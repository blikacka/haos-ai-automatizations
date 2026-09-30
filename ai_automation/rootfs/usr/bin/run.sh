#!/command/with-contenv sh
# Entrypoint of the AI automatizace add-on.
# The base image runs s6-overlay (/init) as PID 1; "with-contenv" restores the
# container environment (SUPERVISOR_TOKEN, ...) that s6 hides from CMD.
# exec replaces this shell so node receives SIGTERM directly from s6.
set -eu

APP_DIR="/opt/ai_automation"

export NODE_ENV="${NODE_ENV:-production}"
export HA_CONFIG_DIR="${HA_CONFIG_DIR:-/homeassistant}"
export DATA_DIR="${DATA_DIR:-/data}"
export SUPERVISOR_URL="${SUPERVISOR_URL:-http://supervisor}"
export CODEX_BIN="${CODEX_BIN:-codex}"
export PORT="${PORT:-8099}"
export WEB_DIR="${WEB_DIR:-$APP_DIR/dist/web}"
export AGENT_DIR="${AGENT_DIR:-$APP_DIR/agent}"
export PATH="$APP_DIR/bin:$PATH"

# Private persistent storage: chats, per-user Codex credentials, agent files.
umask 077
for dirPath in "$DATA_DIR" "$DATA_DIR/users" "$DATA_DIR/agent"; do
    mkdir -p "$dirPath"
    chmod 700 "$dirPath"
done

if [ ! -d "$HA_CONFIG_DIR" ]; then
    echo "[ai_automation] WARNING: Home Assistant config dir $HA_CONFIG_DIR not found" >&2
fi

echo "[ai_automation] starting server on port $PORT (codex: $("$CODEX_BIN" --version 2>/dev/null || echo 'not found'))"

exec node "$APP_DIR/dist/server/main.js"
