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
}

func TestTownOfficeMembersVersionConflict(t *testing.T) {
	cfg, db := newTownTestFixture(t)

	router := gin.New()
	router.PUT("/api/town/office-members", UpdateTownOfficeMembers(cfg))

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
	if db != nil {
		db.Close()
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
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state, err := readTownSharedState(cfg)
		if err != nil {
			t.Fatalf("readTownSharedState: %v", err)
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
