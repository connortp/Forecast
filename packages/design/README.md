# @forecast/design

Shared design assets for every Forecast surface.

## Sky plates (`sky/`)

Nine photos named by sky state: `clear`, `partly`, `overcast`, `rain`, `storm`, `dawn`, `dusk`, `night`, `night-cloudy` (JPEG, 2000px long edge). Every plate is seen from above the clouds or at the horizon, never looking straight up at a blue sky. Two muted, seamless loops: `clouds.mp4` (flying over a sea of clouds at sunrise) and `rain.mp4` (720p, about 1MB each, with poster frames).

`sky/index.json` maps every engine condition (`sunny`, `partly`, `cloudy`, `rain`, `storm`) and time of day (`dawn`, `day`, `dusk`, `night`) to a plate, an optional `brightness` multiplier and an optional `video`. Web and iOS should both resolve backgrounds from this file so they always agree.

Show the plate alone when the viewer prefers reduced motion. Sources and license are in `sky/credits.md`.
