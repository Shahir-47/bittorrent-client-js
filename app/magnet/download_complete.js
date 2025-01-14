const fs = require("fs");
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

async function downloadCompleteFromMagnet(magnetLink, outFile) {
	// Get initial connection and metadata
	const { socket, info } = await setupMagnetConnection(magnetLink);

	try {
		// Send interested and wait for unchoke
		sendInterested(socket);
		await waitForUnchoke(socket);

		// Calculate total pieces
		const pieceLength = info["piece length"];
		const totalLength = info.length;
		const numPieces = Math.ceil(totalLength / pieceLength);
		const completeFile = Buffer.alloc(totalLength);

		// Download pieces sequentially
		const BLOCK_SIZE = 16 * 1024;
		const PIPELINE_SIZE = 10;

		for (let pieceIndex = 0; pieceIndex < numPieces; pieceIndex++) {
			const isLastPiece = pieceIndex === numPieces - 1;
			const currentPieceLength = isLastPiece
				? totalLength - pieceLength * (numPieces - 1)
				: pieceLength;

			const pieceBuffer = Buffer.alloc(currentPieceLength);
			await downloadPiece(
				socket,
				pieceIndex,
				pieceBuffer,
				currentPieceLength,
				BLOCK_SIZE,
				PIPELINE_SIZE
			);
			verifyPieceHash(pieceBuffer, info.pieces, pieceIndex);

			// Copy piece to final buffer and log progress
			pieceBuffer.copy(completeFile, pieceIndex * pieceLength);
			console.log(`Downloaded piece ${pieceIndex}/${numPieces - 1}`);
		}

		fs.writeFileSync(outFile, completeFile);
	} finally {
		socket.destroy();
	}
}

async function setupMagnetConnection(magnetLink) {
	const parsedMagnet = magnetParse(magnetLink);
	const infoHashBinary = Buffer.from(parsedMagnet.infoHash, "hex");
	const peerId = generateRandomPeerId();

	// Get peers from tracker
	const peers = await getPeersFromTracker(
		parsedMagnet.trackerURL,
		urlEncodeBytes(infoHashBinary),
		peerId,
		79752
	);

	if (peers.length === 0) {
		throw new Error("No peers found");
	}

	// Try to connect to peers
	for (let i = 0; i < Math.min(3, peers.length); i++) {
		try {
			const socket = await connectToPeer(
				peers[i],
				parsedMagnet.infoHash,
				peerId
			);
			const info = await getMetadataFromPeer(socket);
			return { socket, info };
		} catch (error) {
			console.error(`Failed with peer ${i}:`, error.message);
			continue;
		}
	}
	throw new Error("Failed to connect to any peers");
}

async function downloadPiece(
	socket,
	pieceIndex,
	pieceBuffer,
	pieceLength,
	BLOCK_SIZE,
	PIPELINE_SIZE
) {
	let offset = 0;
	while (offset < pieceLength) {
		const promises = [];
		const blockCount = Math.min(
			PIPELINE_SIZE,
			Math.ceil((pieceLength - offset) / BLOCK_SIZE)
		);

		// Send all requests in the pipeline
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

module.exports = { downloadCompleteFromMagnet };
