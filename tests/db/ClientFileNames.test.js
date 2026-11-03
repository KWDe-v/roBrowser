import { describe, it, expect, beforeEach, vi } from 'vitest';
import ClientFileNames, {
	ALIASES_FILE,
	DEFAULT_CLIENT_FILES,
	getSystemAliases,
	parseClientFiles,
	parseJsonWithComments
} from 'DB/ClientFileNames.js';

/** A Client.loadFile that answers `files` by name, and fails for anything else. */
function fakeLoadFile(files) {
	return (filename, onload, onerror) => {
		if (filename in files) {
			onload(new TextEncoder().encode(files[filename]));
		} else {
			onerror();
		}
	};
}

beforeEach(() => {
	ClientFileNames.reset();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('getSystemAliases', () => {
	it('tries every suffix, .lub before .lua', () => {
		expect(getSystemAliases('System/mapInfo.lub')).toEqual([
			'System/mapInfo.lub',
			'System/mapInfo.lua',
			'System/mapInfo_true.lub',
			'System/mapInfo_true.lua',
			'System/mapInfo_sak.lub',
			'System/mapInfo_sak.lua',
			'System/mapInfo_Sakray.lub',
			'System/mapInfo_Sakray.lua'
		]);
	});
});

describe('parseJsonWithComments', () => {
	it('accepts line and block comments', () => {
		const text = `{
			// translations
			"a": [], /* none */
			"b": ["x"] // last
		}`;
		expect(parseJsonWithComments(text)).toEqual({ a: [], b: ['x'] });
	});

	it('accepts trailing commas, even before a comment', () => {
		expect(parseJsonWithComments('{ "a": ["x", "y",], "b": 1, // end\n }')).toEqual({ a: ['x', 'y'], b: 1 });
	});

	it('leaves slashes and commas inside strings alone', () => {
		expect(parseJsonWithComments('{ "a": "System//Font/*,]", "b": "say \\"hi\\" // no" }')).toEqual({
			a: 'System//Font/*,]',
			b: 'say "hi" // no'
		});
	});

	it('still rejects broken JSON', () => {
		expect(() => parseJsonWithComments('{ "a": ')).toThrow();
	});
});

describe('parseClientFiles', () => {
	it('keeps known keys in a valid format', () => {
		expect(
			parseClientFiles({
				mapInfo: ['System/a.lub'],
				itemInfo: { all: ['System/i1.lua', 'System/i2.lua'] },
				signBoardTranslation: []
			})
		).toEqual({
			mapInfo: ['System/a.lub'],
			itemInfo: { all: ['System/i1.lua', 'System/i2.lua'] },
			signBoardTranslation: []
		});
	});

	it('drops unknown keys and wrong formats', () => {
		expect(
			parseClientFiles({
				nope: ['x'],
				mapInfo: 'System/a.lub',
				questInfo: [1, 2],
				fontPath: ['System/Font/']
			})
		).toEqual({});
	});

	it('ends a folder with a slash', () => {
		expect(parseClientFiles({ fontPath: 'System/Fonts' })).toEqual({ fontPath: 'System/Fonts/' });
	});

	it('rejects anything but an object', () => {
		expect(parseClientFiles([])).toEqual({});
		expect(parseClientFiles(null)).toEqual({});
	});
});

describe('ClientFileNames', () => {
	it('keeps the defaults when the client has no aliases.json', async () => {
		await ClientFileNames.load(fakeLoadFile({}));
		expect(ClientFileNames.list('mapInfo')).toEqual(DEFAULT_CLIENT_FILES.mapInfo);
		expect(ClientFileNames.folder('fontPath')).toBe('System/Font/');
		expect(ClientFileNames.isCustom('mapInfo')).toBe(false);
		expect(ClientFileNames.loadAll('itemInfo')).toBe(false);
	});

	it('reads the names aliases.json gives, key by key', async () => {
		await ClientFileNames.load(
			fakeLoadFile({
				[ALIASES_FILE]: JSON.stringify({
					mapInfo: ['System/mapInfo_true.lub'],
					itemInfo: { all: ['System/iteminfo/iteminfo1.lua', 'System/iteminfo/iteminfo2.lua'] },
					questTranslation: []
				})
			})
		);

		expect(ClientFileNames.list('mapInfo')).toEqual(['System/mapInfo_true.lub']);
		expect(ClientFileNames.isCustom('mapInfo')).toBe(true);

		expect(ClientFileNames.list('itemInfo')).toEqual([
			'System/iteminfo/iteminfo1.lua',
			'System/iteminfo/iteminfo2.lua'
		]);
		expect(ClientFileNames.loadAll('itemInfo')).toBe(true);

		expect(ClientFileNames.list('questTranslation')).toEqual([]);

		// left out: default
		expect(ClientFileNames.list('townInfo')).toEqual(DEFAULT_CLIENT_FILES.townInfo);
	});

	it('keeps the defaults when aliases.json is not valid JSON', async () => {
		await ClientFileNames.load(fakeLoadFile({ [ALIASES_FILE]: '{ mapInfo: ' }));
		expect(ClientFileNames.list('mapInfo')).toEqual(DEFAULT_CLIENT_FILES.mapInfo);
	});

	it('forgets the previous client when loading another', async () => {
		await ClientFileNames.load(fakeLoadFile({ [ALIASES_FILE]: '{"mapInfo": ["System/x.lub"]}' }));
		await ClientFileNames.load(fakeLoadFile({}));
		expect(ClientFileNames.list('mapInfo')).toEqual(DEFAULT_CLIENT_FILES.mapInfo);
	});

	it('hands out copies: a caller cannot change the names', async () => {
		ClientFileNames.list('mapInfo').push('System/other.lub');
		expect(ClientFileNames.list('mapInfo')).toEqual(DEFAULT_CLIENT_FILES.mapInfo);
	});
});
