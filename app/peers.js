const { decodeBencode } = require("./decode_bencode");
const { encodeBencode } = require("./encode_bencode");
const { parsePeers, calculateSHA1Hash, urlEncodeBytes } = require("./utility");

async function getPeers(data) {
	const bencodedValue = data.toString("binary");
	let { announce, info } = decodeBencode(bencodedValue);

	const infoHashRaw = calculateSHA1Hash(encodeBencode(info));
	const infoHashEncoded = urlEncodeBytes(infoHashRaw);
	const peerId = "-SS1000-123456789ABC";
	const left = info.length;

	let trackerUrl = announce;
	if (!trackerUrl.includes("?")) trackerUrl += "?";
	else trackerUrl += "&";

	trackerUrl += `info_hash=${infoHashEncoded}`;
	trackerUrl += `&peer_id=-SS1000-abcdefgh1234`;
	trackerUrl += `&port=6881`;
	trackerUrl += `&uploaded=0`;
	trackerUrl += `&downloaded=0`;
	trackerUrl += `&left=${info.length}`;
	trackerUrl += `&compact=1`;

	return fetch(trackerUrl)
		.then((res) => res.arrayBuffer())
		.then((buf) => {
			const responseBinary = Buffer.from(buf).toString("binary");
			const trackerResponse = decodeBencode(responseBinary);

			const interval = trackerResponse.interval;
			const peersBinary = trackerResponse.peers;

			return parsePeers(peersBinary);
		})
		.catch((err) => {
			return err;
		});
}

module.exports = { getPeers };
