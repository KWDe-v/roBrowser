/**
 * server/aliases.js
 *
 * Lets plain Node resolve the client's path aliases (`Loaders/GameFile.js`, `Utils/...`), so the server
 * reads GRFs with the client's own loader instead of a second implementation.
 *
 * Every alias is a top-level folder of src/ (the same list vite.config.js and builder-web.mjs spell out),
 * so the folders are read here rather than copied into a third list.
 */
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const srcRoot = path.resolve(import.meta.dirname, '../src');
const aliases = new Set(
	fs
		.readdirSync(srcRoot, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
);

if (typeof module.registerHooks !== 'function') {
	throw new Error(`The roBrowser server needs Node 22.15 or newer (running ${process.version}).`);
}

module.registerHooks({
	resolve(specifier, context, nextResolve) {
		const slash = specifier.indexOf('/');
		if (slash > 0 && aliases.has(specifier.slice(0, slash))) {
			return {
				url: pathToFileURL(path.join(srcRoot, specifier)).href,
				shortCircuit: true
			};
		}
		return nextResolve(specifier, context);
	}
});
