function readPieceMessage(socket, expectedPieceIndex, expectedOffset) {
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);
		let messageTimeout;

		function resetTimeout() {
			if (messageTimeout) clearTimeout(messageTimeout);
			messageTimeout = setTimeout(() => {
				cleanup();
				reject(new Error("Piece message timeout"));
			}, 2000);
		}

		resetTimeout();

		function onData(chunk) {
			buffer = Buffer.concat([buffer, chunk]);
			resetTimeout();

			while (buffer.length >= 4) {
				const msgLength = buffer.readUInt32BE(0);

				// Handle keep-alive
				if (msgLength === 0) {
					buffer = buffer.slice(4);
					continue;
				}

				// Wait for complete message
				if (buffer.length < 4 + msgLength) break;

				const msg = buffer.slice(4, 4 + msgLength);
				buffer = buffer.slice(4 + msgLength);

				const msgId = msg.readUInt8(0);

				if (msgId === 7) {
					// piece message
					const pieceIndex = msg.readUInt32BE(1);
					const begin = msg.readUInt32BE(5);

					if (pieceIndex === expectedPieceIndex && begin === expectedOffset) {
						const blockData = msg.slice(9);
						cleanup();
						return resolve({ pieceIndex, begin, blockData });
					}
				}
			}
		}

		function onError(err) {
			cleanup();
			reject(err);
		}

		function cleanup() {
			if (messageTimeout) clearTimeout(messageTimeout);
			socket.removeListener("data", onData);
			socket.removeListener("error", onError);
		}

		socket.on("data", onData);
		socket.on("error", onError);
	});
}

module.exports = { readPieceMessage };
