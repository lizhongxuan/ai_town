package handler

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// ---------------------------------------------------------------------------
// T-105: Recommendation system v1
//
// Rule-based recommendations using stable fields only (no unfrozen upstream trace).
// Three categories:
//   1. Main town agent selection recommendations
//   2. Office vacancy/complement recommendations
//   3. Risk governance suggestions
//
// Recommendations are explainable and auditable.
// On error, recommendations gracefully degrade (grayed out).
// ---------------------------------------------------------------------------

// TownRecommendation represents a single recommendation.
type TownRecommendation struct {
	ID       string `json:"id"`
	Category string `json:"category"` // selection, complement, risk
	AgentID  string `json:"agentId,omitempty"`
	Title    string `json:"title"`
	Reason   string `json:"reason"`
	Score    int    `json:"score"`
}

// GetTownRecommendations returns rule-based recommendations.
// GET /api/town/recommendations
func GetTownRecommendations(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled"})
			return
		}

		if !IsTownFeatureEnabled("recommendations") {
			c.JSON(http.StatusOK, gin.H{
				"ok":              true,
				"recommendations": []TownRecommendation{},
				"degraded":        true,
				"reason":          "推荐功能已关闭",
			})
			return
		}

		state, err := townStore.ReadState()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"ok":              true,
				"recommendations": []TownRecommendation{},
				"degraded":        true,
				"reason":          "无法读取状态",
			})
			return
		}

		recs := buildTownRecommendations(cfg, state)
		c.JSON(http.StatusOK, gin.H{
			"ok":              true,
			"recommendations": recs,
		})
	}
}

func buildTownRecommendations(cfg *config.Config, state townSharedState) []TownRecommendation {
	var recs []TownRecommendation

	agentIDs, _ := loadAgentIDs(cfg)
	managerID := loadDefaultAgentID(cfg)

	// Count selected members
	selectedCount := countTownSelectedMembers(state.OfficeMembers)

	// 1. Selection recommendations: suggest agents with high recent weight
	for _, agentID := range agentIDs {
		if agentID == managerID {
			continue
		}
		membership := state.OfficeMembers[agentID]
		if membership == "selected" || membership == "auto_added" {
			continue
		}
		weight := state.RecentWeights[agentID]
		if weight >= 3 {
			recs = append(recs, TownRecommendation{
				ID:       "sel-" + agentID,
				Category: "selection",
				AgentID:  agentID,
				Title:    "建议选入办公室: " + agentID,
				Reason:   "近期活跃度较高，参与过多次任务",
				Score:    weight,
			})
		}
	}

	// 2. Complement recommendations: if office is understaffed
	if selectedCount < 3 && len(agentIDs) > 3 {
		recs = append(recs, TownRecommendation{
			ID:       "comp-understaffed",
			Category: "complement",
			Title:    "办公室成员不足",
			Reason:   "当前仅 " + itoa2(selectedCount) + " 名成员在办公室，建议补充至 3 名以上以提升协作效率",
			Score:    10,
		})
	}

	// 3. Risk suggestions: if there are recent error runs
	errorCount := 0
	for _, run := range state.Runs {
		if run.Status == "error" {
			errorCount++
		}
	}
	if errorCount >= 2 {
		recs = append(recs, TownRecommendation{
			ID:       "risk-errors",
			Category: "risk",
			Title:    "近期任务失败率偏高",
			Reason:   "最近有 " + itoa2(errorCount) + " 个任务失败，建议检查 Agent 状态或重置异常会话",
			Score:    15,
		})
	}

	// Sort by score descending
	sort.Slice(recs, func(i, j int) bool {
		return recs[i].Score > recs[j].Score
	})

	return recs
}

func itoa2(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
