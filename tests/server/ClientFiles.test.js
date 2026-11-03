// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import ClientFiles, { parseDataIni } from '../../server/ClientFiles.js';
import createClientRoutes from '../../server/clientRoutes.js';
import TextEncoding from 'Utils/CodepageManager.js';

const HEADER_SIZE = 46;
const TYPE_FILE = 0x01;

/**
 * A GRF 0x200 holding `files`, every name given as raw bytes (the way an archive stores them).
 *
 * @param {Array<{name: Uint8Array, data: Uint8Array}>} files
 * @return {Buffer}
 */
function buildGrf(files) {
	const bodies = [];
	const entries = [];
	let offset = 0;

	for (const { name, data } of files) {
		const packed = zlib.deflateSync(data);
		bodies.push(packed);

		const entry = Buffer.alloc(name.length + 1 + 17);
		Buffer.from(name).copy(entry, 0);
		let pos = name.length + 1;
		entry.writeUInt32LE(packed.length, pos);
		entry.writeUInt32LE(packed.length, pos + 4);
		entry.writeUInt32LE(data.length, pos + 8);
		entry.writeUInt8(TYPE_FILE, pos + 12);
		entry.writeUInt32LE(offset, pos + 13);
		entries.push(entry);

		offset += packed.length;
	}

	const table = Buffer.concat(entries);
	const packedTable = zlib.deflateSync(table);

	const header = Buffer.alloc(HEADER_SIZE);
	header.write('Master of Magic', 0, 'latin1');
	header.writeUInt32LE(offset, 30); // file table offset, after the bodies
	header.writeUInt32LE(0, 34); // skip
	header.writeUInt32LE(files.length + 7, 38); // file count, stored with 7 added
	header.writeUInt32LE(0x200, 42);

	const tableHeader = Buffer.alloc(8);
	tableHeader.writeUInt32LE(packedTable.length, 0);
	tableHeader.writeUInt32LE(table.length, 4);

	return Buffer.concat([header, ...bodies, tableHeader, packedTable]);
}

const ascii = text => new Uint8Array(Buffer.from(text, 'latin1'));

// "data\sprite\<two CP949 bytes>.spr": a Korean name as an archive stores it
const koreanBytes = new Uint8Array([...ascii('data\\sprite\\'), 0xc0, 0xce, ...ascii('.spr')]);
// ...and the way the client spells it once it reads the table
const koreanName = TextEncoding.decode(koreanBytes, 'utf-8');

let root;
let files;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'robrowser-client-'));

	fs.writeFileSync(
		path.join(root, 'custom.grf'),
		buildGrf([{ name: ascii('data\\shared.txt'), data: ascii('from custom') }])
	);
	fs.writeFileSync(
		path.join(root, 'data.grf'),
		buildGrf([
			{ name: ascii('data\\shared.txt'), data: ascii('from data') },
			{ name: ascii('data\\Texture\\Mixed.BMP'), data: ascii('bitmap') },
			{ name: ascii('data\\loose.txt'), data: ascii('packed copy') },
			{ name: ascii('data\\bgm.mp3'), data: ascii('0123456789') },
			{ name: koreanBytes, data: ascii('sprite') }
		])
	);
	fs.writeFileSync(path.join(root, 'DATA.INI'), '[Data]\r\n1=data.grf\r\n0=custom.grf\r\n');

	fs.mkdirSync(path.join(root, 'data'));
	fs.writeFileSync(path.join(root, 'data', 'loose.txt'), 'loose copy');
	fs.mkdirSync(path.join(root, 'System'));
	fs.writeFileSync(path.join(root, 'System', 'itemInfo.lub'), 'lua');
	fs.writeFileSync(path.join(root, 'aliases.json'), '{}');
	fs.writeFileSync(path.join(root, 'notes.txt'), 'private');

	files = new ClientFiles({ root, log: () => {} });
});

afterAll(() => {
	files.close();
	fs.rmSync(root, { recursive: true, force: true });
});

const text = data => (data ? Buffer.from(data).toString('latin1') : null);

describe('parseDataIni', () => {
	it('orders the [Data] entries by number and ignores the rest', () => {
		const ini = '; comment\n[Other]\n0=nope.grf\n[data]\n2=c.grf\n# comment\n0=a.grf\n1 = b.grf\n';
		expect(parseDataIni(ini)).toEqual(['a.grf', 'b.grf', 'c.grf']);
	});
});

describe('ClientFiles', () => {
	it('opens every archive DATA.INI lists', () => {
		expect(files.archives).toHaveLength(2);
	});

	it('reads a file packed in a GRF, whatever the case and separator', async () => {
		expect(text(await files.getFile('data/texture/mixed.bmp'))).toBe('bitmap');
		expect(text(await files.getFile('DATA\\TEXTURE\\MIXED.BMP'))).toBe('bitmap');
	});

	it('gives the lowest DATA.INI number priority', async () => {
		expect(text(await files.getFile('data/shared.txt'))).toBe('from custom');
	});

	it('prefers a loose file over the archives', async () => {
		expect(text(await files.getFile('data/loose.txt'))).toBe('loose copy');
	});

	it('finds loose files without regard to case', async () => {
		expect(text(await files.getFile('system/ITEMINFO.lub'))).toBe('lua');
	});

	it('finds a Korean name by the spelling the client asks for', async () => {
		expect(text(await files.getFile(koreanName.replace(/\\/g, '/')))).toBe('sprite');
	});

	it('never serves the archives, DATA.INI or anything outside the asset folders', async () => {
		expect(await files.getFile('DATA.INI')).toBeNull();
		expect(await files.getFile('data.grf')).toBeNull();
		expect(await files.getFile('data/../DATA.INI')).toBeNull();
		expect(await files.getFile('../package.json')).toBeNull();
		expect(await files.getFile('data')).toBeNull();
	});

	it('serves aliases.json, and no other file at the top of the client folder', async () => {
		expect(text(await files.getFile('aliases.json'))).toBe('{}');
		expect(text(await files.getFile('ALIASES.JSON'))).toBe('{}');
		expect(await files.getFile('notes.txt')).toBeNull();
	});

	it('answers null for a missing file', async () => {
		expect(await files.getFile('data/missing.txt')).toBeNull();
	});

	it('searches the name tables like the client does', () => {
		expect(files.search(/data\\[^\0]+\.bmp/gi)).toEqual(['data\\Texture\\Mixed.BMP']);
	});

	it('serves loose files only when DATA.INI is missing', async () => {
		const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'robrowser-bare-'));
		fs.mkdirSync(path.join(bare, 'data'));
		fs.writeFileSync(path.join(bare, 'data', 'a.txt'), 'a');
		const loose = new ClientFiles({ root: bare, log: () => {} });
		expect(loose.archives).toHaveLength(0);
		expect(text(await loose.getFile('data/a.txt'))).toBe('a');
		fs.rmSync(bare, { recursive: true, force: true });
	});
});

/**
 * Run one request through the routes and collect the answer.
 */
function request(routes, { method = 'GET', url, headers = {}, body = '' }) {
	return new Promise((resolve, reject) => {
		const listeners = {};
		const req = {
			method,
			url,
			headers,
			on(event, fn) {
				listeners[event] = fn;
				if (event === 'end') {
					queueMicrotask(() => {
						if (body) {
							listeners.data?.(Buffer.from(body));
						}
						listeners.end();
					});
				}
				return req;
			},
			destroy() {}
		};
		const res = {
			statusCode: 200,
			headers: {},
			setHeader(name, value) {
				res.headers[name.toLowerCase()] = value;
			},
			end(data) {
				resolve({ status: res.statusCode, headers: res.headers, body: data ? Buffer.from(data) : Buffer.alloc(0) });
			}
		};
		routes(req, res, error => reject(error || new Error('not handled')));
	});
}

describe('clientRoutes', () => {
	let routes;
	beforeAll(() => {
		routes = createClientRoutes(files);
	});

	it('serves a file the way FileManager.getHTTP encodes its path', async () => {
		const url = '/' + koreanName.replace(/\\/g, '/').replace(/[^/]+/g, part => encodeURIComponent(part));
		const res = await request(routes, { url });
		expect(res.status).toBe(200);
		expect(res.body.toString('latin1')).toBe('sprite');
	});

	it('answers 404 for a missing file', async () => {
		const res = await request(routes, { url: '/data/missing.txt' });
		expect(res.status).toBe(404);
	});

	it('serves a byte range of an audio file', async () => {
		const res = await request(routes, { url: '/data/bgm.mp3', headers: { range: 'bytes=2-5' } });
		expect(res.status).toBe(206);
		expect(res.headers['content-range']).toBe('bytes 2-5/10');
		expect(res.body.toString('latin1')).toBe('2345');
	});

	it('answers a batch with every file it found, in base64', async () => {
		const res = await request(routes, {
			method: 'POST',
			url: '/batch',
			body: JSON.stringify({ files: ['data/loose.txt', 'data/missing.txt'] })
		});
		const json = JSON.parse(res.body.toString('utf8'));
		expect(Object.keys(json)).toEqual(['data/loose.txt']);
		expect(Buffer.from(json['data/loose.txt'], 'base64').toString('latin1')).toBe('loose copy');
	});

	it('rejects a batch without a file list', async () => {
		const res = await request(routes, { method: 'POST', url: '/batch', body: '{}' });
		expect(res.status).toBe(400);
	});

	it('answers a search as the client posts it', async () => {
		const res = await request(routes, {
			method: 'POST',
			url: '/',
			body: 'filter=' + encodeURIComponent('data\\\\[^\\0]+\\.bmp')
		});
		expect(res.body.toString('latin1')).toBe('data\\Texture\\Mixed.BMP');
	});

	it('answers an empty search when search is off or the pattern is invalid', async () => {
		const off = createClientRoutes(files, { enableSearch: false });
		const disabled = await request(off, { method: 'POST', url: '/', body: 'filter=bmp' });
		expect(disabled.body.length).toBe(0);

		const invalid = await request(routes, { method: 'POST', url: '/', body: 'filter=' + encodeURIComponent('(') });
		expect(invalid.body.length).toBe(0);
	});
});
