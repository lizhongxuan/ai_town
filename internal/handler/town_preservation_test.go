package handler

import (
	"math/rand"
	"strings"
	"testing"
	"testing/quick"
)

// ---------------------------------------------------------------------------
// Preservation property tests
//
// These tests verify that existing normalisation and derivation helpers
// continue to behave as they always have. They use testing/quick to
// exercise the functions with random inputs and assert invariants.
// ---------------------------------------------------------------------------

// validRunSources is the complete set of values normalizeTownRunSource may return.
var validRunSources = map[string]bool{
	"im": true, "office": true, "logsync": true, "manual": true,
}

// validInstanceStatuses is the complete set of values normalizeTownInstanceStatus may return.
var validInstanceStatuses = map[string]bool{
	"thinking": true, "executing": true, "completed": true, "error": true,
}

// validExecutionStates is the complete set of values deriveTownExecutionState may return.
var validExecutionStates = map[string]bool{
	"idle": true, "standby": true, "busy": true, "completed": true, "error": true,
}

// ---------------------------------------------------------------------------
// Property 1: normalizeTownRunSource preserves existing source mappings
// **Validates: Requirements 1.1**
// ---------------------------------------------------------------------------

func TestProperty_NormalizeTownRunSource_OutputAlwaysValid(t *testing.T) {
	f := func(raw string) bool {
		out := normalizeTownRunSource(raw)
		return validRunSources[out]
	}
	cfg := &quick.Config{MaxCount: 500, Rand: rand.New(rand.NewSource(42))}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("normalizeTownRunSource returned invalid value: %v", err)
	}
}

func TestProperty_NormalizeTownRunSource_KnownMappings(t *testing.T) {
	known := map[string]string{
		"office":  "office",
		"im":      "im",
		"manual":  "manual",
		"logsync": "logsync",
		"":        "manual",
	}
	for input, want := range known {
		got := normalizeTownRunSource(input)
		if got != want {
			t.Errorf("normalizeTownRunSource(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestProperty_NormalizeTownRunSource_UnknownDefaultsToManual(t *testing.T) {
	f := func(raw string) bool {
		trimmed := strings.TrimSpace(raw)
		switch trimmed {
		case "im", "office", "logsync":
			return true // skip known values
		}
		return normalizeTownRunSource(raw) == "manual"
	}
	cfg := &quick.Config{MaxCount: 500, Rand: rand.New(rand.NewSource(42))}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("unknown source did not default to manual: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Property 2: deriveTownExecutionState preserves existing state derivation
// **Validates: Requirements 1.2**
// ---------------------------------------------------------------------------

func TestProperty_DeriveTownExecutionState_OutputAlwaysValid(t *testing.T) {
	memberships := []string{"selected", "unselected", ""}
	runStatuses := []string{"running", "completed", "error", ""}
	instanceStatuses := []string{"thinking", "executing", "completed", "error", ""}

	f := func(mIdx, rIdx, iIdx uint8, hasRunID, hasInstID bool) bool {
		membership := memberships[int(mIdx)%len(memberships)]
		runStatus := runStatuses[int(rIdx)%len(runStatuses)]
		instStatus := instanceStatuses[int(iIdx)%len(instanceStatuses)]

		var run townSharedRun
		if hasRunID {
			run = townSharedRun{ID: "run-1", Status: runStatus}
		}
		var inst townSharedInstance
		if hasInstID {
			inst = townSharedInstance{ID: "inst-1", Status: instStatus}
		}

		out := deriveTownExecutionState(membership, run, inst)
		return validExecutionStates[out]
	}
	cfg := &quick.Config{MaxCount: 500, Rand: rand.New(rand.NewSource(42))}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("deriveTownExecutionState returned invalid value: %v", err)
	}
}

func TestProperty_DeriveTownExecutionState_KnownCombinations(t *testing.T) {
	cases := []struct {
		name       string
		membership string
		run        townSharedRun
		instance   townSharedInstance
		want       string
	}{
		{
			name:       "selected + running run + instance → busy",
			membership: "selected",
			run:        townSharedRun{ID: "r1", Status: "running"},
			instance:   townSharedInstance{ID: "i1", Status: "executing"},
			want:       "busy",
		},
		{
			name:       "unselected + no run + no instance → idle",
			membership: "unselected",
			run:        townSharedRun{},
			instance:   townSharedInstance{},
			want:       "idle",
		},
		{
			name:       "selected + completed run + completed instance → completed",
			membership: "selected",
			run:        townSharedRun{ID: "r1", Status: "completed"},
			instance:   townSharedInstance{ID: "i1", Status: "completed"},
			want:       "completed",
		},
		{
			name:       "selected + error run + instance → error",
			membership: "selected",
			run:        townSharedRun{ID: "r1", Status: "error"},
			instance:   townSharedInstance{ID: "i1", Status: "executing"},
			want:       "error",
		},
		{
			name:       "selected + no run + no instance → standby",
			membership: "selected",
			run:        townSharedRun{},
			instance:   townSharedInstance{},
			want:       "standby",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveTownExecutionState(tc.membership, tc.run, tc.instance)
			if got != tc.want {
				t.Errorf("deriveTownExecutionState(%q, run=%+v, inst=%+v) = %q, want %q",
					tc.membership, tc.run, tc.instance, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Property 3: normalizeTownInstanceStatus preserves existing status mappings
// **Validates: Requirements 1.3**
// ---------------------------------------------------------------------------

func TestProperty_NormalizeTownInstanceStatus_OutputAlwaysValid(t *testing.T) {
	f := func(raw string) bool {
		out := normalizeTownInstanceStatus(raw)
		return validInstanceStatuses[out]
	}
	cfg := &quick.Config{MaxCount: 500, Rand: rand.New(rand.NewSource(42))}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("normalizeTownInstanceStatus returned invalid value: %v", err)
	}
}

func TestProperty_NormalizeTownInstanceStatus_KnownMappings(t *testing.T) {
	known := map[string]string{
		"thinking":  "thinking",
		"executing": "executing",
		"completed": "completed",
		"error":     "error",
	}
	for input, want := range known {
		got := normalizeTownInstanceStatus(input)
		if got != want {
			t.Errorf("normalizeTownInstanceStatus(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestProperty_NormalizeTownInstanceStatus_UnknownDefaultsToCompleted(t *testing.T) {
	f := func(raw string) bool {
		trimmed := strings.TrimSpace(raw)
		switch trimmed {
		case "thinking", "executing", "completed", "error":
			return true // skip known values
		}
		return normalizeTownInstanceStatus(raw) == "completed"
	}
	cfg := &quick.Config{MaxCount: 500, Rand: rand.New(rand.NewSource(42))}
	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("unknown instance status did not default to completed: %v", err)
	}
}
