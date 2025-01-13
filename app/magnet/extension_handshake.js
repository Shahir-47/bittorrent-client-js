const { decodeBencode } = require("../bencode/decode_bencode");
const { encodeBencode } = require("../bencode/encode_bencode");

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

module.exports = { createExtensionHandshake, parseExtensionHandshake };
