package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// MigrateTownJSONToDB imports town_state.json into the DB store.
// It backs up the JSON file first, then imports all data in a single transaction.
// Returns the number of records imported and any error.
func MigrateTownJSONToDB(cfg *config.Config, db *sql.DB) (MigrationReport, error) {
	report := MigrationReport{}

	// 1. Read existing JSON state
	state, err := readTownSharedStateUnlocked(cfg)
	if err != nil {
		return report, fmt.Errorf("读取 town_state.json 失败: %w", err)
	}

	// 2. Backup JSON file
	srcPath := townStateFilePath(cfg)
	if _, statErr := os.Stat(srcPath); statErr == nil {
		backupPath := fmt.Sprintf("%s.bak.%d", srcPath, time.Now().UnixMilli())
		raw, readErr := os.ReadFile(srcPath)
		if readErr != nil {
			return report, fmt.Errorf("备份 town_state.json 失败: %w", readErr)
		}
		if writeErr := os.WriteFile(backupPath, raw, 0o644); writeErr != nil {
			return report, fmt.Errorf("写入备份文件失败: %w", writeErr)
		}
		report.BackupPath = backupPath
	}

	// 3. Ensure tables exist
	if err := MigrateTownTables(db); err != nil {
		return report, fmt.Errorf("创建 Town 表失败: %w", err)
	}

	// 4. Import into DB via store
	store := NewTownDBStore(db)
	tx, err := db.Begin()
	if err != nil {
		return report, fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback()

	// Write meta
	if _, err := tx.Exec("UPDATE town_meta SET version = ?, updated_at = ? WHERE id = 1",
		state.Version, state.UpdatedAt); err != nil {
		return report, fmt.Errorf("写入 town_meta 失败: %w", err)
	}
	_ = store // store is used for type reference only; we write directly in tx

	// Write office members
	if _, err := tx.Exec("DELETE FROM town_office_member"); err != nil {
		return report, err
	}
	for agentID, membership := range state.OfficeMembers {
		if membership == "" || membership == "unselected" {
			continue
		}
		if _, err := tx.Exec("INSERT INTO town_office_member (agent_id, membership) VALUES (?, ?)",
			agentID, membership); err != nil {
			return report, err
		}
		report.OfficeMembers++
	}

	// Write recent weights
	if _, err := tx.Exec("DELETE FROM town_recent_weight"); err != nil {
		return report, err
	}
	for agentID, weight := range state.RecentWeights {
		if weight <= 0 {
			continue
		}
		if _, err := tx.Exec("INSERT INTO town_recent_weight (agent_id, weight) VALUES (?, ?)",
			agentID, weight); err != nil {
			return report, err
		}
		report.RecentWeights++
	}

	// Write runs
	if _, err := tx.Exec("DELETE FROM town_run"); err != nil {
		return report, err
	}
	for _, run := range state.Runs {
		participantJSON, _ := json.Marshal(run.ParticipantAgentIDs)
		spawnedJSON, _ := json.Marshal(run.SpawnedSessions)
		if _, err := tx.Exec(`INSERT INTO town_run (id, title, prompt, source, status, primary_session_id, error_text, participant_agent_ids, spawned_sessions, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			run.ID, run.Title, run.Prompt, run.Source, run.Status,
			run.PrimarySessionID, run.Error, string(participantJSON), string(spawnedJSON),
			run.CreatedAt, run.UpdatedAt); err != nil {
			return report, err
		}
		report.Runs++
	}

	// Write logs
	if _, err := tx.Exec("DELETE FROM town_log"); err != nil {
		return report, err
	}
	for i, l := range state.Logs {
		if _, err := tx.Exec("INSERT INTO town_log (id, run_id, agent_id, title, detail, time, type, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			l.ID, l.RunID, l.AgentID, l.Title, l.Detail, l.Time, l.Type, len(state.Logs)-i); err != nil {
			return report, err
		}
		report.Logs++
	}

	// Write events
	if _, err := tx.Exec("DELETE FROM town_event"); err != nil {
		return report, err
	}
	for i, e := range state.Events {
		if _, err := tx.Exec("INSERT INTO town_event (id, type, title, detail, time, run_id, scene_hint, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			e.ID, e.Type, e.Title, e.Detail, e.Time, e.RunID, e.SceneHint, len(state.Events)-i); err != nil {
			return report, err
		}
		report.Events++
	}

	// Write instances
	if _, err := tx.Exec("DELETE FROM town_instance"); err != nil {
		return report, err
	}
	for i, inst := range state.Instances {
		if _, err := tx.Exec("INSERT INTO town_instance (id, agent_id, run_id, session_id, zone_id, status, seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
			inst.ID, inst.AgentID, inst.RunID, inst.SessionID, inst.ZoneID, inst.Status, len(state.Instances)-i); err != nil {
			return report, err
		}
		report.Instances++
	}

	if err := tx.Commit(); err != nil {
		return report, fmt.Errorf("提交事务失败: %w", err)
	}

	report.Version = state.Version

	// 5. Post-migration verification: count check + version check
	verifyErrors := verifyTownMigration(db, state, report)
	if len(verifyErrors) > 0 {
		report.VerifyErrors = verifyErrors
	} else {
		report.Verified = true
	}

	return report, nil
}

// ExportTownDBToJSON exports the DB state back to a JSON file for rollback.
func ExportTownDBToJSON(cfg *config.Config, db *sql.DB) error {
	store := NewTownDBStore(db)
	state, err := store.ReadState()
	if err != nil {
		return fmt.Errorf("读取 DB 状态失败: %w", err)
	}

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化状态失败: %w", err)
	}

	target := townStateFilePath(cfg)
	tmp := fmt.Sprintf("%s.tmp", target)
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return fmt.Errorf("写入临时文件失败: %w", err)
	}
	return os.Rename(tmp, target)
}

// RestoreTownJSONFromBackup restores a backup JSON file as the active state file.
func RestoreTownJSONFromBackup(cfg *config.Config, backupPath string) error {
	raw, err := os.ReadFile(backupPath)
	if err != nil {
		return fmt.Errorf("读取备份文件失败: %w", err)
	}
	// Validate it's valid JSON
	var state townSharedState
	if err := json.Unmarshal(raw, &state); err != nil {
		return fmt.Errorf("备份文件格式无效: %w", err)
	}
	target := townStateFilePath(cfg)
	return os.WriteFile(target, raw, 0o644)
}

// MigrationReport summarizes a JSON -> DB migration.
type MigrationReport struct {
	Version       int64  `json:"version"`
	BackupPath    string `json:"backupPath,omitempty"`
	OfficeMembers int    `json:"officeMembers"`
	RecentWeights int    `json:"recentWeights"`
	Runs          int    `json:"runs"`
	Logs          int    `json:"logs"`
	Events        int    `json:"events"`
	Instances     int    `json:"instances"`
	Verified      bool   `json:"verified"`
	VerifyErrors  []string `json:"verifyErrors,omitempty"`
}

// verifyTownMigration checks that DB counts match the source state after migration.
func verifyTownMigration(db *sql.DB, source townSharedState, report MigrationReport) []string {
	var errs []string

	// Version check
	var dbVersion int64
	if err := db.QueryRow("SELECT version FROM town_meta WHERE id = 1").Scan(&dbVersion); err != nil {
		errs = append(errs, fmt.Sprintf("version 校验失败: %v", err))
	} else if dbVersion != source.Version {
		errs = append(errs, fmt.Sprintf("version 不一致: 源=%d, DB=%d", source.Version, dbVersion))
	}

	// Count checks
	checks := []struct {
		table    string
		expected int
	}{
		{"town_office_member", report.OfficeMembers},
		{"town_recent_weight", report.RecentWeights},
		{"town_run", report.Runs},
		{"town_log", report.Logs},
		{"town_event", report.Events},
		{"town_instance", report.Instances},
	}
	for _, chk := range checks {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + chk.table).Scan(&count); err != nil {
			errs = append(errs, fmt.Sprintf("%s 计数查询失败: %v", chk.table, err))
		} else if count != chk.expected {
			errs = append(errs, fmt.Sprintf("%s 计数不一致: 期望=%d, 实际=%d", chk.table, chk.expected, count))
		}
	}

	return errs
}

// TownMigrateHandler exposes JSON <-> DB migration as an API endpoint.
func TownMigrateHandler(cfg *config.Config, db *sql.DB) func(c interface{ JSON(int, any) }) {
	return func(c interface{ JSON(int, any) }) {
		report, err := MigrateTownJSONToDB(cfg, db)
		if err != nil {
			c.JSON(500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(200, map[string]any{"ok": true, "report": report})
	}
}

// TownExportHandler exposes DB -> JSON export as an API endpoint.
func TownExportHandler(cfg *config.Config, db *sql.DB) func(c interface{ JSON(int, any) }) {
	return func(c interface{ JSON(int, any) }) {
		if err := ExportTownDBToJSON(cfg, db); err != nil {
			c.JSON(500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		target := filepath.Join(cfg.DataDir, "town_state.json")
		c.JSON(200, map[string]any{"ok": true, "path": target})
	}
}

// TownMigrateGin is a Gin-compatible handler for JSON -> DB migration.
func TownMigrateGin(cfg *config.Config, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		report, err := MigrateTownJSONToDB(cfg, db)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"ok": true, "report": report})
	}
}

// TownExportGin is a Gin-compatible handler for DB -> JSON export.
func TownExportGin(cfg *config.Config, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := ExportTownDBToJSON(cfg, db); err != nil {
			c.JSON(500, gin.H{"ok": false, "error": err.Error()})
			return
		}
		target := filepath.Join(cfg.DataDir, "town_state.json")
		c.JSON(200, gin.H{"ok": true, "path": target})
	}
}
