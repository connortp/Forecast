// Compile-time checks for the track() signature. Run by `pnpm typecheck`.
import { track } from "./index";

track("logout_completed");
track("bucket_created", { kind: "goal" });
// @ts-expect-error unknown event
track("made_up_event", {});
// @ts-expect-error missing required property
track("bucket_created", {});
// @ts-expect-error amounts are not part of the taxonomy
track("bucket_created", { kind: "goal", amount: 500 });
