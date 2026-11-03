/**
 * DB/ClientFileNames.js
 *
 * Where the client keeps its System files, read from `aliases.json` at the root of the client folder.
 * Clients rename and move these (itemInfo_true.lub, a translated SystemEN folder...), so each one is
 * listed there instead of being fixed in the code; a key the file leaves out keeps its default.
 *
 *   {
 *     "itemInfo": { "all": ["System/iteminfo/iteminfo1.lua", "System/iteminfo/iteminfo2.lua"] },
 *     "mapInfo": ["System/mapInfo_true.lub"],
 *     "signBoardTranslation": []
 *   }
 *
 * A list is tried in order and the first file that loads is used; `{ "all": [...] }` loads every file
 * in order (the first one to define an entry keeps it); an empty list skips the file.
 * `fontPath` is a folder. The file is edited by hand: `//` and `/* *\/` comments and trailing commas
 * are accepted.
 */

export const ALIASES_FILE = 'aliases.json';

/**
 * Every name the client tries for a System file: `<name>`, `<name>_true`, `<name>_sak`, `<name>_Sakray`,
 * each as .lub then .lua.
 *
 * @param {string} basePath
 * @return {string[]}
 */
export function getSystemAliases(basePath) {
	basePath = basePath.replace(/\.(lub|lua)$/i, ''); // Prevents extension been passed

	const suffixes = ['', '_true', '_sak', '_Sakray']; // Priority order
	const extensions = ['.lub', '.lua'];
	const fileList = [];

	for (let s = 0; s < suffixes.length; s++) {
		for (let e = 0; e < extensions.length; e++) {
			fileList.push(basePath + suffixes[s] + extensions[e]);
		}
	}
	return fileList;
}

/**
 * The names used when aliases.json does not say otherwise.
 */
export const DEFAULT_CLIENT_FILES = {
	fontPath: 'System/Font/',
	itemInfo: getSystemAliases('System/itemInfo.lub'),
	petEvolution: getSystemAliases('System/PetEvolutionCln.lub'),
	mapInfo: getSystemAliases('System/mapInfo.lub'),
	questInfo: getSystemAliases('System/OngoingQuestInfoList.lub'),
	privateAirship: ['System/PrivateAirplane_True.lub', ...getSystemAliases('System/PrivateAirplane.lub')],
	townInfo: ['System/Towninfo.lub'],
	attendance: ['System/CheckAttendance.lub'],
	achievement: ['System/achievement_list.lub'],
	// Not official: translations some clients add
	signBoardTranslation: ['SystemEN/Sign_Data.lub'],
	questTranslation: ['SystemEN/OngoingQuests.lub'],
	townInfoTranslation: ['SystemEN/Towninfo.lub']
};

const FOLDER_KEYS = new Set(['fontPath']);

/**
 * JSON with comments and trailing commas, as people write it by hand.
 *
 * @param {string} text
 * @return {*}
 */
export function parseJsonWithComments(text) {
	let out = '';
	let inString = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (inString) {
			out += char;
			if (char === '\\') {
				out += text[++i] ?? '';
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			out += char;
		} else if (char === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') {
				i++;
			}
			out += '\n';
		} else if (char === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end === -1 ? text.length : end + 1;
		} else if (char === ',') {
			// a comma followed only by blanks before } or ] is dropped
			const next = text.slice(i + 1).match(/^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*[}\]]/);
			if (!next) {
				out += char;
			}
		} else {
			out += char;
		}
	}

	return JSON.parse(out);
}

let _files = { ...DEFAULT_CLIENT_FILES };

/**
 * Keep the keys of `json` that are known and well formed; report the others.
 *
 * @param {object} json
 * @return {object}
 */
export function parseClientFiles(json) {
	const result = {};
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		console.warn(`[ClientFileNames] ${ALIASES_FILE} must hold a JSON object.`);
		return result;
	}

	const isList = value => Array.isArray(value) && value.every(name => typeof name === 'string');

	for (const [key, value] of Object.entries(json)) {
		if (!(key in DEFAULT_CLIENT_FILES)) {
			console.warn(`[ClientFileNames] Unknown key "${key}" in ${ALIASES_FILE}.`);
			continue;
		}

		const valid = FOLDER_KEYS.has(key)
			? typeof value === 'string'
			: isList(value) || (value && typeof value === 'object' && isList(value.all));

		if (!valid) {
			console.warn(`[ClientFileNames] Ignored "${key}" in ${ALIASES_FILE}: wrong format.`);
			continue;
		}

		// A folder always ends with "/", the way the paths are joined
		result[key] = FOLDER_KEYS.has(key) && value && !/[/\\]$/.test(value) ? value + '/' : value;
	}

	return result;
}

const ClientFileNames = {
	/**
	 * Read aliases.json from the client, if it has one. Always resolves: without the file, or with a
	 * broken one, the defaults stay.
	 *
	 * @param {function(string, function, function)} loadFile Client.loadFile
	 * @return {Promise<void>}
	 */
	load(loadFile) {
		_files = { ...DEFAULT_CLIENT_FILES };

		return new Promise(resolve => {
			loadFile(
				ALIASES_FILE,
				buffer => {
					try {
						const text = new TextDecoder('utf-8').decode(
							buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
						);
						Object.assign(_files, parseClientFiles(parseJsonWithComments(text)));
						console.log(`Loaded file names from "${ALIASES_FILE}".`);
					} catch (error) {
						console.warn(`[ClientFileNames] Cannot read ${ALIASES_FILE}: ${error.message}`);
					}
					resolve();
				},
				() => resolve()
			);
		});
	},

	/**
	 * @param {string} key a folder key (fontPath)
	 * @return {string}
	 */
	folder(key) {
		return _files[key];
	},

	/**
	 * @param {string} key
	 * @return {string[]} names to try, in order
	 */
	list(key) {
		const value = _files[key];
		return [...(Array.isArray(value) ? value : value.all)];
	},

	/**
	 * @param {string} key
	 * @return {boolean} true when every listed file is to be loaded, not only the first found
	 */
	loadAll(key) {
		return !Array.isArray(_files[key]);
	},

	/**
	 * @param {string} key
	 * @return {boolean} true when aliases.json sets this key
	 */
	isCustom(key) {
		return _files[key] !== DEFAULT_CLIENT_FILES[key];
	},

	/** Back to the defaults (tests, and before reading another client). */
	reset() {
		_files = { ...DEFAULT_CLIENT_FILES };
	}
};

export default ClientFileNames;
