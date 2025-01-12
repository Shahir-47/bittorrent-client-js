const net = require("net");

function waitForBitfield(socket) {
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);

		socket.on("data", onData);
		socket.on("error", onError);

		function onData(chunk) {
			buffer = Buffer.concat([buffer, chunk]);

			while (buffer.length >= 4) {
				// The next 4 bytes give us the length of the message body
				const msgLength = buffer.readUInt32BE(0);

				// If the message length is 0, it's a keep-alive. Just remove 4 bytes and continue
				if (msgLength === 0) {
					// Keep-alive
					buffer = buffer.slice(4);
					continue;
				}

				// Check if we have enough data for the full message
				if (buffer.length < 4 + msgLength) {
					// Not enough data yet, wait for more
					return;
				}

				// We have the entire message
				const msg = buffer.slice(4, 4 + msgLength);
				// Remove this message from our buffer
				buffer = buffer.slice(4 + msgLength);

				// The first byte of 'msg' is the message ID
				const msgId = msg.readUInt8(0);

				if (msgId === 5) {
					cleanup();
					resolve();
					return;
				}
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
	});
}

module.exports = { waitForBitfield };
