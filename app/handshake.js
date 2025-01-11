const fs = require("fs");
const crypto = require("crypto");
const net = require("net");

const { decodeBencode } = require("./decode_bencode");
const { encodeBencode } = require("./encode_bencode");
const { calculateSHA1Hash } = require("./utility");

function sendHandshake(torrentPath, peerIp, peerPort) {
	const data = fs.readFileSync(torrentPath);
	const bencodedValue = data.toString("binary");
	const { info } = decodeBencode(bencodedValue);

	const infoHash = calculateSHA1Hash(encodeBencode(info));
	const myPeerId = crypto.randomBytes(20);

	return doHandshake(peerIp, Number(peerPort), infoHash, myPeerId)
		.then(({ socket, peerIdFromPeer }) => {
			return { socket, peerIdFromPeer };
		})
		.catch((err) => {
			return err;
		});
}

function buildHandshake(infoHashBuffer, myPeerIdBuffer) {
	const handshake = Buffer.alloc(68);

	handshake.writeUInt8(19, 0);
	handshake.write("BitTorrent protocol", 1, 19, "ascii");
	infoHashBuffer.copy(handshake, 28);
	myPeerIdBuffer.copy(handshake, 48);

	return handshake;
}

function doHandshake(peerIp, peerPort, infoHash, myPeerId) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(
			{ host: peerIp, port: peerPort },
			() => {
				console.log("Connected to peer:", peerIp, peerPort);
				const handshakeMsg = buildHandshake(infoHash, myPeerId);
				socket.write(handshakeMsg);
			}
		);

		let receivedData = Buffer.alloc(0);

		socket.on("data", (chunk) => {
			receivedData = Buffer.concat([receivedData, chunk]);

			if (receivedData.length >= 68) {
				const peerHandshake = receivedData.slice(0, 68);

				const pstrlen = peerHandshake.readUInt8(0);
				const pstr = peerHandshake.slice(1, 1 + pstrlen).toString("ascii");
				const infoHashFromPeer = peerHandshake.slice(28, 48);
				const peerIdFromPeer = peerHandshake.slice(48, 68);

				console.log("Got handshake from peer!");
				console.log("pstrlen:", pstrlen, "pstr:", pstr);
				console.log("infoHash (hex):", infoHashFromPeer.toString("hex"));
				console.log("peerId (hex):", peerIdFromPeer.toString("hex"));

				resolve({ socket, peerIdFromPeer });
			}
		});

		socket.on("error", (err) => {
			reject(err);
		});
	});
}

module.exports = { sendHandshake };
