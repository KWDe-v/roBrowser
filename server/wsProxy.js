/**
 * server/wsProxy.js
 *
 * WebSocket to TCP bridge on the same port as the game, under /ws/: the browser cannot open TCP, so it
 * connects to `ws://<host>/ws/<server ip>:<port>` (the server's `socketProxy`, see
 * src/Network/SocketHelpers/WebSocket.js) and the bytes are relayed to the game server.
 *
 * Only targets in the allow list are reached, otherwise anyone could use the server as an open proxy.
 */
import net from 'node:net';
import { WebSocketServer } from 'ws';

const PREFIX = '/ws/';

/** rAthena's default login, char and map ports on this machine. */
const DEFAULT_TARGETS = ['6900', '6121', '5121'].flatMap(port => [`127.0.0.1:${port}`, `localhost:${port}`]);

/**
 * @param {string|undefined} value comma-separated `host:port` list, e.g. from WS_ALLOWED_TARGETS
 * @return {string[]}
 */
export function parseAllowedTargets(value) {
	const targets = (value || '')
		.split(',')
		.map(target => target.trim())
		.filter(Boolean);
	return targets.length ? targets : DEFAULT_TARGETS;
}

/**
 * Relay the WebSocket upgrades under /ws/ of an HTTP server; other upgrades (Vite's HMR) are left alone.
 *
 * @param {import('node:http').Server} server
 * @param {object} [options]
 * @param {string[]} [options.allowedTargets]
 * @param {function} [options.log]
 * @return {WebSocketServer}
 */
export function attachWsProxy(server, { allowedTargets = DEFAULT_TARGETS, log = console.log } = {}) {
	const wss = new WebSocketServer({ noServer: true });

	server.on('upgrade', (req, socket, head) => {
		if (!req.url || !req.url.startsWith(PREFIX)) {
			return;
		}

		const target = decodeURIComponent(req.url.slice(PREFIX.length));
		const colon = target.lastIndexOf(':');
		const host = target.slice(0, colon);
		const port = parseInt(target.slice(colon + 1), 10);

		if (colon < 1 || !Number.isInteger(port) || port < 1 || port > 65535 || !allowedTargets.includes(target)) {
			log(`[wsproxy] Refused ${target} (allowed: ${allowedTargets.join(', ')})`);
			socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
			return;
		}

		wss.handleUpgrade(req, socket, head, ws => relay(ws, host, port, target, log));
	});

	return wss;
}

function relay(ws, host, port, target, log) {
	const tcp = net.connect(port, host);
	tcp.setNoDelay(true);

	// Packets from the browser can arrive before the game server accepts: hold them until then
	const pending = [];
	let connected = false;

	tcp.on('connect', () => {
		connected = true;
		for (const data of pending) {
			tcp.write(data);
		}
		pending.length = 0;
	});

	ws.on('message', data => {
		if (connected) {
			tcp.write(data);
		} else {
			pending.push(data);
		}
	});

	tcp.on('data', data => {
		if (ws.readyState === ws.OPEN) {
			ws.send(data);
		}
	});

	const close = () => {
		tcp.destroy();
		if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
			ws.close();
		}
	};

	ws.on('close', close);
	ws.on('error', close);
	tcp.on('close', close);
	tcp.on('error', error => {
		log(`[wsproxy] ${target}: ${error.message}`);
		close();
	});
}
