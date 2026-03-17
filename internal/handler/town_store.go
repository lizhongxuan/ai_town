package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// TownStore abstracts Town state persistence.
// Implementations must guarantee CAS semantics on version.
type TownStore interface {
	// ReadState returns the current town shared state.
	ReadState() (townSharedState, error)
	// UpdateState applies a mutation under CAS. If expectedVersion is non-nil
	// and does not match the current version, errTownVersionConflict is returned.
	UpdateState(expectedVersion *int64, apply func(state *townSharedState) error) (townSharedState, error)
}

// ---------------------------------------------------------------------------
// DB-backed TownStore
// ---------------------------------------------------------------------------

// TownDBStore persists town state in SQLite with CAS via version column.
type TownDBStore struct {
	db *sql.DB
}

// NewTownDBStore creates a DB-backed store. Call MigrateTownTables first.
func NewTownDBStore(db *sql.DB) *TownDBStore {
	return &TownDBStore{db: db}
}

// MigrateTownTables creates all town-related tables if they don't exist.
func MigrateTownTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS town_meta (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		version INTEGER NOT NULL DEFAULT 1,
		updated_at INTEGER NOT NULL DEFAULT 0
	);
	INSERT OR IGNORE INTO town_meta (id, version, updated_at) VALUES (1, 1, 0);

	CREATE TABLE IF NOT EXISTS town_office_member (
		agent_id TEXT PRIMARY KEY,
		membership TEXT NOT NULL DEFAULT 'unselected'
	);

	CREATE TABLE IF NOT EXISTS town_recent_weight (
		agent_id TEXT PRIMARY KEY,
		weight INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS town_run (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '',
		prompt TEXT NOT NULL DEFAULT '',
		source TEXT NOT NULL DEFAULT 'manual',
		status TEXT NOT NULL DEFAULT 'running',
		primary_session_id TEXT NOT NULL DEFAULT '',
		error_text TEXT NOT NULL DEFAULT '',
		participant_agent_ids TEXT NOT NULL DEFAULT '[]',
		spawned_sessions TEXT NOT NULL DEFAULT '[]',
		created_at INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_run_updated ON town_run(updated_at DESC);

	CREATE TABLE IF NOT EXISTS town_log (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL DEFAULT '',
		agent_id TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		detail TEXT NOT NULL DEFAULT '',
		time INTEGER NOT NULL DEFAULT 0,
		type TEXT NOT NULL DEFAULT 'system',
		seq INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_log_seq ON town_log(seq DESC);

	CREATE TABLE IF NOT EXISTS town_event (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL DEFAULT 'info',
		title TEXT NOT NULL DEFAULT '',
		detail TEXT NOT NULL DEFAULT '',
		time INTEGER NOT NULL DEFAULT 0,
		run_id TEXT NOT NULL DEFAULT '',
		scene_hint TEXT NOT NULL DEFAULT '',
		seq INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_event_seq ON town_event(seq DESC);

	CREATE TABLE IF NOT EXISTS town_instance (
		id TEXT PRIMARY KEY,
		agent_id TEXT NOT NULL DEFAULT '',
		run_id TEXT NOT NULL DEFAULT '',
		session_id TEXT NOT NULL DEFAULT '',
		zone_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'completed',
		seq INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_town_instance_seq ON town_instance(seq DESC);

	CREATE TABLE IF NOT EXISTS town_office_audit (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		payload TEXT NOT NULL DEFAULT '{}',
		created_at INTEGER NOT NULL DEFAULT 0
	);
	`
	_, err := db.Exec(schema)
	return err
}

// ReadState loads the full town state from DB tables.
func (s *TownDBStore) ReadState() (townSharedState, error) {
	state := defaultTownSharedState()

	// 1. Read meta
	err := s.db.QueryRow("SELECT version, updated_at FROM town_meta WHERE id = 1").
		Scan(&state.Version, &state.UpdatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return townSharedState{}, fmt.Errorf("town_meta read: %w", err)
	}
	if state.Version <= 0 {
		state.Version = 1
	}

	// 2. Office members
	rows, err := s.db.Query("SELECT agent_id, membership FROM town_office_member")
	if err != nil {
		return townSharedState{}, fmt.Errorf("town_office_member read: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var agentID, membership string
		if err := rows.Scan(&agentID, &membership); err != nil {
			continue
		}
		if membership != "" && membership != "unselected" {
			state.OfficeMembers[agentID] = membership
		}
	}

	// 3. Recent weights
	rows2, err := s.db.Query("SELECT agent_id, weight FROM town_recent_weight")
	if err != nil {
		return townSharedState{}, fmt.Errorf("town_recent_weight read: %w", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var agentID string
		var weight int
		if err := rows2.Scan(&agentID, &weight); err != nil {
			continue
		}
		state.RecentWeights[agentID] = weight
	}

	// 4. Runs (ordered by updated_at DESC, limited)
	runRows, err := s.db.Query(
		"SELECT id, title, prompt, source, status, primary_session_id, error_text, participant_agent_ids, spawned_sessions, created_at, updated_at FROM town_run ORDER BY updated_at DESC LIMIT ?",
		townMaxRuns,
	)
	if err != nil {
		return townSharedState{}, fmt.Errorf("town_run read: %w", err)
	}
	defer runRows.Close()
	for runRows.Next() {
		var run townSharedRun
		var participantJSON, spawnedJSON string
		if err := runRows.Scan(&run.ID, &run.Title, &run.Prompt, &run.Source, &run.Status,
			&run.PrimarySessionID, &run.Error, &participantJSON, &spawnedJSON,
			&run.CreatedAt, &run.UpdatedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(participantJSON), &run.ParticipantAgentIDs)
		if run.ParticipantAgentIDs == nil {
			run.ParticipantAgentIDs = []string{}
		}
		_ = json.Unmarshal([]byte(spawnedJSON), &run.SpawnedSessions)
		if run.SpawnedSessions == nil {
			run.SpawnedSessions = []townSharedSpawnedSession{}
		}
		state.Runs = append(state.Runs, run)
	}

	// 5. Logs (ordered by seq DESC, limited)
	logRows, err := s.db.Query(
		"SELECT id, run_id, agent_id, title, detail, time, type FROM town_log ORDER BY seq DESC LIMIT ?",
		townMaxLogs,
	)
	if err != nil {
		return townSharedState{}, fmt.Errorf("town_log read: %w", err)
	}
	defer logRows.Close()
	for logRows.Next() {
		var l townSharedLog
		if err := logRows.Scan(&l.ID, &l.RunID, &l.AgentID, &l.Title, &l.Detail, &l.Time, &l.Type); err != nil {
			continue
		}
		state.Logs = append(state.Logs, l)
	}

	// 6. Events (ordered by seq DESC, limited)
	eventRows, err := s.db.Query(
		"SELECT id, type, title, detail, time, run_id, scene_hint FROM town_event ORDER BY seq DESC LIMIT ?",
		townMaxEvents,
	)
	if err != nil {
		return townSharedState{}, fmt.Errorf("town_event read: %w", err)
	}
	defer eventRows.Close()
	for eventRows.Next() {
		var e townSharedEvent
		if err := eventRows.Scan(&e.ID, &e.Type, &e.Title, &e.Detail, &e.Time, &e.RunID, &e.SceneHint); err != nil {
			continue
		}
		state.Events = append(state.Events, e)
	}

	// 7. Instances (ordered by seq DESC, limited)
	instRows, err := s.db.Query(
		"SELECT id, agent_id, run_id, session_id, zone_id, status FROM town_instance ORDER BY seq DESC LIMIT ?",
		townMaxInstances,
	)
	if err != nil {
		return townSharedState{}, fmt.Errorf("town_instance read: %w", err)
	}
	defer instRows.Close()
	for instRows.Next() {
		var inst townSharedInstance
		if err := instRows.Scan(&inst.ID, &inst.AgentID, &inst.RunID, &inst.SessionID, &inst.ZoneID, &inst.Status); err != nil {
			continue
		}
		state.Instances = append(state.Instances, inst)
	}

	return state, nil
}

// UpdateState applies a mutation inside a DB transaction with CAS on version.
func (s *TownDBStore) UpdateState(expectedVersion *int64, apply func(state *townSharedState) error) (townSharedState, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return townSharedState{}, fmt.Errorf("town tx begin: %w", err)
	}
	defer tx.Rollback()

	// Read current version under transaction
	var currentVersion int64
	if err := tx.QueryRow("SELECT version FROM town_meta WHERE id = 1").Scan(&currentVersion); err != nil {
		return townSharedState{}, fmt.Errorf("town_meta read in tx: %w", err)
	}

	// CAS check
	if expectedVersion != nil && currentVersion != *expectedVersion {
		return townSharedState{}, errTownVersionConflict
	}

	// Read full state (within same tx for consistency)
	state, err := s.readStateInTx(tx)
	if err != nil {
		return townSharedState{}, err
	}

	// Apply mutation
	if err := apply(&state); err != nil {
		return townSharedState{}, err
	}

	// Sanitize
	sanitizeTownSharedState(&state)
	state.Version = currentVersion + 1
	state.UpdatedAt = time.Now().UnixMilli()

	// Write back all tables
	if err := s.writeStateInTx(tx, state); err != nil {
		return townSharedState{}, err
	}

	if err := tx.Commit(); err != nil {
		return townSharedState{}, fmt.Errorf("town tx commit: %w", err)
	}
	return state, nil
}

func (s *TownDBStore) readStateInTx(tx *sql.Tx) (townSharedState, error) {
	state := defaultTownSharedState()

	if err := tx.QueryRow("SELECT version, updated_at FROM town_meta WHERE id = 1").
		Scan(&state.Version, &state.UpdatedAt); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return townSharedState{}, err
	}

	// Office members
	rows, err := tx.Query("SELECT agent_id, membership FROM town_office_member")
	if err != nil {
		return townSharedState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var agentID, membership string
		if err := rows.Scan(&agentID, &membership); err != nil {
			continue
		}
		if membership != "" && membership != "unselected" {
			state.OfficeMembers[agentID] = membership
		}
	}

	// Recent weights
	rows2, err := tx.Query("SELECT agent_id, weight FROM town_recent_weight")
	if err != nil {
		return townSharedState{}, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var agentID string
		var weight int
		if err := rows2.Scan(&agentID, &weight); err != nil {
			continue
		}
		state.RecentWeights[agentID] = weight
	}

	// Runs
	runRows, err := tx.Query(
		"SELECT id, title, prompt, source, status, primary_session_id, error_text, participant_agent_ids, spawned_sessions, created_at, updated_at FROM town_run ORDER BY updated_at DESC LIMIT ?",
		townMaxRuns,
	)
	if err != nil {
		return townSharedState{}, err
	}
	defer runRows.Close()
	for runRows.Next() {
		var run townSharedRun
		var participantJSON, spawnedJSON string
		if err := runRows.Scan(&run.ID, &run.Title, &run.Prompt, &run.Source, &run.Status,
			&run.PrimarySessionID, &run.Error, &participantJSON, &spawnedJSON,
			&run.CreatedAt, &run.UpdatedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(participantJSON), &run.ParticipantAgentIDs)
		if run.ParticipantAgentIDs == nil {
			run.ParticipantAgentIDs = []string{}
		}
		_ = json.Unmarshal([]byte(spawnedJSON), &run.SpawnedSessions)
		if run.SpawnedSessions == nil {
			run.SpawnedSessions = []townSharedSpawnedSession{}
		}
		state.Runs = append(state.Runs, run)
	}

	// Logs
	logRows, err := tx.Query("SELECT id, run_id, agent_id, title, detail, time, type FROM town_log ORDER BY seq DESC LIMIT ?", townMaxLogs)
	if err != nil {
		return townSharedState{}, err
	}
	defer logRows.Close()
	for logRows.Next() {
		var l townSharedLog
		if err := logRows.Scan(&l.ID, &l.RunID, &l.AgentID, &l.Title, &l.Detail, &l.Time, &l.Type); err != nil {
			continue
		}
		state.Logs = append(state.Logs, l)
	}

	// Events
	eventRows, err := tx.Query("SELECT id, type, title, detail, time, run_id, scene_hint FROM town_event ORDER BY seq DESC LIMIT ?", townMaxEvents)
	if err != nil {
		return townSharedState{}, err
	}
	defer eventRows.Close()
	for eventRows.Next() {
		var e townSharedEvent
		if err := eventRows.Scan(&e.ID, &e.Type, &e.Title, &e.Detail, &e.Time, &e.RunID, &e.SceneHint); err != nil {
			continue
		}
		state.Events = append(state.Events, e)
	}

	// Instances
	instRows, err := tx.Query("SELECT id, agent_id, run_id, session_id, zone_id, status FROM town_instance ORDER BY seq DESC LIMIT ?", townMaxInstances)
	if err != nil {
		return townSharedState{}, err
	}
	defer instRows.Close()
	for instRows.Next() {
		var inst townSharedInstance
		if err := instRows.Scan(&inst.ID, &inst.AgentID, &inst.RunID, &inst.SessionID, &inst.ZoneID, &inst.Status); err != nil {
			continue
		}
		state.Instances = append(state.Instances, inst)
	}

	return state, nil
}

func (s *TownDBStore) writeStateInTx(tx *sql.Tx, state townSharedState) error {
	// 1. Update meta
	if _, err := tx.Exec("UPDATE town_meta SET version = ?, updated_at = ? WHERE id = 1",
		state.Version, state.UpdatedAt); err != nil {
		return fmt.Errorf("town_meta write: %w", err)
	}

	// 2. Office members: delete all, re-insert
	if _, err := tx.Exec("DELETE FROM town_office_member"); err != nil {
		return fmt.Errorf("town_office_member clear: %w", err)
	}
	for agentID, membership := range state.OfficeMembers {
		if membership == "" || membership == "unselected" {
			continue
		}
		if _, err := tx.Exec("INSERT INTO town_office_member (agent_id, membership) VALUES (?, ?)",
			agentID, membership); err != nil {
			return fmt.Errorf("town_office_member insert: %w", err)
		}
	}

	// 3. Recent weights: delete all, re-insert
	if _, err := tx.Exec("DELETE FROM town_recent_weight"); err != nil {
		return fmt.Errorf("town_recent_weight clear: %w", err)
	}
	for agentID, weight := range state.RecentWeights {
		if weight <= 0 {
			continue
		}
		if _, err := tx.Exec("INSERT INTO town_recent_weight (agent_id, weight) VALUES (?, ?)",
			agentID, weight); err != nil {
			return fmt.Errorf("town_recent_weight insert: %w", err)
		}
	}

	// 4. Runs: upsert each run
	for _, run := range state.Runs {
		participantJSON, _ := json.Marshal(run.ParticipantAgentIDs)
		spawnedJSON, _ := json.Marshal(run.SpawnedSessions)
		if _, err := tx.Exec(`INSERT INTO town_run (id, title, prompt, source, status, primary_session_id, error_text, participant_agent_ids, spawned_sessions, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET title=excluded.title, prompt=excluded.prompt, source=excluded.source, status=excluded.status,
				primary_session_id=excluded.primary_session_id, error_text=excluded.error_text,
				participant_agent_ids=excluded.participant_agent_ids, spawned_sessions=excluded.spawned_sessions,
				created_at=excluded.created_at, updated_at=excluded.updated_at`,
			run.ID, run.Title, run.Prompt, run.Source, run.Status,
			run.PrimarySessionID, run.Error, string(participantJSON), string(spawnedJSON),
			run.CreatedAt, run.UpdatedAt); err != nil {
			return fmt.Errorf("town_run upsert: %w", err)
		}
	}
	// Trim old runs beyond limit
	if len(state.Runs) > 0 {
		keepIDs := make([]string, 0, len(state.Runs))
		for _, run := range state.Runs {
			keepIDs = append(keepIDs, "'"+strings.ReplaceAll(run.ID, "'", "''")+"'")
		}
		if _, err := tx.Exec("DELETE FROM town_run WHERE id NOT IN (" + strings.Join(keepIDs, ",") + ")"); err != nil {
			return fmt.Errorf("town_run trim: %w", err)
		}
	}

	// 5. Logs: clear and re-insert (with seq for ordering)
	if _, err := tx.Exec("DELETE FROM town_log"); err != nil {
		return fmt.Errorf("town_log clear: %w", err)
	}
	for i, l := range state.Logs {
		if _, err := tx.Exec("INSERT INTO town_log (id, run_id, agent_id, title, detail, time, type, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			l.ID, l.RunID, l.AgentID, l.Title, l.Detail, l.Time, l.Type, len(state.Logs)-i); err != nil {
			return fmt.Errorf("town_log insert: %w", err)
		}
	}

	// 6. Events: clear and re-insert
	if _, err := tx.Exec("DELETE FROM town_event"); err != nil {
		return fmt.Errorf("town_event clear: %w", err)
	}
	for i, e := range state.Events {
		if _, err := tx.Exec("INSERT INTO town_event (id, type, title, detail, time, run_id, scene_hint, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			e.ID, e.Type, e.Title, e.Detail, e.Time, e.RunID, e.SceneHint, len(state.Events)-i); err != nil {
			return fmt.Errorf("town_event insert: %w", err)
		}
	}

	// 7. Instances: clear and re-insert
	if _, err := tx.Exec("DELETE FROM town_instance"); err != nil {
		return fmt.Errorf("town_instance clear: %w", err)
	}
	for i, inst := range state.Instances {
		if _, err := tx.Exec("INSERT INTO town_instance (id, agent_id, run_id, session_id, zone_id, status, seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
			inst.ID, inst.AgentID, inst.RunID, inst.SessionID, inst.ZoneID, inst.Status, len(state.Instances)-i); err != nil {
			return fmt.Errorf("town_instance insert: %w", err)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// File-backed TownStore (legacy fallback)
// ---------------------------------------------------------------------------

// TownFileStore wraps the existing file-based state management.
type TownFileStore struct {
	cfg *config.Config
}

// NewTownFileStore creates a file-backed store using the existing JSON file.
func NewTownFileStore(cfg *config.Config) *TownFileStore {
	return &TownFileStore{cfg: cfg}
}

// ReadState reads from town_state.json.
func (s *TownFileStore) ReadState() (townSharedState, error) {
	return readTownSharedState(s.cfg)
}

// UpdateState applies a mutation with file-level CAS.
func (s *TownFileStore) UpdateState(expectedVersion *int64, apply func(state *townSharedState) error) (townSharedState, error) {
	return updateTownSharedState(s.cfg, expectedVersion, apply)
}
