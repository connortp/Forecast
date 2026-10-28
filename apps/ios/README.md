# Forecast for iOS

Native SwiftUI app. Same screen as the web app: the sky, the date, and one number, with the details below the fold.

## Run it

1. Open `apps/ios/Forecast.xcodeproj` in Xcode 26 or later.
2. Pick an iPhone simulator and press Run.

To run on your own iPhone, choose your team under *Signing & Capabilities* for the Forecast target, plug in the phone, and pick it as the run destination.

## Layout

| Path | What it is |
| --- | --- |
| `ForecastKit/` | Swift package with the safe-to-spend engine, sample scenarios, and copy. A line-for-line port of `apps/web/src/lib`; keep the two in step. |
| `Forecast/` | The app: hero, sky, detail cards, fonts, assets. |
| `../../packages/design/sky` | Shared sky photos and loops, bundled into the app as the `sky` folder and chosen through `index.json`. |

The engine tests are the same cases as `apps/web/src/lib/engine.test.ts`:

```bash
cd apps/ios/ForecastKit && swift test
```

## Notes

- Fonts are Newsreader (number, headlines), Geist (body), and Geist Mono (labels), all under the SIL Open Font License (`Forecast/Fonts/OFL.txt`).
- Videos play muted and looped over their plate, and are skipped when Reduce Motion is on.
- Debug builds accept launch arguments for screenshots: `-scenario sunny|partly|rain|storm`, `-time auto|dawn|day|dusk|night`, `-tone calm|spicy`, `-openDetails YES`.
