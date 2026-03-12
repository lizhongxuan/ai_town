# Town Release Checklist

## 1. Backend

- Confirm `townV3Enabled` matches the rollout target in `clawpanel.json` or `TOWN_V3_ENABLED`.
- If the deployment uses an external Town bridge, confirm the running service environment exposes `TOWN_RUN_BRIDGE_URL` (and `TOWN_RUN_BRIDGE_TOKEN` if required by the bridge). Otherwise verify the service user can discover and execute `openclaw`.
- Confirm the manager agent used by Town has valid model/auth configuration, so `openclaw agent --agent <manager>` can actually execute instead of failing over with missing provider credentials.
- Verify `GET /api/town/snapshot` returns `200` and `snapshot.version` increases after member updates.
- Verify `POST /api/town/runs` creates a real run and a matching run log timeline.
- Verify normalized Town events appear in `/api/events` for `run started/completed`, `session spawned`, `agent busy/idle`, and `im received`.
- Verify `data/town_state.json` and `data/town_office_audit.jsonl` are writable by the running service user.

## 2. Frontend

- Run `cd web && npm test`.
- Run `cd web && npm run build`.
- If Playwright is not cached locally yet, run `npx --yes --package=playwright playwright install chromium` once.
- Run `TOWN_QA_URL=http://127.0.0.1:8000 node scripts/town-responsive-check.mjs` against a built Town bundle and review `output/playwright/town/`.
- Confirm Town page can switch between `主镇` and `办公室` without console errors.
- Confirm replay mode freezes realtime updates and exits back to the latest snapshot.
- Confirm keyboard movement only affects local display positions and does not change shared office membership.

## 3. Consistency And Performance

- Run `TOWN_TEST_AGENT=<non-manager-agent> node scripts/town-multiuser-consistency.mjs` with `TOWN_ADMIN_TOKEN` against the target environment.
- Run `cd web && npm run bench:town-replay:check`, then compare the output with `town/town_replay_perf.md` if a deeper diff is needed.
- Verify office member updates still return `town.office_members.version_conflict` on stale writes.
- Verify a 2000-event replay still enters replay mode and frame sweep stays within the accepted baseline window.

## 4. Rollout

- Enable `townV3Enabled` only in the intended environment first.
- Ask at least one secondary client/browser to verify shared member state after rollout.
- Keep `TOWN_VERBOSE_LOGS` off by default; only enable during diagnosis.
- Preserve the pre-release `town_state.json` backup if a migration rewrites old member data.

## 5. Rollback

- Disable `townV3Enabled` and restart ClawPanel if Town must be pulled back quickly.
- Restore the previous binary/frontend bundle if Town-specific API or UI regressions block core operations.
- If member state was corrupted, restore `data/town_state.json` from backup and restart the service.
- Re-run snapshot, run creation, and multi-user consistency checks after rollback to confirm recovery.
