# Town Replay Performance Baseline

## Scope

- target path: `Town` replay mode
- event volume: `2000`
- benchmark entry: `cd web && npm run bench:town-replay`
- threshold gate: `cd web && npm run bench:town-replay:check`
- measured operations:
  - enter replay (`enterReplay` sort + cap + build state)
  - full frame sweep (`setReplayFrame` from `0` to `1999`)

## Baseline

- run date: 2026-03-12 09:19:02 CST
- command: `cd web && npm run bench:town-replay:check`
- node: `v24.14.0`
- samples: `40`
- events: `2000`
- results:
  - `buildReplayStateMs.mean = 0.028ms`
  - `buildReplayStateMs.p95 = 0.074ms`
  - `buildReplayStateMs.max = 0.139ms`
  - `sweepFramesMs.mean = 0.084ms`
  - `sweepFramesMs.p95 = 0.224ms`
  - `sweepFramesMs.max = 0.545ms`

## Acceptance Guidance

- `buildReplayStateMs.mean` should stay comfortably below a single frame budget on desktop browsers.
- `sweepFramesMs.mean` should stay stable across repeated runs; sudden growth usually means replay state work leaked into render paths.
- Compare `p95` first when deciding whether a change regressed replay smoothness.
- `bench:town-replay:check` currently enforces `buildReplayStateMs.p95 <= 0.5ms` and `sweepFramesMs.p95 <= 1ms`.

## Notes

- This benchmark is a local reducer/model baseline, not a full browser FPS measurement.
- Use it together with manual drag verification on the Town page before release.
