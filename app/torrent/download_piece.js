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
		socket.setTimeout(30000); // 8 second timeout

		// Initial handshake sequence
		try {
			await Promise.race([
				waitForBitfield(socket),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Bitfield timeout")), 2000)
				),
			]);
		} catch (error) {
			console.log("No bitfield received, continuing anyway");
		}

		await sendInterested(socket);
		await waitForUnchoke(socket);

		// Calculate piece parameters
		const pieceLength = info["piece length"];
		const totalLength = info.length;
		const actualPieceLength =
			pieceIndex === Math.floor(totalLength / pieceLength)
				? totalLength % pieceLength
				: pieceLength;

		const pieceBuffer = Buffer.alloc(actualPieceLength);
		const BLOCK_SIZE = 16 * 1024;

		// Create blocks array
		const blocks = [];
		for (let offset = 0; offset < actualPieceLength; offset += BLOCK_SIZE) {
			blocks.push({
				offset,
				size: Math.min(BLOCK_SIZE, actualPieceLength - offset),
			});
		}

		// Download blocks with retries
		const PIPELINE_SIZE = 5;
		let completedBlocks = 0;
		let retryCount = 0;
		const MAX_RETRIES = 3;

		while (completedBlocks < blocks.length && retryCount < MAX_RETRIES) {
			try {
				const activeRequests = [];
				const remainingBlocks = Math.min(
					PIPELINE_SIZE,
					blocks.length - completedBlocks
				);

				for (let i = 0; i < remainingBlocks; i++) {
					const block = blocks[completedBlocks + i];
					sendRequest(socket, pieceIndex, block.offset, block.size);
					activeRequests.push(
						readPieceMessage(socket, pieceIndex, block.offset).then(
							(response) => {
								response.blockData.copy(pieceBuffer, response.begin);
								return response;
							}
						)
					);
				}

				await Promise.all(activeRequests);
				completedBlocks += remainingBlocks;
				retryCount = 0; // Reset retry count on success
			} catch (error) {
				console.error(
					`Download attempt ${retryCount + 1} failed: ${error.message}`
				);
				retryCount++;
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait before retry
			}
		}

		if (completedBlocks < blocks.length) {
			throw new Error("Failed to download piece after maximum retries");
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
