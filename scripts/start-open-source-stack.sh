#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-foreground}"
PID_DIR="/tmp/white-room"
SERVER_LOG="$PID_DIR/server.log"
CLIENT_LOG="$PID_DIR/client.log"
SERVER_PID_FILE="$PID_DIR/server.pid"
CLIENT_PID_FILE="$PID_DIR/client.pid"
SERVER_PORT="${PORT:-8787}"
CLIENT_PORT_REQUESTED="${CLIENT_PORT:-5180}"

log() {
  printf '[dev:oss] %s\n' "$1"
}

port_in_use() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

select_client_port() {
  local requested="$1"
  local candidate="$requested"
  local max_port=$((requested + 20))

  while [[ "$candidate" -le "$max_port" ]]; do
    if ! port_in_use "$candidate"; then
      echo "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
  done

  echo "$requested"
}

start_server() {
  npm --workspace server run dev >"$SERVER_LOG" 2>&1 &
  local server_pid=$!
  echo "$server_pid" >"$SERVER_PID_FILE"
  echo "$server_pid"
}

start_client() {
  local client_port="$1"
  npm --workspace client run dev -- --host 0.0.0.0 --port "$client_port" >"$CLIENT_LOG" 2>&1 &
  local client_pid=$!
  echo "$client_pid" >"$CLIENT_PID_FILE"
  echo "$client_pid"
}

cleanup_managed() {
  if [[ -f "$SERVER_PID_FILE" ]]; then
    kill "$(cat "$SERVER_PID_FILE")" >/dev/null 2>&1 || true
    rm -f "$SERVER_PID_FILE"
  fi
  if [[ -f "$CLIENT_PID_FILE" ]]; then
    kill "$(cat "$CLIENT_PID_FILE")" >/dev/null 2>&1 || true
    rm -f "$CLIENT_PID_FILE"
  fi
}

cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  log "loading .env"
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

mkdir -p "$PID_DIR"
CLIENT_PORT_SELECTED="$(select_client_port "$CLIENT_PORT_REQUESTED")"

if port_in_use "$SERVER_PORT"; then
  log "server port $SERVER_PORT is already in use"
  log "stop the process on :$SERVER_PORT or run with a different PORT value"
  exit 1
fi

if [[ "$MODE" == "--background" ]]; then
  log "starting server in background"
  SERVER_PID="$(start_server)"
  log "starting client in background"
  CLIENT_PID="$(start_client "$CLIENT_PORT_SELECTED")"
  log "server pid=$SERVER_PID client pid=$CLIENT_PID"
  log "play URL: http://127.0.0.1:$CLIENT_PORT_SELECTED"
  log "logs: $SERVER_LOG and $CLIENT_LOG"
  exit 0
fi

cleanup_managed
trap cleanup_managed EXIT INT TERM

log "starting server (foreground mode)"
SERVER_PID="$(start_server)"
log "starting client (foreground mode)"
CLIENT_PID="$(start_client "$CLIENT_PORT_SELECTED")"
log "play URL: http://127.0.0.1:$CLIENT_PORT_SELECTED"
log "press Ctrl+C to stop both services"

while kill -0 "$SERVER_PID" >/dev/null 2>&1 && kill -0 "$CLIENT_PID" >/dev/null 2>&1; do
  sleep 1
done

log "one process exited; shutting down managed services"
