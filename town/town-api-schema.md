# Town API Schema

## Scope

This draft documents the current Town-facing snapshot contract used by:

- `GET /api/town/snapshot`
- `PUT /api/town/office-members`
- `POST /api/town/runs`
- `GET /api/town/runs/:id/logs`

The Town page is a visualization layer over OpenClaw runtime and configuration. It does not define an independent agent model.

## 1. Snapshot Response

Top-level shape:

```json
{
  "ok": true,
  "snapshot": {
    "clock": "15:04",
    "weather": "晴朗",
    "version": 12,
    "sync": {
      "mode": "approximate",
      "busyWindowSeconds": 30,
      "stateDebounceSeconds": 8,
      "completedWindowSeconds": 45
    },
    "openclaw": {
      "agentId": "main",
      "name": "OpenClaw(main)"
    },
    "maxSelectableAgents": 10,
    "officeMembers": {},
    "agents": [],
    "visibleTownAgentIds": [],
    "events": [],
    "logs": [],
    "runs": [],
    "instances": []
  }
}
```

## 2. Time Fields

Machine-readable time fields use this rule:

- Numeric fields keep Unix milliseconds for sorting and rendering.
- Matching `*Rfc3339` fields provide exact RFC3339 timestamps.
- UI-only labels such as `clock`, `timeLabel`, `createdAtLabel`, `updatedAtLabel` are presentation fields.

Examples:

- `event.time` + `event.timeRfc3339`
- `log.time` + `log.timeRfc3339`
- `run.createdAt` + `run.createdAtRfc3339`
- `run.updatedAt` + `run.updatedAtRfc3339`

## 3. Enumerations

### 3.1 Office Membership

- `unselected`
- `selected`
- `auto_added`

Rule:

- `selected` has higher priority than `auto_added`.
- `auto_added` must not downgrade an already `selected` member.
- `unselected` removes the member from the office pool.

### 3.2 Execution State

- `idle`
- `standby`
- `busy`
- `completed`
- `error`

### 3.3 Session Role

- `none`
- `primary`
- `spawned`

### 3.4 Run Status

- `running`
- `completed`
- `error`

### 3.5 Run Source

- `manual`
- `im`

### 3.6 Event Type

- `info`
- `success`
- `warning`
- `im`

### 3.7 Log Type

- `system`
- `session`
- `spawn`
- `im`

### 3.8 Zone State

Frontend-derived contract:

- `running`
- `fading`

### 3.9 Agent Instance Status

- `thinking`
- `executing`
- `completed`
- `error`

## 4. Contract Objects

### 4.1 TownSnapshotAgent

Fields:

- `id`
- `name`
- `role`
- `description`
- `skills[]`
- `sessions`
- `lastActive`
- `lastActiveRfc3339`
- `recentWeight`
- `officeMembership`
- `executionState`
- `sessionRole`
- `location`

### 4.2 TownZone

This object is frontend-derived and not persisted in backend snapshot directly.

Fields:

- `id`
- `title`
- `runId`
- `state`
- `brightness`
- `updatedAt`

### 4.3 TownAgentInstance

Fields:

- `id`
- `agentId`
- `runId`
- `sessionId`
- `zoneId`
- `status`

## 5. Event Detail Payload

Runtime events are stored as key-value lines in `detail`.

Example:

```text
runId=run-123
agentId=coder
sessionId=spawn-run-123-1
```

Required fields depend on event type:

- `openclaw.run.started`: `runId`, `source`
- `openclaw.run.completed`: `runId`, `source`
- `openclaw.run.failed`: `runId`, `source`
- `openclaw.run.single`: `runId`
- `openclaw.session.spawned`: `runId`, `agentId`, `sessionId`
- `openclaw.agent.busy`: `runId`, `agentId`
- `openclaw.agent.idle`: `runId`, `agentId`
- `openclaw.agent.auto_added`: `runId`, `agentId`
- `openclaw.agent.reset`: `agentId`
- `openclaw.im.received`: `runId`, `source`, `prompt`

## 6. Office Members Update

`PUT /api/town/office-members`

Request shape:

```json
{
  "agentId": "coder",
  "membership": "selected",
  "expectedVersion": 12
}
```

Notes:

- `expectedVersion` is optional.
- If provided and stale, backend returns `409`.
- Successful updates return the new `version`.

## 7. Notes

- Snapshot `version` is the Town state file version used for optimistic concurrency.
- The Town page may still derive zones and some animation-only state locally.
- The backend keeps snapshot payload backward compatible by retaining numeric timestamps and label fields.
