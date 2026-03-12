# Town Ops Guide

## 1. Common Files

- `data/town_state.json`
- `data/town_office_audit.jsonl`
- event log database: `data/clawpanel.db`

## 2. Common Symptoms

### Symptom: Town page shows stale members

Check:

- whether `town_state.json` is updating
- whether `version` is increasing
- whether client got `town.office_members.version_conflict`

Recovery:

1. Refresh snapshot.
2. Retry with latest version.
3. Inspect `town_office_audit.jsonl` for the last writer.

### Symptom: Run created in UI but not executed

Check:

- if you use an external bridge, verify `TOWN_RUN_BRIDGE_URL` and `TOWN_RUN_BRIDGE_TOKEN` in the service manager environment, not only in the current shell
- if you use the built-in local bridge, verify the service user can find `openclaw` and that `openclaw agent --agent <manager>` can run with the current OpenClaw auth/model config
- if the command falls back with `No API key found for provider ...`, fix the manager agent auth profile first; Town can create the run shell, but real execution will still fail
- bridge timeout env: `TOWN_RUN_BRIDGE_TIMEOUT_SECONDS`
- last error code: `town.run.bridge_failed`

Recovery:

1. Verify bridge endpoint is reachable.
2. Retry task from Town UI.
3. Open run logs and event log to confirm whether `openclaw.run.started` exists.

### Symptom: Agent appears stuck in office

Check:

- recent events for `openclaw.agent.busy`, `openclaw.agent.idle`
- session files under the agent session directory

Recovery:

1. Use Town reset action for the agent.
2. If needed, keep the agent in office after reset.
3. If session files are corrupted, clear them and reload snapshot.

### Symptom: Snapshot requests are slow

Check:

- snapshot baseline test result in CI
- event log size
- run history size in `town_state.json`

Recovery:

1. Reduce noisy event generation.
2. Trim historical events if needed.
3. Enable verbose Town logs only during diagnosis.

## 3. Useful Env Vars

- `TOWN_BUSY_WINDOW_SECONDS`
- `TOWN_STATE_DEBOUNCE_SECONDS`
- `TOWN_COMPLETED_WINDOW_SECONDS`
- `TOWN_RUN_BRIDGE_URL`
- `TOWN_RUN_BRIDGE_TOKEN`
- `TOWN_RUN_BRIDGE_TIMEOUT_SECONDS`
- `TOWN_VERBOSE_LOGS`

## 4. Observability

Town backend logs emit categories:

- `snapshot`
- `office-members`
- `run`
- `replay`
- `reset`

Use them together with normalized events to diagnose Town/OpenClaw drift.

## 5. Validation Scripts

- shared-state check: `TOWN_TEST_AGENT=<non-manager-agent> node scripts/town-multiuser-consistency.mjs`
- replay baseline: `cd web && npm run bench:town-replay`
- replay threshold gate: `cd web && npm run bench:town-replay:check`
- first-time Playwright setup: `npx --yes --package=playwright playwright install chromium`
- responsive QA: `TOWN_QA_URL=http://127.0.0.1:8000 node scripts/town-responsive-check.mjs`

## 6. Related Docs

- `town/town_release_checklist.md`
- `town/town_replay_perf.md`
