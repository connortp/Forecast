# Forecast

A calm, weather-app-style view of your money. Open it and you see one number: what you can safely spend today.

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | The signed-in web app (Next.js) |
| `apps/ios` | The native iOS app (SwiftUI) |
| `apps/site` | The marketing website |
| `packages/*` | Shared code (analytics, the safe-to-spend engine, UI) |

## Getting started

```bash
corepack enable
pnpm install
pnpm dev
```
