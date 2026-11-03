// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import { attachWsProxy, parseAllowedTargets } from '../../server/wsProxy.js';

let game; // TCP echo server standing in for rAthena
let gamePort;
let server;
let wss;
let port;

beforeAll(async () => {
	game = net.createServer(socket => socket.on('data', data => socket.write(data)));
	await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
	gamePort = game.address().port;

	server = http.createServer((req, res) => res.end());
	wss = attachWsProxy(server, { allowedTargets: [`127.0.0.1:${gamePort}`], log: () => {} });
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	port = server.address().port;
});

afterAll(async () => {
	wss.close();
	await new Promise(resolve => server.close(resolve));
	await new Promise(resolve => game.close(resolve));
});

describe('parseAllowedTargets', () => {
	it('splits a comma-separated list', () => {
		expect(parseAllowedTargets(' 1.2.3.4:6900, 1.2.3.4:6121 ')).toEqual(['1.2.3.4:6900', '1.2.3.4:6121']);
	});

	it("defaults to rAthena's ports on this machine", () => {
		expect(parseAllowedTargets('')).toContain('127.0.0.1:6900');
		expect(parseAllowedTargets(undefined)).toContain('localhost:5121');
	});
});

describe('attachWsProxy', () => {
	it('relays bytes both ways to an allowed game server', async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/127.0.0.1:${gamePort}`);
		ws.binaryType = 'nodebuffer';
		// Sent at once, before the TCP side has connected: it must not be lost
		ws.on('open', () => ws.send(Buffer.from([1, 2, 3])));
		const echo = await new Promise((resolve, reject) => {
			ws.on('message', resolve);
			ws.on('error', reject);
		});
		expect([...echo]).toEqual([1, 2, 3]);
		ws.close();
	});

	it('refuses a target outside the allow list', async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/10.0.0.1:6900`);
		const outcome = await new Promise(resolve => {
			ws.on('open', () => resolve('open'));
			ws.on('error', () => resolve('refused'));
		});
		expect(outcome).toBe('refused');
	});
});
