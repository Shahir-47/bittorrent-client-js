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
	let socket = null;
	let downloadSuccess = false;

	try {
		// parse the torrent file
		const data = fs.readFileSync(torrentPath);
		const bencodedValue = data.toString("binary");
		const { info } = decodeBencode(bencodedValue);

		const totalLength = info.length;
		const pieceLength = info["piece length"];
		const numPieces = Math.ceil(totalLength / pieceLength);
		const completeFile = Buffer.alloc(totalLength);

		// find peers
		const peers = await Promise.race([
			getPeers(data),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Peer discovery timeout")), 10000)
			),
		]);

		if (!peers?.length) {
			throw new Error("No peers found from tracker");
		}

		// Try connecting to peers until we find one that works
		for (let i = 0; i < Math.min(5, peers.length); i++) {
			const [peerIp, peerPort] = peers[i].split(":");
			const infoHash = calculateSHA1Hash(encodeBencode(info));
			const myPeerId = crypto.randomBytes(20);

			try {
				// Attempt handshake with timeout
				const result = await Promise.race([
					doHandshake(peerIp, Number(peerPort), infoHash, myPeerId),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error("Handshake timeout")), 5000)
					),
				]);
				socket = result.socket;

				// setting up socket event handlers once - this prevents memory leaks
				socket.setMaxListeners(20);
				socket.once("error", (error) => {
					console.error(`Socket error: ${error.message}`);
				});
				socket.once("timeout", () => {
					console.error("Socket timeout occurred");
					socket.destroy();
				});
				socket.setTimeout(30000);

				break;
			} catch (error) {
				console.error(
					`Failed to connect to peer ${peerIp}:${peerPort}: ${error.message}`
				);
				if (socket) {
					socket.destroy();
					socket = null;
				}
			}
		}

		if (!socket) {
			throw new Error("Failed to connect to any peers");
		}

		// Handle the optional bitfield message
		try {
			await Promise.race([
				waitForBitfield(socket),
				new Promise((resolve) => setTimeout(resolve, 2000)),
			]);
		} catch {
			console.log("No bitfield received, continuing");
		}

		// Essential protocol messages
		await sendInterested(socket);
		await Promise.race([
			waitForUnchoke(socket),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Unchoke timeout")), 5000)
			),
		]);

		// Download pieces sequentially
		const BLOCK_SIZE = 16 * 1024;
		const PIPELINE_SIZE = 10;
		const MAX_BLOCK_RETRIES = 3;

		for (let pieceIndex = 0; pieceIndex < numPieces; pieceIndex++) {
			const isLastPiece = pieceIndex === numPieces - 1;
			const currentPieceLength = isLastPiece
				? totalLength - pieceLength * (numPieces - 1)
				: pieceLength;

			const pieceBuffer = Buffer.alloc(currentPieceLength);
			let offset = 0;

			while (offset < currentPieceLength) {
				let retryCount = 0;
				let success = false;

				while (!success && retryCount < MAX_BLOCK_RETRIES) {
					try {
						const promises = [];
						const blockCount = Math.min(
							PIPELINE_SIZE,
							Math.ceil((currentPieceLength - offset) / BLOCK_SIZE)
						);

						// Request all blocks in the current pipeline
						for (let i = 0; i < blockCount; i++) {
							const begin = offset + i * BLOCK_SIZE;
							const size = Math.min(BLOCK_SIZE, currentPieceLength - begin);
							sendRequest(socket, pieceIndex, begin, size);

							// Each readPieceMessage gets its own error handler
							const blockPromise = readPieceMessage(
								socket,
								pieceIndex,
								begin
							).catch((error) => {
								throw new Error(`Block read failed: ${error.message}`);
							});

							promises.push(blockPromise);
						}

						const responses = await Promise.race([
							Promise.all(promises),
							new Promise((_, reject) =>
								setTimeout(
									() => reject(new Error("Block batch timeout")),
									10000
								)
							),
						]);

						for (const response of responses) {
							response.blockData.copy(pieceBuffer, response.begin);
						}

						offset += BLOCK_SIZE * blockCount;
						success = true;
					} catch (error) {
						retryCount++;
						if (socket.destroyed) {
							throw new Error("Socket disconnected");
						}
						await new Promise((resolve) =>
							setTimeout(resolve, 1000 * retryCount)
						);
					}
				}

				if (!success) {
					throw new Error(
						`Failed to download piece ${pieceIndex} after ${MAX_BLOCK_RETRIES} attempts`
					);
				}
			}

			// Verify the piece hash
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
				throw new Error(`Piece ${pieceIndex} hash verification failed`);
			}

			pieceBuffer.copy(completeFile, pieceIndex * pieceLength);
			console.log(
				`Successfully downloaded piece ${pieceIndex}/${
					numPieces - 1
				} (${Math.round(((pieceIndex + 1) / numPieces) * 100)}%)`
			);
		}

		fs.writeFileSync(outFile, completeFile);
		console.log(`Download complete! File saved to ${outFile}`);
		downloadSuccess = true;
	} finally {
		// Clean up resources
		if (socket) {
			socket.removeAllListeners();
			socket.end();
			socket.destroy();
			socket = null;
		}

		if (!downloadSuccess && outFile) {
			try {
				fs.unlinkSync(outFile);
			} catch {
				// Ignore cleanup errors
			}
		}

		// exit
		process.nextTick(() => {
			process.exit(0);
		});
	}
}

module.exports = { downloadComplete };
