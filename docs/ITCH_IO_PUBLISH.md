# itch.io Publish Checklist

1. Build production bundle: `npm run build`
2. Create zip package: `npm run release:package`
3. Upload generated `release/white-room-jarvis-vX.Y.Z-web.zip`
4. Confirm root contains `index.html`
5. Set project text:
   - Controls: Type or hold push-to-talk if local voice stack is available
   - Content warning + Calm Mode mention
6. Validate private embedded playthrough before public release
