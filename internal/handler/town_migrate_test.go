package handler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestMigrateTownJSONToDBAndExport(t *testing.T) {
	cfg, db := newTownTestFixture(t)

	// Seed some data via the file store
	fileStore := NewTownFileStore(cfg)
	_, err := fileStore.UpdateState(nil, func(state *townSharedState) error {
		state.OfficeMembers["coder"] = "selected"
		state.RecentWeights["coder"] = 5
		state.Runs = append(state.Runs, townSharedRun{
			ID:                  "run-migrate-1",
			Title:               "迁移测试",
			Prompt:              "测试迁移",
			Source:              "manual",
			Status:              "completed",
			PrimarySessionID:    "session-1",
			CreatedAt:           1000,
			UpdatedAt:           2000,
			ParticipantAgentIDs: []string{"coder"},
		})
		appendTownStateLog(state, townSharedLog{
			ID:    "log-1",
			RunID: "run-migrate-1",
			Title: "测试日志",
			Time:  1000,
			Type:  "system",
		})
		appendTownStateEvent(state, townSharedEvent{
			ID:    "event-1",
			Type:  "info",
			Title: "测试事件",
			Time:  1000,
			RunID: "run-migrate-1",
		})
		state.Instances = append(state.Instances, townSharedInstance{
			ID:      "inst-1",
			AgentID: "coder",
			RunID:   "run-migrate-1",
			Status:  "completed",
		})
		return nil
	})
	if err != nil {
		t.Fatalf("seed file state: %v", err)
	}

	// Run migration
	report, err := MigrateTownJSONToDB(cfg, db)
	if err != nil {
		t.Fatalf("MigrateTownJSONToDB: %v", err)
	}
	if report.Runs != 1 {
		t.Fatalf("expected 1 run migrated, got %d", report.Runs)
	}
	if report.Logs != 1 {
		t.Fatalf("expected 1 log migrated, got %d", report.Logs)
	}
	if report.Events != 1 {
		t.Fatalf("expected 1 event migrated, got %d", report.Events)
	}
	if report.Instances != 1 {
		t.Fatalf("expected 1 instance migrated, got %d", report.Instances)
	}
	if report.OfficeMembers != 1 {
		t.Fatalf("expected 1 office member, got %d", report.OfficeMembers)
	}
	if report.BackupPath == "" {
		t.Fatal("expected backup path to be set")
	}

	// Verify DB state
	dbStore := NewTownDBStore(db)
	dbState, err := dbStore.ReadState()
	if err != nil {
		t.Fatalf("ReadState from DB: %v", err)
	}
	if dbState.OfficeMembers["coder"] != "selected" {
		t.Fatalf("expected coder selected, got %q", dbState.OfficeMembers["coder"])
	}
	if len(dbState.Runs) != 1 || dbState.Runs[0].ID != "run-migrate-1" {
		t.Fatalf("unexpected runs: %#v", dbState.Runs)
	}

	// Export back to JSON
	if err := ExportTownDBToJSON(cfg, db); err != nil {
		t.Fatalf("ExportTownDBToJSON: %v", err)
	}

	// Verify exported JSON
	exported, err := os.ReadFile(townStateFilePath(cfg))
	if err != nil {
		t.Fatalf("read exported JSON: %v", err)
	}
	var exportedState townSharedState
	if err := json.Unmarshal(exported, &exportedState); err != nil {
		t.Fatalf("unmarshal exported JSON: %v", err)
	}
	if exportedState.OfficeMembers["coder"] != "selected" {
		t.Fatalf("exported state missing coder")
	}
	if len(exportedState.Runs) != 1 {
		t.Fatalf("exported state runs: %d", len(exportedState.Runs))
	}

	// Verify migration verification passed
	if !report.Verified {
		t.Fatalf("migration verification failed: %v", report.VerifyErrors)
	}
	if len(report.VerifyErrors) > 0 {
		t.Fatalf("unexpected verify errors: %v", report.VerifyErrors)
	}
}
