const { magnetParse } = require("./magnet_parse");
const { decodeBencode } = require("./decode_bencode");
const { encodeBencode } = require("./encode_bencode");
const { urlEncodeBytes } = require("./utility");
const net = require("net");

function createHandshakeMessage(infoHash, peerId) {
	const buffer = Buffer.alloc(68);
	buffer.writeUInt8(19, 0);
	buffer.write("BitTorrent protocol", 1);

	// Set reserved bytes with extension support
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

function createExtensionHandshake() {
	const extensionData = {
		m: {
			ut_metadata: 1,
		},
	};

	const bencodedData = encodeBencode(extensionData);
	const messageLength = 4 + 1 + 1 + bencodedData.length;
	const buffer = Buffer.alloc(messageLength);

	buffer.writeUInt32BE(1 + 1 + bencodedData.length, 0);
	buffer.writeUInt8(20, 4); // Extension message type
	buffer.writeUInt8(0, 5); // Handshake type
	Buffer.from(bencodedData).copy(buffer, 6);

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

function parseMessage(buffer) {
	if (buffer.length < 4) return null;

	const length = buffer.readUInt32BE(0);
	if (buffer.length < 4 + length) return null;

	const messageBuffer = buffer.slice(0, 4 + length);
	const remainingBuffer = buffer.slice(4 + length);

	return {
		message: messageBuffer,
		remaining: remainingBuffer,
		length: length,
	};
}

function parseExtensionHandshake(message) {
	// Extension message starts after the 6-byte header
	// (4 bytes length prefix + 1 byte msg type + 1 byte extension ID)
	const payload = message.slice(6);
	const handshakeData = decodeBencode(payload.toString("binary"));

	// Extracting the ut_metadata ID from the extension message
	if (
		handshakeData &&
		handshakeData.m &&
		typeof handshakeData.m.ut_metadata === "number"
	) {
		return handshakeData.m.ut_metadata;
	}

	throw new Error("Invalid extension handshake format");
}

async function performPeerHandshake(peer, infoHash, myPeerId) {
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		let handshakeReceived = false;
		let bitfieldReceived = false;
		let extensionHandshakeReceived = false;
		let receivedPeerId = null;
		let metadataExtensionId = null;
		let dataBuffer = Buffer.alloc(0);

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
			dataBuffer = Buffer.concat([dataBuffer, data]);

			// Handle initial handshake
			if (!handshakeReceived && dataBuffer.length >= 68) {
				receivedPeerId = dataBuffer.slice(48, 68).toString("hex");
				handshakeReceived = true;
				dataBuffer = dataBuffer.slice(68);
				return;
			}

			// Process subsequent messages
			while (dataBuffer.length >= 4) {
				const message = parseMessage(dataBuffer);
				if (!message) break;

				dataBuffer = message.remaining;

				if (!bitfieldReceived) {
					// First message after handshake is bitfield
					bitfieldReceived = true;
					// Send our extension handshake
					const extensionHandshake = createExtensionHandshake();
					socket.write(extensionHandshake);
				} else if (!extensionHandshakeReceived) {
					try {
						metadataExtensionId = parseExtensionHandshake(message.message);
						extensionHandshakeReceived = true;
						clearTimeout(timeout);
						socket.destroy();
						resolve({ receivedPeerId, metadataExtensionId });
					} catch (error) {
						reject(
							new Error(`Failed to parse extension handshake: ${error.message}`)
						);
					}
				}
			}
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

		const { receivedPeerId, metadataExtensionId } = await performPeerHandshake(
			peers[0],
			parsedMagnet.infoHash,
			peerId
		);

		console.log(`Peer ID: ${receivedPeerId}`);
		console.log(`Peer Metadata Extension ID: ${metadataExtensionId}`);

		return { receivedPeerId, metadataExtensionId };
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
