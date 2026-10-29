# Forecast for iOS

Native SwiftUI app. Same screen as the web app: the sky, the date, and one number, with the details below the fold.

Packages: ForecastKit (local), [supabase-swift](https://github.com/supabase/supabase-swift) and Plaid's [LinkKit](https://github.com/plaid/plaid-link-ios-spm), resolved by Xcode on first open.

## Run it

1. Open `apps/ios/Forecast.xcodeproj` in Xcode 26 or later.
2. Pick an iPhone simulator and press Run.

To run on your own iPhone, pick it as the run destination. Signing is automatic with team ZUADR84P7U and bundle ID `com.connortp.forecast`; Xcode needs to be signed in to that Apple account (Settings > Accounts).

## TestFlight

`scripts/testflight.sh` archives a Release build and uploads it to App Store Connect. The app record (bundle ID `com.connortp.forecast`) has to exist in App Store Connect first. See the script header for using an API key instead of the Xcode account.

## Layout

| Path | What it is |
| --- | --- |
| `ForecastKit/` | Swift package with the safe-to-spend engine, sample scenarios, and copy. A line-for-line port of `apps/web/src/lib`; keep the two in step. |
| `Forecast/` | The app: hero, sky, detail cards, fonts, assets. |
| `Forecast/Backend/` | Supabase sign-in and data (`Backend`, `AppSession`) and Plaid Link (`PlaidLink`). |
| `Forecast-Info.plist` | The `com.connortp.forecast://` URL scheme the sign-in email returns to, and `ForecastPlaidEnv`. |
| `../../packages/design/sky` | Shared sky photos and loops, bundled into the app as the `sky` folder and chosen through `index.json`. |

The engine tests are the same cases as `apps/web/src/lib/engine.test.ts`:

```bash
cd apps/ios/ForecastKit && swift test
```

## Notes

- Fonts are Newsreader (number, headlines), Geist (body), and Geist Mono (labels), all under the SIL Open Font License (`Forecast/Fonts/OFL.txt`).
- Videos play muted and looped over their plate, and are skipped when Reduce Motion is on.
- The app runs on real data: email sign-in through Supabase, Plaid Link for the bank, and the number from `ForecastKit/Live.swift` (a port of `apps/web/src/lib/live.ts`). Signed-out launches show sign-up (`Forecast/Signup/`); signed-in, set-up accounts go straight to the forecast. Pull down on the forecast to refresh from the bank.
- Example data is a demo mode, like the web's `/?demo`: tap "Look around with example data" on the welcome screen, or launch with `-demo YES` (`-demo NO` leaves it).
- Sign-in emails a link. Tapping it on the phone opens `com.connortp.forecast://login`, which must be in the Supabase project's redirect URLs (Authentication > URL Configuration). Once the email template includes `{{ .Token }}`, the six-digit code works too.
- While `ForecastPlaidEnv` is `sandbox`, the bank step offers "Use a test bank". In Plaid Link itself, the sandbox login is `user_good` / `pass_good`.
- Apple and Google buttons say they aren't switched on yet, until those Supabase providers are set up.
- Debug builds accept launch arguments for screenshots: `-scenario sunny|partly|rain|storm`, `-time auto|dawn|day|dusk|night`, `-tone calm|spicy`, `-openDetails YES`.
