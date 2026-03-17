package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
	"github.com/zhaoxinyi02/ClawPanel/internal/model"
	ws "github.com/zhaoxinyi02/ClawPanel/internal/websocket"
)

func TestValidateTownEventFields(t *testing.T) {
	t.Parallel()

	if err := validateTownEventFields("openclaw.run.started", "runId=run-1\nsource=manual"); err != nil {
		t.Fatalf("expected valid run.started fields, got %v", err)
	}
	if err := validateTownEventFields("openclaw.session.spawned", "runId=run-1\nagentId=coder"); err == nil {
		t.Fatalf("expected validation failure for missing sessionId")
	}
}

func TestDispatchTownRunBridgeUsesLocalOpenClawFallback(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}
	fake := filepath.Join(binDir, "openclaw")
	script := "#!/bin/sh\nprintf '{\"sessionId\":\"session-test\",\"output\":\"done\"}'\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake openclaw: %v", err)
	}

	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+oldPath)

	cfg := &config.Config{
		OpenClawDir:  filepath.Join(root, "openclaw"),
		OpenClawWork: filepath.Join(root, "workspaces", "main"),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := dispatchTownRunBridge(ctx, cfg, townBridgeRequest{
		RunID:          "run-test",
		Title:          "标题",
		Prompt:         "只回复 OK",
		Source:         "manual",
		ManagerAgentID: "main",
	})
	if err != nil {
		t.Fatalf("dispatchTownRunBridge returned error: %v", err)
	}
	if result.SessionID != "session-test" {
		t.Fatalf("expected session-test, got %q", result.SessionID)
	}
	if result.Output != "done" {
		t.Fatalf("expected output done, got %q", result.Output)
	}
}

func TestDispatchTownRunBridgeTreatsJSONSuccessAsSuccessEvenWithNonZeroExit(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}
	fake := filepath.Join(binDir, "openclaw")
	script := "#!/bin/sh\nprintf '{\"status\":\"ok\",\"summary\":\"completed\",\"result\":{\"payloads\":[{\"text\":\"hello\"}],\"meta\":{\"agentMeta\":{\"sessionId\":\"session-nested\"}}}}'\nexit 1\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake openclaw: %v", err)
	}

	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+oldPath)

	cfg := &config.Config{
		OpenClawDir:  filepath.Join(root, "openclaw"),
		OpenClawWork: filepath.Join(root, "workspaces", "main"),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := dispatchTownRunBridge(ctx, cfg, townBridgeRequest{
		RunID:          "run-test",
		Title:          "标题",
		Prompt:         "只回复 OK",
		Source:         "manual",
		ManagerAgentID: "main",
	})
	if err != nil {
		t.Fatalf("dispatchTownRunBridge returned error: %v", err)
	}
	if result.SessionID != "session-nested" {
		t.Fatalf("expected session-nested, got %q", result.SessionID)
	}
	if result.Output != "hello" {
		t.Fatalf("expected parsed output hello, got %q", result.Output)
	}
}

func TestDispatchTownRunBridgeHTTPParsesNestedPayloadResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","summary":"completed","result":{"payloads":[{"text":"bridge hello"}],"meta":{"agentMeta":{"sessionId":"session-http"}}}}`))
	}))
	defer server.Close()

	t.Setenv("TOWN_RUN_BRIDGE_URL", server.URL)
	cfg := &config.Config{}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := dispatchTownRunBridge(ctx, cfg, townBridgeRequest{
		RunID:           "run-http",
		Title:           "标题",
		Prompt:          "hello",
		Source:          "manual",
		ManagerAgentID:  "main",
		StandbyAgentIDs: []string{"coder"},
	})
	if err != nil {
		t.Fatalf("dispatchTownRunBridge returned error: %v", err)
	}
	if result.SessionID != "session-http" {
		t.Fatalf("expected session-http, got %q", result.SessionID)
	}
	if result.Output != "bridge hello" {
		t.Fatalf("expected parsed output bridge hello, got %q", result.Output)
	}
}

func TestTownOfficeMembersVersionConflict(t *testing.T) {
	cfg, _ := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	router := gin.New()
	router.PUT("/api/town/office-members", UpdateTownOfficeMembers(cfg, hub))

	snapshot, err := buildTownSnapshot(cfg)
	if err != nil {
		t.Fatalf("buildTownSnapshot: %v", err)
	}

	body := `{"agentId":"coder","membership":"selected","expectedVersion":` + itoa(snapshot.Version) + `}`
	first := performTownRequest(router, http.MethodPut, "/api/town/office-members", body)
	if first.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", first.Code, first.Body.String())
	}

	second := performTownRequest(router, http.MethodPut, "/api/town/office-members", body)
	if second.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", second.Code, second.Body.String())
	}
}

func TestTownSnapshotRunLogsAndReset(t *testing.T) {
	cfg, db := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	router := gin.New()
	router.GET("/api/town/snapshot", GetTownSnapshot(cfg, db, hub))
	router.POST("/api/town/runs", CreateTownRun(cfg, db, hub))
	router.GET("/api/town/runs/:id/logs", GetTownRunLogs(cfg, db))
	router.POST("/api/town/agents/:id/reset", ResetTownAgent(cfg, db, hub))

	runResponse := performTownRequest(router, http.MethodPost, "/api/town/runs", `{"prompt":"请整理发布说明","selectedAgents":["coder"]}`)
	if runResponse.Code != http.StatusOK {
		t.Fatalf("createTownRun failed: %d %s", runResponse.Code, runResponse.Body.String())
	}

	var payload struct {
		OK  bool `json:"ok"`
		Run struct {
			ID string `json:"id"`
		} `json:"run"`
	}
	if err := json.Unmarshal(runResponse.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode run payload: %v", err)
	}
	if !payload.OK || payload.Run.ID == "" {
		t.Fatalf("unexpected run payload: %s", runResponse.Body.String())
	}

	waitForTownRunStatus(t, cfg, payload.Run.ID, "completed")

	logsResponse := performTownRequest(router, http.MethodGet, "/api/town/runs/"+payload.Run.ID+"/logs", "")
	if logsResponse.Code != http.StatusOK {
		t.Fatalf("getTownRunLogs failed: %d %s", logsResponse.Code, logsResponse.Body.String())
	}

	resetResponse := performTownRequest(router, http.MethodPost, "/api/town/agents/coder/reset", `{"keepInOffice":true}`)
	if resetResponse.Code != http.StatusOK {
		t.Fatalf("resetTownAgent failed: %d %s", resetResponse.Code, resetResponse.Body.String())
	}
}

func TestCreateTownRunKeepsSelectedOfficeMembersStandby(t *testing.T) {
	cfg, db := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	router := gin.New()
	router.PUT("/api/town/office-members", UpdateTownOfficeMembers(cfg, hub))
	router.POST("/api/town/runs", CreateTownRun(cfg, db, hub))

	selectResp := performTownRequest(router, http.MethodPut, "/api/town/office-members", `{"agentId":"coder","membership":"selected"}`)
	if selectResp.Code != http.StatusOK {
		t.Fatalf("select office member failed: %d %s", selectResp.Code, selectResp.Body.String())
	}

	runResp := performTownRequest(router, http.MethodPost, "/api/town/runs", `{"prompt":"你好","selectedAgents":["coder"]}`)
	if runResp.Code != http.StatusOK {
		t.Fatalf("createTownRun failed: %d %s", runResp.Code, runResp.Body.String())
	}

	var payload struct {
		Run struct {
			ID                  string   `json:"id"`
			ParticipantAgentIDs []string `json:"participantAgentIds"`
		} `json:"run"`
	}
	if err := json.Unmarshal(runResp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode run payload: %v", err)
	}
	if len(payload.Run.ParticipantAgentIDs) != 0 {
		t.Fatalf("expected no forced participants, got %#v", payload.Run.ParticipantAgentIDs)
	}

	waitForTownRunStatus(t, cfg, payload.Run.ID, "completed")

	state, err := townStore.ReadState()
	if err != nil {
		t.Fatalf("townStore.ReadState: %v", err)
	}
	for _, run := range state.Runs {
		if run.ID != payload.Run.ID {
			continue
		}
		if len(run.ParticipantAgentIDs) != 0 {
			t.Fatalf("expected stored run to have no forced participants, got %#v", run.ParticipantAgentIDs)
		}
	}
	for _, instance := range state.Instances {
		if instance.RunID == payload.Run.ID && instance.AgentID == "coder" {
			t.Fatalf("expected coder to stay standby without spawned instance, got %#v", instance)
		}
	}

	snapshot, err := buildTownSnapshotFromStore(cfg)
	if err != nil {
		t.Fatalf("buildTownSnapshot: %v", err)
	}
	for _, agent := range snapshot.Agents {
		if agent.ID != "coder" {
			continue
		}
		if agent.OfficeMembership != "selected" {
			t.Fatalf("expected coder to remain selected, got %q", agent.OfficeMembership)
		}
		if agent.ExecutionState != "standby" {
			t.Fatalf("expected coder to remain standby, got %q", agent.ExecutionState)
		}
		return
	}
	t.Fatalf("expected coder in snapshot")
}

func TestResetTownAgentClearsHistoricalErrorStateFromSnapshot(t *testing.T) {
	cfg, db := newTownTestFixture(t)
	hub := ws.NewHub()
	go hub.Run()
	defer hub.Stop()

	// F-03: Write OFFICE.md so coder is in office
	if err := WriteOfficeMembers(cfg, []string{"coder"}); err != nil {
		t.Fatalf("write OFFICE.md: %v", err)
	}

	router := gin.New()
	router.POST("/api/town/agents/:id/reset", ResetTownAgent(cfg, db, hub))

	_, err := townStore.UpdateState(nil, func(state *townSharedState) error {
		state.OfficeMembers["coder"] = "selected"
		state.Runs = prependTownRun(state.Runs, townSharedRun{
			ID:                  "run-old-error",
			Title:               "旧失败任务",
			Prompt:              "旧失败任务",
			Source:              "manual",
			Status:              "error",
			PrimarySessionID:    "session-old-error",
			CreatedAt:           time.Now().Add(-time.Minute).UnixMilli(),
			UpdatedAt:           time.Now().Add(-time.Minute).UnixMilli(),
			ParticipantAgentIDs: []string{"coder"},
			SpawnedSessions: []townSharedSpawnedSession{
				{ID: "spawn-old-error-coder", AgentID: "coder", Status: "error"},
			},
		})
		state.Instances = prependTownInstance(state.Instances, townSharedInstance{
			ID:        "instance-old-error-coder",
			AgentID:   "coder",
			RunID:     "run-old-error",
			SessionID: "spawn-old-error-coder",
			ZoneID:    "zone-run-old-error",
			Status:    "error",
		})
		return nil
	})
	if err != nil {
		t.Fatalf("seed town shared state: %v", err)
	}

	before, err := buildTownSnapshotFromStore(cfg)
	if err != nil {
		t.Fatalf("buildTownSnapshotFromStore before reset: %v", err)
	}
	if before.Agents[0].ExecutionState != "error" {
		t.Fatalf("expected pre-reset execution state error, got %q", before.Agents[0].ExecutionState)
	}

	resetResponse := performTownRequest(router, http.MethodPost, "/api/town/agents/coder/reset", `{"keepInOffice":true}`)
	if resetResponse.Code != http.StatusOK {
		t.Fatalf("resetTownAgent failed: %d %s", resetResponse.Code, resetResponse.Body.String())
	}

	after, err := buildTownSnapshotFromStore(cfg)
	if err != nil {
		t.Fatalf("buildTownSnapshotFromStore after reset: %v", err)
	}
	if len(after.Agents) == 0 {
		t.Fatalf("expected agent snapshot after reset")
	}
	if after.Agents[0].ExecutionState != "standby" {
		t.Fatalf("expected standby after reset, got %q", after.Agents[0].ExecutionState)
	}
	if after.Agents[0].SessionRole != "none" {
		t.Fatalf("expected session role none after reset, got %q", after.Agents[0].SessionRole)
	}
}

func TestTownSnapshotExcludesDefaultManagerFromSelectableAgents(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	openClawDir := filepath.Join(root, "openclaw")
	workDir := filepath.Join(root, "workspaces", "main")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir data dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(openClawDir, "agents", "coder"), 0o755); err != nil {
		t.Fatalf("mkdir coder agent: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(openClawDir, "agents", "reviewer", "sessions"), 0o755); err != nil {
		t.Fatalf("mkdir reviewer sessions: %v", err)
	}

	openClawJSON := map[string]any{
		"agents": map[string]any{
			"default": "coder",
			"list": []any{
				map[string]any{
					"id":          "coder",
					"name":        "编程高手",
					"description": "默认主控 Agent",
				},
				map[string]any{
					"id":          "reviewer",
					"name":        "审查员",
					"description": "负责审查与验证",
				},
			},
		},
	}
	raw, err := json.Marshal(openClawJSON)
	if err != nil {
		t.Fatalf("marshal openclaw.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(openClawDir, "openclaw.json"), raw, 0o644); err != nil {
		t.Fatalf("write openclaw.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(openClawDir, "agents", "reviewer", "sessions", "sessions.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write sessions.json: %v", err)
	}

	enabled := true
	cfg := &config.Config{
		DataDir:       dataDir,
		OpenClawDir:   openClawDir,
		OpenClawWork:  workDir,
		TownV3Enabled: &enabled,
	}

	snapshot, err := buildTownSnapshot(cfg)
	if err != nil {
		t.Fatalf("buildTownSnapshot: %v", err)
	}
	if snapshot.OpenClaw.AgentID != "coder" {
		t.Fatalf("expected coder as manager, got %q", snapshot.OpenClaw.AgentID)
	}
	if len(snapshot.Agents) != 1 || snapshot.Agents[0].ID != "reviewer" {
		t.Fatalf("expected only reviewer to be selectable, got %#v", snapshot.Agents)
	}
	if len(snapshot.VisibleTownAgentID) != 1 || snapshot.VisibleTownAgentID[0] != "reviewer" {
		t.Fatalf("expected only reviewer to be visible in main town, got %#v", snapshot.VisibleTownAgentID)
	}
}

func newTownTestFixture(t *testing.T) (*config.Config, *sql.DB) {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	openClawDir := filepath.Join(root, "openclaw")
	workDir := filepath.Join(root, "workspaces", "main")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir data dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(openClawDir, "agents", "main"), 0o755); err != nil {
		t.Fatalf("mkdir main agent: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(openClawDir, "agents", "coder", "sessions"), 0o755); err != nil {
		t.Fatalf("mkdir coder sessions: %v", err)
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	openClawJSON := map[string]any{
		"agents": map[string]any{
			"default": "main",
			"list": []any{
				map[string]any{"id": "main", "name": "OpenClaw(main)"},
				map[string]any{
					"id":          "coder",
					"name":        "编码高手",
					"description": "负责代码实现和命令执行",
					"skills": []any{
						map[string]any{"id": "code", "name": "代码执行", "enabled": true},
					},
				},
			},
		},
	}
	raw, err := json.Marshal(openClawJSON)
	if err != nil {
		t.Fatalf("marshal openclaw.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(openClawDir, "openclaw.json"), raw, 0o644); err != nil {
		t.Fatalf("write openclaw.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(openClawDir, "agents", "coder", "sessions", "sessions.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write sessions.json: %v", err)
	}

	enabled := true
	cfg := &config.Config{
		DataDir:       dataDir,
		OpenClawDir:   openClawDir,
		OpenClawWork:  workDir,
		TownV3Enabled: &enabled,
	}
	db, err := model.InitDB(dataDir)
	if err != nil {
		t.Fatalf("init db: %v", err)
	}

	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "openclaw"), []byte("#!/bin/sh\nprintf '{\"sessionId\":\"session-ok\",\"output\":\"done\"}'\n"), 0o755); err != nil {
		t.Fatalf("write fake openclaw: %v", err)
	}
	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+oldPath)

	InitTownStore(cfg, db)

	return cfg, db
}

func performTownRequest(router *gin.Engine, method, target, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func waitForTownRunStatus(t *testing.T, cfg *config.Config, runID, status string) {
	t.Helper()
	_ = cfg
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state, err := townStore.ReadState()
		if err != nil {
			t.Fatalf("townStore.ReadState: %v", err)
		}
		for _, run := range state.Runs {
			if run.ID == runID && run.Status == status {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("run %s did not reach status %s", runID, status)
}

func itoa(value int64) string {
	return fmt.Sprintf("%d", value)
}
