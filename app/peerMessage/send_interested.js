function sendInterested(socket) {
	const buf = Buffer.alloc(5);
	buf.writeUInt32BE(1, 0);
	buf.writeUInt8(2, 4);
	socket.write(buf);
	console.log("Sent interested message (ID=2).");
}

module.exports = { sendInterested };
