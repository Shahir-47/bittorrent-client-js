function magnetParse(magnetLink) {
	if (!magnetLink.startsWith("magnet:?")) {
		throw new Error("Invalid magnet link");
	}

	const params = new URLSearchParams(magnetLink.slice(8));
	const infoHash = params.get("xt")?.split(":")?.pop();
	const name = params.get("dn");
	const trackers = params.getAll("tr");

	return { infoHash, name, trackerURL };
}

module.exports = { magnetParse };
