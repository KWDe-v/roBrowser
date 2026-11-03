/**
 * server/ClientFiles.js
 *
 * The game files of one client folder, as the Remote Client used to serve them: loose files first,
 * then the GRFs listed in DATA.INI.
 *
 *   client/
 *   ├── DATA.INI        [Data] 0=custom.grf 1=data.grf (lowest number wins, as in the client)
 *   ├── data.grf        archives stay packed, nothing is extracted
 *   ├── data/           loose files (translated tables...) win over the GRFs
 *   ├── System/  BGM/  AI/
 *
 * Only data/, System/, BGM/ and AI/ are reachable: the GRFs and DATA.INI themselves never are.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import GrfArchive from './GrfArchive.js';

/** Top-level folders a request may read from disk. */
const SERVABLE_ROOTS = new Set(['data', 'system', 'bgm', 'ai']);

/** Files at the top of the client folder a request may read: where the client keeps its System files. */
const SERVABLE_FILES = new Set(['aliases.json']);

/**
 * DATA.INI's [Data] section, in priority order (lowest number first).
 *
 * @param {string} content
 * @return {string[]} archive paths as written
 */
export function parseDataIni(content) {
	const byIndex = new Map();
	let inData = false;

	for (const raw of content.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith(';') || line.startsWith('#')) {
			continue;
		}

		const section = line.match(/^\[\s*(.*?)\s*\]$/);
		if (section) {
			inData = section[1].toLowerCase() === 'data';
			continue;
		}

		const entry = inData && line.match(/^(\d+)\s*=\s*(.+)$/);
		if (entry) {
			byIndex.set(Number(entry[1]), entry[2].trim());
		}
	}

	return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
}

/**
 * Least recently used cache with a byte budget.
 */
class ByteCache {
	constructor(maxBytes) {
		this.maxBytes = maxBytes;
		this.bytes = 0;
		this.map = new Map();
	}

	get(key) {
		const value = this.map.get(key);
		if (value) {
			this.map.delete(key);
			this.map.set(key, value);
		}
		return value;
	}

	set(key, value) {
		if (value.length > this.maxBytes) {
			return;
		}
		if (this.map.has(key)) {
			this.bytes -= this.map.get(key).length;
			this.map.delete(key);
		}
		this.map.set(key, value);
		this.bytes += value.length;

		while (this.bytes > this.maxBytes) {
			const [oldest, data] = this.map.entries().next().value;
			this.map.delete(oldest);
			this.bytes -= data.length;
		}
	}
}

class ClientFiles {
	/**
	 * @param {object} options
	 * @param {string} options.root client folder
	 * @param {number} [options.cacheMB=256] memory kept for recently served files
	 * @param {function} [options.log]
	 */
	constructor({ root, cacheMB = 256, log = console.log }) {
		this.root = path.resolve(root);
		this.cache = new ByteCache(cacheMB * 1024 * 1024);
		this.log = log;
		this.archives = [];
		this.load();
	}

	/**
	 * Open the archives DATA.INI lists. A missing DATA.INI or archive is reported, not fatal: loose files
	 * are still served.
	 */
	load() {
		const dataIni = path.join(this.root, 'DATA.INI');
		if (!fs.existsSync(dataIni)) {
			this.log(`[client] No DATA.INI in ${this.root}, serving loose files only.`);
			return;
		}

		for (const entry of parseDataIni(fs.readFileSync(dataIni, 'utf8'))) {
			const grfPath = path.resolve(this.root, entry);
			const start = Date.now();
			try {
				const archive = new GrfArchive(grfPath);
				this.archives.push(archive);
				this.log(`[client] ${entry}: ${archive.count.toLocaleString()} files (${Date.now() - start} ms)`);
			} catch (error) {
				this.log(`[client] Cannot open ${entry}: ${error.message}`);
			}
		}
	}

	/**
	 * A request path inside one of the servable folders, or null if it reaches anywhere else.
	 *
	 * @param {string} filename `/` or `\` separated, relative to the client folder
	 * @return {string|null}
	 */
	resolveLoose(filename) {
		if (filename.includes('\0')) {
			return null;
		}
		const resolved = path.resolve(this.root, filename.replace(/\\/g, '/'));
		const relative = path.relative(this.root, resolved);
		if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
			return null;
		}
		const top = relative.split(path.sep)[0].toLowerCase();
		if (relative === top) {
			return SERVABLE_FILES.has(top) ? resolved : null;
		}
		return SERVABLE_ROOTS.has(top) ? resolved : null;
	}

	/**
	 * The file at `resolved`, matched without regard to case as on Windows, or null.
	 * The client asks for `System/itemInfo.lub` whatever the folder on a Linux server calls it.
	 *
	 * @param {string} resolved absolute path inside the client folder
	 * @return {Promise<string|null>}
	 */
	async findOnDisk(resolved) {
		try {
			if ((await fsp.stat(resolved)).isFile()) {
				return resolved;
			}
			return null;
		} catch (_e) {
			// not under this exact case: walk down from the client folder
		}

		let current = this.root;
		for (const part of path.relative(this.root, resolved).split(path.sep)) {
			let names;
			try {
				names = await fsp.readdir(current);
			} catch (_e) {
				return null;
			}
			const lower = part.toLowerCase();
			const match = names.find(name => name.toLowerCase() === lower);
			if (!match) {
				return null;
			}
			current = path.join(current, match);
		}

		try {
			return (await fsp.stat(current)).isFile() ? current : null;
		} catch (_e) {
			return null;
		}
	}

	/**
	 * @param {string} filename path as the client asks for it: `/` or `\` separated, any case
	 * @return {Promise<Uint8Array|null>}
	 */
	async getFile(filename) {
		const key = filename.replace(/\//g, '\\').toLowerCase();
		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}

		let content = null;
		const loose = this.resolveLoose(filename);
		if (loose) {
			const found = await this.findOnDisk(loose);
			if (found) {
				content = new Uint8Array(await fsp.readFile(found));
			}
		}

		if (!content) {
			const grfPath = filename.replace(/\//g, '\\');
			for (const archive of this.archives) {
				if (archive.has(grfPath)) {
					content = await archive.getFile(grfPath);
					break;
				}
			}
		}

		if (content) {
			this.cache.set(key, content);
		}
		return content;
	}

	/**
	 * Every match of `pattern` in each archive's name table, as the client's FileManager.search returns
	 * them for a GRF it loaded itself.
	 *
	 * @param {RegExp} pattern
	 * @return {string[]}
	 */
	search(pattern) {
		const matches = this.archives.flatMap(archive => archive.nameTable.match(pattern) || []);
		return Array.from(new Set(matches));
	}

	close() {
		for (const archive of this.archives) {
			archive.close();
		}
		this.archives = [];
	}
}

export default ClientFiles;
