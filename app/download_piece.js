// download_piece.js
const fs = require("fs");
const crypto = require("crypto");
const { decodeBencode } = require("./decode_bencode");
const { encodeBencode } = require("./encode_bencode");
const { calculateSHA1Hash } = require("./utility");
const { doHandshake } = require("./handshake");
const { getPeers } = require("./peers");
const { waitForBitfield } = require("./peerMessage/wait_for_bitfield");

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
	const [peerIp, peerPort] = peers[0].split(":");
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

	await waitForBitfield(socket);

	console.log(
		"Got bitfield. Next steps: send 'interested', wait 'unchoke', etc."
	);

	// TODO

	fs.writeFileSync(outFile, "dummy data");
	console.log(`Wrote piece #${pieceIndex} to ${outFile}`);
}

module.exports = { downloadPiece };
