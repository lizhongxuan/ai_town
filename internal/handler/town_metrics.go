package handler

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// T-007: Observability baseline — Metrics, Feature Flags, Alerts
//
// Exposes Prometheus-compatible metrics at GET /api/town/metrics:
//   town_snapshot_build_ms          — histogram of snapshot build latency
//   town_store_conflict_total       — counter of CAS 409 conflicts
//   town_run_bridge_failed_total    — counter of bridge dispatch failures
//   town_ws_invalidate_total        — counter of WS invalidate broadcasts
//   town_run_plan_captured_total    — counter of observation plan captures
//   town_actor_bubble_total         — counter of actor bubble broadcasts
//
// Feature flags via environment variables:
//   TOWN_FF_OBSERVATION=0|1         — enable/disable observation endpoints
//   TOWN_FF_RECOMMENDATIONS=0|1    — enable/disable recommendations
//   TOWN_FF_BUBBLE=0|1             — enable/disable actor bubbles
// ---------------------------------------------------------------------------

// TownMetrics holds all Town-related counters and histograms.
type TownMetrics struct {
	SnapshotBuildCount   atomic.Int64
	SnapshotBuildSumMs   atomic.Int64
	StoreConflictTotal   atomic.Int64
	RunBridgeFailedTotal atomic.Int64
	WSInvalidateTotal    atomic.Int64
	RunPlanCapturedTotal atomic.Int64
	ActorBubbleTotal     atomic.Int64
}

var townMetrics = &TownMetrics{}

// RecordTownSnapshotBuild records a snapshot build latency.
func RecordTownSnapshotBuild(d time.Duration) {
	townMetrics.SnapshotBuildCount.Add(1)
	townMetrics.SnapshotBuildSumMs.Add(d.Milliseconds())
}

// RecordTownStoreConflict increments the CAS conflict counter.
func RecordTownStoreConflict() {
	townMetrics.StoreConflictTotal.Add(1)
}

// RecordTownRunBridgeFailed increments the bridge failure counter.
func RecordTownRunBridgeFailed() {
	townMetrics.RunBridgeFailedTotal.Add(1)
}

// RecordTownWSInvalidate increments the WS invalidate counter.
func RecordTownWSInvalidate() {
	townMetrics.WSInvalidateTotal.Add(1)
}

// RecordTownRunPlanCaptured increments the plan capture counter.
func RecordTownRunPlanCaptured() {
	townMetrics.RunPlanCapturedTotal.Add(1)
}

// RecordTownActorBubble increments the actor bubble counter.
func RecordTownActorBubble() {
	townMetrics.ActorBubbleTotal.Add(1)
}

// GetTownMetrics returns a Gin handler that exposes Prometheus-style metrics.
func GetTownMetrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		count := townMetrics.SnapshotBuildCount.Load()
		sumMs := townMetrics.SnapshotBuildSumMs.Load()
		avgMs := int64(0)
		if count > 0 {
			avgMs = sumMs / count
		}

		c.String(http.StatusOK, strings.Join([]string{
			"# HELP town_snapshot_build_ms Snapshot build latency in milliseconds",
			"# TYPE town_snapshot_build_ms summary",
			pmetric("town_snapshot_build_count", count),
			pmetric("town_snapshot_build_sum_ms", sumMs),
			pmetric("town_snapshot_build_avg_ms", avgMs),
			"# HELP town_store_conflict_total CAS version conflict count",
			"# TYPE town_store_conflict_total counter",
			pmetric("town_store_conflict_total", townMetrics.StoreConflictTotal.Load()),
			"# HELP town_run_bridge_failed_total Bridge dispatch failure count",
			"# TYPE town_run_bridge_failed_total counter",
			pmetric("town_run_bridge_failed_total", townMetrics.RunBridgeFailedTotal.Load()),
			"# HELP town_ws_invalidate_total WS invalidate broadcast count",
			"# TYPE town_ws_invalidate_total counter",
			pmetric("town_ws_invalidate_total", townMetrics.WSInvalidateTotal.Load()),
			"# HELP town_run_plan_captured_total Observation plan capture count",
			"# TYPE town_run_plan_captured_total counter",
			pmetric("town_run_plan_captured_total", townMetrics.RunPlanCapturedTotal.Load()),
			"# HELP town_actor_bubble_total Actor bubble broadcast count",
			"# TYPE town_actor_bubble_total counter",
			pmetric("town_actor_bubble_total", townMetrics.ActorBubbleTotal.Load()),
		}, "\n")+"\n")
	}
}

func pmetric(name string, value int64) string {
	return name + " " + strconv.FormatInt(value, 10)
}

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

// TownFeatureFlags holds runtime feature toggles.
type TownFeatureFlags struct {
	mu    sync.RWMutex
	flags map[string]bool
}

var townFF = &TownFeatureFlags{flags: make(map[string]bool)}

// InitTownFeatureFlags loads feature flags from environment variables.
func InitTownFeatureFlags() {
	townFF.mu.Lock()
	defer townFF.mu.Unlock()
	townFF.flags["observation"] = townEnvBool("TOWN_FF_OBSERVATION", true)
	townFF.flags["recommendations"] = townEnvBool("TOWN_FF_RECOMMENDATIONS", true)
	townFF.flags["bubble"] = townEnvBool("TOWN_FF_BUBBLE", true)
}

// IsTownFeatureEnabled checks if a feature flag is enabled.
func IsTownFeatureEnabled(name string) bool {
	townFF.mu.RLock()
	defer townFF.mu.RUnlock()
	enabled, exists := townFF.flags[name]
	if !exists {
		return true // default enabled
	}
	return enabled
}

// SetTownFeatureFlag sets a feature flag at runtime (for hot-toggle).
func SetTownFeatureFlag(name string, enabled bool) {
	townFF.mu.Lock()
	defer townFF.mu.Unlock()
	townFF.flags[name] = enabled
}

// GetTownFeatureFlags returns a Gin handler that lists all feature flags.
func GetTownFeatureFlags() gin.HandlerFunc {
	return func(c *gin.Context) {
		townFF.mu.RLock()
		defer townFF.mu.RUnlock()
		flags := make(map[string]bool, len(townFF.flags))
		for k, v := range townFF.flags {
			flags[k] = v
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "flags": flags})
	}
}

// ToggleTownFeatureFlag returns a Gin handler to toggle a feature flag.
func ToggleTownFeatureFlag() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name    string `json:"name"`
			Enabled bool   `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "name is required"})
			return
		}
		SetTownFeatureFlag(req.Name, req.Enabled)
		c.JSON(http.StatusOK, gin.H{"ok": true, "name": req.Name, "enabled": req.Enabled})
	}
}

// TownFeatureGate is a middleware that blocks requests if a feature is disabled.
func TownFeatureGate(featureName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !IsTownFeatureEnabled(featureName) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"ok":    false,
				"code":  "town.feature_disabled",
				"error": featureName + " 功能已关闭",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

func townEnvBool(key string, defaultVal bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return defaultVal
	}
	return v == "1" || v == "true" || v == "yes"
}
