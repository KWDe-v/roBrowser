/**
 * server/clientRoutes.js
 *
 * The HTTP side of the client folder, in the shape src/Core/FileManager.js asks for it when
 * `remoteClient` points here:
 *
 *   GET  <remoteClient><path>   one file (getHTTP)
 *   POST <remoteClient>batch    several files, base64 in JSON (getBatchHTTP)
 *   POST <remoteClient>         file search, form `filter=<RegExp.source>` (search, map/model/GRF viewers)
 *
 * A Connect-style handler, mounted on the prefix: `req.url` is the path below it. The Vite dev server
 * and server/index.js both mount it.
 */
import './aliases.js';
import path from 'node:path';

const { default: TextEncoding } = await import('Utils/CodepageManager.js');

const MIME_TYPES = {
	'.bmp': 'image/bmp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.tga': 'image/x-tga',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
	'.txt': 'text/plain',
	'.xml': 'text/xml',
	'.lua': 'text/plain',
	'.json': 'application/json'
};

/** Played by an <audio> element straight from the URL: the browser needs byte ranges to seek. */
const RANGE_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg']);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_FILES = 50;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const MAX_FILTER_LENGTH = 256;

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', chunk => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error('Body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/**
 * The file path a request asks for, decoded segment by segment as getHTTP encoded it.
 *
 * @param {string} url request path below the mount point, with query string
 * @return {string|null}
 */
function requestPath(url) {
	const pathname = url.split('?')[0].replace(/^\/+/, '');
	try {
		return pathname
			.split('/')
			.map(part => decodeURIComponent(part))
			.join('/');
	} catch (_e) {
		return null;
	}
}

function sendFile(req, res, filename, content) {
	const ext = path.extname(filename).toLowerCase();
	res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
	res.setHeader('Cache-Control', 'public, max-age=86400');

	let body = Buffer.from(content.buffer, content.byteOffset, content.byteLength);

	if (RANGE_EXTENSIONS.has(ext)) {
		res.setHeader('Accept-Ranges', 'bytes');
		const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
		if (range && (range[1] || range[2])) {
			const size = body.length;
			const start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2], 10));
			const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
			if (start > end || start >= size) {
				res.statusCode = 416;
				res.setHeader('Content-Range', `bytes */${size}`);
				res.end();
				return;
			}
			res.statusCode = 206;
			res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
			body = body.subarray(start, end + 1);
		}
	}

	res.setHeader('Content-Length', body.length);
	res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * @param {import('./ClientFiles.js').default} files
 * @param {object} [options]
 * @param {boolean} [options.enableSearch=true] file search runs a client-supplied pattern over every
 *   name: worth turning off on a public server, the game itself never searches
 * @return {function(req, res, next)}
 */
export default function createClientRoutes(files, { enableSearch = true } = {}) {
	async function batch(req, res) {
		let list;
		try {
			list = JSON.parse(await readBody(req)).files;
		} catch (_e) {
			list = null;
		}
		if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH_FILES) {
			res.statusCode = 400;
			res.end('Invalid files array');
			return;
		}

		// Read at once, answered in order. A missing file is null; one past the size budget is left out,
		// and the client asks for it on its own (FileManager.sendBatch).
		const names = list.filter(filename => typeof filename === 'string');
		const contents = await Promise.all(names.map(filename => files.getFile(filename)));

		const results = {};
		let total = 0;
		names.forEach((filename, index) => {
			const content = contents[index];
			if (!content) {
				results[filename] = null;
				return;
			}
			if (total + content.length > MAX_BATCH_BYTES) {
				return;
			}
			total += content.length;
			results[filename] = Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('base64');
		});

		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Cache-Control', 'no-store');
		res.end(JSON.stringify(results));
	}

	/**
	 * The client reads the answer as ISO-8859-1 (which browsers decode as windows-1252) and splits it on
	 * new lines; anything that is not a result must be an empty body, or it would come back as file names.
	 */
	async function search(req, res) {
		res.setHeader('Content-Type', 'text/plain; charset=ISO-8859-1');
		res.setHeader('Cache-Control', 'no-store');

		let matches = [];
		try {
			const filter = new URLSearchParams(await readBody(req)).get('filter');
			if (enableSearch && filter && filter.length <= MAX_FILTER_LENGTH) {
				matches = files.search(new RegExp(filter, 'gi'));
			}
		} catch (_e) {
			matches = [];
		}

		res.end(Buffer.from(TextEncoding.encode(matches.join('\n'), 'windows-1252')));
	}

	return async function clientRoutes(req, res, next) {
		try {
			res.setHeader('Access-Control-Allow-Origin', '*');

			if (req.method === 'OPTIONS') {
				res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST');
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
				res.statusCode = 204;
				res.end();
				return;
			}

			const filename = requestPath(req.url);

			if (req.method === 'POST') {
				if (filename === 'batch') {
					await batch(req, res);
				} else if (filename === '' || filename === 'search') {
					await search(req, res);
				} else {
					next();
				}
				return;
			}

			if (req.method !== 'GET' && req.method !== 'HEAD') {
				next();
				return;
			}

			const content = filename ? await files.getFile(filename) : null;
			if (!content) {
				res.statusCode = 404;
				res.setHeader('Content-Type', 'text/plain');
				res.setHeader('Cache-Control', 'no-store');
				res.end('File not found');
				return;
			}

			sendFile(req, res, filename, content);
		} catch (error) {
			next(error);
		}
	};
}
