package handler

import (
	"crypto/sha256"
	"encoding/binary"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// T-203: Recommendation learning layer & A/B testing
//
// Extends the rule engine (T-105) with:
//   - Adoption feedback tracking
//   - Stable bucketing for A/B experiments
//   - Experiment configuration and rollback
//
// Metrics: CTR, adoption rate, completion time per strategy.
// ---------------------------------------------------------------------------

// TownABExperiment represents an A/B experiment configuration.
type TownABExperiment struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Strategy    string `json:"strategy"`    // control, variant_a, variant_b
	BucketRatio int    `json:"bucketRatio"` // percentage for variant
	Enabled     bool   `json:"enabled"`
}

// TownRecommendationFeedback records user adoption of a recommendation.
type TownRecommendationFeedback struct {
	RecommendationID string `json:"recommendationId"`
	Adopted          bool   `json:"adopted"`
	UserID           string `json:"userId,omitempty"`
	ExperimentID     string `json:"experimentId,omitempty"`
}

var (
	townABMu          sync.RWMutex
	townABExperiments = make(map[string]*TownABExperiment)
	townFeedbackLog   []TownRecommendationFeedback
)


// townStableBucket returns a deterministic bucket (0-99) for a user+experiment pair.
func townStableBucket(userID, experimentID string) int {
	h := sha256.Sum256([]byte(userID + ":" + experimentID))
	return int(binary.BigEndian.Uint32(h[:4]) % 100)
}

// GetTownABBucket returns which strategy a user falls into for an experiment.
func GetTownABBucket(userID, experimentID string) string {
	townABMu.RLock()
	exp, ok := townABExperiments[experimentID]
	townABMu.RUnlock()
	if !ok || !exp.Enabled {
		return "control"
	}
	bucket := townStableBucket(userID, experimentID)
	if bucket < exp.BucketRatio {
		return exp.Strategy
	}
	return "control"
}

// RecordTownRecommendationFeedback records adoption feedback.
func RecordTownRecommendationFeedback() gin.HandlerFunc {
	return func(c *gin.Context) {
		var fb TownRecommendationFeedback
		if err := c.ShouldBindJSON(&fb); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "无效的反馈数据"})
			return
		}
		if fb.RecommendationID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "recommendationId 不能为空"})
			return
		}
		townABMu.Lock()
		townFeedbackLog = append(townFeedbackLog, fb)
		townABMu.Unlock()
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// GetTownABExperiments returns all experiment configurations.
func GetTownABExperiments() gin.HandlerFunc {
	return func(c *gin.Context) {
		townABMu.RLock()
		list := make([]*TownABExperiment, 0, len(townABExperiments))
		for _, exp := range townABExperiments {
			list = append(list, exp)
		}
		townABMu.RUnlock()
		c.JSON(http.StatusOK, gin.H{"ok": true, "experiments": list})
	}
}

// ToggleTownABExperiment enables or disables an experiment.
func ToggleTownABExperiment() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			ID      string `json:"id"`
			Enabled *bool  `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" || req.Enabled == nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "需要 id 和 enabled 字段"})
			return
		}
		townABMu.Lock()
		exp, ok := townABExperiments[req.ID]
		if ok {
			exp.Enabled = *req.Enabled
		}
		townABMu.Unlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "实验不存在"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "experiment": exp})
	}
}

// CreateTownABExperiment creates a new A/B experiment.
func CreateTownABExperiment() gin.HandlerFunc {
	return func(c *gin.Context) {
		var exp TownABExperiment
		if err := c.ShouldBindJSON(&exp); err != nil || exp.ID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "需要有效的实验配置"})
			return
		}
		if exp.BucketRatio < 0 || exp.BucketRatio > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "bucketRatio 必须在 0-100 之间"})
			return
		}
		townABMu.Lock()
		townABExperiments[exp.ID] = &exp
		townABMu.Unlock()
		c.JSON(http.StatusOK, gin.H{"ok": true, "experiment": exp})
	}
}

// GetTownABMetrics returns feedback metrics per experiment.
func GetTownABMetrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		townABMu.RLock()
		total := len(townFeedbackLog)
		adopted := 0
		byExp := make(map[string]struct{ Total, Adopted int })
		for _, fb := range townFeedbackLog {
			if fb.Adopted {
				adopted++
			}
			s := byExp[fb.ExperimentID]
			s.Total++
			if fb.Adopted {
				s.Adopted++
			}
			byExp[fb.ExperimentID] = s
		}
		townABMu.RUnlock()
		c.JSON(http.StatusOK, gin.H{
			"ok":           true,
			"totalFeedback": total,
			"adopted":      adopted,
			"byExperiment": byExp,
		})
	}
}
