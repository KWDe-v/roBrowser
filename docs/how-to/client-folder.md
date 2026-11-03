# Serve the game from a client folder

roBrowser can serve the game files itself, straight from the GRFs, with no separate Remote Client or
wsProxy. One port carries the client, the game files (`/client/`) and the WebSocket proxy (`/ws/`).

| Use         | Command                                       | Port |
| ----------- | --------------------------------------------- | ---- |
| Development | `npm run live`                                | 3000 |
| Production  | `npm run build -- -O -T -H` then `npm start`  | 8000 |

The code is in `server/` (`ClientFiles.js`, `clientRoutes.js`, `wsProxy.js`); the dev server mounts it
through `vite/clientserver.plugin.js`, the production server is `server/index.js`.

## 1. Fill the client folder

Copy from a Ragnarok client into `client/`:

```text
client/
├── DATA.INI        which GRFs to load (copy the client's own)
├── data.grf        GRFs stay packed: nothing is extracted
├── rdata.grf
├── data/           loose files (translated tables, Lua...) win over the GRFs
├── System/
├── BGM/
└── AI/
```

`DATA.INI` lists the archives in its `[Data]` section; the lowest number wins when two hold the same
file. A path may be absolute, so archives can stay where the client is installed.

```ini
[Data]
0=custom.grf
1=data.grf
```

GRF versions 0x200 and 0x300 are read with the client's own loader (`src/Loaders/GameFile.js`), so file
names, Korean ones included, match exactly what the browser asks for.

Only `data/`, `System/`, `BGM/` and `AI/` are reachable over HTTP: the GRFs and `DATA.INI` are not. The
whole folder is ignored by git: game assets must never be committed.

### System file names: `aliases.json`

Clients rename and move their System files (`itemInfo_true.lub`, `System/iteminfo/*.lua`, a
`SystemEN/` translation...). `client/aliases.json` says which ones to read; a key it leaves out keeps the
default name (`src/DB/ClientFileNames.js`, `DEFAULT_CLIENT_FILES`). Comments and trailing commas are
accepted.

```jsonc
{
	"fontPath": "System/Font/",
	// every file listed, in order: the first one to define an item keeps it
	"itemInfo": { "all": ["System/iteminfo/iteminfo1.lua", "System/iteminfo/iteminfo2.lua"] },
	// tried in order, the first found is used
	"mapInfo": ["System/mapInfo_true.lub"],
	"petEvolution": ["System/PetEvolutionCln_true.lub"],
	"questInfo": ["System/OngoingQuestInfoList_True.lub"],
	"privateAirship": ["System/PrivateAirplane_true.lub"],
	// only the first name is read
	"townInfo": ["System/Towninfo.lub"],
	"attendance": ["System/CheckAttendance.lub"],
	"achievement": ["System/Achievement_list.lub"],
	// an empty list skips the file
	"signBoardTranslation": [],
	"questTranslation": [],
	"townInfoTranslation": []
}
```

Listing the exact names also keeps the console free of the `Can't get file` lines the default name
guesses produce. Names outside `System/` or `SystemEN/` get `System/` put in front.

To use a client installed elsewhere without copying it, set `CLIENT_PATH`:

```bash
CLIENT_PATH="/path/to/client" npm run live
```

## 2. Point the game at it

In the server definition (`applications/browser-examples/demo.html`, or `Config.local.js` in production):

```js
remoteClient: '/client/',
socketProxy: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/',
```

Set `remoteClient: '/client/'` at the top level of the configuration too, so the Intro and login screens
read the same files.

## 3. Production

```bash
npm run build -- -O -T -H
npm start
```

The server reads `Config.local.js` from the project folder first (then from `dist/Web/`), so the server
settings survive a rebuild. A minimal one:

```js
window.ROConfigLocal = {
	remoteClient: '/client/',
	servers: [
		{
			display: 'My Server',
			address: '127.0.0.1',
			port: 6900,
			version: 55,
			langtype: 12,
			packetver: 20211103,
			renewal: true,
			packetKeys: false,
			socketProxy: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/',
			remoteClient: '/client/'
		}
	]
};
```

Behind HTTPS, put a reverse proxy (nginx, Caddy) in front and forward WebSocket upgrades for `/ws/`.

### Environment

| Variable              | Default                                    | Meaning                                                    |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `PORT`                | `8000`                                     | Listening port (production server)                         |
| `CLIENT_PATH`         | `./client`                                 | Client folder                                              |
| `STATIC_PATH`         | `./dist/Web`                               | Built client (production server)                           |
| `CACHE_MB`            | `256`                                      | Memory kept for recently served game files                 |
| `WS_ALLOWED_TARGETS`  | `127.0.0.1` / `localhost` on 6900,6121,5121 | Game servers `/ws/` may reach, `host:port` comma-separated |
| `CLIENT_ENABLESEARCH` | off in production                          | `true` answers file searches (asset viewers only)          |

`WS_ALLOWED_TARGETS` must hold every address the game server hands out: the login server's, and the
`char_ip` / `map_ip` rAthena sends. If players connect from other machines and rAthena sends a public IP,
list that IP with each port.

## Notes

- Opening the GRFs takes a second or two at start-up (about 1.5 s for a 220,000-file `data.grf`) and keeps
  their file tables in memory.
- Loose files are matched without regard to case, as on Windows, so a Linux server finds
  `System/itemInfo.lub` whatever the file is called on disk. Loose files with Korean names are not
  matched: keep those inside a GRF.
- The repository's `wsproxy.js` and an external Remote Client still work: set `socketProxy` /
  `remoteClient` to them instead.
