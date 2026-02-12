# Release Notes (v5.0.0 HAL Clean Build)

## REQ/HC Mapping

- `OBJ-001`, `HC-001`, `HC-002`, `HC-003`: Single white-room runtime in `/client/src/app/GameLoopController.ts`.
- `OBJ-002`, `HC-004`, `HC-005`, `HC-020`: Conversation-only progression with typed path always on in `/client/src/conversation/ConversationEngine.ts`.
- `OBJ-003`, `HC-018`: Every rabbit turn emits morph signal consumed by `/client/src/world/WorldMorphEngine.ts`.
- `OBJ-004`, `G-010`: Doctrine parsing/indexing from source files in `/server/src/doctrine/DoctrineParser.ts` and `/server/src/doctrine/DoctrineIndexer.ts`.
- `OBJ-005`, `HC-012`, `HC-013`, `HC-019`, `G-003`: Five-minute enforcement and forced exit routing in `/client/src/rabbit/RabbitMind.ts` and `/client/src/app/GameLoopController.ts`.
- `OBJ-006`, `HC-017`, `G-007`: Local-first free path with optional local adapters and deterministic fallback in `/server/src/routes/llm.ts`.
- `OBJ-007`, `HC-011`, `HC-009`, `HC-010`, `G-006`: Simulated-character safeguards and meta leakage rejection in `/server/src/validators/RabbitOutputSchema.ts`.

## Fallback Ladder

- LLM: Ollama primary -> Ollama fallback -> deterministic response.
- STT: whisper.cpp route -> typed lock after 2 failures.
- TTS: Piper/espeak route -> subtitle-only continuity.

## Safety and UX

- Calm mode clamps active and session-scoped.
- Door visibility remains locked until Mirror phase.
- Subtitles are always on.

## Build Verification

- `npm run verify:spec`
- `npm run lint`
- `npm run test`
- `npm run build`
