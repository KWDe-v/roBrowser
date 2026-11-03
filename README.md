# roBrowser

Cliente de Ragnarok Online que roda no navegador (WebGL), baseado no
[roBrowserLegacy](https://github.com/MrAntares/roBrowserLegacy).

A diferença principal: **uma pasta e uma porta**. O próprio roBrowser lê os arquivos do jogo direto dos
`.grf`, sem extrair, e faz a ponte com o servidor do jogo. Não é preciso instalar Remote Client nem wsProxy
à parte.

## O que este repositório traz

- **GRFs lidos direto da pasta `client/`**, sem extrair. Versões 0x200 e 0x300, com nomes em coreano.
- **Tudo numa porta só:** a página do jogo, os arquivos do cliente (`/client/`) e o proxy WebSocket
  (`/ws/`), tanto no desenvolvimento (`npm run live`) quanto em produção (`npm start`).
- **`client/aliases.json`:** diz quais arquivos da pasta `System` o jogo deve ler (`itemInfo`, `mapInfo`,
  traduções...), sem nomes fixos no código.
- **Aba de títulos corrigida:** mostra só os títulos que o personagem tem, a partir das conquistas que o
  servidor envia.

## Requisitos

- [Node.js](https://nodejs.org/) 22.15 ou mais novo
- Um servidor de jogo: [rAthena](https://github.com/rathena/rathena) (testado) ou Hercules
- Os arquivos de um cliente de Ragnarok: `.grf`, `DATA.INI`, `System/`, `data/`, `BGM/`, `AI/`

## Instalação

```bash
git clone https://github.com/KWDe-v/roBrowser.git
cd roBrowser
npm install
```

### 1. Copie o cliente para `client/`

```text
client/
├── DATA.INI        quais GRFs carregar (o do próprio cliente)
├── data.grf        sem extrair
├── Ragnarok.grf
├── data/           arquivos soltos (traduções...) têm prioridade sobre os GRFs
├── System/
├── BGM/
├── AI/
└── aliases.json    nomes dos arquivos da pasta System
```

Os arquivos do jogo nunca vão para o git: tudo dentro de `client/` é ignorado, exceto o `aliases.json`.

### 2. Ajuste o `aliases.json`

Cada cliente nomeia os arquivos da `System` de um jeito. Liste os que o seu tem:

```jsonc
{
	"fontPath": "System/Font/",
	// carrega todos, em ordem
	"itemInfo": { "all": ["System/iteminfo/iteminfo1.lua", "System/iteminfo/iteminfo2.lua"] },
	// tenta em ordem e usa o primeiro que existir
	"mapInfo": ["System/mapInfo_true.lub"],
	"questInfo": ["System/OngoingQuestInfoList_True.lub"],
	// lista vazia: não carrega
	"signBoardTranslation": []
}
```

Chave que não aparece usa o nome padrão. Comentários são aceitos. Todas as chaves estão em
[docs/how-to/client-folder.md](docs/how-to/client-folder.md).

### 3. Configure o servidor do jogo

Em [applications/browser-examples/demo.html](applications/browser-examples/demo.html), no item de
`servers`:

| Campo         | O que é                                                  |
| ------------- | -------------------------------------------------------- |
| `display`     | Nome mostrado no jogo                                    |
| `address`     | IP do login-server                                       |
| `port`        | Porta do login-server (padrão `6900`)                    |
| `packetver`   | O mesmo `PACKETVER` compilado no servidor (ex. `20211103`) |
| `renewal`     | `true` para Renewal, `false` para Pre-Renewal            |
| `langtype`    | Idioma / codificação do cliente                          |

`remoteClient` e `socketProxy` já apontam para este mesmo servidor e não precisam mudar.

## Rodando no seu PC

Com o rAthena ligado:

```bash
npm run live
```

O jogo abre em `http://localhost:3000/applications/browser-examples/demo.html`.

## Colocando online

```bash
npm run build -- -O -T -H
npm start
```

O servidor sobe na porta `8000`. As configurações ficam num `Config.local.js` na raiz do projeto, que
sobrevive a um novo build:

```js
window.ROConfigLocal = {
	remoteClient: '/client/',
	skipIntro: true,
	servers: [
		{
			display: 'Meu Servidor',
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

Variáveis de ambiente:

| Variável              | Padrão                                         | O que faz                                              |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `PORT`                | `8000`                                         | Porta do servidor                                      |
| `CLIENT_PATH`         | `./client`                                     | Pasta do cliente                                       |
| `CACHE_MB`            | `256`                                          | Memória para os arquivos servidos recentemente         |
| `WS_ALLOWED_TARGETS`  | `127.0.0.1` e `localhost` nas portas 6900, 6121, 5121 | Servidores que o `/ws/` pode acessar (`ip:porta`, separados por vírgula) |
| `CLIENT_ENABLESEARCH` | desligado                                      | `true` libera a busca de arquivos (só os visualizadores usam) |

`WS_ALLOWED_TARGETS` precisa conter todos os endereços que o rAthena entrega ao jogador: o do login e
também o `char_ip` e o `map_ip`. Se o rAthena enviar um IP público, coloque esse IP com cada porta.

Com HTTPS, coloque um proxy reverso (nginx, Caddy) na frente e repasse as conexões WebSocket de `/ws/`.

## Desenvolvimento

```bash
npm test          # testes (Vitest)
npm run lint      # ESLint
npm run format    # Prettier
```

Documentação técnica em [docs/](docs/README.md). O guia da pasta `client/` está em
[docs/how-to/client-folder.md](docs/how-to/client-folder.md).

## Licença e créditos

Distribuído sob a [GNU GPL v3](LICENSE), a mesma licença do projeto em que se baseia.

- [roBrowser](https://www.robrowser.com/), de Vincent Thibault
- [roBrowserLegacy](https://github.com/MrAntares/roBrowserLegacy) e todos os seus
  [contribuidores](https://github.com/MrAntares/roBrowserLegacy/graphs/contributors)
- [roBrowserLegacy-RemoteClient-JS](https://github.com/FranciscoWallison/roBrowserLegacy-RemoteClient-JS),
  que serviu de referência para o servidor de arquivos

Ragnarok Online é marca da Gravity Co., Ltd. Este repositório não contém arquivos do jogo.
