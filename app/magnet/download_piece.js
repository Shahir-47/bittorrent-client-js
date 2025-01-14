const fs = require("fs");
const { magnetParse } = require("./magnet_parse");
const { sendInterested } = require("../peerMessage/send_interested");
const { waitForUnchoke } = require("../peerMessage/wait_for_unchoke");
const { sendRequest } = require("../peerMessage/send_request");
const { readPieceMessage } = require("../peerMessage/read_piece_message");
const {
	urlEncodeBytes,
	connectToPeer,
	generateRandomPeerId,
	getPeersFromTracker,
	verifyPieceHash,
	getMetadataFromPeer,
} = require("../utility");

async function downloadBlocks(socket, pieceIndex, blocks, pieceBuffer) {
	const PIPELINE_SIZE = 5;
	let completedBlocks = 0;

	while (completedBlocks < blocks.length) {
		const activeRequests = [];
		const remainingBlocks = Math.min(
			PIPELINE_SIZE,
			blocks.length - completedBlocks
		);

		for (let i = 0; i < remainingBlocks; i++) {
			const block = blocks[completedBlocks + i];
			sendRequest(socket, pieceIndex, block.offset, block.size);
			activeRequests.push(
				readPieceMessage(socket, pieceIndex, block.offset).then((response) => {
					response.blockData.copy(pieceBuffer, response.begin);
					return response;
				})
			);
		}

		await Promise.all(activeRequests);
		completedBlocks += remainingBlocks;
	}
}

function createBlocks(pieceLength) {
	const blocks = [];
	const BLOCK_SIZE = 16 * 1024;
	for (let offset = 0; offset < pieceLength; offset += BLOCK_SIZE) {
		blocks.push({
			offset,
			size: Math.min(BLOCK_SIZE, pieceLength - offset),
		});
	}
	return blocks;
}

async function downloadPieceFromMagnet(magnetLink, pieceIndex, outFile) {
	const parsedMagnet = magnetParse(magnetLink);
	const infoHashBinary = Buffer.from(parsedMagnet.infoHash, "hex");
	const peerId = generateRandomPeerId();

	const peers = await getPeersFromTracker(
		parsedMagnet.trackerURL,
		urlEncodeBytes(infoHashBinary),
		peerId,
		79752
	);

	let socket;
	let info;

	for (let i = 0; i < Math.min(3, peers.length); i++) {
		try {
			socket = await connectToPeer(peers[i], parsedMagnet.infoHash, peerId);
			info = await getMetadataFromPeer(socket);
			break;
		} catch (error) {
			if (socket) socket.destroy();
			continue;
		}
	}

	if (!socket || !info) {
		throw new Error("Failed to connect to any peers");
	}

	try {
		sendInterested(socket);
		await waitForUnchoke(socket);

		const pieceLength = info["piece length"];
		const totalLength = info.length;
		const actualPieceLength =
			pieceIndex === Math.floor(totalLength / pieceLength)
				? totalLength % pieceLength
				: pieceLength;

		const pieceBuffer = Buffer.alloc(actualPieceLength);
		const blocks = createBlocks(actualPieceLength);

		await downloadBlocks(socket, pieceIndex, blocks, pieceBuffer);
		verifyPieceHash(pieceBuffer, info.pieces, pieceIndex);

		fs.writeFileSync(outFile, pieceBuffer);
	} finally {
		socket.destroy();
	}
}

module.exports = { downloadPieceFromMagnet };
