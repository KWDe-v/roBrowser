/**
 * server/GrfArchive.js
 *
 * One GRF on disk, read with the client's own loader (src/Loaders/GameFile.js).
 *
 * Using the same loader matters for file names: the server indexes each name exactly the way the
 * browser does when a GRF is dropped on the Intro screen, so a path the client asks for over HTTP
 * matches the entry it would have found locally, Korean names included.
 *
 * The archive is never read whole: the file table is read once, then each request reads only the bytes
 * of its own entry.
 */
import './aliases.js';
import fs from 'node:fs';

// BinaryReader picks its global object from `self` or `window` while it loads, and neither exists in Node.
// Only for that import: nothing else on the server path reads them.
const hadSelf = 'self' in globalThis;
if (!hadSelf) {
	globalThis.self = globalThis;
}
const { default: GRF } = await import('Loaders/GameFile.js');
if (!hadSelf) {
	delete globalThis.self;
}

/**
 * GameFile.load() reads through `new FileReaderSync()` and `file.slice()`. Here a slice is only a byte
 * range, and the reader reads it from the open file.
 */
class FileRangeReader {
	readAsArrayBuffer({ fd, start, end }) {
		const buffer = Buffer.alloc(end - start);
		fs.readSync(fd, buffer, 0, buffer.length, start);
		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
	}
}

class GrfArchive {
	/**
	 * @param {string} filePath
	 */
	constructor(filePath) {
		this.path = filePath;
		this.fd = fs.openSync(filePath, 'r');

		const fd = this.fd;
		const file = {
			fd: null, // GameFile only takes its own fd path inside Electron; ranges go through the reader
			size: fs.fstatSync(fd).size,
			slice: (start, end) => ({ fd, start, end })
		};

		const hadReader = 'FileReaderSync' in globalThis;
		const previousReader = globalThis.FileReaderSync;
		globalThis.FileReaderSync = FileRangeReader;
		try {
			this.grf = new GRF(file);
		} catch (error) {
			fs.closeSync(fd);
			throw error;
		} finally {
			if (hadReader) {
				globalThis.FileReaderSync = previousReader;
			} else {
				delete globalThis.FileReaderSync;
			}
		}
	}

	/**
	 * Every name in the archive, NUL-separated, as the client's `table.data` (used by file search).
	 */
	get nameTable() {
		return this.grf.table.data;
	}

	/**
	 * Number of entries in the archive.
	 */
	get count() {
		return this.grf.entries.length;
	}

	/**
	 * @param {string} filename path as the client spells it, `\` separated, any case
	 * @return {boolean}
	 */
	has(filename) {
		const entry = this.grf.search(filename.toLowerCase());
		return !!entry && !!(entry.type & GRF.FILELIST_TYPE_FILE);
	}

	/**
	 * Read and decode one file.
	 *
	 * @param {string} filename path as the client spells it, `\` separated, any case
	 * @return {Promise<Uint8Array|null>} null when the archive does not hold it, or cannot decode it
	 */
	async getFile(filename) {
		const entry = this.grf.search(filename.toLowerCase());
		if (!entry || !(entry.type & GRF.FILELIST_TYPE_FILE)) {
			return null;
		}

		const buffer = Buffer.alloc(entry.length_aligned);
		const { bytesRead } = await new Promise((resolve, reject) => {
			fs.read(this.fd, buffer, 0, buffer.length, entry.offset + GRF.struct_header.size, (error, bytes) =>
				error ? reject(error) : resolve({ bytesRead: bytes })
			);
		});
		if (bytesRead < entry.pack_size) {
			return null;
		}

		// decodeEntry answers synchronously, and not at all for an entry it cannot decode
		let result = null;
		this.grf.decodeEntry(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead), entry, data => {
			result = new Uint8Array(data);
		});
		return result;
	}

	close() {
		fs.closeSync(this.fd);
	}
}

export default GrfArchive;
