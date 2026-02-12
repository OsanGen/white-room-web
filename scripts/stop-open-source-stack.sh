#!/usr/bin/env bash
set -euo pipefail

PID_DIR="/tmp/white-room"
SERVER_PID_FILE="$PID_DIR/server.pid"
CLIENT_PID_FILE="$PID_DIR/client.pid"

log() {
  printf '[stop:oss] %s\n' "$1"
}

stopped=0

if [[ -f "$SERVER_PID_FILE" ]]; then
  server_pid="$(cat "$SERVER_PID_FILE")"
  if kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    log "stopped server pid=$server_pid"
    stopped=1
  fi
  rm -f "$SERVER_PID_FILE"
fi

if [[ -f "$CLIENT_PID_FILE" ]]; then
  client_pid="$(cat "$CLIENT_PID_FILE")"
  if kill -0 "$client_pid" >/dev/null 2>&1; then
    kill "$client_pid" >/dev/null 2>&1 || true
    log "stopped client pid=$client_pid"
    stopped=1
  fi
  rm -f "$CLIENT_PID_FILE"
fi

if [[ "$stopped" -eq 0 ]]; then
  log "no managed OSS stack pids found"
fi
