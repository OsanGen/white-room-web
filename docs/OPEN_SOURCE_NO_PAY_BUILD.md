# Open-Source No-Pay Build

This runbook is the zero-paid-dependency path for local development, playtesting, and packaging.

## 1) Bootstrap

```bash
cd "/Users/abelsanchez/CODEX/HAL 2.0/WHITE_ROOM_WEB"
npm run setup:oss -- --install
```

If dependencies are already installed, run checks only:

```bash
npm run setup:oss
```

## 2) Environment

Copy env template and keep defaults unless tuning is needed:

```bash
cp .env.example .env
```

Canonical reliability defaults:

- `LLM_ENABLE_SECONDARY_MODEL=false`
- `LLM_MODEL_TIMEOUT_MS=18000`
- `LLM_ROUTE_TIMEOUT_MS=21000`
- `VITE_LLM_CLIENT_TIMEOUT_MS=24000`
- `LLM_DOCTRINE_TOP_K=4`
- `LLM_PROMPT_CHAR_CAP=6200`
- `LLM_CACHE_ENABLED=true`
- `LLM_CACHE_TTL_MS=3600000`
- `LLM_CACHE_MAX_ENTRIES=2000`
- `LLM_CACHE_KEY_VERSION=1`
- `REFLEX_ENABLED=true`
- `REFLEX_TARGET_MS=120`
- `ENRICHMENT_SOFT_DEADLINE_MS=2200`
- `ENRICHMENT_DROP_IF_STALE=true`
- `ENRICHMENT_APPLY_IF_TURN_MATCH_ONLY=true`
- `VITE_REFLEX_ENABLED=true`
- `VITE_ENRICHMENT_SOFT_DEADLINE_MS=2200`
- `VITE_ENRICHMENT_DROP_IF_STALE=true`
- `VITE_ENRICHMENT_APPLY_IF_TURN_MATCH_ONLY=true`
- `BRIDGE_SESSION_TTL_MS=900000`
- `BRIDGE_REQUEST_TIMEOUT_MS=21000`

## 3) Runtime Checks

```bash
npm run check:runtime
```

Then confirm health endpoint once server is running:

```bash
curl -sS http://127.0.0.1:8787/api/health
```

Expected healthy shape:

- `ok: true`
- `providers.llm: "ollama"`
- `availability.ollama: true`

## 4) Start Local Stack

Foreground:

```bash
npm run dev:oss
```

Background:

```bash
npm run dev:oss -- --background
```

Play URL:

- `http://127.0.0.1:5180` (or next free port)

Stop services:

```bash
npm run stop:oss
```

## 5) Consent + Runtime Selection

At first launch, choose one:

- `Use Local AI`
- `Use Hosted / Fallback`

### If `Use Local AI` selected

Run companion bridge command shown in UI (example):

```bash
npm --workspace bridge run dev -- --server http://127.0.0.1:5180 --session <SESSION_ID> --bridge-token <BRIDGE_TOKEN>
```

Game status badge should change to `Local Bridge Connected`.

### If `Use Hosted / Fallback` selected

- Server-local Ollama route is used by default.
- If unavailable, deterministic continuity path stays playable.

## 6) Quality Gates

```bash
npm run build
npm test
npm run lint
npm run verify:spec
```

## 7) Release Package (No-Pay Distribution)

```bash
npm run release:package
```

Expected artifact:

- `release/white-room-jarvis-v5.0.0-web.zip`

## 8) Common Failures

### Symptom: Enrichment not applying (reflex text never refines)

1. Check Ollama endpoint:
```bash
curl -sS http://127.0.0.1:11434/api/tags
```
2. Check game server:
```bash
curl -sS http://127.0.0.1:8787/api/health
```
3. Restart stack:
```bash
npm run stop:oss
npm run dev:oss -- --background
```
4. Inspect debug keys: `enrichment_pending`, `enrichment_applied`, `enrichment_drop_reason`, `enrichment_latency_ms`.
5. If using bridge mode, click `Reconnect Local AI` and rerun new bridge command.

### Symptom: Bridge never connects

1. Ensure bridge process is running in terminal.
2. Verify session/token are the current values from UI hint.
3. Check `WS /ws/bridge` is reachable through the same server origin.

### Symptom: Latency too high

1. Keep reflex lane enabled (`REFLEX_ENABLED=true`, `VITE_REFLEX_ENABLED=true`) for instant first-line rendering.
2. Keep `qwen2.5:3b` as primary.
3. Keep secondary model disabled unless explicitly testing.
4. Keep LLM turn cache enabled and verify debug shows `llm_cache_hit=true` on repeated similar turns.
5. Confirm `/api/llm/enrich` responses are not being dropped as stale/late by inspecting debug keys:
- `enrichment_pending`
- `enrichment_applied`
- `enrichment_drop_reason`
- `enrichment_latency_ms`
6. Increase model/route/client timeouts in this order while preserving:
- `client_timeout > route_timeout > model_timeout`
