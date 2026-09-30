# AI automatizace – HAOS add-on specification (source of truth for all agents)

## Goal
Home Assistant OS add-on "AI automatizace" (slug `ai_automation`, sidebar icon `mdi:robot`, ingress panel).
Each HA user logs in with their own ChatGPT account to OpenAI Codex (device-code flow) and chats with
Codex, which inspects and changes the HA configuration (YAML, automations, hardware such as USB Modbus).
Hard rules: always back up before changes, always verify (check_config) after, never leave HA broken,
ask when unclear, keep a restorable version history (restores are themselves versions, so a restore can be undone).

## Repository layout
```
repository.yaml                  HA add-on repository manifest
ai_automation/
  config.yaml build.yaml Dockerfile DOCS.md README.md CHANGELOG.md icon.png logo.png
  translations/en.yaml cs.yaml
  rootfs/usr/bin/run.sh           entrypoint (bashio not required; plain sh ok)
  app/                            Node 22 + TypeScript project (ESM, NodeNext)
    src/shared/api.ts             REST + WS contract (DO NOT change without updating both sides)
    src/server/**                 backend (compiled by tsc -> dist/server)
    src/tool/haos-tool.ts         CLI used by Codex inside the container (compiled -> dist/tool)
    src/web/**                    frontend vanilla TS, bundled by esbuild -> dist/web/app.js
    public/                       index.html, styles.css, static assets (copied to dist/web)
    agent/AGENTS.md               instructions for Codex (copied to /data/agent/AGENTS.md at start)
    test/                         node:test tests (*.test.ts, run with --experimental-strip-types)
```

## Coding rules (user mandated)
- TypeScript strict, no `any`, no semicolons, 4 spaces, single quotes, trailing commas multiline.
- Multi-line imports when importing more than one name.
- JSDoc on exported functions/classes. Names in English, min 3 chars, camelCase.
- Max 300 lines per file – split modules.
- Server imports use `.js` suffix (NodeNext): `import { x } from './foo.js'`.
- Handle CWE: path traversal (validate ids with regex `^[A-Za-z0-9_-]{1,64}$`, commit ids `^[0-9a-f]{7,40}$`),
  command injection (only `execFile`/`spawn` with arg arrays, never shell strings), XSS (web: never set
  innerHTML with untrusted text; use textContent / safe markdown renderer that escapes), CSRF (only JSON
  bodies accepted, `Content-Type: application/json` required for mutating requests), request size limits (1 MB).
- Only dependency at runtime: `ws`. Everything else is Node stdlib.

## Runtime environment inside the add-on container
- `SUPERVISOR_TOKEN` env; Supervisor API `http://supervisor/...`; HA Core REST via `http://supervisor/core/api/...`;
  HA Core WS via `ws://supervisor/core/websocket` (auth message with access_token = SUPERVISOR_TOKEN).
- HA config mounted read-write at `/homeassistant`. Persistent add-on storage `/data`. Options in `/data/options.json`.
- Ingress: server listens on `0.0.0.0:8099`. Only requests from `172.30.32.2` (ingress proxy) are accepted
  (env `ALLOW_ANY_ORIGIN_IP=1` disables this for local dev). User identity from headers
  `X-Remote-User-Id`, `X-Remote-User-Name`, `X-Remote-User-Display-Name` (reject if id missing).
  All UI URLs must be RELATIVE (served under `/api/hassio_ingress/<token>/`).
- Env overrides for local dev/testing: `HA_CONFIG_DIR` (default `/homeassistant`), `DATA_DIR` (default `/data`),
  `SUPERVISOR_URL` (default `http://supervisor`), `CODEX_BIN` (default `codex`), `PORT` (default 8099),
  `WEB_DIR` (default `<app>/dist/web`), `AGENT_DIR` (default `<app>/agent`).

## Server modules (src/server) and their exact public interfaces

### config/env.ts
```ts
export interface AppEnv { port: number, haConfigDir: string, dataDir: string, supervisorUrl: string,
  supervisorToken: string, codexBin: string, webDir: string, agentDir: string, allowAnyOriginIp: boolean,
  addonVersion: string }
export function loadEnv(): AppEnv
export interface AddonOptions { defaultModel: string | null, defaultEffort: string | null, logLevel: 'debug'|'info'|'warning'|'error' }
export function loadAddonOptions(dataDir: string): AddonOptions   // reads /data/options.json keys default_model, default_reasoning, log_level
```
### util/logger.ts – `export const logger: { debug, info, warn, error }(msg: string, meta?: Record<string, unknown>)`, `setLogLevel(level)`.
### util/ids.ts – `newId(): string` (crypto.randomUUID without dashes or base36 16 chars), `isSafeId(value: string): boolean`, `userDirName(userId: string): string` (sha256 hex first 32 chars).
### util/mutex.ts – `export class Mutex { runExclusive<T>(fn: () => Promise<T>): Promise<T>; get isLocked(): boolean; get queueLength(): number }`
### util/jsonFile.ts – `readJsonFile<T>(path, fallback: T): Promise<T>`, `writeJsonFileAtomic(path, data): Promise<void>` (write tmp + rename, mode 0600, mkdir -p 0700).

### ha/supervisorClient.ts
```ts
export class SupervisorClient {
  constructor(baseUrl: string, token: string)
  supervisor<T>(method: 'GET'|'POST'|'PUT'|'DELETE', path: string, body?: unknown): Promise<T>   // unwraps {result:'ok', data}
  core<T>(method: 'GET'|'POST'|'PUT'|'DELETE', path: string, body?: unknown): Promise<T>        // path like '/api/config/core/check_config'
  coreWs<T>(message: Record<string, unknown>): Promise<T>                                       // one-shot WS command, resolves result, rejects on error; 30s timeout
}
```
### ha/configGuard.ts
```ts
export class ConfigGuard {
  constructor(client: SupervisorClient)
  checkConfig(): Promise<ConfigCheckResult>        // POST /api/config/core/check_config -> {result:'valid'|'invalid', errors}
  reloadAll(): Promise<void>                        // POST /api/services/homeassistant/reload_all
  restartCore(): Promise<void>                      // only if checkConfig valid; POST supervisor /core/restart; throws otherwise
}
```
### history/configHistory.ts (+ helpers history/gitRunner.ts, history/versionParser.ts)
Git repository with SEPARATE git dir `<dataDir>/history.git`, work tree = haConfigDir (never create `.git` in config).
Uses the `git` binary via execFile with `--git-dir`/`--work-tree`. Author `AI automatizace <ai@local>`.
Excluded (info/exclude): `*.db`, `*.db-*`, `*.db-shm`, `*.db-wal`, `*.log`, `*.log.*`, `home-assistant.log*`, `tts/`, `backups/`, `deps/`,
`.cloud/`, `__pycache__/`, `*.pyc`, `.git/`, `node_modules/`, `.storage/auth`, `.storage/auth_provider.*`,
`.storage/onboarding`, `.storage/http*`, `.storage/cloud`, `.storage/core.uuid`, `.storage/trace.saved_traces`,
`.storage/*.bak`, `media/`, `*.mp4`, `*.mkv`, `*.jpg`, `*.jpeg`, `*.png` larger files are fine but media dirs excluded, `.HA_VERSION` keep.
Commit message format: first line = title; body lines `X-Kind: <VersionKind>`, `X-Chat: <chatId>`, `X-User: <name>`, `X-Restored-From: <sha>`.
```ts
export interface SnapshotInput { kind: VersionKind, title: string, chatId?: string | null, userName?: string | null, restoredFrom?: string | null }
export class ConfigHistory {
  constructor(haConfigDir: string, gitDir: string)
  init(): Promise<void>                         // idempotent; creates repo + initial commit (kind 'initial')
  snapshot(input: SnapshotInput): Promise<VersionSummary | null>  // `git add -A` + commit; null when nothing changed
  list(limit: number, cursor: string | null): Promise<VersionListResponse>   // newest first, cursor = sha to continue after
  detail(versionId: string): Promise<VersionDetail>   // diff vs parent, per-file, each diff truncated to 200 KB
  currentVersionId(): Promise<string>
  restore(versionId: string, userName: string): Promise<{ version: VersionSummary | null, changedPaths: string[] }>
     // 1) snapshot current state as 'manual' if dirty 2) make work tree equal to target tree (also delete files that
     // are tracked now but absent in target) 3) commit kind 'restore' with restoredFrom
  diffWorkTree(): Promise<FileDiff[]>           // uncommitted changes vs HEAD
}
```
All operations serialized by an internal Mutex.

### history/restoreService.ts
```ts
export class RestoreService {
  constructor(history: ConfigHistory, guard: ConfigGuard)
  restore(versionId: string, userName: string): Promise<RestoreResult>
    // runs history.restore, then guard.checkConfig; if invalid -> restore back to the pre-restore version and return checkPassed=false;
    // if valid -> guard.reloadAll(); needsRestart = changedPaths.some(p => p.startsWith('.storage/') || p.startsWith('custom_components/') || p === 'configuration.yaml' && ...)  (keep: any .storage/ or custom_components/ change => true)
}
```

### codex/rpcClient.ts – generic JSON-RPC 2.0 over child-process stdio (newline delimited JSON, no "jsonrpc" field needed but tolerated)
```ts
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>
export class JsonRpcProcess extends EventEmitter {   // events: 'notification' (method, params), 'exit' (code)
  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string)
  start(): void
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
  notify(method: string, params?: unknown): void
  setServerRequestHandler(handler: ServerRequestHandler): void   // requests from server (have id + method) -> reply {id, result} or {id, error}
  stop(): Promise<void>
  get isRunning(): boolean
}
```
### codex/codexSession.ts – one `codex app-server` process per HA user
```ts
export class CodexSession extends EventEmitter {  // re-emits 'notification' (method, params)
  constructor(options: { codexBin: string, codexHome: string, cwd: string, env: NodeJS.ProcessEnv })
  start(): Promise<void>   // spawn, `initialize` {clientInfo:{name:'ai_automation',title:'AI automatizace',version}, capabilities:null}, then notify 'initialized'
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
  setServerRequestHandler(handler: ServerRequestHandler): void
  stop(): Promise<void>
}
```
CODEX_HOME per user: `<dataDir>/users/<userDirName>/codex` (mode 0700). On first creation write `config.toml`:
```toml
cli_auth_credentials_store = "file"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[shell_environment_policy]
inherit = "all"
[features]
```
Spawn env: process.env + `CODEX_HOME`, `HOME=<codexHome>/..`, `PATH` includes `<app>/bin` (haos-tool wrapper).
### codex/sessionPool.ts
```ts
export class CodexSessionPool {
  constructor(env: AppEnv)
  get(userId: string): Promise<CodexSession>    // lazy start, restart if crashed; idle stop after 30 min without active turn
  markBusy(userId: string, busy: boolean): void
  stopAll(): Promise<void>
}
```
### codex/accountService.ts
Protocol: `account/read` {refreshToken:false} -> {account: {type:'chatgpt', email, planType} | {type:'apiKey'} | null};
`account/login/start` {type:'chatgptDeviceCode'} -> {type:'chatgptDeviceCode', loginId, verificationUrl, userCode};
notification `account/login/completed` {loginId, success, error}; `account/login/cancel` {loginId}; `account/logout` {}.
```ts
export class AccountService {
  constructor(pool: CodexSessionPool, hub: EventHub)
  getAccount(userId: string): Promise<AccountState>
  startLogin(userId: string): Promise<AccountState>    // pendingLogin; on completion publish 'account.updated'
  cancelLogin(userId: string): Promise<AccountState>
  logout(userId: string): Promise<AccountState>
}
```
### codex/modelService.ts
`model/list` {includeHidden:false} paginated -> Model{id, displayName, description, isDefault, supportedReasoningEfforts:[{reasoningEffort, description}], defaultReasoningEffort}.
`export class ModelService { constructor(pool); listModels(userId: string): Promise<ModelOption[]> }` (cache 10 min per user).

### codex/eventMapper.ts – maps app-server notifications to ChatEntry upserts (pure functions, unit tested)
Notifications used: `turn/started` {threadId, turn}, `turn/completed` {threadId, turn{id,status,error}},
`item/started` / `item/completed` {item, threadId, turnId}, `item/agentMessage/delta` {threadId, turnId, itemId, delta},
`error` {error:{message}, willRetry, threadId, turnId}.
ThreadItem types: `agentMessage`{id,text} -> assistant; `commandExecution`{id,command,status,aggregatedOutput,exitCode,commandActions:[{type:'read'|'listFiles'|'search'|'unknown',...}]}
-> activity (kind read/search/command, title = human friendly Czech e.g. "Čtu soubor automations.yaml", detail = command + trimmed output 4 KB);
`fileChange`{id, changes:[{path, kind:{type:'add'|'delete'|'update'}, diff}], status} -> fileChange;
`reasoning`{summary[]} -> activity 'reasoning' (title "Přemýšlím", detail summary text); `plan`{text} -> activity 'plan';
`webSearch` -> activity 'web'; `mcpToolCall`/`dynamicToolCall` -> activity 'tool'; `userMessage` ignored (we record user entries ourselves).
Entry id = item id. Mapper must be defensive (unknown shapes ignored).
Server request `item/tool/requestUserInput` {threadId, turnId, itemId, questions:[{id, header, question, isOther, isSecret, options:[{label,description}]|null}]}
-> question entry; reply `{answers: {[questionId]: {answers: string[]}}}` when user answers.
Approval server requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `execCommandApproval`, `applyPatchApproval`)
-> auto `{decision:'accept'}` (policy is 'never' anyway, safety is enforced by instructions + guard).

### chats/chatStore.ts
Per user dir `<dataDir>/users/<userDirName>/chats/<chatId>.json` storing `{ ...ChatDetail, threadId: string | null }`.
```ts
export interface StoredChat extends ChatDetail { threadId: string | null }
export class ChatStore {
  constructor(dataDir: string)
  list(userId: string): Promise<ChatSummary[]>       // newest updatedAt first
  create(userId: string, title?: string): Promise<StoredChat>   // default title 'Nový chat'
  get(userId: string, chatId: string): Promise<StoredChat | null>
  save(userId: string, chat: StoredChat): Promise<void>   // debounced-safe atomic write
  delete(userId: string, chatId: string): Promise<boolean>
}
export function toSummary(chat: StoredChat): ChatSummary
```
### chats/chatRunner.ts (+ chats/turnVerifier.ts, chats/developerInstructions.ts)
```ts
export class ChatRunner {
  constructor(deps: { store: ChatStore, pool: CodexSessionPool, hub: EventHub, history: ConfigHistory, guard: ConfigGuard, env: AppEnv })
  sendMessage(user: CurrentUser, chatId: string, request: SendMessageRequest): Promise<void>  // returns after turn queued/started
  interrupt(user: CurrentUser, chatId: string): Promise<void>
  answer(user: CurrentUser, chatId: string, request: AnswerQuestionRequest): Promise<void>
  isBusy(): boolean
}
```
Turn flow (global Mutex – one config-modifying turn at a time across all users; status 'queued' while waiting):
1. Append user entry, status running. Title: if chat title is default, set to first 60 chars of text.
2. `history.snapshot({kind:'manual', title:'Změny provedené mimo AI'})` (captures manual edits), then
   `pre = history.snapshot({kind:'before-ai', ...})` is NOT needed if nothing changed – remember `baseVersion = currentVersionId()`.
3. thread: if chat.threadId null -> `thread/start` {model, cwd: haConfigDir, approvalPolicy:'never', sandbox:'danger-full-access',
   developerInstructions: <from developerInstructions.ts incl. user name + language cs>, config:{model_reasoning_effort: effort}}
   else `thread/resume` {threadId, model, cwd, approvalPolicy, sandbox, developerInstructions}.
4. `turn/start` {threadId, input:[{type:'text', text, text_elements:[]}], model, effort}. Stream notifications for this
   threadId -> eventMapper -> store + hub events (`chat.entry`, `chat.delta`). Wait for `turn/completed`.
5. Verification (status 'verifying'): `changes = history.diffWorkTree()`. If no changes -> done (no verification entry).
   Else `guard.checkConfig()`. If valid -> `history.snapshot({kind:'ai-change', title: <first line of prompt>, chatId, userName})`,
   verification entry 'passed' with versionId, snapshot entry. If invalid -> automatically start ONE follow-up repair turn
   in the same thread with text "Automatická kontrola konfigurace selhala: <errors>. Oprav to..." (entry shown as activity),
   re-check; if still invalid -> restore work tree to baseVersion (history.restore) + reloadAll, verification entry 'restored'.
6. Status idle (or waitingForUser while a question entry is open; 'error' on failures). Always release mutex.
Interrupt: `turn/interrupt` {threadId, turnId}.

### http/server.ts, http/router.ts, http/routes/*.ts, http/eventHub.ts
EventHub: `publish(userId, event: ServerEvent)`, `broadcast(event)`, `attach(server: http.Server, resolveUser)` –
WS endpoint `/api/events` (with or without ingress prefix — match by `url.endsWith('/api/events')`), ping every 25s.
REST (all JSON, all under relative `api/`; router must match path suffix after ingress prefix — ingress strips the prefix, so paths arrive as `/api/...`):
```
GET    /api/me                         -> MeResponse
POST   /api/account/login              -> AccountState
POST   /api/account/login/cancel       -> AccountState
POST   /api/account/logout             -> AccountState
GET    /api/models                     -> ModelOption[]
PUT    /api/settings  UserSettings     -> UserSettings    (stored <userDir>/settings.json)
GET    /api/chats                      -> ChatSummary[]
POST   /api/chats  CreateChatRequest   -> ChatDetail
GET    /api/chats/:id                  -> ChatDetail
PATCH  /api/chats/:id RenameChatRequest-> ChatSummary
DELETE /api/chats/:id                  -> {ok:true}
POST   /api/chats/:id/messages SendMessageRequest -> 202 {ok:true}
POST   /api/chats/:id/interrupt        -> {ok:true}
POST   /api/chats/:id/answers AnswerQuestionRequest -> {ok:true}
GET    /api/history?limit=&cursor=     -> VersionListResponse
GET    /api/history/:sha               -> VersionDetail
POST   /api/history/:sha/restore       -> RestoreResult
POST   /api/system/check-config        -> ConfigCheckResult
POST   /api/system/restart             -> {ok:true}   (only when check passes)
GET    /  and static files from webDir (index.html fallback), correct content types, no directory traversal.
```
Errors: `{error: string}` with 4xx/5xx. Security headers: `X-Content-Type-Options: nosniff`, CSP `default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.
### main.ts – composition root: loadEnv, logger level, history.init(), copy AGENTS.md, create services, start server, SIGTERM -> pool.stopAll().

## haos-tool (src/tool) – CLI for Codex, on PATH as `haos-tool` (wrapper script `app/bin/haos-tool` -> node dist/tool/haos-tool.js)
Output JSON (pretty) to stdout, errors to stderr with exit code 1. Uses SUPERVISOR_TOKEN.
```
haos-tool help
haos-tool entities [--domain D] [--search TEXT] [--area AREA]   # state + friendly_name + area + device, compact
haos-tool entity <entity_id>                                     # full state + registry entry + device
haos-tool areas | devices [--search TEXT] | integrations
haos-tool services [domain]
haos-tool call <domain.service> [json-data]                      # call service (e.g. test a light)
haos-tool check-config                                           # validate configuration
haos-tool reload <automation|script|scene|group|template|input_*|core|all>
haos-tool restart-core                                           # refuses unless check-config valid
haos-tool hardware                                               # supervisor /hardware/info + /dev/serial/by-id listing
haos-tool usb                                                    # serial devices with by-id, vendor/product from sysfs if readable
haos-tool logs [core|supervisor|host] [--lines N] [--grep TEXT]  # core: /api/error_log or supervisor /core/logs
haos-tool snapshot "<message>"                                    # commit to config history (kind before-ai) – call before risky edits
haos-tool history [N]                                            # list last N versions
haos-tool backup "<name>"                                        # supervisor partial backup (homeassistant folder) for big changes
haos-tool addons | addon <slug>                                  # installed add-ons
haos-tool ws '<json>'                                            # raw core websocket command
haos-tool api <GET|POST> <path> [json]                           # raw core REST
haos-tool supervisor <GET|POST> <path> [json]                    # raw supervisor REST
haos-tool automation-trace <automation_id>                       # last traces (trace/list + trace/get)
```

## agent/AGENTS.md
Instructions for Codex (English, but reply to the user in Czech unless they write in another language):
safety rules, workflow (understand -> discover entities via haos-tool -> ask if ambiguous (list candidate entities with
friendly names/areas) -> snapshot -> edit YAML following HA best practices (automations with unique `id`, `alias`,
`description`, modern syntax `triggers:`/`actions:`/`conditions:`, packages when configuration grows) -> check-config ->
reload -> verify entity states/automation loaded -> summarize in plain language for non-programmers), never restart
host/supervisor, never delete user data, never touch secrets except via `!secret`, never modify `.storage` directly
(use websocket APIs), prefer UI-compatible `automations.yaml` for automations, Modbus example guidance, etc.

## UI (Czech language), see .claude/UI.md
