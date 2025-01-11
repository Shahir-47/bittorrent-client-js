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

function encodeBencodeDictionary(value) {
	let result = "d";
	const keys = Object.keys(value).sort();

	for (let key in value) {
		result += encodeBencodeString(key);
		result += encodeBencode(value[key]);
	}

	return result + "e";
}

function encodeBencodeList(value) {
	return `l${value.join("")}e`;
}

function encodeBencodeString(value) {
	return `${value.length}:${value}`;
}

function encodeBencodeInt(value) {
	return `i${value}e`;
}

module.exports = { encodeBencode };
