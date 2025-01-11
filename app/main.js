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
		const [peerIp, peerPort] = process.argv[4].split(":");

		sendHandshake(process.argv[3], peerIp, peerPort).then(
			({ peerIdFromPeer }) => {
				console.log("Peer ID:", peerIdFromPeer.toString("hex"));
			}
		);
	} else if (command === "download_piece") {
		const outFlagIndex = process.argv.indexOf("-o");
		if (outFlagIndex === -1) {
			throw new Error(
				"Must specify -o <output_file> before the .torrent file and piece index"
			);
		}

		const outFile = process.argv[outFlagIndex + 1];
		const torrentPath = process.argv[outFlagIndex + 2];
		const pieceIndex = Number(process.argv[outFlagIndex + 3]);

		downloadPiece(torrentPath, pieceIndex, outFile)
			.then(() => {
				console.log(`Downloaded piece #${pieceIndex} to ${outFile}`);
			})
			.catch((err) => {
				console.error("Failed to download piece:", err);
			});
	} else {
		throw new Error(`Unknown command ${command}`);
	}
}

main();
