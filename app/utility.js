const crypto = require("crypto");

function parsePeers(peersBinary) {
	const peers = [];
	for (let i = 0; i < peersBinary.length; i += 6) {
		const ipBytes = peersBinary.slice(i, i + 4);
		const portBytes = peersBinary.slice(i + 4, i + 6);

		const ip = [
			ipBytes.charCodeAt(0),
			ipBytes.charCodeAt(1),
			ipBytes.charCodeAt(2),
			ipBytes.charCodeAt(3),
		].join(".");

		const port = (portBytes.charCodeAt(0) << 8) + portBytes.charCodeAt(1);

		peers.push(`${ip}:${port}`);
	}
	return peers;
}

function calculateSHA1Hash(bencodedValue, encoding = "binary") {
	const hash = crypto.createHash("sha1");
	hash.update(bencodedValue, "binary");
	return encoding === "binary" ? hash.digest() : hash.digest(encoding);
}

function urlEncodeBytes(buf) {
	let out = "";
	for (const byte of buf) {
		// Each byte -> %xx format
		out += "%" + byte.toString(16).padStart(2, "0");
	}
	return out;
}

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

function generateRandomPeerId() {
	const prefix = "-SS0001-";
	const randomPart = Array.from({ length: 12 }, () =>
		Math.floor(Math.random() * 36).toString(36)
	).join("");

	return prefix + randomPart;
}

module.exports = {
	parsePeers,
	parsePeerString,
	calculateSHA1Hash,
	urlEncodeBytes,
	createHandshakeMessage,
	generateRandomPeerId,
};
