/**
 * vite/clientserver.plugin.js
 *
 * Serves the client folder and the WebSocket proxy from the dev server, so `npm run live` needs no
 * Remote Client or wsProxy running beside it: /client/ answers with the game files (GRFs read in place)
 * and /ws/ relays to the game server. The same modules back the production server (server/index.js).
 *
 * CLIENT_PATH points it at a client folder other than ./client.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const serverDir = path.resolve(import.meta.dirname, '../server');

// Loaded at run time, not bundled with the config: the server modules resolve the client's path aliases
// through Node hooks (server/aliases.js).
const load = name => import(pathToFileURL(path.join(serverDir, name)).href);

export default function clientServerPlugin() {
	return {
		name: 'robrowser-client-server',
		apply: 'serve',
		async configureServer(server) {
			// Vitest starts a dev server too: tests must not open a real client
			if (process.env.VITEST) {
				return;
			}

			const [{ default: ClientFiles }, { default: createClientRoutes }, { attachWsProxy, parseAllowedTargets }] =
				await Promise.all([load('ClientFiles.js'), load('clientRoutes.js'), load('wsProxy.js')]);

			const files = new ClientFiles({
				root: path.resolve(server.config.root, process.env.CLIENT_PATH || 'client'),
				cacheMB: parseInt(process.env.CACHE_MB || '256', 10),
				log: message => server.config.logger.info(message)
			});

			server.middlewares.use('/client', createClientRoutes(files));

			if (server.httpServer) {
				attachWsProxy(server.httpServer, {
					allowedTargets: parseAllowedTargets(process.env.WS_ALLOWED_TARGETS),
					log: message => server.config.logger.info(message)
				});
				server.httpServer.once('close', () => files.close());
			}
		}
	};
}
