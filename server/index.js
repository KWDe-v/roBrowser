/**
 * server/index.js
 *
 * Production server: one port for everything a player needs.
 *
 *   /            the built client (npm run build), from dist/Web
 *   /client/     game files from the client folder, GRFs read in place (server/ClientFiles.js)
 *   /ws/         WebSocket to TCP bridge to the game server (server/wsProxy.js)
 *
 * Environment:
 *   PORT                 listening port (8000)
 *   CLIENT_PATH          client folder (./client)
 *   STATIC_PATH          built client (./dist/Web)
 *   CACHE_MB             memory kept for recently served game files (256)
 *   WS_ALLOWED_TARGETS   game servers /ws/ may reach, `host:port` comma-separated (rAthena's ports on
 *                        127.0.0.1 and localhost)
 *   CLIENT_ENABLESEARCH  `true` to answer file searches (off: only the asset viewers search, not the game)
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import ClientFiles from './ClientFiles.js';
import createClientRoutes from './clientRoutes.js';
import { attachWsProxy, parseAllowedTargets } from './wsProxy.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const port = parseInt(process.env.PORT || '8000', 10);
const clientPath = path.resolve(projectRoot, process.env.CLIENT_PATH || 'client');
const staticPath = path.resolve(projectRoot, process.env.STATIC_PATH || 'dist/Web');

const STATIC_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf'
};

if (!fs.existsSync(path.join(staticPath, 'index.html'))) {
	console.error(`[server] No build in ${staticPath}. Run "npm run build" first.`);
	process.exit(1);
}

const files = new ClientFiles({
	root: clientPath,
	cacheMB: parseInt(process.env.CACHE_MB || '256', 10)
});
const clientRoutes = createClientRoutes(files, {
	enableSearch: process.env.CLIENT_ENABLESEARCH === 'true'
});

/**
 * A file of the built client, or null. Config.local.js is also looked for in the project folder, so the
 * server's own settings survive a rebuild of dist/.
 */
async function findStatic(urlPath) {
	let relative;
	try {
		relative = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html';
	} catch (_e) {
		return null;
	}

	const candidates = [];
	if (relative === 'Config.local.js') {
		candidates.push(path.join(projectRoot, 'Config.local.js'));
	}

	// Never outside the build folder
	const resolved = path.resolve(staticPath, relative);
	const inside = path.relative(staticPath, resolved);
	if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
		candidates.push(resolved);
	}

	for (const candidate of candidates) {
		try {
			const stat = await fsp.stat(candidate);
			if (stat.isFile()) {
				return candidate;
			}
			if (stat.isDirectory() && fs.existsSync(path.join(candidate, 'index.html'))) {
				return path.join(candidate, 'index.html');
			}
		} catch (_e) {
			// try the next one
		}
	}
	return null;
}

const server = http.createServer(async (req, res) => {
	const fail = error => {
		console.error(`[server] ${req.method} ${req.url}: ${error?.message || 'not handled'}`);
		if (!res.headersSent) {
			res.statusCode = error ? 500 : 404;
		}
		res.end();
	};

	if (req.url === '/client' || req.url.startsWith('/client/')) {
		req.url = req.url.slice('/client'.length) || '/';
		clientRoutes(req, res, fail);
		return;
	}

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.statusCode = 405;
		res.end();
		return;
	}

	const file = await findStatic(req.url);
	if (!file) {
		res.statusCode = 404;
		res.end('Not found');
		return;
	}

	res.setHeader('Content-Type', STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
	res.setHeader('Cache-Control', /\.html$|Config(\.local)?\.js$/.test(file) ? 'no-cache' : 'public, max-age=3600');
	if (req.method === 'HEAD') {
		res.end();
		return;
	}
	fs.createReadStream(file).on('error', fail).pipe(res);
});

const allowedTargets = parseAllowedTargets(process.env.WS_ALLOWED_TARGETS);
const wss = attachWsProxy(server, { allowedTargets });

server.listen(port, () => {
	console.log(`[server] Game on http://localhost:${port}/`);
	console.log(`[server] Game files from ${clientPath}`);
	console.log(`[server] WebSocket proxy on ws://localhost:${port}/ws/ -> ${allowedTargets.join(', ')}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		wss.close();
		server.close();
		files.close();
		process.exit(0);
	});
}
