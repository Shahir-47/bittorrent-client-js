const { magnetParse } = require("./magnet_parse");
const { decodeBencode } = require("../bencode/decode_bencode");
const { encodeBencode } = require("../bencode/encode_bencode");
const { urlEncodeBytes } = require("../utility");
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
			ut_metadata: 1, // Using 1 as our extension ID
		},
	};

	const bencodedData = encodeBencode(extensionData);
	const messageLength = 2 + bencodedData.length; // 1 byte for ext message type + 1 byte for handshake type

	const buffer = Buffer.alloc(4 + messageLength);

	// Write total message length (excluding length prefix)
	buffer.writeUInt32BE(messageLength, 0);
	// Extension message type (20)
	buffer.writeUInt8(20, 4);
	// Handshake type (0)
	buffer.writeUInt8(0, 5);
	// Write the bencoded dictionary
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
	try {
		// Skip the message header (4 bytes length prefix + 1 byte msg type + 1 byte ext msg type)
		const payload = message.slice(6);
		const binaryStr = payload.toString("binary");
		const handshakeData = decodeBencode(binaryStr);

		if (
			!handshakeData ||
			!handshakeData.m ||
			typeof handshakeData.m.ut_metadata !== "number"
		) {
			throw new Error("Missing or invalid ut_metadata ID");
		}

		return handshakeData.m.ut_metadata;
	} catch (error) {
		console.error("Failed to parse extension handshake:", error);
		throw error;
	}
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
		let supportsExtensions = false;
		let handshakeCompleted = false;

		const timeout = setTimeout(() => {
			if (!socket.destroyed) {
				socket.destroy();
			}
			reject(new Error("Handshake timeout"));
		}, 10000);

		socket.on("error", (err) => {
			console.error("Socket error:", err.message);
			clearTimeout(timeout);
			if (!socket.destroyed) {
				socket.destroy();
			}
			if (!handshakeCompleted) {
				reject(err);
			}
		});

		socket.on("close", () => {
			console.log("Socket closed");
			clearTimeout(timeout);
			if (!handshakeCompleted) {
				reject(new Error("Connection closed before handshake completion"));
			}
		});

		socket.connect(peer.port, peer.ip, () => {
			console.log("Connected to peer");
			const handshakeMsg = createHandshakeMessage(infoHash, myPeerId);
			socket.write(handshakeMsg);
		});

		socket.on("data", (data) => {
			if (handshakeCompleted) return; // Ignore data after completion

			dataBuffer = Buffer.concat([dataBuffer, data]);

			// Handle initial handshake
			if (!handshakeReceived && dataBuffer.length >= 68) {
				console.log("Received initial handshake");
				supportsExtensions = !!(dataBuffer[25] & 0x10);
				receivedPeerId = dataBuffer.slice(48, 68).toString("hex");
				handshakeReceived = true;
				dataBuffer = dataBuffer.slice(68);

				if (!supportsExtensions) {
					console.log("Peer doesn't support extensions");
					clearTimeout(timeout);
					socket.destroy();
					reject(new Error("Peer doesn't support extensions"));
					return;
				}
			}

			// Process subsequent messages
			while (dataBuffer.length >= 4) {
				const messageLength = dataBuffer.readUInt32BE(0);
				if (dataBuffer.length < messageLength + 4) break;

				const message = {
					length: messageLength,
					message: dataBuffer.slice(0, messageLength + 4),
				};
				dataBuffer = dataBuffer.slice(messageLength + 4);

				if (!bitfieldReceived) {
					console.log("Received bitfield message");
					bitfieldReceived = true;
					const extensionHandshake = createExtensionHandshake();
					socket.write(extensionHandshake);
					console.log("Sent extension handshake");
				} else if (!extensionHandshakeReceived && message.length > 0) {
					if (message.message[4] === 20) {
						try {
							console.log("Received extension handshake response");
							metadataExtensionId = parseExtensionHandshake(message.message);
							extensionHandshakeReceived = true;
							handshakeCompleted = true;

							clearTimeout(timeout);
							resolve({ receivedPeerId, metadataExtensionId });

							socket.end(() => {
								console.log("Socket ended cleanly");
								socket.destroy();
							});
						} catch (error) {
							console.error("Failed to parse extension handshake:", error);
							socket.destroy();
							reject(
								new Error(
									`Failed to parse extension handshake: ${error.message}`
								)
							);
						}
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
