package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
	ws "github.com/zhaoxinyi02/ClawPanel/internal/websocket"
)

// ---------------------------------------------------------------------------
// T-010: town.invalidate & town.actor.bubble dual WS channels
//
// - town.invalidate: tells the frontend to re-fetch snapshot (version bump).
//   Does NOT carry state payload — just a signal.
// - town.actor.bubble: carries ephemeral speech/action bubbles for actors.
//   Used for real-time display only; snapshot.liveActions is the fallback
//   for reconnection recovery.
// ---------------------------------------------------------------------------

// TownWSMessageType enumerates the WS message types for Town.
const (
	TownWSInvalidate  = "town.invalidate"
	TownWSActorBubble = "town.actor.bubble"
)

// TownActorBubble represents a transient speech bubble for an actor.
type TownActorBubble struct {
	AgentID    string `json:"agentId"`
	RunID      string `json:"runId,omitempty"`
	BubbleType string `json:"bubbleType"` // plan, dispatch, command, skill, summary
	Text       string `json:"text"`
	Timestamp  int64  `json:"timestamp"`
}

// BroadcastTownInvalidate sends a town.invalidate signal to all WS clients.
// This tells the frontend to re-fetch the snapshot.
func BroadcastTownInvalidate(hub *ws.Hub, version int64) {
	if hub == nil {
		return
	}
	RecordTownWSInvalidate()
	payload, err := json.Marshal(map[string]any{
		"type": TownWSInvalidate,
		"data": map[string]any{
			"version": version,
		},
	})
	if err != nil {
		return
	}
	hub.Broadcast(payload)
}

// BroadcastTownActorBubble sends a transient actor bubble to all WS clients.
func BroadcastTownActorBubble(hub *ws.Hub, bubble TownActorBubble) {
	if hub == nil {
		return
	}
	RecordTownActorBubble()
	payload, err := json.Marshal(map[string]any{
		"type": TownWSActorBubble,
		"data": bubble,
	})
	if err != nil {
		return
	}
	hub.Broadcast(payload)
}

// PostTownActorBubble is an API endpoint for OpenClaw to push actor bubbles.
// POST /api/town/actor/bubble
func PostTownActorBubble(cfg *config.Config, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled"})
			return
		}

		var bubble TownActorBubble
		if err := c.ShouldBindJSON(&bubble); err != nil {
			townError(c, http.StatusBadRequest, "town.bubble.invalid", "无效的气泡数据")
			return
		}

		bubble.AgentID = strings.TrimSpace(bubble.AgentID)
		if bubble.AgentID == "" {
			townError(c, http.StatusBadRequest, "town.bubble.agent_required", "缺少 agentId")
			return
		}

		validTypes := map[string]bool{
			"plan": true, "dispatch": true, "command": true,
			"skill": true, "summary": true,
		}
		if !validTypes[bubble.BubbleType] {
			bubble.BubbleType = "summary"
		}

		BroadcastTownActorBubble(hub, bubble)
		log.Printf("[Town] actor bubble: agent=%s type=%s", bubble.AgentID, bubble.BubbleType)

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
