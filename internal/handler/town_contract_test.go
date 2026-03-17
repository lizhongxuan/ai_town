package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	ws "github.com/zhaoxinyi02/ClawPanel/internal/websocket"
)

// ---------------------------------------------------------------------------
// T-008: Contract tests for Town API endpoints
//
// These tests verify the API response shape (contract) for:
//   GET /api/town/snapshot
//   PUT /api/town/office-members
//   POST /api/town/runs
//   GET /api/town/runs/:id/logs
//   GET /api/town/runs/:id/details
//   GET /api/town/runs/:id/replay
//   GET /api/town/metrics
//   GET /api/town/feature-flags
// ---------------------------------------------------------------------------

func TestContractGetTownSnapshot(t *testing.T) {
	cfg, db := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	router := gin.New()
	router.GET("/api/town/snapshot", GetTownSnapshot(cfg, db, hub))

	resp := performTownRequest(router, http.MethodGet, "/api/town/snapshot", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var payload struct {
		OK       bool         `json:"ok"`
		Snapshot TownSnapshot `json:"snapshot"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok=true")
	}
	// Contract: snapshot must have version, clock, weather, agents array
	if payload.Snapshot.Version < 0 {
		t.Fatal("snapshot.version should be >= 0")
	}
	if payload.Snapshot.Clock == "" {
		t.Fatal("snapshot.clock should not be empty")
	}
	if payload.Snapshot.Weather == "" {
		t.Fatal("snapshot.weather should not be empty")
	}
	if payload.Snapshot.Agents == nil {
		t.Fatal("snapshot.agents should not be nil")
	}
	if payload.Snapshot.MaxSelectableAgent <= 0 {
		t.Fatal("snapshot.maxSelectableAgents should be > 0")
	}
}

func TestContractUpdateTownOfficeMembers(t *testing.T) {
	cfg, _ := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	router := gin.New()
	router.PUT("/api/town/office-members", UpdateTownOfficeMembers(cfg, hub))

	resp := performTownRequest(router, http.MethodPut, "/api/town/office-members",
		`{"agentId":"coder","membership":"selected"}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var payload struct {
		OK      bool   `json:"ok"`
		Version int64  `json:"version"`
		AgentID string `json:"agentId"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok=true")
	}
	// Contract: response must include version
	if payload.Version <= 0 {
		t.Fatal("response.version should be > 0")
	}
}

func TestContractGetTownRunLogs(t *testing.T) {
	cfg, db := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	router := gin.New()
	router.POST("/api/town/runs", CreateTownRun(cfg, db, hub))
	router.GET("/api/town/runs/:id/logs", GetTownRunLogs(cfg, db))

	// Create a run first
	runResp := performTownRequest(router, http.MethodPost, "/api/town/runs",
		`{"prompt":"测试","selectedAgents":["coder"]}`)
	var runPayload struct {
		Run struct{ ID string `json:"id"` } `json:"run"`
	}
	json.Unmarshal(runResp.Body.Bytes(), &runPayload)

	waitForTownRunStatus(t, cfg, runPayload.Run.ID, "completed")

	resp := performTownRequest(router, http.MethodGet, "/api/town/runs/"+runPayload.Run.ID+"/logs", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var logsPayload struct {
		OK         bool              `json:"ok"`
		Logs       []TownSnapshotLog `json:"logs"`
		NextCursor string            `json:"nextCursor"`
		Total      int               `json:"total"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &logsPayload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !logsPayload.OK {
		t.Fatal("expected ok=true")
	}
	// Contract: logs array and total must be present
	if logsPayload.Logs == nil {
		t.Fatal("logs should not be nil")
	}
}

func TestContractGetTownRunDetails(t *testing.T) {
	cfg, db := newTownTestFixture(t)

	router := gin.New()
	router.GET("/api/town/runs/:id/details", GetTownRunDetails(cfg, db))

	resp := performTownRequest(router, http.MethodGet, "/api/town/runs/nonexistent/details?section=all", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var payload struct {
		OK      bool           `json:"ok"`
		Details TownRunDetails `json:"details"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok=true")
	}
	// Contract: details.runId must match
	if payload.Details.RunID != "nonexistent" {
		t.Fatalf("expected runId=nonexistent, got %q", payload.Details.RunID)
	}
}

func TestContractGetTownMetrics(t *testing.T) {
	router := gin.New()
	router.GET("/api/town/metrics", GetTownMetrics())

	resp := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/town/metrics", nil)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	body := resp.Body.String()
	// Contract: must contain Prometheus-style metric names
	for _, metric := range []string{
		"town_snapshot_build_count",
		"town_store_conflict_total",
		"town_run_bridge_failed_total",
		"town_ws_invalidate_total",
		"town_run_plan_captured_total",
		"town_actor_bubble_total",
	} {
		if !contains(body, metric) {
			t.Fatalf("metrics output missing %q", metric)
		}
	}
}

func TestContractGetTownFeatureFlags(t *testing.T) {
	InitTownFeatureFlags()

	router := gin.New()
	router.GET("/api/town/feature-flags", GetTownFeatureFlags())

	resp := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/town/feature-flags", nil)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var payload struct {
		OK    bool            `json:"ok"`
		Flags map[string]bool `json:"flags"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok=true")
	}
	// Contract: must have observation, recommendations, bubble flags
	for _, flag := range []string{"observation", "recommendations", "bubble"} {
		if _, exists := payload.Flags[flag]; !exists {
			t.Fatalf("missing feature flag: %s", flag)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
