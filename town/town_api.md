# Town API

## Endpoints

### `GET /api/town/snapshot`

Purpose:

- Return a single render snapshot for Town UI.

Success:

- `200`
- body: `TownSnapshotResponse`

### `PUT /api/town/office-members`

Purpose:

- Update the shared office member pool.

Request:

```json
{
  "agentId": "coder",
  "membership": "selected",
  "expectedVersion": 12
}
```

Notes:

- `expectedVersion` is optional.
- Bulk mode uses `members[]`.
- Success returns the latest `version`.

### `POST /api/town/runs`

Purpose:

- Start a Town task and bridge it to OpenClaw.

Request:

```json
{
  "title": "整理发布说明",
  "prompt": "请整理这次版本更新说明",
  "source": "manual",
  "selectedAgents": ["coder", "writer"]
}
```

Notes:

- `selectedAgents` 表示当前在办公室待命的成员，不表示这些 Agent 会被立即拉入执行。
- 主任务始终先由 `OpenClaw(main)` 发起；只有真实桥接结果确认产生了子会话时，Town 才会把对应 Agent 标记为执行中/已完成。

### `GET /api/town/runs/:id/logs`

Purpose:

- Return one run's high-level replay/log timeline.

### `POST /api/town/agents/:id/reset`

Purpose:

- Clear a broken agent session and restore Town state.

## Error Codes

Town APIs return:

```json
{
  "ok": false,
  "code": "town.run.bridge_failed",
  "error": "Town 桥接 OpenClaw 失败: ..."
}
```

Current codes:

- `town.invalid_request`
- `town.office_members.empty_patch`
- `town.office_members.agent_required`
- `town.office_members.agent_not_found`
- `town.office_members.manager_locked`
- `town.office_members.invalid_membership`
- `town.office_members.selected_limit`
- `town.office_members.version_conflict`
- `town.office_members.state_write_failed`
- `town.run.invalid_request`
- `town.run.prompt_required`
- `town.run.bridge_failed`
- `town.run.state_write_failed`
- `town.run.run_id_required`
- `town.run.not_found`
- `town.reset.agent_required`
- `town.reset.manager_locked`
- `town.reset.agent_not_found`
- `town.reset.invalid_request`
- `town.reset.session_clear_failed`
- `town.reset.state_write_failed`

## Related Docs

- `town/town-api-schema.md`
- `town/town_events.md`
- `town/town_state.md`
