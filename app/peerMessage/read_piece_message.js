// read_piece_message.js
function readPieceMessage(socket, expectedPieceIndex, expectedOffset) {
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);
		let foundBlock = false;

		socket.on("data", onData);
		socket.on("error", onError);

		function onData(chunk) {
			buffer = Buffer.concat([buffer, chunk]);

			while (buffer.length >= 4) {
				const msgLength = buffer.readUInt32BE(0);

				// keep-alive
				if (msgLength === 0) {
					buffer = buffer.slice(4);
					continue;
				}

				// If we don't yet have enough data for the whole message, wait for more
				if (buffer.length < 4 + msgLength) {
					return;
				}

				// We have a full message
				const msg = buffer.slice(4, 4 + msgLength);
				buffer = buffer.slice(4 + msgLength);

				const msgId = msg.readUInt8(0);

				if (msgId === 7) {
					// piece message
					const pieceIndex = msg.readUInt32BE(1);
					const begin = msg.readUInt32BE(5);
					const blockData = msg.slice(9);

					// If this is the piece/offset, resolve
					if (pieceIndex === expectedPieceIndex && begin === expectedOffset) {
						foundBlock = true;
						cleanup();
						return resolve({ pieceIndex, begin, blockData });
					} else {
						// keep parsing the next message in the buffer
						continue;
					}
				} else {
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

module.exports = { readPieceMessage };
