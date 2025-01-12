function encodeBencode(value) {
	if (value === null || value === undefined) {
		throw new Error("Cannot encode null or undefined values");
	}

	if (typeof value === "string") {
		return encodeBencodeString(value);
	} else if (typeof value === "number") {
		if (!Number.isInteger(value)) {
			throw new Error("Only integer values are supported in Bencode");
		}
		return encodeBencodeInt(value);
	} else if (Array.isArray(value)) {
		return encodeBencodeList(value);
	} else if (typeof value === "object") {
		return encodeBencodeDictionary(value);
	} else {
		throw new Error("Only strings, integers, arrays and objects are supported");
	}
}

function encodeBencodeDictionary(value) {
	// sort them lexicographically
	const sortedKeys = Object.keys(value).sort();

	let result = "d";
	for (const key of sortedKeys) {
		// In Bencode, dictionary keys must be strings
		const encodedKey = encodeBencodeString(key);
		const encodedValue = encodeBencode(value[key]);
		result += encodedKey + encodedValue;
	}
	return result + "e";
}

function encodeBencodeList(value) {
	let result = "l";
	for (const item of value) {
		result += encodeBencode(item);
	}
	return result + "e";
}

function encodeBencodeString(value) {
	if (Buffer.isBuffer(value)) {
		return `${value.length}:${value.toString("binary")}`;
	}

	const strValue = String(value);
	return `${strValue.length}:${strValue}`;
}

function encodeBencodeInt(value) {
	return `i${value}e`;
}

module.exports = { encodeBencode };
