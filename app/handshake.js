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
				const handshakeMsg = buildHandshake(infoHash, myPeerId);
				socket.write(handshakeMsg);
			}
		);

		let receivedData = Buffer.alloc(0);

		function onData(chunk) {
			receivedData = Buffer.concat([receivedData, chunk]);

			if (receivedData.length >= 68) {
				const peerHandshake = receivedData.slice(0, 68);
				const peerIdFromPeer = peerHandshake.slice(48, 68);

				receivedData = receivedData.slice(68);
				cleanup();

				resolve({ socket, peerIdFromPeer });
			}
		}

		function onError(err) {
			cleanup();
			reject(err);
		}

		function cleanup() {
			socket.removeListener("data", onData);
			socket.removeListener("error", onError);
		}

		socket.on("data", onData);
		socket.on("error", onError);
	});
}

module.exports = { sendHandshake, doHandshake };
