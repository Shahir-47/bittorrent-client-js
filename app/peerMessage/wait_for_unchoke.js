function waitForUnchoke(socket) {
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);

		socket.on("data", onData);
		socket.on("error", onError);

		function onData(chunk) {
			buffer = Buffer.concat([buffer, chunk]);

			// We might have multiple messages in the buffer, so loop:
			while (buffer.length >= 4) {
				const msgLength = buffer.readUInt32BE(0);

				if (msgLength === 0) {
					// Keep-alive
					buffer = buffer.slice(4);
					console.log("Got keep-alive, ignoring...");
					continue;
				}

				// Wait until we have the full message: 4 bytes + msgLength
				if (buffer.length < 4 + msgLength) {
					// Not enough data yet, wait for more
					return;
				}

				// Extract the full message
				const msg = buffer.slice(4, 4 + msgLength);
				buffer = buffer.slice(4 + msgLength);

				// The first byte is msgId
				const msgId = msg.readUInt8(0);

				if (msgId === 1) {
					// unchoke
					console.log("Got unchoke message (ID=1). Peer is now unchoking us!");
					cleanup();
					return resolve();
				} else {
					// ignore other messages for now, or log them
					console.log("Got message ID=", msgId, " (not unchoke). Ignoring...");
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

module.exports = { waitForUnchoke };
