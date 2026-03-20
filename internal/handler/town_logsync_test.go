package handler

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/quick"

	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// ---------------------------------------------------------------------------
// Mock TownStore for testing (in-memory, no DB needed)
// ---------------------------------------------------------------------------

type mockTownStore struct {
	mu    sync.Mutex
	state townSharedState
}

func (m *mockTownStore) ReadState() (townSharedState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state, nil
}

func (m *mockTownStore) UpdateState(expectedVersion *int64, apply func(state *townSharedState) error) (townSharedState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if expectedVersion != nil && *expectedVersion != m.state.Version {
		return m.state, errTownVersionConflict
	}
	if err := apply(&m.state); err != nil {
		return m.state, err
	}
	m.state.Version++
	return m.state, nil
}

// ---------------------------------------------------------------------------
// Test fixture: temp openclaw dir + config + mock store + syncer
// ---------------------------------------------------------------------------

func newLogSyncTestFixture(t *testing.T) (*townLogSyncer, *mockTownStore) {
	t.Helper()

	root := t.TempDir()
	openClawDir := filepath.Join(root, "openclaw")

	// Create agent directories with session files so buildSessionCache / loadAgentIDs work
	for _, agentID := range []string{"main", "coder", "researcher", "writer"} {
		sessDir := filepath.Join(openClawDir, "agents", agentID, "sessions")
		if err := os.MkdirAll(sessDir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", sessDir, err)
		}
	}

	// Write openclaw.json with agents list
	ocJSON := map[string]any{
		"agents": map[string]any{
			"default": "main",
			"list": []any{
				map[string]any{"id": "main", "name": "Main", "default": true},
				map[string]any{"id": "coder", "name": "Coder"},
				map[string]any{"id": "researcher", "name": "Researcher"},
				map[string]any{"id": "writer", "name": "Writer"},
			},
		},
	}
	raw, err := json.Marshal(ocJSON)
	if err != nil {
		t.Fatalf("marshal openclaw.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(openClawDir, "openclaw.json"), raw, 0o644); err != nil {
		t.Fatalf("write openclaw.json: %v", err)
	}

	enabled := true
	cfg := &config.Config{
		DataDir:       filepath.Join(root, "data"),
		OpenClawDir:   openClawDir,
		TownV3Enabled: &enabled,
	}

	mock := &mockTownStore{state: townSharedState{}}
	// Set the package-level townStore so syncer methods can call it
	townStore = mock

	syncer := &townLogSyncer{
		cfg:          cfg,
		hub:          nil, // hub is only for WS broadcast, nil is safe in tests
		agentStates:  make(map[string]*agentLiveState),
		sessionCache: make(map[string]string),
		logDir:       filepath.Join(root, "logs"),
		idleTimeout:  10 * 60 * 1e9, // 10 min
	}

	return syncer, mock
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// validAgentIDs returns the non-default agent IDs used in the test fixture.
func validAgentIDs() []string {
	return []string{"coder", "researcher", "writer"}
}

// embeddedSignals lists the signals processEmbeddedSignal recognises.
var embeddedSignals = []string{
	"embedded run start",
	"embedded run prompt start",
	"embedded run tool start",
	"embedded run tool end",
	"embedded run prompt end",
	"embedded run done",
}

// expectedStateForSignal returns the expected agentState after a given signal.
func expectedStateForSignal(signal, toolName string) string {
	switch signal {
	case "embedded run start":
		return "executing"
	case "embedded run prompt start":
		return "researching"
	case "embedded run tool start":
		if toolName != "" {
			for _, kw := range []string{"edit", "write", "replace", "multi_replace"} {
				if strings.Contains(toolName, kw) {
					return "editing"
				}
			}
		}
		return "executing"
	case "embedded run tool end":
		return "executing"
	case "embedded run prompt end":
		return "executing"
	case "embedded run done":
		return "executing"
	default:
		return ""
	}
}

// buildEmbeddedLogLine constructs a JSON log line for agent/embedded subsystem.
// The runID is placed in the message field as runId=<value>.
// If includeAgentInRunID is true, the runId uses the agent:X:... format for strategy-1 identification.
func buildEmbeddedLogLine(agentID, signal, runID, toolName string) string {
	msg := signal
	if runID != "" {
		msg += fmt.Sprintf(" runId=%s", runID)
	}
	if toolName != "" {
		msg += fmt.Sprintf(" tool=%s", toolName)
	}
	logData := map[string]interface{}{
		"_meta": map[string]interface{}{
			"name": `{"subsystem":"agent/embedded"}`,
		},
		"0": "",
		"1": msg,
	}
	raw, _ := json.Marshal(logData)
	return string(raw)
}

// buildDiagnosticLogLine constructs a JSON log line for diagnostic subsystem.
func buildDiagnosticLogLine(agentID, signal string, durationMs int) string {
	msg := fmt.Sprintf("lane=session:agent:%s:sess1 %s", agentID, signal)
	if durationMs > 0 {
		msg += fmt.Sprintf(" durationMs=%d", durationMs)
	}
	logData := map[string]interface{}{
		"_meta": map[string]interface{}{
			"name": "diagnostic",
		},
		"0": "",
		"1": msg,
	}
	raw, _ := json.Marshal(logData)
	return string(raw)
}

// ---------------------------------------------------------------------------
// Property 1: processLogLine correctly updates agentStates for embedded signals
// **Validates: Requirements 1.1**
// ---------------------------------------------------------------------------

func TestProperty_ProcessLogLine_EmbeddedSignals(t *testing.T) {
	syncer, _ := newLogSyncTestFixture(t)

	// The implementation's "embedded run start" case requires the full message
	// to NOT contain "tool", "prompt", or "agent". So we test each signal type
	// with appropriate parameters that match the implementation's matching logic.
	//
	// Signals that carry tool names: "embedded run tool start", "embedded run tool end"
	// Signals that never carry tool names: "embedded run start", "embedded run prompt start",
	//   "embedded run prompt end", "embedded run done"
	//
	// The runId format "agent:X:..." contains "agent", which blocks the
	// "embedded run start" case. For that signal, we use a plain runId and
	// rely on sessionCache (strategy 2) for agent identification.

	type testCase struct {
		signal  string
		tools   []string // tool names to pick from (empty string = no tool)
		useAgentRunID bool // whether runId can use agent:X:... format
	}

	cases := []testCase{
		// "embedded run start" — must NOT have "tool", "prompt", or "agent" in message
		{signal: "embedded run start", tools: []string{""}, useAgentRunID: false},
		// "embedded run prompt start/end" — no tool, runId can have agent:
		{signal: "embedded run prompt start", tools: []string{""}, useAgentRunID: true},
		{signal: "embedded run prompt end", tools: []string{""}, useAgentRunID: true},
		// "embedded run tool start" — has tool name
		{signal: "embedded run tool start", tools: []string{"read_file", "edit_file", "write_file", "replace_in_file", "multi_replace", "search"}, useAgentRunID: true},
		// "embedded run tool end" — may or may not have tool
		{signal: "embedded run tool end", tools: []string{"", "read_file"}, useAgentRunID: true},
		// "embedded run done"
		{signal: "embedded run done", tools: []string{""}, useAgentRunID: true},
	}

	f := func(agentIdx uint8, caseIdx uint8, toolIdx uint8) bool {
		agents := validAgentIDs()
		agentID := agents[int(agentIdx)%len(agents)]
		tc := cases[int(caseIdx)%len(cases)]
		toolName := tc.tools[int(toolIdx)%len(tc.tools)]

		var runID string
		if tc.useAgentRunID {
			runID = fmt.Sprintf("agent:%s:run-%d", agentID, agentIdx)
		} else {
			// Use a plain runId and set up sessionCache for identification
			runID = fmt.Sprintf("run-%s-%d", agentID, agentIdx)
			sessionKey := fmt.Sprintf("sess-%s-%d", agentID, agentIdx)
			syncer.mu.Lock()
			syncer.sessionCache[sessionKey] = agentID
			syncer.mu.Unlock()
			// Also add sessionId to the message for strategy-2 lookup
			// Actually, identifyAgent uses the raw JSON content for strategy-3.
			// For "embedded run start" with plain runId, strategy-1 won't match,
			// strategy-2 needs sessionId, strategy-3 does string matching.
			// The raw JSON will contain agentID in the runId value "run-coder-5",
			// so strategy-3 string matching will find it.
		}

		// Reset state
		syncer.mu.Lock()
		delete(syncer.agentStates, agentID)
		syncer.mu.Unlock()

		line := buildEmbeddedLogLine(agentID, tc.signal, runID, toolName)
		syncer.processLogLine(line)

		expected := expectedStateForSignal(tc.signal, toolName)

		syncer.mu.Lock()
		state, exists := syncer.agentStates[agentID]
		syncer.mu.Unlock()

		if expected == "" {
			return !exists
		}

		if !exists {
			t.Logf("FAIL: agent=%s signal=%q tool=%q runID=%q → state not found, expected %q",
				agentID, tc.signal, toolName, runID, expected)
			return false
		}
		if state.State != expected {
			t.Logf("FAIL: agent=%s signal=%q tool=%q → state=%q, expected %q",
				agentID, tc.signal, toolName, state.State, expected)
			return false
		}
		return true
	}

	cfg := &quick.Config{
		MaxCount: 200,
		Rand:     rand.New(rand.NewSource(42)),
	}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("Property_ProcessLogLine_EmbeddedSignals failed: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Property 2: processLogLine correctly handles diagnostic lane signals
// **Validates: Requirements 1.2**
// ---------------------------------------------------------------------------

func TestProperty_ProcessLogLine_DiagnosticLane(t *testing.T) {
	syncer, _ := newLogSyncTestFixture(t)

	f := func(agentIdx uint8, durationMs uint16) bool {
		agents := validAgentIDs()
		agentID := agents[int(agentIdx)%len(agents)]
		dur := int(durationMs)%10000 + 1

		// Reset state
		syncer.mu.Lock()
		delete(syncer.agentStates, agentID)
		syncer.mu.Unlock()

		// Step 1: lane enqueue → should set state to "executing"
		enqueueLine := buildDiagnosticLogLine(agentID, "lane enqueue", 0)
		syncer.processLogLine(enqueueLine)

		syncer.mu.Lock()
		stateAfterEnqueue, existsAfterEnqueue := syncer.agentStates[agentID]
		syncer.mu.Unlock()

		if !existsAfterEnqueue {
			t.Logf("FAIL: agent=%s after lane enqueue → state not found", agentID)
			return false
		}
		if stateAfterEnqueue.State != "executing" {
			t.Logf("FAIL: agent=%s after lane enqueue → state=%q, expected executing", agentID, stateAfterEnqueue.State)
			return false
		}

		// Step 2: lane task done → should remove agent state (idle)
		doneLine := buildDiagnosticLogLine(agentID, "lane task done", dur)
		syncer.processLogLine(doneLine)

		syncer.mu.Lock()
		_, existsAfterDone := syncer.agentStates[agentID]
		syncer.mu.Unlock()

		if existsAfterDone {
			t.Logf("FAIL: agent=%s after lane task done → state still exists, expected removed", agentID)
			return false
		}

		return true
	}

	cfg := &quick.Config{
		MaxCount: 100,
		Rand:     rand.New(rand.NewSource(42)),
	}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("Property_ProcessLogLine_DiagnosticLane failed: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Property 3: identifyAgent correctly resolves agent identity
// **Validates: Requirements 1.3**
// ---------------------------------------------------------------------------

func TestProperty_IdentifyAgent_ThreeTierStrategy(t *testing.T) {
	syncer, _ := newLogSyncTestFixture(t)

	f := func(agentIdx uint8, strategy uint8) bool {
		agents := validAgentIDs()
		agentID := agents[int(agentIdx)%len(agents)]

		tier := int(strategy) % 3

		var runID, sessionID, rawContent string

		switch tier {
		case 0:
			// Strategy 1: runId regex — agent ID embedded in runId
			runID = fmt.Sprintf("agent:%s:run-abc123", agentID)
			sessionID = ""
			rawContent = "some random content"

		case 1:
			// Strategy 2: sessionCache lookup
			sessionKey := fmt.Sprintf("session-%s-%d", agentID, agentIdx)
			syncer.mu.Lock()
			syncer.sessionCache[sessionKey] = agentID
			syncer.mu.Unlock()
			runID = ""
			sessionID = sessionKey
			rawContent = "some random content"

		case 2:
			// Strategy 3: string matching fallback
			runID = ""
			sessionID = ""
			rawContent = fmt.Sprintf("The %s agent is working on something", agentID)
		}

		result := syncer.identifyAgent(runID, sessionID, rawContent)

		if result != agentID {
			t.Logf("FAIL: tier=%d agent=%s runID=%q sessionID=%q → got %q", tier, agentID, runID, sessionID, result)
			return false
		}
		return true
	}

	cfg := &quick.Config{
		MaxCount: 150,
		Rand:     rand.New(rand.NewSource(42)),
	}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("Property_IdentifyAgent_ThreeTierStrategy failed: %v", err)
	}
}
