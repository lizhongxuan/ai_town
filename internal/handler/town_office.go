package handler

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// ---------------------------------------------------------------------------
// F-03: OFFICE.md — persistent office member list
//
// Human-readable file that records which agents are manually selected
// into the office. Agents not in this file default to mainTown.
// ---------------------------------------------------------------------------

var townOfficeMu sync.Mutex

func townOfficeFilePath(cfg *config.Config) string {
	return filepath.Join(cfg.DataDir, "town", "OFFICE.md")
}

// ReadOfficeMembers returns the agent IDs listed in OFFICE.md.
func ReadOfficeMembers(cfg *config.Config) []string {
	townOfficeMu.Lock()
	defer townOfficeMu.Unlock()
	return readOfficeMembersUnlocked(cfg)
}

func readOfficeMembersUnlocked(cfg *config.Config) []string {
	data, err := os.ReadFile(townOfficeFilePath(cfg))
	if err != nil {
		return nil
	}
	return parseOfficeMembers(string(data))
}


func parseOfficeMembers(content string) []string {
	var ids []string
	seen := map[string]bool{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "- ") {
			continue
		}
		id := strings.TrimSpace(strings.TrimPrefix(line, "- "))
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

// WriteOfficeMembers writes the agent IDs to OFFICE.md.
// It validates against openclaw.json — unknown agents are skipped.
func WriteOfficeMembers(cfg *config.Config, agentIDs []string) error {
	townOfficeMu.Lock()
	defer townOfficeMu.Unlock()

	// Validate against openclaw.json
	_, agentSet := loadAgentIDs(cfg)
	var valid []string
	seen := map[string]bool{}
	for _, id := range agentIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if _, ok := agentSet[id]; !ok {
			continue
		}
		seen[id] = true
		valid = append(valid, id)
	}

	var sb strings.Builder
	sb.WriteString("# 办公室成员\n\n")
	sb.WriteString("> 此文件记录被手动选入办公室的 Agent。\n")
	sb.WriteString("> 可直接编辑此文件，每行一个 Agent ID。\n")
	sb.WriteString("> 不在此文件中的 Agent 默认在主镇。\n\n")
	for _, id := range valid {
		sb.WriteString("- ")
		sb.WriteString(id)
		sb.WriteString("\n")
	}

	dir := filepath.Dir(townOfficeFilePath(cfg))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(townOfficeFilePath(cfg), []byte(sb.String()), 0o644)
}

// IsOfficeMember checks if an agent is in OFFICE.md.
func IsOfficeMember(cfg *config.Config, agentID string) bool {
	members := ReadOfficeMembers(cfg)
	for _, id := range members {
		if id == agentID {
			return true
		}
	}
	return false
}

// OfficeMemberSet returns a set of office member IDs for fast lookup.
func OfficeMemberSet(cfg *config.Config) map[string]bool {
	members := ReadOfficeMembers(cfg)
	set := make(map[string]bool, len(members))
	for _, id := range members {
		set[id] = true
	}
	return set
}
