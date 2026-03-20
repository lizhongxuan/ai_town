package handler

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/zhaoxinyi02/ClawPanel/internal/config"
	ws "github.com/zhaoxinyi02/ClawPanel/internal/websocket"
)

const townIMDedupWindow = 5 * time.Second

type townIMSyncContext struct {
	Channel        string
	ConversationID string
	Text           string
}

func syncTownWithExternalLogEvent(cfg *config.Config, db *sql.DB, hub *ws.Hub, source, eventType, summary, detail string) {
	if cfg == nil || !cfg.IsTownV3Enabled() || townStore == nil {
		return
	}

	if ctx, ok := parseTownIMInboundEvent(source, eventType, summary, detail); ok {
		runID, created := upsertTownIMInboundRun(ctx)
		if !created {
			return
		}
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(hub, 0)
		if db != nil {
			recordTownRuntimeEvent(db, hub, "openclaw.im.received", "收到 IM 任务", map[string]string{
				"runId":  runID,
				"source": "im",
				"prompt": ctx.Text,
			})
		}
		return
	}

	if ctx, ok := parseTownIMReplyEvent(source, eventType, summary, detail); ok {
		runID, changed := completeTownIMRun(ctx)
		if !changed {
			return
		}
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(hub, 0)
		if db != nil {
			recordTownRuntimeEvent(db, hub, "openclaw.run.completed", "IM 任务已完成", map[string]string{
				"runId":  runID,
				"source": "im",
			})
		}
	}
}

func parseTownIMInboundEvent(source, eventType, summary, detail string) (townIMSyncContext, bool) {
	source = strings.ToLower(strings.TrimSpace(source))
	eventType = strings.ToLower(strings.TrimSpace(eventType))

	switch {
	case source == "feishu" && eventType == "feishu.message.received":
		fields := parseTownDetailFields(detail)
		text := extractTownIMPrompt(summary, detail)
		if text == "" {
			return townIMSyncContext{}, false
		}
		return townIMSyncContext{
			Channel:        "feishu",
			ConversationID: strings.TrimSpace(fields["chatId"]),
			Text:           text,
		}, true
	case source == "wecom" && eventType == "wecom.message.received":
		fields := parseTownDetailFields(detail)
		text := extractTownIMPrompt(summary, detail)
		if text == "" {
			return townIMSyncContext{}, false
		}
		return townIMSyncContext{
			Channel:        "wecom",
			ConversationID: strings.TrimSpace(fields["to"]),
			Text:           text,
		}, true
	default:
		return townIMSyncContext{}, false
	}
}

func parseTownIMReplyEvent(source, eventType, summary, detail string) (townIMSyncContext, bool) {
	source = strings.ToLower(strings.TrimSpace(source))
	eventType = strings.ToLower(strings.TrimSpace(eventType))
	if source != "openclaw" || eventType != "openclaw.reply" {
		return townIMSyncContext{}, false
	}

	fields := parseTownDetailFields(detail)
	channel := strings.ToLower(strings.TrimSpace(fields["channel"]))
	if channel != "feishu" && channel != "wecom" {
		return townIMSyncContext{}, false
	}

	conversationID := strings.TrimSpace(fields["chatId"])
	if conversationID == "" {
		conversationID = strings.TrimSpace(fields["to"])
	}
	if conversationID == "" {
		return townIMSyncContext{}, false
	}

	text := extractTownIMReply(summary)
	if text == "" {
		return townIMSyncContext{}, false
	}

	return townIMSyncContext{
		Channel:        channel,
		ConversationID: conversationID,
		Text:           text,
	}, true
}

func upsertTownIMInboundRun(ctx townIMSyncContext) (string, bool) {
	now := time.Now()
	runID := fmt.Sprintf("run-im-%d", now.UnixNano())
	conversationKey := buildTownIMConversationKey(ctx.Channel, ctx.ConversationID)
	created := false

	_, err := townStore.UpdateState(nil, func(state *townSharedState) error {
		for idx := range state.Runs {
			run := &state.Runs[idx]
			if run.Source != "im" || run.Status != "running" {
				continue
			}
			if conversationKey == "" || run.PrimarySessionID != conversationKey {
				continue
			}
			if strings.TrimSpace(run.Prompt) != ctx.Text {
				continue
			}
			if now.Sub(time.UnixMilli(run.UpdatedAt)) > townIMDedupWindow {
				continue
			}
			runID = run.ID
			run.UpdatedAt = now.UnixMilli()
			return nil
		}

		run := townSharedRun{
			ID:               runID,
			Title:            buildTownRunTitle("", ctx.Text),
			Prompt:           ctx.Text,
			Source:           "im",
			Status:           "running",
			PrimarySessionID: conversationKey,
			CreatedAt:        now.UnixMilli(),
			UpdatedAt:        now.UnixMilli(),
		}
		state.Runs = prependTownRun(state.Runs, run)
		appendTownStateEvent(state, townSharedEvent{
			ID:        fmt.Sprintf("event-im-start-%d", now.UnixNano()),
			Type:      "im",
			Title:     sourceEventTitle("im"),
			Detail:    fmt.Sprintf("收到来自%s的新任务：%s", townIMChannelLabel(ctx.Channel), truncateTownIMText(ctx.Text, 80)),
			Time:      now.UnixMilli(),
			RunID:     runID,
			SceneHint: "office",
		})
		appendTownStateLog(state, townSharedLog{
			ID:     fmt.Sprintf("log-im-start-%d", now.UnixNano()),
			RunID:  runID,
			Title:  "IM 任务已接入",
			Detail: fmt.Sprintf("OpenClaw(main) 已接到来自%s的任务。", townIMChannelLabel(ctx.Channel)),
			Time:   now.UnixMilli(),
			Type:   "im",
		})
		created = true
		return nil
	})
	if err != nil {
		return "", false
	}
	return runID, created
}

func completeTownIMRun(ctx townIMSyncContext) (string, bool) {
	now := time.Now()
	runID := ""
	conversationKey := buildTownIMConversationKey(ctx.Channel, ctx.ConversationID)
	changed := false

	_, err := townStore.UpdateState(nil, func(state *townSharedState) error {
		if idx := findTownIMRunIndex(state.Runs, conversationKey, "running"); idx >= 0 {
			run := &state.Runs[idx]
			run.Status = "completed"
			run.UpdatedAt = now.UnixMilli()
			if conversationKey != "" {
				run.PrimarySessionID = conversationKey
			}
			runID = run.ID
		} else if idx := findTownIMRunIndex(state.Runs, conversationKey, "completed"); idx >= 0 {
			run := &state.Runs[idx]
			if now.Sub(time.UnixMilli(run.UpdatedAt)) <= townIMDedupWindow {
				runID = run.ID
				return nil
			}
			runID = run.ID
		} else {
			runID = fmt.Sprintf("run-im-%d", now.UnixNano())
			state.Runs = prependTownRun(state.Runs, townSharedRun{
				ID:               runID,
				Title:            buildTownRunTitle("", ctx.Text),
				Prompt:           ctx.Text,
				Source:           "im",
				Status:           "completed",
				PrimarySessionID: conversationKey,
				CreatedAt:        now.UnixMilli(),
				UpdatedAt:        now.UnixMilli(),
			})
		}

		appendTownStateEvent(state, townSharedEvent{
			ID:        fmt.Sprintf("event-im-completed-%d", now.UnixNano()),
			Type:      "success",
			Title:     "IM 任务已完成",
			Detail:    fmt.Sprintf("%s 回复已发送：%s", townIMChannelLabel(ctx.Channel), truncateTownIMText(ctx.Text, 80)),
			Time:      now.UnixMilli(),
			RunID:     runID,
			SceneHint: "office",
		})
		appendTownStateLog(state, townSharedLog{
			ID:     fmt.Sprintf("log-im-completed-%d", now.UnixNano()),
			RunID:  runID,
			Title:  "已发送回复",
			Detail: truncateTownIMText(ctx.Text, 120),
			Time:   now.UnixMilli(),
			Type:   "im",
		})
		changed = true
		return nil
	})
	if err != nil {
		return "", false
	}
	return runID, changed
}

func findTownIMRunIndex(runs []townSharedRun, conversationKey, status string) int {
	if conversationKey == "" {
		return -1
	}
	for idx := range runs {
		run := runs[idx]
		if run.Source != "im" || run.Status != status {
			continue
		}
		if run.PrimarySessionID == conversationKey {
			return idx
		}
	}
	return -1
}

func buildTownIMConversationKey(channel, conversationID string) string {
	channel = strings.ToLower(strings.TrimSpace(channel))
	conversationID = strings.TrimSpace(conversationID)
	if channel == "" || conversationID == "" {
		return ""
	}
	return "imctx:" + channel + ":" + conversationID
}

func parseTownDetailFields(detail string) map[string]string {
	fields := make(map[string]string)
	for _, line := range strings.Split(detail, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		if key == "" || value == "" {
			continue
		}
		fields[key] = value
	}
	return fields
}

func extractTownIMPrompt(summary, detail string) string {
	if source := strings.TrimSpace(detail); source != "" {
		fields := parseTownDetailFields(source)
		if text := strings.TrimSpace(fields["text"]); text != "" {
			return text
		}
	}
	text := stripTownBracketPrefix(summary)
	for _, sep := range []string{": ", "："} {
		if idx := strings.Index(text, sep); idx >= 0 {
			return strings.TrimSpace(text[idx+len(sep):])
		}
	}
	return strings.TrimSpace(text)
}

func extractTownIMReply(summary string) string {
	return strings.TrimSpace(stripTownBracketPrefix(summary))
}

func stripTownBracketPrefix(summary string) string {
	trimmed := strings.TrimSpace(summary)
	for strings.HasPrefix(trimmed, "[") {
		idx := strings.Index(trimmed, "]")
		if idx < 0 {
			break
		}
		trimmed = strings.TrimSpace(trimmed[idx+1:])
	}
	return trimmed
}

func truncateTownIMText(text string, limit int) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if limit <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "..."
}

func townIMChannelLabel(channel string) string {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "feishu":
		return "飞书"
	case "wecom":
		return "企微"
	default:
		return "IM"
	}
}
