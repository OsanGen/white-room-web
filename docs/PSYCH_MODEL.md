# Psychological Model Notes

This model is a game design mapping, not a clinical diagnostic instrument.

## Core Levers

1. Uncertainty modulation
2. Perceived control modulation
3. Self-reference echo

Secondary levers are capped under calm/safety policies.

## Update Pipeline

1. Classify player input into one of six classes.
2. Apply class psych delta.
3. Apply keyword psych delta.
4. Add deterministic bounded noise (+/-0.02 equivalent range).
5. Clamp psych vector to [-1, 1].
6. Transfer vector to environment channels.
7. Clamp channels using default or calm mode caps.

## Safety Caps

Default:
- chroma <= 0.35
- vignette <= 0.65
- jitter <= 0.45
- geom skew <= 0.70
- exposure pulse <= 0.55
- heartbeat gain <= 0.70

Calm mode:
- chroma = 0
- vignette <= 0.40
- jitter <= 0.18
- geom skew <= 0.35
- exposure pulse <= 0.25
- heartbeat gain <= 0.35

## Intent

The design target is controlled uncanny tension with deterministic completion, not open-ended distress escalation.
