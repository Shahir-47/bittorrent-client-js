// download_piece.js
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
	const { announce, info } = decodeBencode(bencodedValue);

	const peers = await getPeers(data);
	if (!peers.length) {
		throw new Error("No peers found from tracker!");
	}
	console.log("Found peers:", peers);

	// For now, pick the first peer from the list
	const [peerIp, peerPort] = peers[1].split(":");
	console.log(`Connecting to peer ${peerIp}:${peerPort}...`);

	const infoHash = calculateSHA1Hash(encodeBencode(info));
	const myPeerId = crypto.randomBytes(20);
	const { socket, peerIdFromPeer } = await doHandshake(
		peerIp,
		Number(peerPort),
		infoHash,
		myPeerId
	);

	console.log("Handshake complete! Peer ID is", peerIdFromPeer.toString("hex"));

	try {
		await waitForBitfield(socket);
		await sendInterested(socket);
		await waitForUnchoke(socket);

		const pieceLength = info["piece length"];
		const totalLength = info.length;

		// Calculate actual piece size (last piece might be smaller)
		const actualPieceLength =
			pieceIndex === Math.floor(totalLength / pieceLength)
				? totalLength % pieceLength
				: pieceLength;

		const pieceBuffer = Buffer.alloc(actualPieceLength);
		let offset = 0;
		const BLOCK_SIZE = 16 * 1024;

		while (offset < actualPieceLength) {
			const remainingBytes = actualPieceLength - offset;
			const size = Math.min(BLOCK_SIZE, remainingBytes);

			sendRequest(socket, pieceIndex, offset, size);

			const {
				pieceIndex: pIndex,
				begin,
				blockData,
			} = await readPieceMessage(socket, pieceIndex, offset);

			if (pIndex !== pieceIndex || begin !== offset) {
				throw new Error(
					`Peer returned unexpected piece/offset: pIndex=${pIndex}, begin=${begin}`
				);
			}

			blockData.copy(pieceBuffer, offset);
			offset += size;
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
			throw new Error(
				`Piece #${pieceIndex} hash mismatch! Got ${actualHashHex}, expected ${expectedHashHex}`
			);
		}

		fs.writeFileSync(outFile, pieceBuffer);
	} finally {
		socket.end();
		socket.destroy();
	}
}

module.exports = { downloadPiece };
