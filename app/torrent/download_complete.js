const fs = require("fs");
const crypto = require("crypto");
const { decodeBencode } = require("../bencode/decode_bencode");
const { encodeBencode } = require("../bencode/encode_bencode");
const { calculateSHA1Hash } = require("../utility");
const { doHandshake } = require("./handshake");
const { getPeers } = require("./peers");
const { waitForBitfield } = require("../peerMessage/wait_for_bitfield");
const { sendInterested } = require("../peerMessage/send_interested");
const { waitForUnchoke } = require("../peerMessage/wait_for_unchoke");
const { sendRequest } = require("../peerMessage/send_request");
const { readPieceMessage } = require("../peerMessage/read_piece_message");

async function downloadComplete(torrentPath, outFile) {
	// Read and parse torrent file
	const data = fs.readFileSync(torrentPath);
	const bencodedValue = data.toString("binary");
	const { info } = decodeBencode(bencodedValue);

	const totalLength = info.length;
	const pieceLength = info["piece length"];
	const numPieces = Math.ceil(totalLength / pieceLength);

	// Create our output file buffer
	const completeFile = Buffer.alloc(totalLength);

	// Get peers from tracker
	const peers = await getPeers(data);
	if (!peers.length) {
		throw new Error("No peers found");
	}

	// Try to establish connection with first peer
	const [peerIp, peerPort] = peers[0].split(":");
	const infoHash = calculateSHA1Hash(encodeBencode(info));
	const myPeerId = crypto.randomBytes(20);

	const { socket } = await doHandshake(
		peerIp,
		Number(peerPort),
		infoHash,
		myPeerId
	);

	try {
		// Initial connection sequence with 2 second timeouts
		await Promise.race([
			waitForBitfield(socket),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Bitfield timeout")), 2000)
			),
		]);

		await sendInterested(socket);

		await Promise.race([
			waitForUnchoke(socket),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Unchoke timeout")), 2000)
			),
		]);

		// Download pieces sequentially with pipelining
		const BLOCK_SIZE = 16 * 1024;
		const PIPELINE_SIZE = 10;

		for (let pieceIndex = 0; pieceIndex < numPieces; pieceIndex++) {
			const isLastPiece = pieceIndex === numPieces - 1;
			const currentPieceLength = isLastPiece
				? totalLength - pieceLength * (numPieces - 1)
				: pieceLength;

			const pieceBuffer = Buffer.alloc(currentPieceLength);
			let offset = 0;

			// Download blocks with pipelining
			while (offset < currentPieceLength) {
				const promises = [];
				const blockCount = Math.min(
					PIPELINE_SIZE,
					Math.ceil((currentPieceLength - offset) / BLOCK_SIZE)
				);

				// Send all requests in the pipeline immediately
				for (let i = 0; i < blockCount; i++) {
					const begin = offset + i * BLOCK_SIZE;
					const size = Math.min(BLOCK_SIZE, currentPieceLength - begin);

					// Send request without waiting
					sendRequest(socket, pieceIndex, begin, size);

					// Create promise for response with timeout
					const blockPromise = Promise.race([
						readPieceMessage(socket, pieceIndex, begin),
						new Promise((_, reject) =>
							setTimeout(() => reject(new Error("Block timeout")), 1000)
						),
					]);

					promises.push(blockPromise);
				}

				// Wait for all blocks in this pipeline batch
				const responses = await Promise.all(promises).catch(async (error) => {
					// On error, wait briefly and retry the whole batch
					await new Promise((resolve) => setTimeout(resolve, 100));
					throw error;
				});

				// Process responses
				for (const { blockData, begin } of responses) {
					blockData.copy(pieceBuffer, begin);
				}

				offset += BLOCK_SIZE * promises.length;
			}

			// Verify piece hash
			const expectedHashBinary = info.pieces.slice(
				pieceIndex * 20,
				pieceIndex * 20 + 20
			);
			const expectedHashHex = Buffer.from(
				expectedHashBinary,
				"binary"
			).toString("hex");
			const actualHashHex = crypto
				.createHash("sha1")
				.update(pieceBuffer)
				.digest("hex");

			if (actualHashHex !== expectedHashHex) {
				throw new Error(`Piece ${pieceIndex} hash mismatch`);
			}

			// Copy piece to final buffer and log progress
			pieceBuffer.copy(completeFile, pieceIndex * pieceLength);
			console.log(`Downloaded piece ${pieceIndex}`);
		}

		// Write the complete file
		fs.writeFileSync(outFile, completeFile);
	} finally {
		socket.end();
		socket.destroy();
	}
}

module.exports = { downloadComplete };
