const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const { magnetParse } = require("./magnet_parse");
const { decodeBencode } = require("../bencode/decode_bencode");
const { sendInterested } = require("../peerMessage/send_interested");
const { waitForUnchoke } = require("../peerMessage/wait_for_unchoke");
const { sendRequest } = require("../peerMessage/send_request");
const { readPieceMessage } = require("../peerMessage/read_piece_message");
const {
	urlEncodeBytes,
	createHandshakeMessage,
	parsePeerString,
	generateRandomPeerId,
} = require("../utility");
const {
	parseExtensionHandshake,
	createExtensionHandshake,
} = require("./extension_handshake");
const {
	createMetadataRequestMessage,
	parseMetadataMessage,
} = require("./metadata_exchange");

async function getPeersFromTracker(
	trackerUrl,
	infoHashEncoded,
	peerId,
	fileSize
) {
	const url =
		`${trackerUrl}${trackerUrl.includes("?") ? "&" : "?"}` +
		`info_hash=${infoHashEncoded}&peer_id=${peerId}&port=6881` +
		`&uploaded=0&downloaded=0&left=${fileSize}&compact=1`;

	const response = await fetch(url);
	const buffer = await response.arrayBuffer();
	const trackerResponse = decodeBencode(Buffer.from(buffer).toString("binary"));
	return parsePeerString(trackerResponse.peers || "");
}

async function connectToPeer(peer, infoHash, peerId) {
	const socket = new net.Socket();
	await new Promise((resolve, reject) => {
		socket.connect(peer.port, peer.ip, resolve);
		socket.on("error", reject);
	});
	socket.write(createHandshakeMessage(infoHash, peerId));
	return socket;
}

async function getMetadataFromPeer(socket) {
	return new Promise((resolve, reject) => {
		let dataBuffer = Buffer.alloc(0);
		let state = {
			handshakeReceived: false,
			bitfieldReceived: false,
			extensionHandshakeReceived: false,
			metadataExtensionId: null,
			metadataRequestSent: false,
		};

		socket.on("data", (data) => {
			dataBuffer = Buffer.concat([dataBuffer, data]);
			dataBuffer = processMessages(dataBuffer, state, socket, resolve);
		});
		socket.on("error", reject);
	});
}

function processMessages(buffer, state, socket, resolve) {
	let dataBuffer = buffer;
	if (!state.handshakeReceived && dataBuffer.length >= 68) {
		if (!(dataBuffer[25] & 0x10))
			throw new Error("Peer doesn't support extensions");
		state.handshakeReceived = true;
		dataBuffer = dataBuffer.slice(68);
	}

	while (dataBuffer.length >= 4) {
		const messageLength = dataBuffer.readUInt32BE(0);
		if (dataBuffer.length < messageLength + 4) break;

		const message = dataBuffer.slice(0, messageLength + 4);
		dataBuffer = dataBuffer.slice(messageLength + 4);

		if (messageLength === 0) continue;

		handleMessage(message, state, socket, resolve);
	}
	return dataBuffer;
}

function handleMessage(message, state, socket, resolve) {
	if (!state.bitfieldReceived && message[4] === 5) {
		state.bitfieldReceived = true;
		socket.write(createExtensionHandshake());
		return;
	}

	if (message[4] === 20) {
		if (!state.extensionHandshakeReceived) {
			state.metadataExtensionId = parseExtensionHandshake(message);
			state.extensionHandshakeReceived = true;
			socket.write(createMetadataRequestMessage(state.metadataExtensionId));
			state.metadataRequestSent = true;
		} else if (state.metadataRequestSent) {
			const result = parseMetadataMessage(message);
			resolve(result.metadata);
		}
	}
}

async function downloadBlocks(socket, pieceIndex, blocks, pieceBuffer) {
	const PIPELINE_SIZE = 5;
	let completedBlocks = 0;

	while (completedBlocks < blocks.length) {
		const activeRequests = [];
		const remainingBlocks = Math.min(
			PIPELINE_SIZE,
			blocks.length - completedBlocks
		);

		for (let i = 0; i < remainingBlocks; i++) {
			const block = blocks[completedBlocks + i];
			sendRequest(socket, pieceIndex, block.offset, block.size);
			activeRequests.push(
				readPieceMessage(socket, pieceIndex, block.offset).then((response) => {
					response.blockData.copy(pieceBuffer, response.begin);
					return response;
				})
			);
		}

		await Promise.all(activeRequests);
		completedBlocks += remainingBlocks;
	}
}

function createBlocks(pieceLength) {
	const blocks = [];
	const BLOCK_SIZE = 16 * 1024;
	for (let offset = 0; offset < pieceLength; offset += BLOCK_SIZE) {
		blocks.push({
			offset,
			size: Math.min(BLOCK_SIZE, pieceLength - offset),
		});
	}
	return blocks;
}

function verifyPieceHash(pieceBuffer, pieceHashes, pieceIndex) {
	const expectedHashBinary = pieceHashes.slice(
		pieceIndex * 20,
		pieceIndex * 20 + 20
	);
	const expectedHashHex = Buffer.from(expectedHashBinary, "binary").toString(
		"hex"
	);
	const actualHashHex = crypto
		.createHash("sha1")
		.update(pieceBuffer)
		.digest("hex");

	if (actualHashHex !== expectedHashHex) {
		throw new Error("Piece hash mismatch");
	}
}

async function downloadPieceFromMagnet(magnetLink, pieceIndex, outFile) {
	const parsedMagnet = magnetParse(magnetLink);
	const infoHashBinary = Buffer.from(parsedMagnet.infoHash, "hex");
	const peerId = generateRandomPeerId();

	const peers = await getPeersFromTracker(
		parsedMagnet.trackerURL,
		urlEncodeBytes(infoHashBinary),
		peerId,
		79752
	);

	let socket;
	let info;

	for (let i = 0; i < Math.min(3, peers.length); i++) {
		try {
			socket = await connectToPeer(peers[i], parsedMagnet.infoHash, peerId);
			info = await getMetadataFromPeer(socket);
			break;
		} catch (error) {
			if (socket) socket.destroy();
			continue;
		}
	}

	if (!socket || !info) {
		throw new Error("Failed to connect to any peers");
	}

	try {
		sendInterested(socket);
		await waitForUnchoke(socket);

		const pieceLength = info["piece length"];
		const totalLength = info.length;
		const actualPieceLength =
			pieceIndex === Math.floor(totalLength / pieceLength)
				? totalLength % pieceLength
				: pieceLength;

		const pieceBuffer = Buffer.alloc(actualPieceLength);
		const blocks = createBlocks(actualPieceLength);

		await downloadBlocks(socket, pieceIndex, blocks, pieceBuffer);
		verifyPieceHash(pieceBuffer, info.pieces, pieceIndex);

		fs.writeFileSync(outFile, pieceBuffer);
	} finally {
		socket.destroy();
	}
}

module.exports = { downloadPieceFromMagnet };
