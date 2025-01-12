function decodeBencode(bencodedValue) {
	// Keep track of our current position in the string
	let pos = 0;

	function decodeNext() {
		if (pos >= bencodedValue.length) {
			throw new Error("Unexpected end of input");
		}

		const currentChar = bencodedValue[pos];

		if (currentChar === "i") {
			// Integer
			pos++; // Move past 'i'
			const start = pos;
			while (pos < bencodedValue.length && bencodedValue[pos] !== "e") {
				pos++;
			}
			if (pos >= bencodedValue.length) {
				throw new Error("Unterminated integer");
			}
			const num = parseInt(bencodedValue.slice(start, pos));
			pos++; // Move past 'e'
			return num;
		}

		if (currentChar === "l") {
			// List
			pos++; // Move past 'l'
			const list = [];
			while (pos < bencodedValue.length && bencodedValue[pos] !== "e") {
				list.push(decodeNext());
			}
			if (pos >= bencodedValue.length) {
				throw new Error("Unterminated list");
			}
			pos++; // Move past 'e'
			return list;
		}

		if (currentChar === "d") {
			// Dictionary
			pos++; // Move past 'd'
			const dict = {};
			while (pos < bencodedValue.length && bencodedValue[pos] !== "e") {
				// Dictionary keys must be strings
				if (isNaN(bencodedValue[pos])) {
					throw new Error("Dictionary key must be a string");
				}
				const key = decodeNext();
				if (typeof key !== "string") {
					throw new Error("Dictionary key must be a string");
				}
				dict[key] = decodeNext();
			}
			if (pos >= bencodedValue.length) {
				throw new Error("Unterminated dictionary");
			}
			pos++; // Move past 'e'
			return dict;
		}

		if (!isNaN(currentChar)) {
			// String
			const colonPos = bencodedValue.indexOf(":", pos);
			if (colonPos === -1) {
				throw new Error("Invalid string: no length delimiter");
			}
			const length = parseInt(bencodedValue.slice(pos, colonPos));
			if (isNaN(length)) {
				throw new Error("Invalid string length");
			}
			pos = colonPos + 1; // Move past ':'
			const endPos = pos + length;
			if (endPos > bencodedValue.length) {
				throw new Error("String longer than remaining input");
			}
			const str = bencodedValue.slice(pos, endPos);
			pos = endPos;
			return str;
		}

		throw new Error(
			`Invalid input character at position ${pos}: ${currentChar}`
		);
	}

	const result = decodeNext();
	if (pos !== bencodedValue.length) {
		throw new Error("Trailing data after value");
	}
	return result;
}

module.exports = { decodeBencode };
