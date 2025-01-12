const { magnetParse } = require("./magnet_parse");
const { decodeBencode } = require("./decode_bencode");
const { urlEncodeBytes } = require("./utility");
const net = require("net");

function createHandshakeMessage(infoHash, peerId) {
	const buffer = Buffer.alloc(68);

	buffer.writeUInt8(19, 0);
	buffer.write("BitTorrent protocol", 1);
	buffer[20] = 0x00;
	buffer[21] = 0x00;
	buffer[22] = 0x00;
	buffer[23] = 0x00;
	buffer[24] = 0x00;
	buffer[25] = 0x10; // Extension support bit
	buffer[26] = 0x00;
	buffer[27] = 0x00;

	Buffer.from(infoHash, "hex").copy(buffer, 28);
	buffer.write(peerId, 48);

	return buffer;
}

function parsePeerString(peers) {
	const peerList = [];
	for (let i = 0; i < peers.length; i += 6) {
		const ip = `${peers.charCodeAt(i)}.${peers.charCodeAt(
			i + 1
		)}.${peers.charCodeAt(i + 2)}.${peers.charCodeAt(i + 3)}`;
		const port = (peers.charCodeAt(i + 4) << 8) + peers.charCodeAt(i + 5);
		peerList.push({ ip, port });
	}
	return peerList;
}

async function performPeerHandshake(peer, infoHash, myPeerId) {
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		const timeout = setTimeout(() => {
			socket.destroy();
			reject(new Error("Handshake timeout"));
		}, 5000);

		socket.on("error", (err) => {
			clearTimeout(timeout);
			socket.destroy();
			reject(err);
		});

		socket.connect(peer.port, peer.ip, () => {
			const handshakeMsg = createHandshakeMessage(infoHash, myPeerId);
			socket.write(handshakeMsg);
		});

		socket.on("data", (data) => {
			clearTimeout(timeout);
			const receivedPeerId = data.slice(48, 68).toString("hex");
			socket.destroy();
			resolve(receivedPeerId);
		});
	});
}

async function performMagnetHandshake(magnetLink) {
	const parsedMagnet = magnetParse(magnetLink);
	if (!parsedMagnet.trackerURL || !parsedMagnet.infoHash) {
		throw new Error("Missing required magnet link parameters");
	}

	const fileSize = 79752;
	const infoHashBinary = Buffer.from(parsedMagnet.infoHash, "hex");
	const infoHashEncoded = urlEncodeBytes(infoHashBinary);
	const peerId = "-SS0001-123456789012";

	let trackerUrl = parsedMagnet.trackerURL;
	if (!trackerUrl.includes("?")) trackerUrl += "?";
	else trackerUrl += "&";

	trackerUrl += `info_hash=${infoHashEncoded}`;
	trackerUrl += `&peer_id=${peerId}`;
	trackerUrl += `&port=6881`;
	trackerUrl += `&uploaded=0`;
	trackerUrl += `&downloaded=0`;
	trackerUrl += `&left=${fileSize}`;
	trackerUrl += `&compact=1`;

	try {
		const response = await fetch(trackerUrl);
		const buffer = await response.arrayBuffer();
		const responseBinary = Buffer.from(buffer).toString("binary");
		const trackerResponse = decodeBencode(responseBinary);

		if (!trackerResponse.peers) {
			throw new Error("No peers received from tracker");
		}

		const peers = parsePeerString(trackerResponse.peers);
		if (peers.length === 0) {
			throw new Error("No valid peers found");
		}

		const receivedPeerId = await performPeerHandshake(
			peers[0],
			parsedMagnet.infoHash,
			peerId
		);

		console.log(`Peer ID: ${receivedPeerId}`);
		return receivedPeerId;
	} catch (error) {
		throw new Error(`Handshake failed: ${error.message}`);
	}
}

async function handleMagnetHandshake(magnetLink) {
	try {
		await performMagnetHandshake(magnetLink);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

module.exports = { performMagnetHandshake, handleMagnetHandshake };
