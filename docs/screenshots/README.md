# Screenshots

Captured from the production build (`npm run preview`) at 1531 × 1259.

| File | Contents |
| --- | --- |
| `en-overview.png` | Operations board, English interface |
| `zh-transport.png` | Transport board, Traditional Chinese interface |

These files are generated, not hand-captured, so they can never silently go
stale against the running product:

```bash
npm run build
npm run preview          # leave running in another terminal
npm run screenshots      # requires: npx playwright install chromium
```

The generator drives a real Chromium, lets the simulation run for six seconds so
the charts and counters show a populated facility rather than an empty one, then
captures each board through the same navigation the user uses. Point it at a
different deployment with `SCREENSHOT_URL=https://example.com npm run screenshots`.
