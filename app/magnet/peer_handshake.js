const { magnetParse } = require("./magnet_parse");
const { decodeBencode } = require("../bencode/decode_bencode");
const {
	urlEncodeBytes,
	createHandshakeMessage,
	parsePeerString,
	generateRandomPeerId,
} = require("../utility");
const net = require("net");
const {
	parseExtensionHandshake,
	createExtensionHandshake,
} = require("./extension_handshake");
const {
	createMetadataRequestMessage,
	parseMetadataMessage,
} = require("./metadata_exchange");

async function communicateWithPeer(peer, infoHash, peerId, isHandshakeOnly) {
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		let dataBuffer = Buffer.alloc(0);
		let handshakeReceived = false;
		let bitfieldReceived = false;
		let extensionHandshakeReceived = false;
		let metadataExtensionId = null;
		let receivedPeerId = null;
		let metadataRequestSent = false;
		let supportsExtensions = false;

		const timeout = setTimeout(() => {
			socket.destroy();
			reject(new Error("Communication timeout"));
		}, 10000);

		socket.connect(peer.port, peer.ip, () => {
			console.log("Connected to peer");
			const handshakeMsg = createHandshakeMessage(infoHash, peerId);
			socket.write(handshakeMsg);
		});

		socket.on("data", (data) => {
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
					socket.destroy();
					reject(new Error("Peer doesn't support extensions"));
					return;
				}
			}

			// Process subsequent messages
			while (dataBuffer.length >= 4) {
				const messageLength = dataBuffer.readUInt32BE(0);
				if (dataBuffer.length < messageLength + 4) break;

				const message = dataBuffer.slice(0, messageLength + 4);
				dataBuffer = dataBuffer.slice(messageLength + 4);

				// Skip empty messages
				if (messageLength === 0) continue;

				// Handle bitfield
				if (!bitfieldReceived) {
					console.log("Received bitfield message");
					bitfieldReceived = true;
					const extensionHandshake = createExtensionHandshake();
					socket.write(extensionHandshake);
					continue;
				}

				// Handle extension messages
				if (message[4] === 20) {
					if (!extensionHandshakeReceived) {
						console.log("Received extension handshake");
						metadataExtensionId = parseExtensionHandshake(message);
						extensionHandshakeReceived = true;

						// end the connection if handshake only
						if (isHandshakeOnly) {
							console.log("Peer ID:", receivedPeerId);
							console.log("Peer Metadata Extension ID:", metadataExtensionId);
							clearTimeout(timeout);
							socket.end();

							setTimeout(() => {
								socket.destroy();
								console.log("Socket forcefully destroyed");
							}, 1000);

							resolve({ metadataExtensionId });
							return;
						}

						// Send metadata request immediately after receiving extension handshake
						console.log("Sending metadata request");
						const requestMessage =
							createMetadataRequestMessage(metadataExtensionId);
						socket.write(requestMessage);
						metadataRequestSent = true;
					} else if (metadataRequestSent) {
						// Handle metadata response
						console.log("Received metadata response");
						try {
							const metadata = parseMetadataMessage(message);
							clearTimeout(timeout);
							socket.end();

							setTimeout(() => {
								socket.destroy();
								console.log("Socket forcefully destroyed");
							}, 1000);

							resolve(metadata);
						} catch (error) {
							socket.destroy();
							reject(error);
						}
					}
				}
			}
		});

		socket.on("error", (error) => {
			if (error.code === "ECONNRESET") {
				console.error("Peer reset the connection prematurely (ECONNRESET)");
				clearTimeout(timeout);

				// Decide how to handle ECONNRESET: reject or resolve with partial data
				reject(new Error("Peer reset the connection prematurely"));
			} else {
				console.error("Socket error:", error);
				clearTimeout(timeout);
				reject(error);
			}
		});

		socket.on("close", () => {
			console.log("Socket fully closed");
			clearTimeout(timeout);
		});

		socket.on("end", () => {
			console.log("Socket closed");
			clearTimeout(timeout);
		});
	});
}

async function performMagnetHandshake(magnetLink, isHandshakeOnly = false) {
	const parsedMagnet = magnetParse(magnetLink);
	if (!parsedMagnet.trackerURL || !parsedMagnet.infoHash) {
		throw new Error("Missing required magnet link parameters");
	}

	const fileSize = 79752;
	const infoHashBinary = Buffer.from(parsedMagnet.infoHash, "hex");
	const infoHashEncoded = urlEncodeBytes(infoHashBinary);
	const peerId = generateRandomPeerId();

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

		const data = await communicateWithPeer(
			peers[0],
			parsedMagnet.infoHash,
			peerId,
			isHandshakeOnly
		);

		if (!isHandshakeOnly) {
			// Format and print the output
			console.log(`Tracker URL: ${parsedMagnet.trackerURL}`);
			console.log(`Length: ${data.metadata.length}`);
			console.log(`Info Hash: ${parsedMagnet.infoHash}`);
			console.log(`Piece Length: ${data.metadata["piece length"]}`);
			console.log("Piece Hashes:");

			// Split piece hashes string into individual hashes
			const pieceBuffer = Buffer.from(data.metadata.pieces, "binary");
			for (let i = 0; i < pieceBuffer.length; i += 20) {
				const hash = pieceBuffer.slice(i, i + 20).toString("hex");
				console.log(hash);
			}
		}

		return data;
	} catch (error) {
		throw new Error(`Handshake failed: ${error.message}`);
	}
}

module.exports = { performMagnetHandshake };
