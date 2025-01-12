function sendRequest(socket, pieceIndex, begin, length) {
	// total message length = 13 (not counting the 4-byte prefix)
	// so entire buffer is 4 + 1 + 4 + 4 + 4 = 17 bytes
	const msg = Buffer.alloc(17);

	msg.writeUInt32BE(13, 0); // 4-byte "length" = 13
	msg.writeUInt8(6, 4); // 1-byte message ID = 6
	msg.writeUInt32BE(pieceIndex, 5); // 4-byte piece index
	msg.writeUInt32BE(begin, 9); // 4-byte "begin"
	msg.writeUInt32BE(length, 13); // 4-byte "length"

	socket.write(msg);
}

module.exports = { sendRequest };
