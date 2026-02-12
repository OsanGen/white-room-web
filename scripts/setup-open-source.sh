#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HAL_ROOT_DEFAULT="/Users/abelsanchez/CODEX/HAL 2.0"
HAL_ROOT="${HAL_ROOT:-$HAL_ROOT_DEFAULT}"
DO_INSTALL="${1:-}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

log() {
  printf '[setup:oss] %s\n' "$1"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing required command: $1"
    return 1
  fi
  return 0
}

check_file() {
  if [[ ! -s "$1" ]]; then
    log "missing required file: $1"
    return 1
  fi
  return 0
}

install_with_brew() {
  local pkg="$1"
  if brew list "$pkg" >/dev/null 2>&1; then
    log "brew package already installed: $pkg"
  else
    log "installing brew package: $pkg"
    brew install "$pkg"
  fi
}

wait_for_ollama() {
  local attempts=20
  local delay_s=1

  log "waiting for ollama endpoint: $OLLAMA_URL/api/tags"
  for ((i=1; i<=attempts; i++)); do
    if curl -sS -m 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
      log "ollama endpoint reachable"
      return 0
    fi
    sleep "$delay_s"
  done

  log "ollama endpoint did not become reachable in time"
  return 1
}

pull_model_with_retry() {
  local model="$1"
  local attempts=3

  for ((i=1; i<=attempts; i++)); do
    log "pulling ollama model: $model (attempt $i/$attempts)"
    if ollama pull "$model"; then
      return 0
    fi
    sleep 2
  done

  return 1
}

log "workspace root: $ROOT_DIR"
log "HAL_ROOT: $HAL_ROOT"

need_cmd node
need_cmd npm
need_cmd curl

check_file "$HAL_ROOT/HAL_CONCIOUS.txt"
check_file "$HAL_ROOT/J_PERSONALITY.txt"
check_file "$HAL_ROOT/J_PSEUDOCODE.txt"

if [[ "$DO_INSTALL" == "--install" ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    log "brew is required for --install mode on macOS"
    exit 1
  fi
  install_with_brew ollama
  install_with_brew whisper-cpp
  install_with_brew espeak-ng

  if ! command -v python3 >/dev/null 2>&1; then
    log "python3 missing; install it before piper"
    exit 1
  fi
  log "installing piper-tts python package"
  python3 -m pip install --user piper-tts
fi

if command -v ollama >/dev/null 2>&1; then
  log "ollama detected"
  if [[ "$DO_INSTALL" == "--install" ]]; then
    log "starting ollama service"
    brew services start ollama || true
    wait_for_ollama
    pull_model_with_retry qwen2.5:3b
    pull_model_with_retry qwen2.5:7b
  fi
else
  log "ollama not detected"
fi

if command -v whisper-cli >/dev/null 2>&1; then
  log "whisper-cli detected"
else
  log "whisper-cli not detected (typed-only fallback will remain active)"
fi

if command -v espeak-ng >/dev/null 2>&1; then
  log "espeak-ng detected"
else
  log "espeak-ng not detected (subtitles-only fallback will remain active)"
fi

log "installing npm dependencies"
cd "$ROOT_DIR"
npm install

log "setup complete"
log "next: run 'npm run check:runtime' then 'npm run dev:oss'"
