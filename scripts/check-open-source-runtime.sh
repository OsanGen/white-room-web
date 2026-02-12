#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HEALTH_URL="${SERVER_HEALTH_URL:-http://127.0.0.1:8787/api/health}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_PRIMARY_MODEL="${OLLAMA_PRIMARY_MODEL:-qwen2.5:3b}"
OLLAMA_FALLBACK_MODEL="${OLLAMA_FALLBACK_MODEL:-qwen2.5:7b}"

log() {
  printf '[check:runtime] %s\n' "$1"
}

probe_url() {
  local url="$1"
  local timeout="${2:-3}"
  curl -sS -m "$timeout" "$url"
}

cd "$ROOT_DIR"

log "checking node/npm"
node -v
npm -v

log "checking doctrine files"
for file in \
  "/Users/abelsanchez/CODEX/HAL 2.0/HAL_CONCIOUS.txt" \
  "/Users/abelsanchez/CODEX/HAL 2.0/J_PERSONALITY.txt" \
  "/Users/abelsanchez/CODEX/HAL 2.0/J_PSEUDOCODE.txt"; do
  if [[ -s "$file" ]]; then
    log "ok: $file"
  else
    log "missing: $file"
    exit 1
  fi
done

if command -v ollama >/dev/null 2>&1; then
  log "ollama command present"
else
  log "ollama command missing"
fi

log "checking ollama endpoint: $OLLAMA_URL/api/tags"
if OLLAMA_TAGS="$(probe_url "$OLLAMA_URL/api/tags" 3 2>/dev/null)"; then
  log "ollama endpoint reachable"
  if [[ "$OLLAMA_TAGS" == *"\"$OLLAMA_PRIMARY_MODEL\""* ]]; then
    log "ollama primary model present: $OLLAMA_PRIMARY_MODEL"
  else
    log "ollama primary model missing: $OLLAMA_PRIMARY_MODEL"
  fi
  if [[ "$OLLAMA_TAGS" == *"\"$OLLAMA_FALLBACK_MODEL\""* ]]; then
    log "ollama fallback model present: $OLLAMA_FALLBACK_MODEL"
  else
    log "ollama fallback model missing: $OLLAMA_FALLBACK_MODEL"
  fi
else
  log "ollama endpoint not reachable"
fi

log "checking server health endpoint: $SERVER_HEALTH_URL"
if probe_url "$SERVER_HEALTH_URL" 3 >/dev/null 2>&1; then
  log "server health endpoint reachable"
  probe_url "$SERVER_HEALTH_URL" 3
else
  log "server health endpoint not reachable"
fi

log "runtime check complete"
