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

async function downloadComplete(torrentPath, outFile) {
	const data = fs.readFileSync(torrentPath);
	const bencodedValue = data.toString("binary");
	const { info } = decodeBencode(bencodedValue);
	const peers = await getPeers(data);

	if (!peers.length) {
		throw new Error("No peers found");
	}

	const totalLength = info.length;
	const pieceLength = info["piece length"];
	const numPieces = Math.ceil(totalLength / pieceLength);
	const completeFile = Buffer.alloc(totalLength);

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

		for (let pieceIndex = 0; pieceIndex < numPieces; pieceIndex++) {
			const isLastPiece = pieceIndex === numPieces - 1;
			const currentPieceLength = isLastPiece
				? totalLength - pieceLength * (numPieces - 1)
				: pieceLength;

			const pieceBuffer = Buffer.alloc(currentPieceLength);
			let offset = 0;
			const BLOCK_SIZE = 16 * 1024;

			while (offset < currentPieceLength) {
				const promises = [];
				for (
					let i = 0;
					i < 5 && offset + i * BLOCK_SIZE < currentPieceLength;
					i++
				) {
					const begin = offset + i * BLOCK_SIZE;
					const size = Math.min(BLOCK_SIZE, currentPieceLength - begin);
					sendRequest(socket, pieceIndex, begin, size);
					promises.push(readPieceMessage(socket, pieceIndex, begin));
				}

				const responses = await Promise.all(promises);
				for (const { blockData, begin } of responses) {
					blockData.copy(pieceBuffer, begin);
				}
				offset += BLOCK_SIZE * promises.length;
			}

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

			pieceBuffer.copy(completeFile, pieceIndex * pieceLength);
			console.log(`Downloaded piece ${pieceIndex}/${numPieces - 1}`);
		}

		fs.writeFileSync(outFile, completeFile);
	} finally {
		socket.end();
		socket.destroy();
	}
}

module.exports = { downloadComplete };
