const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const crypto = require("crypto");
const { magnetParse } = require("./magnet_parse");
const { sendInterested } = require("../peerMessage/send_interested");
const { waitForUnchoke } = require("../peerMessage/wait_for_unchoke");
const { sendRequest } = require("../peerMessage/send_request");
const { readPieceMessage } = require("../peerMessage/read_piece_message");
const {
	urlEncodeBytes,
	connectToPeer,
	getPeersFromTracker,
	generateRandomPeerId,
	verifyPieceHash,
	getMetadataFromPeer,
} = require("../utility");

class DHTNode {
	constructor() {
		this.socket = dgram.createSocket("udp4");
		this.nodeId = crypto.randomBytes(20);
		this.peers = new Set();
	}

	async findPeers(infoHash, timeout = 5000) {
		return new Promise((resolve) => {
			setTimeout(() => {
				this.socket.close();
				resolve([]);
			}, timeout);
		});
	}
}

async function downloadCompleteFromMagnet(magnetLink, outPath) {
	const { socket, info } = await setupMagnetConnection(magnetLink);

	try {
		sendInterested(socket);
		await waitForUnchoke(socket);

		if (info.files) {
			await downloadMultipleFiles(socket, info, outPath);
		} else {
			await downloadSingleFile(socket, info, outPath);
		}
	} finally {
		socket.destroy();
	}
}

async function downloadMultipleFiles(socket, info, outDir) {
	let offset = 0;
	fs.mkdirSync(outDir, { recursive: true });

	for (const file of info.files) {
		const filePath = path.join(outDir, ...file.path);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });

		const startPiece = Math.floor(offset / info["piece length"]);
		const endPiece = Math.floor(
			(offset + file.length - 1) / info["piece length"]
		);

		const fileBuffer = await downloadPiecesRange(
			socket,
			info,
			startPiece,
			endPiece,
			offset % info["piece length"],
			file.length
		);

		fs.writeFileSync(filePath, fileBuffer);
		offset += file.length;
	}
}

async function downloadSingleFile(socket, info, outFile) {
	const pieceLength = info["piece length"];
	const totalLength = info.length;
	const numPieces = Math.ceil(totalLength / pieceLength);

	const fileBuffer = await downloadPiecesRange(
		socket,
		info,
		0,
		numPieces - 1,
		0,
		totalLength
	);

	fs.writeFileSync(outFile, fileBuffer);
}

async function downloadPiecesRange(
	socket,
	info,
	startPiece,
	endPiece,
	startOffset,
	length
) {
	const fileBuffer = Buffer.alloc(length);
	let fileOffset = 0;

	for (let pieceIndex = startPiece; pieceIndex <= endPiece; pieceIndex++) {
		const pieceLength = info["piece length"];
		const isLastPiece = pieceIndex === Math.floor(info.length / pieceLength);
		const currentPieceLength = isLastPiece
			? info.length - pieceLength * Math.floor(info.length / pieceLength)
			: pieceLength;

		const pieceBuffer = Buffer.alloc(currentPieceLength);
		await downloadPiece(socket, pieceIndex, pieceBuffer, currentPieceLength);
		verifyPieceHash(pieceBuffer, info.pieces, pieceIndex);

		const pieceStart = pieceIndex === startPiece ? startOffset : 0;
		const pieceContribution = Math.min(
			pieceBuffer.length - pieceStart,
			length - fileOffset
		);

		pieceBuffer.copy(
			fileBuffer,
			fileOffset,
			pieceStart,
			pieceStart + pieceContribution
		);
		fileOffset += pieceContribution;

		console.log(`Downloaded piece ${pieceIndex}/${endPiece}`);
	}

	return fileBuffer;
}

async function downloadPiece(socket, pieceIndex, pieceBuffer, pieceLength) {
	const BLOCK_SIZE = 16 * 1024;
	const PIPELINE_SIZE = 10;
	let offset = 0;

	while (offset < pieceLength) {
		const promises = [];
		const blockCount = Math.min(
			PIPELINE_SIZE,
			Math.ceil((pieceLength - offset) / BLOCK_SIZE)
		);

		for (let i = 0; i < blockCount; i++) {
			const begin = offset + i * BLOCK_SIZE;
			const size = Math.min(BLOCK_SIZE, pieceLength - begin);

			sendRequest(socket, pieceIndex, begin, size);
			promises.push(
				readPieceMessage(socket, pieceIndex, begin).then((response) => {
					response.blockData.copy(pieceBuffer, response.begin);
					return response;
				})
			);
		}

		try {
			await Promise.all(promises);
		} catch (error) {
			console.error(
				`Failed to download blocks at offset ${offset}, retrying...`
			);
			continue;
		}

		offset += BLOCK_SIZE * blockCount;
	}
}

async function setupMagnetConnection(magnetLink) {
	const parsedMagnet = magnetParse(magnetLink);
	const infoHashBinary = Buffer.from(parsedMagnet.infoHash, "hex");
	const peerId = generateRandomPeerId();

	// Get peers primarily from tracker, with DHT as fallback
	const peers = await getPeersFromTracker(
		parsedMagnet.trackerURL,
		urlEncodeBytes(infoHashBinary),
		peerId,
		79752
	);

	if (peers.length === 0) {
		// Only try DHT if tracker fails
		const dht = new DHTNode();
		const dhtPeers = await dht.findPeers(parsedMagnet.infoHash);
		peers.push(...dhtPeers);
	}

	if (peers.length === 0) {
		throw new Error("No peers found");
	}

	for (let i = 0; i < Math.min(3, peers.length); i++) {
		try {
			const socket = await connectToPeer(
				peers[i],
				parsedMagnet.infoHash,
				peerId
			);
			socket.setMaxListeners(20);
			const info = await getMetadataFromPeer(socket);
			return { socket, info };
		} catch (error) {
			console.error(`Failed with peer ${i}:`, error.message);
			continue;
		}
	}

	throw new Error("Failed to connect to any peers");
}

module.exports = { downloadCompleteFromMagnet };
