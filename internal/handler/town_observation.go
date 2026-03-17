package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// ---------------------------------------------------------------------------
// T-009: Plan / Span / Action observation model
// ---------------------------------------------------------------------------

// MigrateTownObservationTables creates observation-related tables.
func MigrateTownObservationTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS town_run_plan (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL DEFAULT '',
		summary TEXT NOT NULL DEFAULT '',
		execution_mode TEXT NOT NULL DEFAULT '',
		raw_plan TEXT NOT NULL DEFAULT '',
		selected_reasons TEXT NOT NULL DEFAULT '{}',
		rejected_reasons TEXT NOT NULL DEFAULT '{}',
		created_at INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_run_plan_run ON town_run_plan(run_id);

	CREATE TABLE IF NOT EXISTS town_subtask (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL DEFAULT '',
		plan_id TEXT NOT NULL DEFAULT '',
		parent_id TEXT NOT NULL DEFAULT '',
		span_id TEXT NOT NULL DEFAULT '',
		parent_span_id TEXT NOT NULL DEFAULT '',
		task_id TEXT NOT NULL DEFAULT '',
		agent_id TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'pending',
		execution_mode TEXT NOT NULL DEFAULT '',
		started_at INTEGER NOT NULL DEFAULT 0,
		completed_at INTEGER NOT NULL DEFAULT 0,
		duration_ms INTEGER NOT NULL DEFAULT 0,
		seq INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_subtask_run ON town_subtask(run_id);
	CREATE INDEX IF NOT EXISTS idx_town_subtask_span ON town_subtask(span_id);

	CREATE TABLE IF NOT EXISTS town_execution_edge (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		run_id TEXT NOT NULL DEFAULT '',
		from_subtask_id TEXT NOT NULL DEFAULT '',
		to_subtask_id TEXT NOT NULL DEFAULT '',
		edge_type TEXT NOT NULL DEFAULT 'sequential'
	);
	CREATE INDEX IF NOT EXISTS idx_town_edge_run ON town_execution_edge(run_id);

	CREATE TABLE IF NOT EXISTS town_action_call (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL DEFAULT '',
		subtask_id TEXT NOT NULL DEFAULT '',
		span_id TEXT NOT NULL DEFAULT '',
		agent_id TEXT NOT NULL DEFAULT '',
		call_type TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL DEFAULT '',
		raw_input TEXT NOT NULL DEFAULT '',
		raw_output TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'pending',
		started_at INTEGER NOT NULL DEFAULT 0,
		completed_at INTEGER NOT NULL DEFAULT 0,
		duration_ms INTEGER NOT NULL DEFAULT 0,
		seq INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_action_run ON town_action_call(run_id);
	CREATE INDEX IF NOT EXISTS idx_town_action_subtask ON town_action_call(subtask_id);
	`
	_, err := db.Exec(schema)
	return err
}

// ---------------------------------------------------------------------------
// Observation data types
// ---------------------------------------------------------------------------

// TownRunPlan represents a captured plan for a run.
type TownRunPlan struct {
	ID              string            `json:"id"`
	RunID           string            `json:"runId"`
	Summary         string            `json:"summary"`
	ExecutionMode   string            `json:"executionMode"`
	RawPlan         string            `json:"rawPlan,omitempty"`
	SelectedReasons map[string]string `json:"selectedReasons,omitempty"`
	RejectedReasons map[string]string `json:"rejectedReasons,omitempty"`
	CreatedAt       int64             `json:"createdAt"`
}

// TownSubtask represents a subtask within a run's execution plan.
type TownSubtask struct {
	ID            string `json:"id"`
	RunID         string `json:"runId"`
	PlanID        string `json:"planId"`
	ParentID      string `json:"parentId,omitempty"`
	SpanID        string `json:"spanId"`
	ParentSpanID  string `json:"parentSpanId,omitempty"`
	TaskID        string `json:"taskId"`
	AgentID       string `json:"agentId"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	ExecutionMode string `json:"executionMode,omitempty"`
	StartedAt     int64  `json:"startedAt,omitempty"`
	CompletedAt   int64  `json:"completedAt,omitempty"`
	DurationMs    int64  `json:"durationMs,omitempty"`
}

// TownExecutionEdge represents a dependency edge between subtasks.
type TownExecutionEdge struct {
	ID            int64  `json:"id"`
	RunID         string `json:"runId"`
	FromSubtaskID string `json:"fromSubtaskId"`
	ToSubtaskID   string `json:"toSubtaskId"`
	EdgeType      string `json:"edgeType"`
}

// TownActionCall represents a command/skill/tool call within a subtask.
type TownActionCall struct {
	ID          string `json:"id"`
	RunID       string `json:"runId"`
	SubtaskID   string `json:"subtaskId"`
	SpanID      string `json:"spanId"`
	AgentID     string `json:"agentId"`
	CallType    string `json:"callType"`
	Name        string `json:"name"`
	RawInput    string `json:"rawInput,omitempty"`
	RawOutput   string `json:"rawOutput,omitempty"`
	Status      string `json:"status"`
	StartedAt   int64  `json:"startedAt,omitempty"`
	CompletedAt int64  `json:"completedAt,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
}

// TownRunDetails is the response for GET /runs/:id/details
type TownRunDetails struct {
	RunID    string              `json:"runId"`
	Plan     *TownRunPlan        `json:"plan"`
	Subtasks []TownSubtask       `json:"subtasks"`
	Edges    []TownExecutionEdge `json:"edges"`
	Actions  []TownActionCall    `json:"actions"`
}

// TownRunReplay is the response for GET /runs/:id/replay
type TownRunReplay struct {
	RunID    string             `json:"runId"`
	Run      *TownSnapshotRun   `json:"run"`
	Logs     []TownSnapshotLog  `json:"logs"`
	Subtasks []TownSubtask      `json:"subtasks"`
	Actions  []TownActionCall   `json:"actions"`
}

// ---------------------------------------------------------------------------
// API Handlers
// ---------------------------------------------------------------------------

// GetTownRunDetails returns plan, subtasks, edges, and actions for a run.
// GET /api/town/runs/:id/details?section=plan,subtasks,edges,actions
func GetTownRunDetails(cfg *config.Config, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled", "error": "AI 小镇功能未启用"})
			return
		}
		runID := strings.TrimSpace(c.Param("id"))
		if runID == "" {
			townError(c, http.StatusBadRequest, "town.run.run_id_required", "缺少 runId")
			return
		}

		sections := parseSections(c.Query("section"))
		details := TownRunDetails{RunID: runID}

		if sections["plan"] || sections["all"] {
			plan, err := loadRunPlan(db, runID)
			if err == nil {
				details.Plan = plan
			}
		}
		if sections["subtasks"] || sections["all"] {
			subtasks, _ := loadRunSubtasks(db, runID)
			details.Subtasks = subtasks
		}
		if sections["edges"] || sections["all"] {
			edges, _ := loadRunEdges(db, runID)
			details.Edges = edges
		}
		if sections["actions"] || sections["all"] {
			actions, _ := loadRunActions(db, runID)
			details.Actions = actions
		}

		c.JSON(http.StatusOK, gin.H{"ok": true, "details": details})
	}
}

// GetTownRunReplay returns replay data for a run (logs + observation).
// GET /api/town/runs/:id/replay
func GetTownRunReplay(cfg *config.Config, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled", "error": "AI 小镇功能未启用"})
			return
		}
		runID := strings.TrimSpace(c.Param("id"))
		if runID == "" {
			townError(c, http.StatusBadRequest, "town.run.run_id_required", "缺少 runId")
			return
		}

		// Load run from store
		state, err := townStore.ReadState()
		if err != nil {
			townError(c, http.StatusInternalServerError, "town.state_read_failed", err.Error())
			return
		}

		var foundRun *TownSnapshotRun
		for _, run := range state.Runs {
			if run.ID == runID {
				snap := toTownSnapshotRun(run)
				foundRun = &snap
				break
			}
		}
		if foundRun == nil {
			townError(c, http.StatusNotFound, "town.run.not_found", "Run 不存在")
			return
		}

		// Load logs for this run
		logs := make([]TownSnapshotLog, 0)
		for _, l := range state.Logs {
			if l.RunID == runID {
				logs = append(logs, toTownSnapshotLog(l))
			}
		}

		// Load observation data
		subtasks, _ := loadRunSubtasks(db, runID)
		actions, _ := loadRunActions(db, runID)

		c.JSON(http.StatusOK, gin.H{
			"ok": true,
			"replay": TownRunReplay{
				RunID:    runID,
				Run:      foundRun,
				Logs:     logs,
				Subtasks: subtasks,
				Actions:  actions,
			},
		})
	}
}

// IngestTownObservationEvent receives observation events from OpenClaw.
// POST /api/town/observation/events
func IngestTownObservationEvent(cfg *config.Config, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled"})
			return
		}

		var payload struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			townError(c, http.StatusBadRequest, "town.observation.invalid", "无效的观测事件")
			return
		}

		switch payload.Type {
		case "plan.captured":
			var plan TownRunPlan
			if err := json.Unmarshal(payload.Data, &plan); err != nil {
				townError(c, http.StatusBadRequest, "town.observation.invalid_plan", err.Error())
				return
			}
			if err := upsertRunPlan(db, plan); err != nil {
				townError(c, http.StatusInternalServerError, "town.observation.write_failed", err.Error())
				return
			}
			RecordTownRunPlanCaptured()

		case "subtask.started", "subtask.completed":
			var subtask TownSubtask
			if err := json.Unmarshal(payload.Data, &subtask); err != nil {
				townError(c, http.StatusBadRequest, "town.observation.invalid_subtask", err.Error())
				return
			}
			if err := upsertSubtask(db, subtask); err != nil {
				townError(c, http.StatusInternalServerError, "town.observation.write_failed", err.Error())
				return
			}

		case "action.started", "action.completed":
			var action TownActionCall
			if err := json.Unmarshal(payload.Data, &action); err != nil {
				townError(c, http.StatusBadRequest, "town.observation.invalid_action", err.Error())
				return
			}
			if err := upsertActionCall(db, action); err != nil {
				townError(c, http.StatusInternalServerError, "town.observation.write_failed", err.Error())
				return
			}

		default:
			townError(c, http.StatusBadRequest, "town.observation.unknown_type", fmt.Sprintf("未知事件类型: %s", payload.Type))
			return
		}

		InvalidateTownSnapshotCache()
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

func parseSections(raw string) map[string]bool {
	result := map[string]bool{}
	if strings.TrimSpace(raw) == "" {
		result["all"] = true
		return result
	}
	for _, s := range strings.Split(raw, ",") {
		result[strings.TrimSpace(s)] = true
	}
	return result
}

func loadRunPlan(db *sql.DB, runID string) (*TownRunPlan, error) {
	row := db.QueryRow("SELECT id, run_id, summary, execution_mode, raw_plan, selected_reasons, rejected_reasons, created_at FROM town_run_plan WHERE run_id = ? LIMIT 1", runID)
	var p TownRunPlan
	var selectedJSON, rejectedJSON string
	err := row.Scan(&p.ID, &p.RunID, &p.Summary, &p.ExecutionMode, &p.RawPlan, &selectedJSON, &rejectedJSON, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(selectedJSON), &p.SelectedReasons)
	_ = json.Unmarshal([]byte(rejectedJSON), &p.RejectedReasons)
	return &p, nil
}

func loadRunSubtasks(db *sql.DB, runID string) ([]TownSubtask, error) {
	rows, err := db.Query("SELECT id, run_id, plan_id, parent_id, span_id, parent_span_id, task_id, agent_id, title, status, execution_mode, started_at, completed_at, duration_ms FROM town_subtask WHERE run_id = ? ORDER BY seq ASC", runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []TownSubtask
	for rows.Next() {
		var s TownSubtask
		if err := rows.Scan(&s.ID, &s.RunID, &s.PlanID, &s.ParentID, &s.SpanID, &s.ParentSpanID, &s.TaskID, &s.AgentID, &s.Title, &s.Status, &s.ExecutionMode, &s.StartedAt, &s.CompletedAt, &s.DurationMs); err != nil {
			continue
		}
		result = append(result, s)
	}
	return result, nil
}

func loadRunEdges(db *sql.DB, runID string) ([]TownExecutionEdge, error) {
	rows, err := db.Query("SELECT id, run_id, from_subtask_id, to_subtask_id, edge_type FROM town_execution_edge WHERE run_id = ?", runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []TownExecutionEdge
	for rows.Next() {
		var e TownExecutionEdge
		if err := rows.Scan(&e.ID, &e.RunID, &e.FromSubtaskID, &e.ToSubtaskID, &e.EdgeType); err != nil {
			continue
		}
		result = append(result, e)
	}
	return result, nil
}

func loadRunActions(db *sql.DB, runID string) ([]TownActionCall, error) {
	rows, err := db.Query("SELECT id, run_id, subtask_id, span_id, agent_id, call_type, name, raw_input, raw_output, status, started_at, completed_at, duration_ms FROM town_action_call WHERE run_id = ? ORDER BY seq ASC", runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []TownActionCall
	for rows.Next() {
		var a TownActionCall
		if err := rows.Scan(&a.ID, &a.RunID, &a.SubtaskID, &a.SpanID, &a.AgentID, &a.CallType, &a.Name, &a.RawInput, &a.RawOutput, &a.Status, &a.StartedAt, &a.CompletedAt, &a.DurationMs); err != nil {
			continue
		}
		result = append(result, a)
	}
	return result, nil
}

func upsertRunPlan(db *sql.DB, p TownRunPlan) error {
	if p.ID == "" {
		p.ID = fmt.Sprintf("plan-%d", time.Now().UnixMilli())
	}
	if p.CreatedAt == 0 {
		p.CreatedAt = time.Now().UnixMilli()
	}
	selectedJSON, _ := json.Marshal(p.SelectedReasons)
	rejectedJSON, _ := json.Marshal(p.RejectedReasons)
	_, err := db.Exec(`INSERT INTO town_run_plan (id, run_id, summary, execution_mode, raw_plan, selected_reasons, rejected_reasons, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, execution_mode=excluded.execution_mode, raw_plan=excluded.raw_plan, selected_reasons=excluded.selected_reasons, rejected_reasons=excluded.rejected_reasons`,
		p.ID, p.RunID, p.Summary, p.ExecutionMode, p.RawPlan, string(selectedJSON), string(rejectedJSON), p.CreatedAt)
	return err
}

func upsertSubtask(db *sql.DB, s TownSubtask) error {
	if s.DurationMs == 0 && s.StartedAt > 0 && s.CompletedAt > 0 {
		s.DurationMs = s.CompletedAt - s.StartedAt
	}
	_, err := db.Exec(`INSERT INTO town_subtask (id, run_id, plan_id, parent_id, span_id, parent_span_id, task_id, agent_id, title, status, execution_mode, started_at, completed_at, duration_ms, seq)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at, duration_ms=excluded.duration_ms`,
		s.ID, s.RunID, s.PlanID, s.ParentID, s.SpanID, s.ParentSpanID, s.TaskID, s.AgentID, s.Title, s.Status, s.ExecutionMode, s.StartedAt, s.CompletedAt, s.DurationMs, time.Now().UnixMilli())
	return err
}

func upsertActionCall(db *sql.DB, a TownActionCall) error {
	if a.DurationMs == 0 && a.StartedAt > 0 && a.CompletedAt > 0 {
		a.DurationMs = a.CompletedAt - a.StartedAt
	}
	_, err := db.Exec(`INSERT INTO town_action_call (id, run_id, subtask_id, span_id, agent_id, call_type, name, raw_input, raw_output, status, started_at, completed_at, duration_ms, seq)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET raw_output=excluded.raw_output, status=excluded.status, completed_at=excluded.completed_at, duration_ms=excluded.duration_ms`,
		a.ID, a.RunID, a.SubtaskID, a.SpanID, a.AgentID, a.CallType, a.Name, a.RawInput, a.RawOutput, a.Status, a.StartedAt, a.CompletedAt, a.DurationMs, time.Now().UnixMilli())
	return err
}
