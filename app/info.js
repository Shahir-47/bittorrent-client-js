const { decodeBencode } = require("./decode_bencode");
const { encodeBencode } = require("./encode_bencode");
const { calculateSHA1Hash } = require("./utility");

function getInfo(data) {
	let result = {};
	const bencodedValue = data.toString("binary");
	let { announce, info } = decodeBencode(bencodedValue);

	result["trackerURL"] = announce;
	result["length"] = info.length;
	result["infoHash"] = calculateSHA1Hash(encodeBencode(info), "hex");
	result["pieceLength"] = info["piece length"];
	result["pieceHashes"] = [];
	const pieceHashes = info["pieces"];
	for (let i = 0; i < pieceHashes.length; i += 20) {
		const pieceHashBinary = pieceHashes.slice(i, i + 20);
		const pieceHashHex = Buffer.from(pieceHashBinary, "binary").toString("hex");
		result["pieceHashes"].push(pieceHashHex);
	}
	return result;
}

module.exports = { getInfo };
