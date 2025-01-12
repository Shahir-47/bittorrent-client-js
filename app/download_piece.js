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
	const data = fs.readFileSync(torrentPath);
	const bencodedValue = data.toString("binary");
	const { info } = decodeBencode(bencodedValue);

	const peers = await getPeers(data);
	if (!peers.length) {
		throw new Error("No peers found from tracker!");
	}

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
		await waitForBitfield(socket);
		await sendInterested(socket);
		await waitForUnchoke(socket);

		const pieceLength = info["piece length"];
		const totalLength = info.length;
		const actualPieceLength =
			pieceIndex === Math.floor(totalLength / pieceLength)
				? totalLength % pieceLength
				: pieceLength;

		const pieceBuffer = Buffer.alloc(actualPieceLength);
		const BLOCK_SIZE = 16 * 1024;
		let offset = 0;

		// Pipeline 5 requests at a time
		while (offset < actualPieceLength) {
			const promises = [];

			// Send up to 5 requests
			for (
				let i = 0;
				i < 5 && offset + i * BLOCK_SIZE < actualPieceLength;
				i++
			) {
				const begin = offset + i * BLOCK_SIZE;
				const size = Math.min(BLOCK_SIZE, actualPieceLength - begin);
				sendRequest(socket, pieceIndex, begin, size);
				promises.push(readPieceMessage(socket, pieceIndex, begin));
			}

			// Wait for all responses
			const responses = await Promise.all(promises);

			// Process responses
			for (const { blockData, begin } of responses) {
				blockData.copy(pieceBuffer, begin);
			}

			offset += BLOCK_SIZE * promises.length;
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
			throw new Error(`Piece hash mismatch`);
		}

		fs.writeFileSync(outFile, pieceBuffer);
	} finally {
		socket.end();
		socket.destroy();
	}
}

module.exports = { downloadPiece };
