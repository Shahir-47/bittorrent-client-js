const { encodeBencode } = require("../bencode/encode_bencode");
const {
	decodeBencode,
	decodeBencodeWithLength,
} = require("../bencode/decode_bencode");

function createMetadataRequestMessage(metadataExtensionId) {
	const requestData = {
		msg_type: 0,
		piece: 0,
	};
	const bencodedRequest = encodeBencode(requestData);
	const messageLength = 2 + bencodedRequest.length;

	const buffer = Buffer.alloc(4 + messageLength);
	buffer.writeUInt32BE(messageLength, 0);
	buffer.writeUInt8(20, 4);
	buffer.writeUInt8(metadataExtensionId, 5);
	Buffer.from(bencodedRequest).copy(buffer, 6);

	return buffer;
}

function parseMetadataMessage(message) {
	try {
		// Skip the first 4 bytes (length prefix)
		let pos = 4;

		// Read message id (1 byte) - should be 20
		const messageId = message[pos];
		if (messageId !== 20) {
			throw new Error(`Invalid message ID: ${messageId}`);
		}
		pos++;

		// Read extension message id (1 byte)
		const extensionId = message[pos];
		pos++;

		// The rest until metadata piece is bencoded dictionary
		const headerStr = message.slice(pos).toString("binary");
		const { dict: header, consumed } = decodeBencodeWithLength(headerStr);

		// Validate message type
		if (header.msg_type !== 1) {
			throw new Error(`Invalid msg_type: ${header.msg_type}`);
		}

		// Get the metadata piece contents
		const metadataStart = pos + consumed;
		const metadataPiece = message.slice(metadataStart);

		// Parse the metadata piece as bencoded data
		const metadata = decodeBencode(metadataPiece.toString("binary"));

		return {
			messageId,
			extensionId,
			header,
			metadata,
		};
	} catch (error) {
		console.error("Error parsing message:", error);
		throw error;
	}
}

module.exports = { createMetadataRequestMessage, parseMetadataMessage };
