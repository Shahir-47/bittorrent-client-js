const fs = require("fs");
const crypto = require("crypto");
const { decodeBencode } = require("./decode_bencode");
const { encodeBencode } = require("./encode_bencode");
const { calculateSHA1Hash } = require("./utility");
const { doHandshake } = require("./handshake");
const { getPeers } = require("./peers");
const { waitForBitfield } = require("./peerMessage/wait_for_bitfield");
const { sendInterested } = require("./peerMessage/send_interested");
const { waitForUnchoke } = require("./peerMessage/wait_for_unchoke");
const { sendRequest } = require("./peerMessage/send_request");
const { readPieceMessage } = require("./peerMessage/read_piece_message");

async function downloadPiece(torrentPath, pieceIndex, outFile) {
	// Read and parse torrent file
	const data = fs.readFileSync(torrentPath);
	const bencodedValue = data.toString("binary");
	const { info } = decodeBencode(bencodedValue);

	// Connect to peer
	const peers = await getPeers(data);
	if (!peers.length) {
		throw new Error("No peers found from tracker!");
	}

	// Try multiple peers if needed
	let socket;
	for (let i = 0; i < Math.min(3, peers.length); i++) {
		const [peerIp, peerPort] = peers[i].split(":");
		const infoHash = calculateSHA1Hash(encodeBencode(info));
		const myPeerId = crypto.randomBytes(20);

		try {
			const result = await doHandshake(
				peerIp,
				Number(peerPort),
				infoHash,
				myPeerId
			);
			socket = result.socket;
			break;
		} catch (error) {
			console.error(`Failed to connect to peer ${i}:`, error.message);
			continue;
		}
	}

	if (!socket) {
		throw new Error("Failed to connect to any peers");
	}

	try {
		// Set socket timeout
		socket.setTimeout(8000); // 8 second timeout

		// Initial handshake sequence
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

		// Calculate piece parameters
		const pieceLength = info["piece length"];
		const totalLength = info.length;
		const actualPieceLength =
			pieceIndex === Math.floor(totalLength / pieceLength)
				? totalLength % pieceLength
				: pieceLength;

		const pieceBuffer = Buffer.alloc(actualPieceLength);
		const BLOCK_SIZE = 16 * 1024;
		const PIPELINE_SIZE = 5;

		// Create blocks array
		const blocks = [];
		for (let offset = 0; offset < actualPieceLength; offset += BLOCK_SIZE) {
			blocks.push({
				offset,
				size: Math.min(BLOCK_SIZE, actualPieceLength - offset),
			});
		}

		// Download blocks with retries
		let completedBlocks = 0;
		while (completedBlocks < blocks.length) {
			const activeRequests = [];

			// Fill the pipeline
			while (
				activeRequests.length < PIPELINE_SIZE &&
				completedBlocks + activeRequests.length < blocks.length
			) {
				const block = blocks[completedBlocks + activeRequests.length];
				sendRequest(socket, pieceIndex, block.offset, block.size);

				const requestPromise = Promise.race([
					readPieceMessage(socket, pieceIndex, block.offset),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error("Block timeout")), 2000)
					),
				]).then((response) => {
					response.blockData.copy(pieceBuffer, response.begin);
					return response;
				});

				activeRequests.push(requestPromise);
			}

			try {
				await Promise.all(activeRequests);
				completedBlocks += activeRequests.length;
			} catch (error) {
				// retry the failed blocks in the next iteration
				console.error("Block download failed, retrying:", error.message);
			}
		}

		// Verify hash
		const pieceHashes = info.pieces;
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

		fs.writeFileSync(outFile, pieceBuffer);
	} finally {
		socket.end();
		socket.destroy();
	}
}

module.exports = { downloadPiece };
