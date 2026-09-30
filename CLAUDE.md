# houm-codex-haos – HAOS add-on "AI automatizace"

Home Assistant OS add-on: sidebar panel (mdi:robot) where each HA user logs in to OpenAI Codex with their
ChatGPT account (device code) and chats; Codex edits HA configuration safely (snapshot -> edit -> check_config
-> reload -> verify), with a git-based restorable version history.

- Spec (source of truth): `.claude/SPEC.md`, UI spec: `.claude/UI.md`, progress log: `.claude/progress.md`
- Codex app-server protocol bindings (generated, codex-cli 0.154.0): `.claude/codex-protocol-ts/`
- Add-on: `ai_automation/` (config.yaml, Dockerfile, app/ = Node 22 + TS)
- Local dev: `bash devtools/dev.sh` (mock Supervisor + fake Codex + ingress proxy on :8098); deploy steps in `.claude/progress.md`
- Build/test: `cd ai_automation/app && npm run build && npm test && npm run lint`

## Target systems
- Private environment details (hosts, deploy targets) live in `.claude/local.md` and `.claude/progress.md` (gitignored).
- Credentials never go into the repo; `.secrets/`, `tmp/`, `devdata/` and dev `secrets.yaml` are gitignored.
- The repository is PUBLIC: https://github.com/blikacka/haos-ai-automatizations – never commit hosts, IPs, users, tokens.
