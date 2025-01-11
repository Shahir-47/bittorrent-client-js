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

module.exports = { parsePeers, calculateSHA1Hash, urlEncodeBytes };
