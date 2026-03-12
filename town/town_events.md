# Town Events

## Purpose

Town consumes normalized runtime events instead of parsing arbitrary log text.

## Event Types

### Run

- `openclaw.run.started`
- `openclaw.run.completed`
- `openclaw.run.failed`
- `openclaw.run.single`

### Session

- `openclaw.session.spawned`

### Agent

- `openclaw.agent.busy`
- `openclaw.agent.idle`
- `openclaw.agent.auto_added`
- `openclaw.agent.reset`

### IM

- `openclaw.im.received`

## Required Detail Fields

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

## Detail Encoding

`detail` is stored as newline-separated key-value pairs.

Example:

```text
runId=run-123
agentId=coder
sessionId=spawn-run-123-1
```

## Fallback Rule

If a normalized event is missing required fields, Town downgrades it to:

- `type = openclaw.run.failed`
- `detail.message = validation error text`

This prevents malformed runtime events from silently entering the replay stream.
