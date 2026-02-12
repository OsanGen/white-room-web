# Deployment Modes

## Mode A: Full Local (Best for Development)

- Run `npm run dev:oss`
- Browser talks to local server (`/api/*`)
- Server uses local Ollama/STT/TTS
- No internet dependency required for core loop

Use when:

- Building features
- Debugging LLM behavior
- Running low-latency local playtests

## Mode B: Public Web + Consent-Based Local Bridge (Internet Deployment)

Architecture:

1. Static client is hosted publicly.
2. User opens game and gives explicit consent (`Use Local AI`).
3. Browser requests bridge session (`POST /api/bridge/session`).
4. User runs local companion bridge command on their machine.
5. Companion connects outbound to hosted server via `WS /ws/bridge`.
6. LLM/STT/TTS requests route through hosted server to that user’s bridge session.

Degradation behavior:

- Bridge disconnect -> auto-fallback to hosted/deterministic continuity
- No consent -> hosted/fallback path only

Security posture:

- Session-bound client token + bridge token
- Short-lived bridge sessions (`BRIDGE_SESSION_TTL_MS`)
- No bridge calls before consent and active session

## Mode C: Public Static Only (No Bridge)

- Deploy client bundle only (Cloudflare Pages, itch.io)
- Use hosted backend if available
- If backend/provider unavailable, deterministic continuity path remains playable

Use when:

- You need zero-friction distribution
- You can accept reduced LLM availability guarantees

## Mode D: Release Artifact Distribution

- Build and package with `npm run release:package`
- Distribute zip artifact (`release/white-room-jarvis-v5.0.0-web.zip`)

Use when:

- Shipping a fixed version for mirrors or QA handoff

## Runtime Guarantees Across Modes

- Typed input remains available
- Subtitles remain available
- Session resolves within hard cap (`<= 300000ms`)
- Dynamic visuals remain non-collidable
- No paid API dependency is mandatory for baseline playability
