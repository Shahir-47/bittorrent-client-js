# BitTorrent Client in JavaScript

This is an implementation of a BitTorrent client in JavaScript that supports downloading files from both `.torrent` files and magnet links.

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Implementation Details](#implementation-details)
- [Limitations and Unsupported Features](#limitations-and-unsupported-features)
- [Usage](#usage)
- [Testing](#testing)
- [License](#license)

## Features

- Parsing of `.torrent` files
- Extracting tracker URL, info hash, piece length, and piece hashes from `.torrent` files
- Discovering peers via HTTP trackers
- Establishing TCP connections with peers and performing handshakes
- Exchanging peer messages to download file pieces
- Integrity checking of downloaded pieces using SHA-1 hashes
- Saving downloaded pieces to disk and combining them to assemble the complete file
- Parsing of magnet links
- Fetching torrent metadata from peers using the BitTorrent extension protocol
- Downloading files from magnet links by requesting pieces from peers

## Project Structure

The project is structured as follows:

```
bittorrent-client-js/
├── README.md
├── codecrafters.yml
├── package.json
├── sample.torrent
├── your_bittorrent.sh
└── app/
    ├── main.js
    ├── utility.js
    ├── bencode/
    │   ├── decode_bencode.js
    │   └── encode_bencode.js
    ├── magnet/
    │   ├── download_complete.js
    │   ├── download_piece.js
    │   ├── extension_handshake.js
    │   ├── magnet_parse.js
    │   ├── metadata_exchange.js
    │   └── peer_handshake.js
    ├── peerMessage/
    │   ├── read_piece_message.js
    │   ├── send_interested.js
    │   ├── send_request.js
    │   ├── wait_for_bitfield.js
    │   └── wait_for_unchoke.js
    └── torrent/
        ├── download_complete.js
        ├── download_piece.js
        ├── handshake.js
        ├── info.js
        └── peers.js
```

## Implementation Details

The BitTorrent client is implemented in JavaScript and consists of several modules:

- `bencode/`: Contains functions for encoding and decoding data in the Bencode format, which is used in `.torrent` files and peer communication.
- `magnet/`: Contains functions specific to handling magnet links, including parsing magnet links, fetching torrent metadata from peers, and downloading files using magnet links.
- `peerMessage/`: Contains functions for sending and receiving peer messages, such as requesting pieces, sending interest, and waiting for unchoke messages.
- `torrent/`: Contains functions for handling `.torrent` files, including extracting information, discovering peers, performing handshakes, and downloading pieces.
- `utility.js`: Contains utility functions used across different modules.
- `main.js`: The entry point of the application that handles command-line arguments and invokes the appropriate functions.

## Limitations and Unsupported Features

Please note the following limitations and unsupported features of this BitTorrent client:

- Only single-file torrents are supported. Multi-file torrents are not handled.
- Tracker communication is limited to HTTP trackers. UDP trackers are not supported.
- Peer selection strategy is basic and does not implement advanced algorithms for optimizing download speeds.
- Seeding functionality is not implemented. The client can only download files and does not upload pieces to other peers.
- DHT (Distributed Hash Table) and PEX (Peer Exchange) are not supported.

## Usage

To run the BitTorrent client, ensure you have Node.js installed. Then, execute the `your_bittorrent.sh` script with the appropriate command and arguments. Here are some examples:

- To parse a `.torrent` file and print the tracker URL, info hash, piece length, and piece hashes:

  ```
  ./your_bittorrent.sh info sample.torrent
  ```

- To discover peers for a `.torrent` file:

  ```
  ./your_bittorrent.sh peers sample.torrent
  ```

- To download a single piece from a `.torrent` file:

  ```
  ./your_bittorrent.sh download_piece -o /tmp/test-piece sample.torrent <piece_index>
  ```

- To download the entire file from a `.torrent` file:

  ```
  ./your_bittorrent.sh download -o /tmp/test.txt sample.torrent
  ```

- To parse a magnet link and print the info hash and tracker URL:

  ```
  ./your_bittorrent.sh magnet_parse <magnet_link>
  ```

- To download the entire file from a magnet link:
  ```
  ./your_bittorrent.sh magnet_download -o /path/to/output/file.ext <magnet_link>
  ```

For example, you can download a GIF file using these magnet links. Try it yourself and see:

```bash
./your_bittorrent.sh magnet_download -o ./test1.gif "magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
```

```bash
./your_bittorrent.sh magnet_download -o ./test2.gif "magnet:?xt=urn:btih:3f994a835e090238873498636b98a3e78d1c34ca&dn=magnet2.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
```

```bash
./your_bittorrent.sh magnet_download -o ./test3.gif "magnet:?xt=urn:btih:c5fb9894bdaba464811b088d806bdd611ba490af&dn=magnet3.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
```

Note that the output file path and extension should match the expected file type. In the examples above, the output files have the `.gif` extension since the magnet links are for GIF files.

Replace `sample.torrent` with the path to your `.torrent` file, `<piece_index>` with the zero-based index of the piece you want to download, `/path/to/output/file.ext` with the desired output file path and extension, and `<magnet_link>` with the actual magnet link.

## Testing

The BitTorrent client has been tested using various `.torrent` files and magnet links.

The following magnet links have been used to successfully download GIF files:

Magnet Link 1:

```
magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce
```

Magnet Link 2:

```
magnet:?xt=urn:btih:3f994a835e090238873498636b98a3e78d1c34ca&dn=magnet2.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce
```

Magnet Link 3:

```
magnet:?xt=urn:btih:c5fb9894bdaba464811b088d806bdd611ba490af&dn=magnet3.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce
```

However, please note that not all types of magnet links are guaranteed to work flawlessly due to the limitations mentioned above.

## License

This project is licensed under the MIT License.
