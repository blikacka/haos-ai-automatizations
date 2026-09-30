# devtools: local harness for the AI automatizace add-on

This harness runs the add-on on a normal Linux or macOS machine. It needs no Home Assistant and
no Supervisor. The pieces:

| Piece | Port | File |
|-------|------|------|
| Mock Supervisor and HA Core (REST + WebSocket) | 8124 | `mock-supervisor.mjs`, `mock/*.mjs` |
| Add-on server (`ai_automation/app/dist/server/main.js`) | 8099 | built from `ai_automation/app` |
| Ingress emulation proxy | 8098 | `ingress-proxy.mjs` |
| Fake Codex app-server | stdio | `ai_automation/app/test/fixtures/fake-codex.mjs` |

## Quick start

```bash
bash devtools/dev.sh
# open http://127.0.0.1:8098/api/hassio_ingress/devtoken/
```

`dev.sh` works through these steps:

1. It deletes `devdata/` (gitignored). Then it copies `devtools/seed-config` to `devdata/config`, creates
   `devdata/data`, and writes a default `devdata/data/options.json`.
2. It installs dependencies if they are missing (`yaml` for devtools, the app's `node_modules`) and runs
   `npm run build` in `ai_automation/app`.
3. It starts the mock (8124), the add-on (8099) and the proxy (8098).
4. It prints the URLs. Ctrl+C stops all the child processes.

The add-on runs with this environment:

```
HA_CONFIG_DIR=devdata/config  DATA_DIR=devdata/data  SUPERVISOR_URL=http://127.0.0.1:8124
SUPERVISOR_TOKEN=dev-supervisor-token  CODEX_BIN=<abs>/ai_automation/app/test/fixtures/fake-codex.mjs
PORT=8099  ALLOW_ANY_ORIGIN_IP=1  PATH=<abs>/ai_automation/app/bin:$PATH
```

### Options (environment variables for `dev.sh`)

| Variable | Effect |
|----------|--------|
| `SEED=minimal` | Uses `seed-config-minimal`: automations are inline in `configuration.yaml`, with no `automations.yaml` and no `packages/`. Use it to test portability. |
| `KEEP_DATA=1` | Keeps the existing `devdata/`, including chats, history and Codex homes. |
| `SKIP_BUILD=1` | Skips `npm run build` and uses the existing `dist/`. |
| `CODEX_BIN=/path/to/codex` | Uses a real Codex binary instead of the fake. |

## Ingress proxy

The proxy emulates the HA ingress:

- It serves only under `/api/hassio_ingress/devtoken/` and strips that prefix before it forwards a
  request, so any absolute URL in the UI breaks. `/` redirects to the prefix.
- It forwards both HTTP and WebSocket traffic (for example `.../api/events`).
- It drops any `X-Remote-User-*` headers sent by the client. It then injects `X-Remote-User-Id`,
  `X-Remote-User-Name`, `X-Remote-User-Display-Name` and `X-Ingress-Path`.
- The default user is `dev-user-1` (Jakub). To switch user, open `...?user=dev-user-2` (Petra Řeháková).
  The proxy stores the choice in the `devuser` cookie. Any id matching `[A-Za-z0-9_-]{1,64}` works.
- The display name is sent as raw UTF-8 bytes, the same way real HA (aiohttp) sends it. Node reads
  such headers as latin1, so the add-on has to decode them correctly.

## Mock Supervisor / Core

Every request needs `Authorization: Bearer dev-supervisor-token` (or `X-Supervisor-Token`). Supervisor
responses use the envelope `{result: 'ok', data}`.

- **Supervisor:**
  - `GET /info`, `/core/info`, `/host/info`, `/os/info`
  - `GET /hardware/info`: includes a CH340 USB serial adapter, `/dev/ttyUSB0` →
    `/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0`
  - `GET /addons`, `/addons/<slug>/info`, `/addons/<slug>/logs`, `/store`, `/store/addons`, `/store/repositories`
  - `POST /store/addons/<slug>/install` (takes about 1.5 s), `/addons/<slug>/start|stop|restart`
  - `POST /store/repositories {repository}`: the URL `https://github.com/zigbee2mqtt/hassio-zigbee2mqtt`
    adds Zigbee2MQTT to the store
  - `GET /core/logs`, `/supervisor/logs`, `/host/logs` (plain text)
  - `POST /core/restart`: Core REST returns 502 for 2 s and open WebSockets are closed with code 1012
  - `GET /backups`, `POST /backups/new/partial`, `POST /backups/new/full`
- **Core REST (`/core/api/*`):**
  - `GET /`, `/config`, `/states`, `/states/<id>`, `/services`, `/error_log`, `/config/config_entries/entry`
  - `POST /config/core/check_config`: validates the real config directory. It parses
    `configuration.yaml`, `automations.yaml`, `scripts.yaml`, `scenes.yaml` and `packages/**/*.yaml`, and
    resolves `!include`, `!include_dir_named|merge_named|list|merge_list`, `!secret`, `!env_var` and `!input`.
    It returns `{result: 'invalid', errors}` for:
    - YAML syntax errors or unknown tags
    - missing include files or secrets
    - automations without `triggers|trigger` or without `actions|action`
    - triggers without `trigger|platform`
    - scripts without `sequence` or scenes without `entities`
  - `POST /services/<domain>/<service>`: records the call and returns `[]`. `light`/`switch` turn_on,
    turn_off and toggle, and `cover` open/close, change the state. `automation.reload`,
    `script.reload` and `homeassistant.reload_all` re-read the YAML and rebuild the `automation.*` and
    `script.*` states. `automation.trigger` adds a trace.
  - `POST /config/config_entries/flow {handler}`, then `POST /config/config_entries/flow/<flow_id>`.
    The instant domains (met, sun, workday, radio_browser) finish right away. The form domains (modbus, mqtt)
    return a form first.
- **Core WebSocket (`/core/websocket`):**
  - The usual auth flow (`auth_required` → `auth` → `auth_ok`/`auth_invalid`)
  - `get_states`, `get_config`, `get_services`, `config/entity_registry/list`, `list_for_display`, `get`
  - `config/device_registry/list`, `config/area_registry/list`, `config_entries/get`
  - `trace/list`, `trace/get`, `call_service`, `subscribe_events` (state_changed), `ping`
- **Debug endpoints (no auth):** `GET /_mock/calls`, `GET /_mock/backups`, `POST /_mock/reset-calls`.

The seed data (`mock/seedData.mjs`) describes a Czech home:

- Areas: Kotelna, Obývák, Kuchyně, Chodba, Garáž
- Lights: `light.kotelna_zarovka` "Žárovka kotelna", `light.obyvak_strop`, `light.kuchyn_linka`, `light.chodba`
- Switches (pump, garage socket), a garage door cover, `binary_sensor.vchodove_dvere`, motion, temperature
  and humidity sensors
- `person.jakub`, `sun.sun`, `weather.*`

You can run the mock on its own:

```bash
HA_CONFIG_DIR=$PWD/devdata/config MOCK_PORT=8124 node devtools/mock-supervisor.mjs
```

## Seed configs

- `seed-config/`:
  - `configuration.yaml`: default_config, packages via `!include_dir_named`, `!secret`, and
    automation/script/scene includes
  - One automation, one script, `scenes.yaml` = `[]`, `secrets.yaml`, `packages/.gitkeep`, `themes/.gitkeep`
  - A small `.storage/core.entity_registry` and `.HA_VERSION`
  - `home-assistant_v2.db` and `home-assistant.log`, which exist to test the history exclusions
- `seed-config-minimal/`: automations inline in `configuration.yaml` and none of the usual files.

## Self-test

```bash
node devtools/test-mock.mjs
```

This runs the mock on a random port against a copy of the seed in `tmp/mock-test-<pid>/`. It checks auth,
the hardware info, a valid check_config on the seed, and invalid results for broken YAML, a missing
`actions`, a missing secret and a missing include. It also covers reload, the WebSocket commands, the
add-on store, backups, restart (502), and the minimal seed.
