# @forecast/web

The signed-in Forecast app. Right now it runs entirely on example data so the design and the safe-to-spend engine can be judged before bank linking lands.

```bash
pnpm --filter @forecast/web dev    # http://localhost:3000
pnpm --filter @forecast/web test   # engine tests
```

- `src/lib/engine.ts` computes the number, the outlook and the weather. See `docs/web-app.md`.
- `src/lib/sample-data.ts` holds the four example scenarios.
- `src/components/Sky.tsx` paints the sky for each condition and time of day.
