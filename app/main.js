const process = require("process");
const util = require("util");

// Examples:
// - decodeBencode("5:hello") -> "hello"
// - decodeBencode("10:hello12345") -> "hello12345"
function decodeBencode(bencodedValue) {
	if (
		bencodedValue[0] === "l" &&
		bencodedValue[bencodedValue.length - 1] === "e"
	) {
		return decodeBencodeList(bencodedValue);
	} else if (!isNaN(bencodedValue[0])) {
		return decodeBencodeString(bencodedValue);
	} else if (bencodedValue[0] === "i") {
		return decodeBencodeInt(bencodedValue);
	} else {
		throw new Error("Only strings are supported at the moment");
	}
}

function decodeBencodeList(bencodedValue) {
	const result = [];
	let currentIndex = 1;
	while (currentIndex < bencodedValue.length - 1) {
		const currentChar = bencodedValue[currentIndex];
		if (currentChar === "i") {
			const endIndex = bencodedValue.indexOf("e", currentIndex);
			result.push(
				decodeBencodeInt(bencodedValue.slice(currentIndex, endIndex + 1))
			);
			currentIndex = endIndex + 1;
		} else if (!isNaN(currentChar)) {
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
		} else if (currentChar === "l") {
			const endIndex = bencodedValue.indexOf("e", currentIndex);
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
	} else {
		throw new Error(`Unknown command ${command}`);
	}
}

main();
