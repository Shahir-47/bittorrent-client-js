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

class PeerRanking {
	constructor() {
		this.peerScores = new Map();
		this.downloadTimes = new Map();
	}

	startPieceDownload(peerId, pieceIndex) {
		this.downloadTimes.set(`${peerId}-${pieceIndex}`, Date.now());
	}

	endPieceDownload(peerId, pieceIndex, success) {
		const startTime = this.downloadTimes.get(`${peerId}-${pieceIndex}`);
		if (!startTime) return;

		const duration = Date.now() - startTime;
		let score = this.peerScores.get(peerId) || { speed: 0, failures: 0 };

		if (success) {
			// Update speed (lower duration is better)
			const newSpeed = 1000 / duration; // Normalize to speed per second
			score.speed = score.speed * 0.7 + newSpeed * 0.3; // Weighted average
		} else {
			score.failures++;
		}

		this.peerScores.set(peerId, score);
		this.downloadTimes.delete(`${peerId}-${pieceIndex}`);
	}

	getPeerScore(peerId) {
		const score = this.peerScores.get(peerId);
		if (!score) return 0;
		return score.speed / (1 + score.failures);
	}

	rankPeers(peers) {
		return peers.sort((a, b) => {
			const scoreA = this.getPeerScore(a);
			const scoreB = this.getPeerScore(b);
			return scoreB - scoreA;
		});
	}
}

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
	const { socket, info, peerRanking } = await setupMagnetConnection(magnetLink);

	try {
		sendInterested(socket);
		await waitForUnchoke(socket);

		if (info.files) {
			await downloadMultipleFiles(socket, info, outPath, peerRanking);
		} else {
			await downloadSingleFile(socket, info, outPath, peerRanking);
		}
	} finally {
		socket.destroy();
	}
}

async function downloadMultipleFiles(socket, info, outDir, peerRanking) {
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
			file.length,
			peerRanking
		);

		fs.writeFileSync(filePath, fileBuffer);
		offset += file.length;
	}
}

async function downloadSingleFile(socket, info, outFile, peerRanking) {
	const pieceLength = info["piece length"];
	const totalLength = info.length;
	const numPieces = Math.ceil(totalLength / pieceLength);

	const fileBuffer = await downloadPiecesRange(
		socket,
		info,
		0,
		numPieces - 1,
		0,
		totalLength,
		peerRanking
	);

	fs.writeFileSync(outFile, fileBuffer);
}

async function downloadPiecesRange(
	socket,
	info,
	startPiece,
	endPiece,
	startOffset,
	length,
	peerRanking
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
		await downloadPiece(
			socket,
			pieceIndex,
			pieceBuffer,
			currentPieceLength,
			peerRanking
		);
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

async function downloadPiece(
	socket,
	pieceIndex,
	pieceBuffer,
	pieceLength,
	peerRanking
) {
	const BLOCK_SIZE = 16 * 1024;
	const PIPELINE_SIZE = 10;
	let offset = 0;

	if (peerRanking) {
		peerRanking.startPieceDownload(socket.remoteAddress, pieceIndex);
	}

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
			if (peerRanking) {
				peerRanking.endPieceDownload(socket.remoteAddress, pieceIndex, true);
			}
		} catch (error) {
			if (peerRanking) {
				peerRanking.endPieceDownload(socket.remoteAddress, pieceIndex, false);
			}
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
	const peerRanking = new PeerRanking();

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

	// Sort peers by ranking if we have previous performance data
	const rankedPeers = peerRanking.rankPeers(peers);

	for (let i = 0; i < Math.min(3, rankedPeers.length); i++) {
		try {
			const socket = await connectToPeer(
				rankedPeers[i],
				parsedMagnet.infoHash,
				peerId
			);
			socket.setMaxListeners(20);
			const info = await getMetadataFromPeer(socket);
			return { socket, info, peerRanking };
		} catch (error) {
			console.error(`Failed with peer ${i}:`, error.message);
			continue;
		}
	}

	throw new Error("Failed to connect to any peers");
}

module.exports = { downloadCompleteFromMagnet };
