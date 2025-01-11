const process = require("process");
const util = require("util");
const fs = require("fs");
const crypto = require("crypto");

// Examples:
// - decodeBencode("5:hello") -> "hello"
// - decodeBencode("10:hello12345") -> "hello12345"

function urlEncodeBytes(buf) {
	let out = "";
	for (const byte of buf) {
		// Each byte -> %xx format
		out += "%" + byte.toString(16).padStart(2, "0");
	}
	return out;
}

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

function encodeBencodeString(value) {
	return `${value.length}:${value}`;
}

function encodeBencodeInt(value) {
	return `i${value}e`;
}

function encodeBencodeList(value) {
	return `l${value.join("")}e`;
}

function encodeBencodeDictionary(value) {
	let result = "d";
	const keys = Object.keys(value).sort();

	for (let key in value) {
		result += encodeBencodeString(key);
		result += encodeBencode(value[key]);
	}

	return result + "e";
}

function encodeBencode(value) {
	if (typeof value === "string") {
		return encodeBencodeString(value);
	} else if (typeof value === "number") {
		return encodeBencodeInt(value);
	} else if (Array.isArray(value)) {
		return encodeBencodeList(value.map(encodeBencode));
	} else if (typeof value === "object") {
		return encodeBencodeDictionary(value);
	} else {
		throw new Error("Only strings, numbers, arrays and objects are supported");
	}
}

function decodeBencode(bencodedValue) {
	if (bencodedValue[0] === "l") {
		return decodeBencodeList(bencodedValue);
	} else if (bencodedValue[0] === "d") {
		return decodeBencodeDictionary(bencodedValue);
	} else if (!isNaN(bencodedValue[0])) {
		return decodeBencodeString(bencodedValue);
	} else if (bencodedValue[0] === "i") {
		return decodeBencodeInt(bencodedValue);
	} else {
		throw new Error("Only strings are supported at the moment");
	}
}

function decodeBencodeDictionary(bencodedValue) {
	const result = {};
	let currentIndex = 1;

	while (currentIndex < bencodedValue.length - 1) {
		const colonIndex = bencodedValue.indexOf(":", currentIndex);
		const stringLength = parseInt(
			bencodedValue.slice(currentIndex, colonIndex)
		);
		const key = decodeBencodeString(
			bencodedValue.slice(colonIndex, colonIndex + stringLength + 1)
		);
		currentIndex = colonIndex + stringLength + 1;

		if (bencodedValue[currentIndex] === "i") {
			const endIndex = bencodedValue.indexOf("e", currentIndex) + 1;
			result[key] = decodeBencodeInt(
				bencodedValue.slice(currentIndex, endIndex)
			);
			currentIndex = endIndex;
		} else if (!isNaN(bencodedValue[currentIndex])) {
			const colonIndex = bencodedValue.indexOf(":", currentIndex);
			const stringLength = parseInt(
				bencodedValue.slice(currentIndex, colonIndex)
			);
			result[key] = decodeBencodeString(
				bencodedValue.slice(colonIndex, colonIndex + stringLength + 1)
			);
			currentIndex = colonIndex + stringLength + 1;
		} else if (bencodedValue[currentIndex] === "l") {
			let endIndex = bencodedValue.lastIndexOf("e") - 1;

			while (!isNaN(bencodedValue[endIndex - 1]) && endIndex > 0) {
				endIndex = bencodedValue.lastIndexOf("e", endIndex - 1);
			}

			result[key] = decodeBencodeList(
				bencodedValue.slice(currentIndex, endIndex + 1)
			);

			currentIndex = endIndex + 1;
		} else if (bencodedValue[currentIndex] === "d") {
			let endIndex = bencodedValue.lastIndexOf("e") - 1;

			while (!isNaN(bencodedValue[endIndex - 1]) && endIndex > 0) {
				endIndex = bencodedValue.lastIndexOf("e", endIndex - 1);
			}

			result[key] = decodeBencodeDictionary(
				bencodedValue.slice(currentIndex, endIndex + 1)
			);

			currentIndex = endIndex + 1;
		} else {
			throw new Error(
				"Only integers, strings and lists are supported at the moment"
			);
		}
	}
	return result;
}

function decodeBencodeList(bencodedValue) {
	const result = [];
	let currentIndex = 1;

	while (currentIndex < bencodedValue.length - 1) {
		if (bencodedValue[currentIndex] === "i") {
			const endIndex = bencodedValue.indexOf("e", currentIndex) + 1;
			result.push(
				decodeBencodeInt(bencodedValue.slice(currentIndex, endIndex))
			);
			currentIndex = endIndex;
		} else if (!isNaN(bencodedValue[currentIndex])) {
			const colonIndex = bencodedValue.indexOf(":", currentIndex);
			const stringLength = parseInt(
				bencodedValue.slice(currentIndex, colonIndex)
			);
			result.push(
				decodeBencodeString(
					bencodedValue.slice(colonIndex, colonIndex + stringLength + 1)
				)
			);
			currentIndex = colonIndex + stringLength + 1;
		} else if (bencodedValue[currentIndex] === "l") {
			let endIndex = bencodedValue.lastIndexOf("e") - 1;

			while (!isNaN(bencodedValue[endIndex - 1]) && endIndex > 0) {
				endIndex = bencodedValue.lastIndexOf("e", endIndex - 1);
			}

			result.push(
				decodeBencodeList(bencodedValue.slice(currentIndex, endIndex + 1))
			);

			currentIndex = endIndex + 1;
		} else {
			throw new Error(
				"Only integers, strings and lists are supported at the moment"
			);
		}
	}
	return result;
}

function decodeBencodeInt(bencodedValue) {
	if (
		bencodedValue[0] === "i" &&
		bencodedValue[bencodedValue.length - 1] === "e"
	) {
		return parseInt(bencodedValue.slice(1, -1));
	} else {
		throw new Error("Only integers are supported at the moment");
	}
}

function decodeBencodeString(bencodedValue) {
	const firstColonIndex = bencodedValue.indexOf(":");
	if (firstColonIndex === -1) {
		throw new Error("Invalid encoded value");
	}
	return bencodedValue.substr(firstColonIndex + 1);
}

function main() {
	const command = process.argv[2];

	console.error("Logs from your program will appear here!");

	if (command === "decode") {
		const bencodedValue = process.argv[3];

		console.log(JSON.stringify(decodeBencode(bencodedValue)));
	} else if (command === "info") {
		const data = fs.readFileSync(process.argv[3]);
		const bencodedValue = data.toString("binary");
		let { announce, info } = decodeBencode(bencodedValue);

		console.log("Tracker URL:", announce);
		console.log("Length:", info.length);
		console.log("Info Hash:", calculateSHA1Hash(encodeBencode(info), "hex"));
		console.log("Piece Length:", info["piece length"]);
		const pieceHashes = info["pieces"];
		console.log("Piece Hashes:");

		// Split the piece hashes into 20 byte chunks
		for (let i = 0; i < pieceHashes.length; i += 20) {
			const pieceHashBinary = pieceHashes.slice(i, i + 20);
			const pieceHashHex = Buffer.from(pieceHashBinary, "binary").toString(
				"hex"
			);
			console.log(pieceHashHex);
		}
	} else if (command === "peers") {
		const data = fs.readFileSync(process.argv[3]);
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
		trackerUrl += `&peer_id=-SS1000-abcdefgh1234`; // must be 20 bytes
		trackerUrl += `&port=6881`;
		trackerUrl += `&uploaded=0`;
		trackerUrl += `&downloaded=0`;
		trackerUrl += `&left=${info.length}`;
		trackerUrl += `&compact=1`;

		fetch(trackerUrl)
			.then((res) => res.arrayBuffer())
			.then((buf) => {
				const responseBinary = Buffer.from(buf).toString("binary");
				const trackerResponse = decodeBencode(responseBinary);

				const interval = trackerResponse.interval;
				const peersBinary = trackerResponse.peers;

				const peers = parsePeers(peersBinary);
				peers.forEach((peer) => {
					console.log(`${peer}`);
				});
			})
			.catch((err) => {
				console.error("Failed to contact tracker:", err);
			});
	} else {
		throw new Error(`Unknown command ${command}`);
	}
}

main();
