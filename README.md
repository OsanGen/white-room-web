# WHITE ROOM / RABBIT (HAL 2.0)

Top-down 2D symbolic dialogue game in a single white room.

- Player: circle avatar
- Rabbit: circle anchor
- Loop: move (WASD) -> press `E` near rabbit -> dialogue -> dynamic world response
- Core runtime: local-first, open-source, no paid APIs required

## Canonical Runtime

- `client/src/main.ts` mounts `TopDownGameLoopController`
- 2D canvas render path is canonical for performance
- Legacy 3D code remains non-canonical and is not the default entry path

## Core Constraints

- Single room only
- Conversation is the progression system
- Subtitles always on
- Typed input always available
- Session hard limit `<= 300000ms`
- Dynamic world directives are visual-only and non-collidable
- Player-facing output must stay symbolic, non-violent, and non-explicit-religious

## Open-Source Stack (No Pay)

- Node.js + npm workspaces
- Vite + TypeScript (client)
- Express + TypeScript (server)
- Ollama (`qwen2.5:3b` primary)
- Optional: whisper.cpp (STT), Piper/eSpeak (TTS)

## Quick Start

```bash
cd "/Users/abelsanchez/CODEX/HAL 2.0/WHITE_ROOM_WEB"
npm run setup:oss -- --install
npm run check:runtime
npm run dev:oss -- --background
```

Play URL:

- `http://127.0.0.1:5180` (auto-increments if occupied)

Stop stack:

```bash
npm run stop:oss
```

## Runtime Consent (At First Launch)

On first load, the game asks:

- `Use Local AI` (consent to local bridge path)
- `Use Hosted / Fallback` (server-local Ollama path, or deterministic continuity)

Choice is persisted in `localStorage`.

## Local Bridge Mode (Consent-Based)

If `Use Local AI` is selected, the UI provides a command like:

```bash
npm --workspace bridge run dev -- --server http://127.0.0.1:5180 --session <SESSION_ID> --bridge-token <BRIDGE_TOKEN>
```

When connected:

- Runtime badge: `Local Bridge Connected`
- LLM/STT/TTS calls can route through the companion bridge over `WS /ws/bridge`

If disconnected:

- Click `Reconnect Local AI`
- Run the refreshed bridge command from the UI hint
- Game auto-degrades to hosted/deterministic path while bridge is offline

## Live Deployment: GitHub Pages

GitHub Pages can host a playable UI instantly and can be reached by anyone through a public link:

- `client` is compiled to static assets and deployed under GitHub Pages
- runtime API calls are configurable to a live server via `VITE_API_BASE_URL`
- on hosted pages, API endpoints are not localhost-bound

Quick setup:

```bash
# 1) Push this branch to GitHub
git add .
git commit -m "Deploy static client"
git push

# 2) Configure repo variable (GitHub Settings > Secrets and variables > Variables)
VITE_API_BASE_URL=https://your-api-host.example

# 3) Push to main or codex/github-push to trigger workflow
#    The workflow publishes client/dist to GitHub Pages.
```

Important note:

- GitHub Pages is static-only. LLM/STT/TTS/bridge features still require a separately hosted backend server.
- If the backend variable is missing, the page falls back to same-origin `/api/*` calls and most AI features will not work unless API is same-origin.

If you want full-stack one-link deployment, deploy the server side separately (Render/Fly/Railway/etc.) and set `VITE_API_BASE_URL` to that server URL.

## Reliability Defaults

From `.env.example`:

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

## Project BFG: Reflex + Async Enrichment

- Gameplay uses a dual-lane turn flow:
- `Reflex lane`: local deterministic reply is committed immediately.
- `Enrichment lane`: `/api/llm/enrich` runs async and may refine text + directives.
- Enrichment is safety validated, stale/late gated, and never blocks movement or input.
- If enrichment fails or times out, reflex output remains active with no deadlock.

## Safety-Gated LLM Turn Cache

- `/api/llm/respond` now checks an in-memory LRU+TTL cache before bridge/Ollama calls.
- `/api/llm/enrich` also uses the same validator-gated cache strategy.
- Cache keys are SHA-256 over normalized turn context + doctrine fingerprint + model id.
- Only validator-approved non-fallback outputs are cacheable.
- Fallback outputs (`fallback:*`) and invalid outputs are never cached.
- Route diagnostics include `cache_hit`, `cache_key_version`, and `cache_ttl_remaining_ms`.

## Validation Pipeline

```bash
npm run build
npm test
npm run lint
npm run verify:spec
```

## Troubleshooting

If enrichment never applies or feels slow:

1. Verify Ollama:
```bash
curl -sS http://127.0.0.1:11434/api/tags
```
2. Verify server health:
```bash
curl -sS http://127.0.0.1:8787/api/health
```
3. Restart stack:
```bash
npm run stop:oss
npm run dev:oss -- --background
```
4. Check debug fields: `enrichment_pending`, `enrichment_applied`, `enrichment_drop_reason`, `enrichment_latency_ms`.
5. If using Local Bridge, reconnect and rerun bridge command from the UI hint.

## Docs

- `/Users/abelsanchez/CODEX/HAL 2.0/final build.txt`
- `docs/OPEN_SOURCE_NO_PAY_BUILD.md`
- `docs/DEPLOYMENT_MODES.md`
