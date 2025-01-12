const process = require("process");
const fs = require("fs");

const { decodeBencode } = require("./decode_bencode");
const { getInfo } = require("./info");
const { getPeers } = require("./peers");
const { sendHandshake } = require("./handshake");
const { downloadPiece } = require("./download_piece");
const { downloadComplete } = require("./download_complete");
const { magnetParse } = require("./magnet_parse");

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
	} else if (command === "download") {
		const outFlagIndex = process.argv.indexOf("-o");
		if (outFlagIndex === -1) {
			throw new Error("Must specify -o <output_file>");
		}
		const outFile = process.argv[outFlagIndex + 1];
		const torrentPath = process.argv[outFlagIndex + 2];

		downloadComplete(torrentPath, outFile)
			.then(() => {
				console.log(`Downloaded torrent to ${outFile}`);
			})
			.catch((err) => {
				console.error("Failed to download torrent:", err);
			});
	} else if (command === "magnet_parse") {
		const magnetURI = process.argv[3];
		const parsed = magnetParse(magnetURI);

		console.log("Tracker URL:", parsed.trackerURL);
		console.log("Info Hash:", parsed.infoHash);
	} else {
		throw new Error(`Unknown command ${command}`);
	}
}

main();
