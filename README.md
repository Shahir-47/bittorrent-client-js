# BitTorrent Client in JavaScript

This is an implementation of a BitTorrent client in JavaScript that supports downloading files from both `.torrent` files and magnet links.

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Implementation Details](#implementation-details)
- [Limitations and Unsupported Features](#limitations-and-unsupported-features)
- [Installation and Setup](#installation-and-setup)
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

## Installation and Setup

To run this BitTorrent client on your machine:

1. Ensure you have Node.js installed (version 12 or higher)
2. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/bittorrent-client-js.git
   ```
   ```bash
   cd bittorrent-client-js
   ```
3. Install dependencies:

   ```bash
   npm install
   ```

4. Make the shell script executable:

   ```bash
   chmod +x your_bittorrent.sh
   ```

I'll reorganize the Usage section to group related commands together, starting with basic operations, then .torrent operations, and finally magnet operations:

## Usage

To run the BitTorrent client, ensure you have Node.js installed. Then, execute the `your_bittorrent.sh` script with the appropriate command and arguments. Here are all available commands:

### Basic Operations

- To decode a bencoded string:
  ```
  ./your_bittorrent.sh decode <bencoded_string>
  ```
  Try it with a simple bencoded string:
  ```bash
  $ ./your_bittorrent.sh decode "d3:bar4:spam3:fooi42ee"
  ```

### Torrent File Operations

- To parse a `.torrent` file and print the tracker URL, info hash, piece length, and piece hashes:

  ```
  ./your_bittorrent.sh info <path/to/file.torrent>
  ```

  Try it yourself! Run this command to examine the `sample.torrent` file included in the repository:

  ```bash
  $ ./your_bittorrent.sh info sample.torrent
  ```

- To discover peers for a `.torrent` file:

  ```
  ./your_bittorrent.sh peers <path/to/file.torrent>
  ```

  Want to see the available peers? Try this for the `sample.torrent` file included in the repository:

  ```bash
  $ ./your_bittorrent.sh peers sample.torrent
  ```

- To perform a handshake with a specific peer:

  ```
  ./your_bittorrent.sh handshake <path/to/file.torrent> <peer_address>
  ```

  First get a peer address using the peers command, then try connecting to one:

  ```bash
  $ ./your_bittorrent.sh handshake sample.torrent 165.232.41.73:51556
  ```

- To download a single piece from a `.torrent` file:

  ```
  ./your_bittorrent.sh download_piece -o <output_directory/output_filename> <path/to/file.torrent> <piece_index>
  ```

  Try downloading a piece of the file pointed by the `sample.torrent` file included in the repository:

  ```bash
  $ ./your_bittorrent.sh download_piece -o ./test-piece sample.torrent 1
  ```

- To download the entire file from a `.torrent` file:
  ```
  ./your_bittorrent.sh download -o <output_directory/output_filename> <path/to/file.torrent>
  ```
  Try downloading the file pointed out by the `sample.torrent` file included in the repository:
  ```bash
  $ ./your_bittorrent.sh download -o ./test sample.torrent
  ```

### Magnet Link Operations

- To parse a magnet link and print the info hash and tracker URL:

  ```
  ./your_bittorrent.sh magnet_parse <magnet_link>
  ```

  Try parsing one of our test magnet links:

  ```bash
  $ ./your_bittorrent.sh magnet_parse "magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
  ```

- To perform a handshake using a magnet link:

  ```
  ./your_bittorrent.sh magnet_handshake <magnet_link>
  ```

  Try it with one of our test magnet links:

  ```bash
  $ ./your_bittorrent.sh magnet_handshake "magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
  ```

- To retrieve metadata from a magnet link:

  ```
  ./your_bittorrent.sh magnet_info <magnet_link>
  ```

  Try getting info from one of our test magnet links:

  ```bash
  $ ./your_bittorrent.sh magnet_info "magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
  ```

- To download a specific piece from a magnet link:

  ```
  ./your_bittorrent.sh magnet_download_piece -o <output_directory/output_filename> <magnet_link> <piece_index>
  ```

  Try downloading piece #1 from one of our test magnet links:

  ```bash
  $ ./your_bittorrent.sh magnet_download_piece -o ./test-piece "magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce" 1
  ```

- To download the entire file from a magnet link:

  ```
  ./your_bittorrent.sh magnet_download -o <output_directory/output_filename> <magnet_link>
  ```

  Here are a few examples of downloading GIF files from magnet links to your current directory:

  ```bash
  ./your_bittorrent.sh magnet_download -o./test1.gif "magnet:?xt=urn:btih:ad42ce8109f54c99613ce38f9b4d87e70f24a165&dn=magnet1.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
  ```

  ```bash
  ./your_bittorrent.sh magnet_download -o./test2.gif "magnet:?xt=urn:btih:3f994a835e090238873498636b98a3e78d1c34ca&dn=magnet2.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
  ```

  ```bash
  ./your_bittorrent.sh magnet_download -o./test3.gif "magnet:?xt=urn:btih:c5fb9894bdaba464811b088d806bdd611ba490af&dn=magnet3.gif&tr=http%3A%2F%2Fbittorrent-test-tracker.codecrafters.io%2Fannounce"
  ```

### Important Notes

- When using the `-o` flag, you must provide a filename, not just a directory path. If you only specify a directory like `-o./`, the download will fail because no filename was given.
- Always replace `<output_directory/output_filename>` with the directory where you want the file saved and the exact filename you want it to have.
- When downloading binary files (images, videos, etc.), include the appropriate file extension (like `.mp4`, `.jpg`, `.zip`, etc.) so your computer knows how to open it properly.
- For text files, the extension is optional. If you don't provide one, the file will be saved without an extension.

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
