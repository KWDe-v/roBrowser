/**
 * tests/core/FileManager.batch.test.js
 *
 * Files asked for at the same time reach the remote client in one /batch request, so a window's art
 * arrives at once instead of a few files at a time. A file the server lacks fails at once; one the
 * answer leaves out, or a batch that fails, falls back to its own request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let FileManager;
let fetchMock;

const toBase64 = text => btoa(text);
const bytes = buffer => String.fromCharCode(...new Uint8Array(buffer));

/** A fetch answering /batch with `answer(files)` and single files with their name as content. */
function stubFetch(answer, { batchOk = true } = {}) {
	fetchMock = vi.fn(async (url, options) => {
		if (url.endsWith('batch')) {
			const files = JSON.parse(options.body).files;
			return { ok: batchOk, status: batchOk ? 200 : 500, json: async () => answer(files) };
		}
		const body = new TextEncoder().encode('single:' + url).buffer;
		return { ok: true, headers: { get: () => 'application/octet-stream' }, arrayBuffer: async () => body };
	});
	vi.stubGlobal('fetch', fetchMock);
}

const batchCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('batch'));
const singleCalls = () => fetchMock.mock.calls.filter(([url]) => !url.endsWith('batch'));

/** Ask for every file in the same frame and wait for all the answers. */
async function load(filenames) {
	const results = filenames.map(() => vi.fn());
	filenames.forEach((filename, i) => FileManager.getBatchHTTP(filename, results[i]));
	await vi.waitFor(() => results.forEach(cb => expect(cb).toHaveBeenCalled()));
	return results.map(cb => cb.mock.calls[0]);
}

beforeEach(async () => {
	vi.resetModules();
	({ default: FileManager } = await import('Core/FileManager.js'));
	FileManager.remoteClient = '/client/';
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('FileManager.getBatchHTTP', () => {
	it('asks for the files of one frame in a single request', async () => {
		stubFetch(files => Object.fromEntries(files.map(f => [f, toBase64('art:' + f)])));
		const [a, b, c] = await load(['data\\a.bmp', 'data\\b.bmp', 'data\\c.bmp']);

		expect(batchCalls()).toHaveLength(1);
		expect(JSON.parse(batchCalls()[0][1].body).files).toEqual(['data/a.bmp', 'data/b.bmp', 'data/c.bmp']);
		expect(singleCalls()).toHaveLength(0);
		expect(bytes(a[0])).toBe('art:data/a.bmp');
		expect(bytes(b[0])).toBe('art:data/b.bmp');
		expect(bytes(c[0])).toBe('art:data/c.bmp');
	});

	it('splits more than 50 files over several requests', async () => {
		stubFetch(files => Object.fromEntries(files.map(f => [f, toBase64('x')])));
		const names = Array.from({ length: 120 }, (_, i) => `data\\${i}.bmp`);
		await load(names);

		const sizes = batchCalls().map(([, options]) => JSON.parse(options.body).files.length);
		expect(sizes).toEqual([50, 50, 20]);
	});

	it('fails at once a file the server answers null for', async () => {
		stubFetch(files => ({ [files[0]]: toBase64('here'), [files[1]]: null }));
		const [found, missing] = await load(['data\\here.bmp', 'data\\missing.bmp']);

		expect(bytes(found[0])).toBe('here');
		expect(missing).toEqual([null, "Can't get file"]);
		expect(singleCalls()).toHaveLength(0);
	});

	it('asks on its own for a file the answer leaves out', async () => {
		stubFetch(files => ({ [files[0]]: toBase64('in batch') }));
		const [, leftOut] = await load(['data\\a.bmp', 'data\\big.bmp']);

		expect(singleCalls().map(([url]) => url)).toEqual(['/client/data/big.bmp']);
		expect(bytes(leftOut[0])).toBe('single:/client/data/big.bmp');
	});

	it('falls back to single requests when the batch request fails', async () => {
		stubFetch(() => ({}), { batchOk: false });
		await load(['data\\a.bmp', 'data\\b.bmp']);

		expect(singleCalls().map(([url]) => url)).toEqual(['/client/data/a.bmp', '/client/data/b.bmp']);
	});

	it('leaves sounds to their URL, played by the audio element', async () => {
		stubFetch(() => ({}));
		const callback = vi.fn();
		FileManager.getBatchHTTP('BGM\\01.mp3', callback);

		expect(callback).toHaveBeenCalledWith('/client/BGM/01.mp3');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends a lone file as a plain request', async () => {
		stubFetch(() => ({}));
		await load(['data\\only.bmp']);

		expect(batchCalls()).toHaveLength(0);
		expect(singleCalls()).toHaveLength(1);
	});
});
