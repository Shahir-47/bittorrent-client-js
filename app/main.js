const process = require("process");
const fs = require("fs");

const { decodeBencode } = require("./decode_bencode");
const { getInfo } = require("./info");
const { getPeers } = require("./peers");
const { sendHandshake } = require("./handshake");
const { downloadPiece } = require("./download_piece");

function main() {
	const command = process.argv[2];

	console.error("Logs from your program will appear here!");

	if (command === "decode") {
		console.log(JSON.stringify(decodeBencode(process.argv[3])));
	} else if (command === "info") {
		let info = getInfo(fs.readFileSync(process.argv[3]));

		console.log("Tracker URL:", info["trackerURL"]);
		console.log("Length:", info["length"]);
		console.log("Info Hash:", info["infoHash"]);
		console.log("Piece Length:", info["pieceLength"]);
		console.log("Piece Hashes:");
		for (let pieceHash of info["pieceHashes"]) {
			console.log(pieceHash);
		}
	} else if (command === "peers") {
		getPeers(fs.readFileSync(process.argv[3])).then((peers) => {
			for (let peer of peers) {
				console.log(peer);
			}
		});
	} else if (command === "handshake") {
		const torrentPath = process.argv[3];
		const [peerIp, peerPort] = process.argv[4].split(":");

		sendHandshake(torrentPath, peerIp, peerPort).then((peerId) => {
			console.log("Peer ID:", peerId.toString("hex"));
		});
	} else if (command === "download_piece") {
	} else {
		throw new Error(`Unknown command ${command}`);
	}
}

main();
