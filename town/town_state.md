# Town State Model

## Core Principle

Town is a visualization layer over OpenClaw state. It does not own an independent agent runtime.

## Shared State

Persisted in `town_state.json`:

- `version`
- `officeMembers`
- `runs`
- `updatedAt`

## Office Membership

Values:

- `unselected`
- `selected`
- `auto_added`

Rules:

- `selected` means the user explicitly keeps the agent in office.
- `auto_added` means OpenClaw or IM dispatch pulled the agent in automatically.
- `selected` has higher priority than `auto_added`.
- Only explicit `unselected` sends an agent back to town.

## Execution State

Values:

- `idle`
- `standby`
- `busy`
- `completed`
- `error`

Current sync mode:

- `approximate`
- based on `events + session last update time`

## Run State

Values:

- `running`
- `completed`
- `error`

## Session Role

Values:

- `none`
- `primary`
- `spawned`

## Zone Model

`TownZone` is frontend-derived:

- one active run maps to one office partition
- max visible partitions: `6`
- extra runs go to overflow list

Fields:

- `id`
- `title`
- `runId`
- `state`
- `brightness`
- `updatedAt`

## Agent Instance Model

`TownAgentInstance` is backend-provided:

- same agent may appear in multiple active runs
- each clone binds to one `runId/sessionId/zoneId`

Fields:

- `id`
- `agentId`
- `runId`
- `sessionId`
- `zoneId`
- `status`

## Concurrency

Town shared state uses:

- monotonic `version`
- optional `expectedVersion` CAS on office member updates
- process-level serialization for state file writes

This keeps multi-request updates from silently overwriting each other.
