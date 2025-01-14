const crypto = require("crypto");
const net = require("net");
const { decodeBencode } = require("./bencode/decode_bencode");
const {
	createExtensionHandshake,
	parseExtensionHandshake,
} = require("./magnet/extension_handshake");
const {
	createMetadataRequestMessage,
	parseMetadataMessage,
} = require("./magnet/metadata_exchange");

function parsePeers(peersBinary) {
	const peers = [];
	for (let i = 0; i < peersBinary.length; i += 6) {
		const ipBytes = peersBinary.slice(i, i + 4);
		const portBytes = peersBinary.slice(i + 4, i + 6);

		const ip = [
			ipBytes.charCodeAt(0),
			ipBytes.charCodeAt(1),
			ipBytes.charCodeAt(2),
			ipBytes.charCodeAt(3),
		].join(".");

		const port = (portBytes.charCodeAt(0) << 8) + portBytes.charCodeAt(1);

		peers.push(`${ip}:${port}`);
	}
	return peers;
}

function calculateSHA1Hash(bencodedValue, encoding = "binary") {
	const hash = crypto.createHash("sha1");
	hash.update(bencodedValue, "binary");
	return encoding === "binary" ? hash.digest() : hash.digest(encoding);
}

function urlEncodeBytes(buf) {
	let out = "";
	for (const byte of buf) {
		// Each byte -> %xx format
		out += "%" + byte.toString(16).padStart(2, "0");
	}
	return out;
}

function createHandshakeMessage(infoHash, peerId) {
	const buffer = Buffer.alloc(68);
	buffer.writeUInt8(19, 0);
	buffer.write("BitTorrent protocol", 1);

	// Set reserved bytes with extension support
	buffer[20] = 0x00;
	buffer[21] = 0x00;
	buffer[22] = 0x00;
	buffer[23] = 0x00;
	buffer[24] = 0x00;
	buffer[25] = 0x10; // Extension support bit
	buffer[26] = 0x00;
	buffer[27] = 0x00;

	Buffer.from(infoHash, "hex").copy(buffer, 28);
	buffer.write(peerId, 48);
	return buffer;
}

function parsePeerString(peers) {
	const peerList = [];
	for (let i = 0; i < peers.length; i += 6) {
		const ip = `${peers.charCodeAt(i)}.${peers.charCodeAt(
			i + 1
		)}.${peers.charCodeAt(i + 2)}.${peers.charCodeAt(i + 3)}`;
		const port = (peers.charCodeAt(i + 4) << 8) + peers.charCodeAt(i + 5);
		peerList.push({ ip, port });
	}
	return peerList;
}

function generateRandomPeerId() {
	const prefix = "-SS0001-";
	const randomPart = Array.from({ length: 12 }, () =>
		Math.floor(Math.random() * 36).toString(36)
	).join("");

	return prefix + randomPart;
}

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

module.exports = {
	parsePeers,
	parsePeerString,
	calculateSHA1Hash,
	urlEncodeBytes,
	createHandshakeMessage,
	generateRandomPeerId,
	getPeersFromTracker,
	connectToPeer,
	verifyPieceHash,
	getMetadataFromPeer,
	processMessages,
	handleMessage,
};
