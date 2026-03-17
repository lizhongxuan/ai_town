package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
	"github.com/zhaoxinyi02/ClawPanel/internal/model"
	ws "github.com/zhaoxinyi02/ClawPanel/internal/websocket"
)

const (
	townMaxSelectableAgents     = 10
	townMaxRuns                 = 48
	townMaxLogs                 = 120
	townMaxEvents               = 32
	townMaxInstances            = 256
	townBusyWindowSeconds       = 30
	townStateDebounceSeconds    = 8
	townCompletedWindowSeconds  = 45
	townDefaultBridgeTimeoutSec = 120
)

var (
	townStateMu            sync.Mutex
	errTownVersionConflict = errors.New("town office members version conflict")
	errTownEmptyPatch      = errors.New("town office members patch is empty")
	errTownManagerLocked   = errors.New("town manager membership is locked")
	errTownSelectedLimit   = errors.New("town selected limit exceeded")
	townStore              TownStore // initialized by InitTownStore

	// Snapshot version cache (T-003)
	townSnapshotCache       *TownSnapshot
	townSnapshotCacheVer    int64
	townSnapshotCacheAt     time.Time
	townSnapshotCacheMu     sync.Mutex
	townSnapshotCacheTTL    = 3 * time.Second
	townConfigModTime       time.Time // F-02: openclaw.json ModTime for change detection
)

// InitTownStore sets the package-level TownStore.
// If db is non-nil and TOWN_STORE_DRIVER != "file", uses DB store; otherwise file store.
func InitTownStore(cfg *config.Config, db *sql.DB) {
	driver := strings.TrimSpace(os.Getenv("TOWN_STORE_DRIVER"))
	if db != nil && driver != "file" {
		townStore = NewTownDBStore(db)
	} else {
		townStore = NewTownFileStore(cfg)
	}
}

func GetTownSnapshot(cfg *config.Config, db *sql.DB, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = db
		_ = hub
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{
				"ok":    false,
				"code":  "town.disabled",
				"error": "AI 小镇功能未启用",
			})
			return
		}

		snapshot, err := buildTownSnapshotFromStore(cfg)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"ok":    false,
				"code":  "town.state_read_failed",
				"error": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"ok":       true,
			"snapshot": snapshot,
		})
	}
}

func UpdateTownOfficeMembers(cfg *config.Config, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{
				"ok":    false,
				"code":  "town.disabled",
				"error": "AI 小镇功能未启用",
			})
			return
		}

		var req townOfficeMembersRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			townError(c, http.StatusBadRequest, "town.invalid_request", "参数错误")
			return
		}

		patches := make([]townOfficeMemberPatch, 0, len(req.Members)+1)
		if strings.TrimSpace(req.AgentID) != "" {
			patches = append(patches, townOfficeMemberPatch{
				AgentID:    strings.TrimSpace(req.AgentID),
				Membership: strings.TrimSpace(req.Membership),
			})
		}
		for _, item := range req.Members {
			patches = append(patches, townOfficeMemberPatch{
				AgentID:    strings.TrimSpace(item.AgentID),
				Membership: strings.TrimSpace(item.Membership),
			})
		}
		if len(patches) == 0 {
			townError(c, http.StatusBadRequest, "town.office_members.empty_patch", "办公室成员池补丁为空")
			return
		}

		_, agentSet := loadAgentIDs(cfg)
		managerID := loadDefaultAgentID(cfg)

		// F-03/F-06: Read current OFFICE.md, apply patches, write back
		currentMembers := ReadOfficeMembers(cfg)
		memberSet := make(map[string]bool, len(currentMembers))
		for _, id := range currentMembers {
			memberSet[id] = true
		}

		for _, patch := range patches {
			if patch.AgentID == "" {
				townError(c, http.StatusBadRequest, "town.office_members.agent_required", "agentId 不能为空")
				return
			}
			if patch.AgentID == managerID {
				townError(c, http.StatusBadRequest, "town.office_members.manager_locked", "主控 Agent 不能加入办公室")
				return
			}
			if _, ok := agentSet[patch.AgentID]; !ok {
				townError(c, http.StatusBadRequest, "town.office_members.agent_not_found", "Agent 不存在: "+patch.AgentID)
				return
			}
			membership, ok := normalizeTownMembership(patch.Membership)
			if !ok {
				townError(c, http.StatusBadRequest, "town.office_members.invalid_membership", "无效的 membership: "+patch.Membership)
				return
			}
			if membership == "selected" {
				memberSet[patch.AgentID] = true
			} else {
				delete(memberSet, patch.AgentID)
			}
		}

		if len(memberSet) > townMaxSelectableAgents {
			townError(c, http.StatusBadRequest, "town.office_members.limit", fmt.Sprintf("办公室成员不能超过 %d 人", townMaxSelectableAgents))
			return
		}

		// Build ordered list
		newMembers := make([]string, 0, len(memberSet))
		for id := range memberSet {
			newMembers = append(newMembers, id)
		}
		sort.Strings(newMembers)

		if err := WriteOfficeMembers(cfg, newMembers); err != nil {
			townError(c, http.StatusInternalServerError, "town.office_members.write_failed", err.Error())
			return
		}

		// Also update DB state for version bump and WS invalidation
		nextState, err := townStore.UpdateState(req.ExpectedVersion, func(state *townSharedState) error {
			state.OfficeMembers = make(map[string]string, len(newMembers))
			for _, id := range newMembers {
				state.OfficeMembers[id] = "selected"
			}
			return nil
		})
		if err != nil {
			handleTownOfficeMemberError(c, err)
			return
		}
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(hub, nextState.Version)

		appendTownAuditRecord(cfg, map[string]any{
			"time":     time.Now().Format(time.RFC3339),
			"version":  nextState.Version,
			"members":  newMembers,
			"patches":  patches,
			"clientIp": c.ClientIP(),
		})

		// Build response officeMembers map
		respMembers := make(map[string]string, len(newMembers))
		for _, id := range newMembers {
			respMembers[id] = "selected"
		}

		c.JSON(http.StatusOK, gin.H{
			"ok":            true,
			"version":       nextState.Version,
			"officeMembers": respMembers,
		})
	}
}

func CreateTownRun(cfg *config.Config, db *sql.DB, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{
				"ok":    false,
				"code":  "town.disabled",
				"error": "AI 小镇功能未启用",
			})
			return
		}

		var req townCreateRunRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			townError(c, http.StatusBadRequest, "town.run.invalid_request", "参数错误")
			return
		}

		prompt := strings.TrimSpace(req.Prompt)
		if prompt == "" {
			townError(c, http.StatusBadRequest, "town.run.prompt_required", "任务内容不能为空")
			return
		}

		source := normalizeTownRunSource(req.Source)
		runID := fmt.Sprintf("run-%d", time.Now().UnixMilli())
		managerID := loadDefaultAgentID(cfg)
		_, agentSet := loadAgentIDs(cfg)

		// F-06: Task mode distinction
		// office → force all OFFICE.md members as standby
		// im → no standby, let openclaw-main decide
		var standbyAgents []string
		if source == "office" {
			officeMembers := ReadOfficeMembers(cfg)
			standbyAgents = uniqueTownAgents(officeMembers, agentSet, managerID)
		} else if source == "im" {
			// IM mode: no forced standby, openclaw-main decides
			standbyAgents = nil
		} else {
			// manual or other: use explicitly selected agents
			standbyAgents = uniqueTownAgents(req.SelectedAgents, agentSet, managerID)
		}

		now := time.Now()
		run := townSharedRun{
			ID:                  runID,
			Title:               buildTownRunTitle(strings.TrimSpace(req.Title), prompt),
			Prompt:              prompt,
			Source:              source,
			Status:              "running",
			PrimarySessionID:    fmt.Sprintf("session-%s", runID),
			CreatedAt:           now.UnixMilli(),
			UpdatedAt:           now.UnixMilli(),
			ParticipantAgentIDs: []string{},
			SpawnedSessions:     []townSharedSpawnedSession{},
		}

		_, err := townStore.UpdateState(nil, func(state *townSharedState) error {
			// F-05: removed applyTownAutoAdded — IM agents no longer permanently join office
			for _, agentID := range standbyAgents {
				state.RecentWeights[agentID] = maxTownInt(state.RecentWeights[agentID]+2, 2)
			}
			state.Runs = prependTownRun(state.Runs, run)
			appendTownStateEvent(state, townSharedEvent{
				ID:        fmt.Sprintf("event-%d", now.UnixMilli()),
				Type:      sourceEventType(source),
				Title:     sourceEventTitle(source),
				Detail:    participantDetail(standbyAgents),
				Time:      now.UnixMilli(),
				RunID:     runID,
				SceneHint: "office",
			})
			appendTownStateLog(state, townSharedLog{
				ID:     fmt.Sprintf("log-%d", now.UnixMilli()),
				RunID:  runID,
				Title:  "主任务会话已创建",
				Detail: fmt.Sprintf("OpenClaw(main) 已为「%s」创建主任务会话。", run.Title),
				Time:   now.UnixMilli(),
				Type:   sourceLogType(source),
			})
			for _, agentID := range standbyAgents {
				appendTownStateLog(state, townSharedLog{
					ID:      fmt.Sprintf("log-%d-%s", now.UnixMilli(), agentID),
					RunID:   runID,
					AgentID: agentID,
					Title:   fmt.Sprintf("%s 在办公室待命", agentID),
					Detail:  fmt.Sprintf("%s 已在办公室待命，等待 OpenClaw(main) 按需调度。", agentID),
					Time:    now.UnixMilli(),
					Type:    sourceLogType(source),
				})
			}
			return nil
		})
		if err != nil {
			townError(c, http.StatusInternalServerError, "town.run.state_write_failed", err.Error())
			return
		}
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(hub, 0)

		recordTownRuntimeEvent(db, hub, "openclaw.run.started", "主任务已创建", map[string]string{
			"runId":  runID,
			"source": source,
			"title":  run.Title,
		})
		if len(standbyAgents) == 0 {
			recordTownRuntimeEvent(db, hub, "openclaw.run.single", "本轮由 OpenClaw(main) 单独执行", map[string]string{
				"runId": runID,
			})
		}
		for _, agentID := range standbyAgents {
			if source == "im" {
				recordTownRuntimeEvent(db, hub, "openclaw.agent.auto_added", fmt.Sprintf("%s 自动加入办公室成员池", agentID), map[string]string{
					"runId":   runID,
					"agentId": agentID,
				})
			}
		}

		go finalizeTownRun(cfg, db, hub, townBridgeRequest{
			RunID:           runID,
			Title:           run.Title,
			Prompt:          prompt,
			Source:          source,
			ManagerAgentID:  managerID,
			StandbyAgentIDs: standbyAgents,
		})

		c.JSON(http.StatusOK, gin.H{
			"ok": true,
			"run": gin.H{
				"id":                  run.ID,
				"title":               run.Title,
				"status":              run.Status,
				"primarySessionId":    run.PrimarySessionID,
				"participantAgentIds": run.ParticipantAgentIDs,
			},
		})
	}
}

func GetTownRunLogs(cfg *config.Config, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = db
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{
				"ok":    false,
				"code":  "town.disabled",
				"error": "AI 小镇功能未启用",
			})
			return
		}

		runID := strings.TrimSpace(c.Param("id"))
		if runID == "" {
			townError(c, http.StatusBadRequest, "town.run.run_id_required", "runId 不能为空")
			return
		}

		// T-011: cursor/limit pagination
		cursor := strings.TrimSpace(c.Query("cursor"))
		limit := 50
		if v := strings.TrimSpace(c.Query("limit")); v != "" {
			if n := parseTownInt(v, 50); n > 0 && n <= 200 {
				limit = n
			}
		}

		state, err := townStore.ReadState()
		if err != nil {
			townError(c, http.StatusInternalServerError, "town.run.state_read_failed", err.Error())
			return
		}

		found := false
		for _, run := range state.Runs {
			if run.ID == runID {
				found = true
				break
			}
		}
		if !found {
			townError(c, http.StatusNotFound, "town.run.not_found", "找不到对应任务")
			return
		}

		allLogs := make([]TownSnapshotLog, 0, 16)
		for _, logEntry := range state.Logs {
			if logEntry.RunID != runID {
				continue
			}
			allLogs = append(allLogs, toTownSnapshotLog(logEntry))
		}
		sort.Slice(allLogs, func(i, j int) bool {
			if allLogs[i].Time != allLogs[j].Time {
				return allLogs[i].Time < allLogs[j].Time
			}
			return allLogs[i].ID < allLogs[j].ID
		})

		// Apply cursor: skip entries until we pass the cursor ID
		startIdx := 0
		if cursor != "" {
			for i, l := range allLogs {
				if l.ID == cursor {
					startIdx = i + 1
					break
				}
			}
		}

		// Slice to limit
		endIdx := startIdx + limit
		if endIdx > len(allLogs) {
			endIdx = len(allLogs)
		}
		page := allLogs[startIdx:endIdx]

		var nextCursor string
		if endIdx < len(allLogs) && len(page) > 0 {
			nextCursor = page[len(page)-1].ID
		}

		c.JSON(http.StatusOK, gin.H{
			"ok":         true,
			"logs":       page,
			"nextCursor": nextCursor,
			"total":      len(allLogs),
		})
	}
}

func ResetTownAgent(cfg *config.Config, db *sql.DB, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{
				"ok":    false,
				"code":  "town.disabled",
				"error": "AI 小镇功能未启用",
			})
			return
		}

		agentID := strings.TrimSpace(c.Param("id"))
		if agentID == "" {
			townError(c, http.StatusBadRequest, "town.reset.agent_required", "agentId 不能为空")
			return
		}
		if agentID == loadDefaultAgentID(cfg) {
			townError(c, http.StatusBadRequest, "town.reset.manager_locked", "主控 Agent 不能在 Town 内重置")
			return
		}
		if err := validateAgentQuery(cfg, agentID); err != nil {
			townError(c, http.StatusBadRequest, "town.reset.agent_not_found", err.Error())
			return
		}

		var req townResetAgentRequest
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			townError(c, http.StatusBadRequest, "town.reset.invalid_request", "参数错误")
			return
		}

		if err := clearTownAgentSessions(cfg, agentID); err != nil {
			townError(c, http.StatusInternalServerError, "town.reset.session_clear_failed", err.Error())
			return
		}

		state, err := townStore.UpdateState(nil, func(state *townSharedState) error {
			if req.KeepInOffice {
				state.OfficeMembers[agentID] = "selected"
			} else {
				delete(state.OfficeMembers, agentID)
			}
			nextInstances := state.Instances[:0]
			for _, instance := range state.Instances {
				if instance.AgentID == agentID {
					continue
				}
				nextInstances = append(nextInstances, instance)
			}
			state.Instances = nextInstances
			appendTownStateEvent(state, townSharedEvent{
				ID:        fmt.Sprintf("event-reset-%d", time.Now().UnixMilli()),
				Type:      "info",
				Title:     "成员已重置",
				Detail:    fmt.Sprintf("%s 的会话与异常状态已清理。", agentID),
				Time:      time.Now().UnixMilli(),
				SceneHint: "office",
			})
			appendTownStateLog(state, townSharedLog{
				ID:      fmt.Sprintf("log-reset-%d", time.Now().UnixMilli()),
				AgentID: agentID,
				Title:   "成员已重置",
				Detail:  fmt.Sprintf("%s 的会话文件与 Town 实例状态已清理。", agentID),
				Time:    time.Now().UnixMilli(),
				Type:    "system",
			})
			return nil
		})
		if err != nil {
			townError(c, http.StatusInternalServerError, "town.reset.state_write_failed", err.Error())
			return
		}
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(hub, state.Version)

		recordTownRuntimeEvent(db, hub, "openclaw.agent.reset", fmt.Sprintf("%s 已被重置", agentID), map[string]string{
			"agentId": agentID,
		})

		c.JSON(http.StatusOK, gin.H{
			"ok":            true,
			"version":       state.Version,
			"officeMembers": state.OfficeMembers,
		})
	}
}

func buildTownSnapshotFromStore(cfg *config.Config) (TownSnapshot, error) {
	// T-003: version-based cache with short TTL to reduce polling pressure.
	// F-02: also invalidate when openclaw.json changes (agent list updated).
	townSnapshotCacheMu.Lock()
	defer townSnapshotCacheMu.Unlock()

	// F-02: detect openclaw.json changes
	configPath := filepath.Join(cfg.OpenClawDir, "openclaw.json")
	if info, err := os.Stat(configPath); err == nil {
		if info.ModTime().After(townConfigModTime) {
			townConfigModTime = info.ModTime()
			townSnapshotCache = nil // force rebuild
		}
	}

	state, err := townStore.ReadState()
	if err != nil {
		return TownSnapshot{}, err
	}

	now := time.Now()
	if townSnapshotCache != nil &&
		state.Version == townSnapshotCacheVer &&
		now.Sub(townSnapshotCacheAt) < townSnapshotCacheTTL {
		return *townSnapshotCache, nil
	}

	buildStart := time.Now()
	snapshot, err := buildTownSnapshotFromState(cfg, state)
	if err != nil {
		return TownSnapshot{}, err
	}
	RecordTownSnapshotBuild(time.Since(buildStart))

	townSnapshotCache = &snapshot
	townSnapshotCacheVer = state.Version
	townSnapshotCacheAt = now
	return snapshot, nil
}

// InvalidateTownSnapshotCache forces the next snapshot request to rebuild.
// Called after any state mutation (office members, runs, etc.).
func InvalidateTownSnapshotCache() {
	townSnapshotCacheMu.Lock()
	townSnapshotCache = nil
	townSnapshotCacheMu.Unlock()
}

func buildTownSnapshot(cfg *config.Config) (TownSnapshot, error) {
	state, err := readTownSharedState(cfg)
	if err != nil {
		return TownSnapshot{}, err
	}
	return buildTownSnapshotFromState(cfg, state)
}

func buildTownSnapshotFromState(cfg *config.Config, state townSharedState) (TownSnapshot, error) {

	agentIDs, _ := loadAgentIDs(cfg)
	ocConfig, _ := cfg.ReadOpenClawJSON()
	managerID := loadDefaultAgentID(cfg)
	now := time.Now()
	runMap := make(map[string]townSharedRun, len(state.Runs))
	latestRunByAgent := make(map[string]townSharedRun)
	latestInstanceByAgent := make(map[string]townSharedInstance)
	for _, run := range state.Runs {
		runMap[run.ID] = run
		for _, agentID := range run.ParticipantAgentIDs {
			if _, exists := latestRunByAgent[agentID]; !exists {
				latestRunByAgent[agentID] = run
			}
		}
	}
	for _, instance := range state.Instances {
		if _, exists := latestInstanceByAgent[instance.AgentID]; exists {
			continue
		}
		latestInstanceByAgent[instance.AgentID] = instance
	}

	// F-04: Read OFFICE.md for location state machine
	officeSet := OfficeMemberSet(cfg)

	agents := make([]TownSnapshotAgent, 0, len(agentIDs))
	for _, agentID := range agentIDs {
		if agentID == managerID {
			continue
		}
		sessions, lastActive := getAgentSessionStats(cfg, agentID)
		item := findAgentConfig(ocConfig, agentID)

		// F-04: membership from OFFICE.md instead of DB
		membership := "unselected"
		if officeSet[agentID] {
			membership = "selected"
		}

		executionState := deriveTownExecutionState(membership, latestRunByAgent[agentID], latestInstanceByAgent[agentID])
		sessionRole := "none"
		if executionState == "busy" || executionState == "completed" || executionState == "error" {
			sessionRole = "spawned"
		}

		// F-04: New location state machine
		// busy/error → office_busy (on desk working)
		// in OFFICE.md and idle → office_idle (wandering in office)
		// not in OFFICE.md and idle → mainTown (wandering in town)
		location := "mainTown"
		if executionState == "busy" || executionState == "error" {
			location = "office_busy"
		} else if officeSet[agentID] {
			location = "office_idle"
		}

		recentWeight := maxTownInt(state.RecentWeights[agentID], sessions)
		if recentWeight <= 0 {
			recentWeight = 1
		}

		agents = append(agents, TownSnapshotAgent{
			ID:               agentID,
			Name:             buildTownAgentName(item, agentID),
			Role:             buildTownAgentRole(item),
			Description:      buildTownAgentDescription(item),
			Skills:           buildTownSnapshotSkills(item, agentID),
			Sessions:         sessions,
			LastActive:       lastActive,
			LastActiveRfc333: formatTownRFC3339(lastActive),
			RecentWeight:     recentWeight,
			OfficeMembership: membership,
			ExecutionState:   executionState,
			SessionRole:      sessionRole,
			Location:         location,
		})
	}

	visibleAgentIDs := buildTownVisibleAgentIDs(agents)
	events := make([]TownSnapshotEvent, 0, minTownInt(len(state.Events), 12))
	for index, event := range state.Events {
		if index >= 12 {
			break
		}
		events = append(events, toTownSnapshotEvent(event))
	}
	logs := make([]TownSnapshotLog, 0, minTownInt(len(state.Logs), 80))
	for index, logEntry := range state.Logs {
		if index >= 80 {
			break
		}
		logs = append(logs, toTownSnapshotLog(logEntry))
	}
	runs := make([]TownSnapshotRun, 0, len(state.Runs))
	for _, run := range state.Runs {
		runs = append(runs, toTownSnapshotRun(run))
	}
	instances := make([]TownSnapshotInstance, 0, len(state.Instances))
	for _, instance := range state.Instances {
		instances = append(instances, TownSnapshotInstance{
			ID:        instance.ID,
			AgentID:   instance.AgentID,
			RunID:     instance.RunID,
			SessionID: instance.SessionID,
			ZoneID:    instance.ZoneID,
			Status:    normalizeTownInstanceStatus(instance.Status),
		})
	}

	return TownSnapshot{
		Clock:   now.Format("15:04"),
		Weather: deriveTownWeather(now),
		Version: state.Version,
		Sync: TownSnapshotSync{
			Mode:                  "approximate",
			BusyWindowSeconds:     townBusyWindowSeconds,
			StateDebounceSeconds:  townStateDebounceSeconds,
			CompletedWindowSecond: townCompletedWindowSeconds,
		},
		OpenClaw: TownSnapshotOpenClaw{
			AgentID: managerID,
			Name:    "OpenClaw(main)",
		},
		MaxSelectableAgent: townMaxSelectableAgents,
		OfficeMembers:      cloneTownOfficeMembers(state.OfficeMembers),
		Agents:             agents,
		VisibleTownAgentID: visibleAgentIDs,
		Events:             events,
		Logs:               logs,
		Runs:               runs,
		Instances:          instances,
	}, nil
}

func updateTownSharedState(
	cfg *config.Config,
	expectedVersion *int64,
	apply func(state *townSharedState) error,
) (townSharedState, error) {
	townStateMu.Lock()
	defer townStateMu.Unlock()

	state, err := readTownSharedStateUnlocked(cfg)
	if err != nil {
		return townSharedState{}, err
	}
	if expectedVersion != nil && state.Version != *expectedVersion {
		return townSharedState{}, errTownVersionConflict
	}
	if err := apply(&state); err != nil {
		return townSharedState{}, err
	}
	sanitizeTownSharedState(&state)
	state.Version++
	state.UpdatedAt = time.Now().UnixMilli()
	if err := writeTownSharedStateUnlocked(cfg, state); err != nil {
		return townSharedState{}, err
	}
	return state, nil
}

func readTownSharedState(cfg *config.Config) (townSharedState, error) {
	townStateMu.Lock()
	defer townStateMu.Unlock()
	return readTownSharedStateUnlocked(cfg)
}

func readTownSharedStateUnlocked(cfg *config.Config) (townSharedState, error) {
	path := townStateFilePath(cfg)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaultTownSharedState(), nil
	}
	if err != nil {
		return townSharedState{}, err
	}
	var state townSharedState
	if err := json.Unmarshal(raw, &state); err != nil {
		return defaultTownSharedState(), nil
	}
	sanitizeTownSharedState(&state)
	if state.Version <= 0 {
		state.Version = 1
	}
	return state, nil
}

func writeTownSharedStateUnlocked(cfg *config.Config, state townSharedState) error {
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	target := townStateFilePath(cfg)
	tmp := fmt.Sprintf("%s.tmp", target)
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}

func townStateFilePath(cfg *config.Config) string {
	return filepath.Join(cfg.DataDir, "town_state.json")
}

func townAuditFilePath(cfg *config.Config) string {
	return filepath.Join(cfg.DataDir, "town_office_audit.jsonl")
}

func defaultTownSharedState() townSharedState {
	return townSharedState{
		Version:       1,
		OfficeMembers: map[string]string{},
		Runs:          []townSharedRun{},
		Logs:          []townSharedLog{},
		Events:        []townSharedEvent{},
		Instances:     []townSharedInstance{},
		RecentWeights: map[string]int{},
		UpdatedAt:     time.Now().UnixMilli(),
	}
}

func sanitizeTownSharedState(state *townSharedState) {
	if state.OfficeMembers == nil {
		state.OfficeMembers = map[string]string{}
	}
	if state.Runs == nil {
		state.Runs = []townSharedRun{}
	}
	if state.Logs == nil {
		state.Logs = []townSharedLog{}
	}
	if state.Events == nil {
		state.Events = []townSharedEvent{}
	}
	if state.Instances == nil {
		state.Instances = []townSharedInstance{}
	}
	if state.RecentWeights == nil {
		state.RecentWeights = map[string]int{}
	}
	for agentID, membership := range state.OfficeMembers {
		normalized, ok := normalizeTownMembership(membership)
		if !ok || normalized == "unselected" {
			delete(state.OfficeMembers, agentID)
			continue
		}
		state.OfficeMembers[agentID] = normalized
	}
	if state.Version <= 0 {
		state.Version = 1
	}
	if len(state.Runs) > townMaxRuns {
		state.Runs = append([]townSharedRun(nil), state.Runs[:townMaxRuns]...)
	}
	if len(state.Logs) > townMaxLogs {
		state.Logs = append([]townSharedLog(nil), state.Logs[:townMaxLogs]...)
	}
	if len(state.Events) > townMaxEvents {
		state.Events = append([]townSharedEvent(nil), state.Events[:townMaxEvents]...)
	}
	if len(state.Instances) > townMaxInstances {
		state.Instances = append([]townSharedInstance(nil), state.Instances[:townMaxInstances]...)
	}
}

func appendTownStateLog(state *townSharedState, logEntry townSharedLog) {
	state.Logs = append([]townSharedLog{logEntry}, state.Logs...)
	if len(state.Logs) > townMaxLogs {
		state.Logs = state.Logs[:townMaxLogs]
	}
}

func appendTownStateEvent(state *townSharedState, event townSharedEvent) {
	state.Events = append([]townSharedEvent{event}, state.Events...)
	if len(state.Events) > townMaxEvents {
		state.Events = state.Events[:townMaxEvents]
	}
}

func prependTownRun(runs []townSharedRun, run townSharedRun) []townSharedRun {
	next := append([]townSharedRun{run}, runs...)
	if len(next) > townMaxRuns {
		next = next[:townMaxRuns]
	}
	return next
}

func prependTownInstance(instances []townSharedInstance, instance townSharedInstance) []townSharedInstance {
	next := append([]townSharedInstance{instance}, instances...)
	if len(next) > townMaxInstances {
		next = next[:townMaxInstances]
	}
	return next
}

func cloneTownOfficeMembers(input map[string]string) map[string]string {
	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func normalizeTownMembership(raw string) (string, bool) {
	switch strings.TrimSpace(raw) {
	case "", "unselected":
		return "unselected", true
	case "selected":
		return "selected", true
	case "auto_added":
		return "auto_added", true
	default:
		return "", false
	}
}

func applyTownMembership(state map[string]string, agentID, membership string) {
	current := state[agentID]
	if membership == "unselected" {
		delete(state, agentID)
		return
	}
	if current == "selected" && membership == "auto_added" {
		return
	}
	state[agentID] = membership
}

func applyTownAutoAdded(state map[string]string, agentID string) {
	current := state[agentID]
	if current == "selected" {
		return
	}
	state[agentID] = "auto_added"
}

func countTownSelectedMembers(members map[string]string) int {
	total := 0
	for _, membership := range members {
		if membership == "selected" {
			total++
		}
	}
	return total
}

func buildTownVisibleAgentIDs(agents []TownSnapshotAgent) []string {
	candidates := make([]TownSnapshotAgent, 0, len(agents))
	for _, agent := range agents {
		if agent.OfficeMembership == "unselected" && agent.Location == "mainTown" {
			candidates = append(candidates, agent)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].RecentWeight != candidates[j].RecentWeight {
			return candidates[i].RecentWeight > candidates[j].RecentWeight
		}
		if candidates[i].LastActive != candidates[j].LastActive {
			return candidates[i].LastActive > candidates[j].LastActive
		}
		return candidates[i].ID < candidates[j].ID
	})
	limit := minTownInt(len(candidates), 6)
	result := make([]string, 0, limit)
	for index := 0; index < limit; index++ {
		result = append(result, candidates[index].ID)
	}
	return result
}

func deriveTownExecutionState(membership string, run townSharedRun, instance townSharedInstance) string {
	hasRun := strings.TrimSpace(run.ID) != ""
	hasInstance := strings.TrimSpace(instance.ID) != "" || strings.TrimSpace(instance.RunID) != "" || strings.TrimSpace(instance.AgentID) != ""
	if hasInstance && hasRun && (normalizeTownInstanceStatus(instance.Status) == "error" || normalizeTownRunStatus(run.Status) == "error") {
		return "error"
	}
	if hasInstance && hasRun && normalizeTownRunStatus(run.Status) == "running" {
		return "busy"
	}
	if hasInstance && membership != "unselected" && normalizeTownInstanceStatus(instance.Status) == "completed" {
		return "completed"
	}
	if membership != "unselected" {
		return "standby"
	}
	return "idle"
}

func buildTownAgentName(item map[string]interface{}, fallback string) string {
	for _, key := range []string{"name", "title", "displayName"} {
		if value := strings.TrimSpace(toString(item[key])); value != "" {
			return value
		}
	}
	return fallback
}

func buildTownAgentRole(item map[string]interface{}) string {
	for _, key := range []string{"description", "role", "summary"} {
		if value := strings.TrimSpace(toString(item[key])); value != "" {
			return value
		}
	}
	return "协作成员"
}

func buildTownAgentDescription(item map[string]interface{}) string {
	description := buildTownAgentRole(item)
	if description == "" {
		return "协作成员"
	}
	return description
}

func buildTownSnapshotSkills(item map[string]interface{}, agentID string) []TownSnapshotSkill {
	rawList, _ := item["skills"].([]interface{})
	result := make([]TownSnapshotSkill, 0, len(rawList))
	for index, raw := range rawList {
		record, _ := raw.(map[string]interface{})
		skillID := strings.TrimSpace(toString(record["id"]))
		if skillID == "" {
			skillID = fmt.Sprintf("%s-skill-%d", agentID, index+1)
		}
		name := strings.TrimSpace(toString(record["name"]))
		if name == "" {
			name = skillID
		}
		source := strings.TrimSpace(toString(record["source"]))
		if source == "" {
			source = "workspace"
		}
		description := strings.TrimSpace(toString(record["description"]))
		if description == "" {
			description = "暂无描述"
		}
		enabled, ok := record["enabled"].(bool)
		if !ok {
			enabled = true
		}
		result = append(result, TownSnapshotSkill{
			ID:          skillID,
			Name:        name,
			Source:      source,
			Enabled:     enabled,
			Description: description,
		})
	}
	return result
}

func toTownSnapshotEvent(event townSharedEvent) TownSnapshotEvent {
	return TownSnapshotEvent{
		ID:          event.ID,
		Type:        normalizeTownEventType(event.Type),
		Title:       event.Title,
		Detail:      event.Detail,
		TimeLabel:   formatTownClockAt(event.Time),
		Time:        event.Time,
		TimeRfc3339: formatTownRFC3339(event.Time),
		RunID:       event.RunID,
		SceneHint:   event.SceneHint,
	}
}

func toTownSnapshotLog(logEntry townSharedLog) TownSnapshotLog {
	return TownSnapshotLog{
		ID:          logEntry.ID,
		RunID:       logEntry.RunID,
		AgentID:     logEntry.AgentID,
		Title:       logEntry.Title,
		Detail:      logEntry.Detail,
		TimeLabel:   formatTownClockAt(logEntry.Time),
		Time:        logEntry.Time,
		TimeRfc3339: formatTownRFC3339(logEntry.Time),
		Type:        normalizeTownLogType(logEntry.Type),
	}
}

func toTownSnapshotRun(run townSharedRun) TownSnapshotRun {
	spawned := make([]TownSnapshotSpawnedSession, 0, len(run.SpawnedSessions))
	for _, session := range run.SpawnedSessions {
		spawned = append(spawned, TownSnapshotSpawnedSession{
			ID:      session.ID,
			AgentID: session.AgentID,
			Status:  normalizeTownRunStatus(session.Status),
		})
	}
	return TownSnapshotRun{
		ID:                 run.ID,
		Title:              run.Title,
		Prompt:             run.Prompt,
		Source:             normalizeTownRunSource(run.Source),
		Status:             normalizeTownRunStatus(run.Status),
		PrimarySessionID:   run.PrimarySessionID,
		CreatedAt:          run.CreatedAt,
		CreatedAtRfc3339:   formatTownRFC3339(run.CreatedAt),
		UpdatedAt:          run.UpdatedAt,
		UpdatedAtRfc3339:   formatTownRFC3339(run.UpdatedAt),
		CreatedAtLabel:     formatTownClockAt(run.CreatedAt),
		UpdatedAtLabel:     formatTownClockAt(run.UpdatedAt),
		ParticipantAgentID: append([]string(nil), run.ParticipantAgentIDs...),
		SpawnedSessions:    spawned,
	}
}

func normalizeTownRunSource(raw string) string {
	switch strings.TrimSpace(raw) {
	case "im":
		return "im"
	case "office":
		return "office"
	case "logsync":
		return "logsync"
	default:
		return "manual"
	}
}

func normalizeTownRunStatus(raw string) string {
	switch strings.TrimSpace(raw) {
	case "running", "completed", "error":
		return strings.TrimSpace(raw)
	default:
		return "completed"
	}
}

func normalizeTownInstanceStatus(raw string) string {
	switch strings.TrimSpace(raw) {
	case "thinking", "executing", "completed", "error":
		return strings.TrimSpace(raw)
	default:
		return "completed"
	}
}

func normalizeTownEventType(raw string) string {
	switch strings.TrimSpace(raw) {
	case "success", "warning", "im":
		return strings.TrimSpace(raw)
	default:
		return "info"
	}
}

func normalizeTownLogType(raw string) string {
	switch strings.TrimSpace(raw) {
	case "session", "spawn", "im":
		return strings.TrimSpace(raw)
	default:
		return "system"
	}
}

func buildTownRunTitle(title, prompt string) string {
	if title != "" {
		return title
	}
	compact := strings.Join(strings.Fields(prompt), " ")
	if len(compact) <= 18 {
		return compact
	}
	return compact[:18] + "..."
}

func deriveTownWeather(now time.Time) string {
	hour := now.Hour()
	switch {
	case hour < 6:
		return "深夜"
	case hour < 12:
		return "晴朗"
	case hour < 18:
		return "微风"
	default:
		return "夜色"
	}
}

func formatTownClockAt(ms int64) string {
	if ms <= 0 {
		return "--:--"
	}
	return time.UnixMilli(ms).Format("15:04")
}

func formatTownRFC3339(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).Format(time.RFC3339)
}

func uniqueTownAgents(input []string, agentSet map[string]struct{}, managerID string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(input))
	for _, raw := range input {
		agentID := strings.TrimSpace(raw)
		if agentID == "" || agentID == managerID {
			continue
		}
		if _, ok := agentSet[agentID]; !ok {
			continue
		}
		if _, ok := seen[agentID]; ok {
			continue
		}
		seen[agentID] = struct{}{}
		result = append(result, agentID)
	}
	sort.Strings(result)
	return result
}

func participantDetail(agentIDs []string) string {
	if len(agentIDs) == 0 {
		return "当前任务先由 OpenClaw(main) 发起；如有需要会再拉入其他 Agent。"
	}
	return fmt.Sprintf("%s 已在办公室待命，OpenClaw(main) 会按需拉入协作。", strings.Join(agentIDs, "、"))
}

func sourceEventType(source string) string {
	if source == "im" {
		return "im"
	}
	return "success"
}

func sourceEventTitle(source string) string {
	if source == "im" {
		return "OpenClaw(main) 正在办公室执行任务"
	}
	return "OpenClaw(main) 已发起协作任务"
}

func sourceLogType(source string) string {
	if source == "im" {
		return "im"
	}
	return "session"
}

func finalizeTownRun(cfg *config.Config, db *sql.DB, hub *ws.Hub, req townBridgeRequest) {
	timeout := resolveTownBridgeTimeout()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result, err := dispatchTownRunBridge(ctx, cfg, req)
	now := time.Now()
	if err != nil {
		_, _ = townStore.UpdateState(nil, func(state *townSharedState) error {
			for runIndex := range state.Runs {
				if state.Runs[runIndex].ID != req.RunID {
					continue
				}
				state.Runs[runIndex].Status = "error"
				state.Runs[runIndex].UpdatedAt = now.UnixMilli()
				state.Runs[runIndex].Error = err.Error()
				for sessionIndex := range state.Runs[runIndex].SpawnedSessions {
					state.Runs[runIndex].SpawnedSessions[sessionIndex].Status = "error"
				}
				break
			}
			for index := range state.Instances {
				if state.Instances[index].RunID == req.RunID {
					state.Instances[index].Status = "error"
				}
			}
			// F-08: Return-to-position on error — remove instances for non-OFFICE.md agents
			errOfficeSet := OfficeMemberSet(cfg)
			cleanedErrInstances := state.Instances[:0]
			for _, inst := range state.Instances {
				if inst.RunID == req.RunID && !errOfficeSet[inst.AgentID] {
					continue // not in OFFICE.md → remove, back to mainTown
				}
				cleanedErrInstances = append(cleanedErrInstances, inst)
			}
			state.Instances = cleanedErrInstances
			appendTownStateEvent(state, townSharedEvent{
				ID:        fmt.Sprintf("event-failed-%d", now.UnixMilli()),
				Type:      "warning",
				Title:     "任务执行失败",
				Detail:    err.Error(),
				Time:      now.UnixMilli(),
				RunID:     req.RunID,
				SceneHint: "office",
			})
			appendTownStateLog(state, townSharedLog{
				ID:     fmt.Sprintf("log-failed-%d", now.UnixMilli()),
				RunID:  req.RunID,
				Title:  "主任务执行失败",
				Detail: err.Error(),
				Time:   now.UnixMilli(),
				Type:   "system",
			})
			return nil
		})
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(hub, 0)

		recordTownRuntimeEvent(db, hub, "openclaw.run.failed", "Town 桥接 OpenClaw 失败", map[string]string{
			"runId":   req.RunID,
			"source":  req.Source,
			"message": err.Error(),
		})
		RecordTownRunBridgeFailed()
		return
	}

	_, _ = townStore.UpdateState(nil, func(state *townSharedState) error {
		for runIndex := range state.Runs {
			if state.Runs[runIndex].ID != req.RunID {
				continue
			}
			participantAgentIDs := townBridgeParticipantAgentIDs(result)
			if len(participantAgentIDs) > 0 {
				state.Runs[runIndex].ParticipantAgentIDs = append([]string(nil), participantAgentIDs...)
				state.Runs[runIndex].SpawnedSessions = normalizeTownBridgeSpawnedSessions(req.RunID, result.SpawnedSessions, participantAgentIDs)
				state.Instances = ensureTownRunInstances(state.Instances, req.RunID, state.Runs[runIndex].SpawnedSessions, "completed")
			}
			state.Runs[runIndex].Status = "completed"
			state.Runs[runIndex].UpdatedAt = now.UnixMilli()
			if strings.TrimSpace(result.SessionID) != "" {
				state.Runs[runIndex].PrimarySessionID = strings.TrimSpace(result.SessionID)
			}
			for sessionIndex := range state.Runs[runIndex].SpawnedSessions {
				state.Runs[runIndex].SpawnedSessions[sessionIndex].Status = "completed"
			}
			break
		}
		// F-08: Return-to-position logic — remove instances for non-OFFICE.md agents
		officeSet := OfficeMemberSet(cfg)
		participantIDs := townBridgeParticipantAgentIDs(result)
		cleanedInstances := state.Instances[:0]
		for _, inst := range state.Instances {
			if inst.RunID == req.RunID && !officeSet[inst.AgentID] {
				// Not in OFFICE.md → remove instance, agent returns to mainTown
				continue
			}
			if inst.RunID == req.RunID && officeSet[inst.AgentID] {
				// In OFFICE.md → keep instance but mark idle
				inst.Status = "completed"
			}
			cleanedInstances = append(cleanedInstances, inst)
		}
		state.Instances = cleanedInstances

		appendTownStateEvent(state, townSharedEvent{
			ID:        fmt.Sprintf("event-completed-%d", now.UnixMilli()),
			Type:      "success",
			Title:     "办公室任务已完成",
			Detail:    fmt.Sprintf("主任务「%s」已完成。", req.Title),
			Time:      now.UnixMilli(),
			RunID:     req.RunID,
			SceneHint: "office",
		})
		appendTownStateLog(state, townSharedLog{
			ID:     fmt.Sprintf("log-completed-%d", now.UnixMilli()),
			RunID:  req.RunID,
			Title:  "任务已完成",
			Detail: buildTownCompletionDetail(result.Output),
			Time:   now.UnixMilli(),
			Type:   "session",
		})
		// F-08: Log return-to-position for each participant
		for _, agentID := range participantIDs {
			dest := "主镇"
			if officeSet[agentID] {
				dest = "办公室"
			}
			appendTownStateLog(state, townSharedLog{
				ID:      fmt.Sprintf("log-return-%d-%s", now.UnixMilli(), agentID),
				RunID:   req.RunID,
				AgentID: agentID,
				Title:   fmt.Sprintf("%s 已回到%s", agentID, dest),
				Detail:  fmt.Sprintf("任务完成，%s 回到%s。", agentID, dest),
				Time:    now.UnixMilli(),
				Type:    "system",
			})
		}
		return nil
	})
	InvalidateTownSnapshotCache()
	BroadcastTownInvalidate(hub, 0)

	recordTownRuntimeEvent(db, hub, "openclaw.run.completed", "主任务已完成", map[string]string{
		"runId":  req.RunID,
		"source": req.Source,
	})
	for _, agentID := range townBridgeParticipantAgentIDs(result) {
		recordTownRuntimeEvent(db, hub, "openclaw.agent.idle", fmt.Sprintf("%s 已恢复待命", agentID), map[string]string{
			"runId":   req.RunID,
			"agentId": agentID,
		})
	}
}

func dispatchTownRunBridge(ctx context.Context, cfg *config.Config, req townBridgeRequest) (townBridgeResult, error) {
	if bridgeURL := strings.TrimSpace(os.Getenv("TOWN_RUN_BRIDGE_URL")); bridgeURL != "" {
		return dispatchTownRunBridgeHTTP(ctx, bridgeURL, req)
	}
	return dispatchTownRunBridgeLocal(ctx, cfg, req)
}

func dispatchTownRunBridgeHTTP(ctx context.Context, bridgeURL string, req townBridgeRequest) (townBridgeResult, error) {
	body := map[string]any{
		"runId":          req.RunID,
		"title":          req.Title,
		"prompt":         req.Prompt,
		"source":         req.Source,
		"managerAgentId": req.ManagerAgentID,
		"selectedAgents": []string{},
		"standbyAgents":  req.StandbyAgentIDs,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return townBridgeResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, bridgeURL, bytes.NewReader(raw))
	if err != nil {
		return townBridgeResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if token := strings.TrimSpace(os.Getenv("TOWN_RUN_BRIDGE_TOKEN")); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return townBridgeResult{}, fmt.Errorf("Town 桥接 OpenClaw 失败: %w", err)
	}
	defer response.Body.Close()

	bodyRaw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode >= 400 {
		return townBridgeResult{}, fmt.Errorf("Town 桥接 OpenClaw 失败: bridge HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(bodyRaw)))
	}

	parsed, payload := decodeTownBridgeResult(bodyRaw)
	if len(bodyRaw) == 0 {
		return parsed, nil
	}
	if payloadErr := townBridgePayloadError(payload); payloadErr != nil {
		return townBridgeResult{}, fmt.Errorf("Town 桥接 OpenClaw 失败: %s", payloadErr.Error())
	}
	return parsed, nil
}

func dispatchTownRunBridgeLocal(ctx context.Context, cfg *config.Config, req townBridgeRequest) (townBridgeResult, error) {
	bin, err := resolveTownOpenClawBinary()
	if err != nil {
		return townBridgeResult{}, fmt.Errorf("Town 桥接 OpenClaw 失败: %w", err)
	}
	// F-07: Build prompt with standby agents context for openclaw-main
	effectivePrompt := req.Prompt
	if len(req.StandbyAgentIDs) > 0 {
		effectivePrompt = fmt.Sprintf("可用协作 Agent: %s\n\n%s", strings.Join(req.StandbyAgentIDs, ", "), req.Prompt)
	}
	command := exec.CommandContext(ctx, bin, "agent", "--agent", req.ManagerAgentID, "--message", effectivePrompt, "--json")
	command.Env = append(os.Environ(),
		fmt.Sprintf("OPENCLAW_DIR=%s", cfg.OpenClawDir),
		fmt.Sprintf("OPENCLAW_WORK=%s", cfg.OpenClawWork),
	)
	output, err := command.CombinedOutput()
	trimmed := strings.TrimSpace(string(output))
	parsed, payload := decodeTownBridgeResult(output)
	if payloadErr := townBridgePayloadError(payload); payloadErr != nil {
		return townBridgeResult{}, fmt.Errorf("Town 桥接 OpenClaw 失败: %s", payloadErr.Error())
	}
	if err != nil {
		if townBridgePayloadLooksSuccessful(payload, parsed) {
			return parsed, nil
		}
		if trimmed == "" {
			trimmed = err.Error()
		}
		return townBridgeResult{}, fmt.Errorf("Town 桥接 OpenClaw 失败: %s", trimmed)
	}
	return parsed, nil
}

func decodeTownBridgeResult(raw []byte) (townBridgeResult, map[string]any) {
	trimmed := strings.TrimSpace(string(raw))
	result := townBridgeResult{Output: trimmed}
	if len(raw) == 0 {
		return result, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return result, nil
	}
	result.Output = extractTownBridgeOutput(payload, trimmed)
	result.SessionID = extractTownBridgeSessionID(payload)
	result.ParticipantAgentIDs = extractTownBridgeParticipantAgentIDs(payload)
	result.SpawnedSessions = extractTownBridgeSpawnedSessions(payload)
	return result, payload
}

func townBridgePayloadError(payload map[string]any) error {
	if len(payload) == 0 {
		return nil
	}
	status := strings.ToLower(strings.TrimSpace(toString(payload["status"])))
	message := strings.TrimSpace(toString(payload["error"]))
	if message == "" {
		message = strings.TrimSpace(toString(payload["message"]))
	}
	if okValue, exists := payload["ok"]; exists {
		if ok, matched := okValue.(bool); matched && !ok {
			if message == "" {
				message = "bridge returned ok=false"
			}
			return errors.New(message)
		}
	}
	if status == "error" || status == "failed" {
		if message == "" {
			message = "bridge returned failure status"
		}
		return errors.New(message)
	}
	if message != "" && status == "" {
		return errors.New(message)
	}
	return nil
}

func townBridgePayloadLooksSuccessful(payload map[string]any, result townBridgeResult) bool {
	if len(payload) == 0 {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(toString(payload["status"])))
	if status == "ok" || status == "completed" || status == "success" {
		return true
	}
	if okValue, exists := payload["ok"]; exists {
		if ok, matched := okValue.(bool); matched {
			return ok
		}
	}
	return result.SessionID != "" || result.Output != ""
}

func extractTownBridgeOutput(payload map[string]any, fallback string) string {
	for _, source := range []map[string]any{payload, asMap(payload["result"])} {
		if len(source) == 0 {
			continue
		}
		if output := strings.TrimSpace(toString(source["output"])); output != "" {
			return output
		}
		if text := strings.TrimSpace(toString(source["text"])); text != "" {
			return text
		}
		if texts := extractTownBridgePayloadTexts(source["payloads"]); len(texts) > 0 {
			return strings.Join(texts, "\n\n")
		}
	}
	return fallback
}

func extractTownBridgeSessionID(payload map[string]any) string {
	for _, source := range []map[string]any{
		payload,
		asMap(payload["result"]),
		asMap(asMap(payload["meta"])["agentMeta"]),
		asMap(asMap(asMap(payload["result"])["meta"])["agentMeta"]),
	} {
		if len(source) == 0 {
			continue
		}
		if sessionID := strings.TrimSpace(toString(source["sessionId"])); sessionID != "" {
			return sessionID
		}
		if sessionID := strings.TrimSpace(toString(source["id"])); sessionID != "" {
			return sessionID
		}
	}
	return ""
}

func extractTownBridgeParticipantAgentIDs(payload map[string]any) []string {
	for _, source := range []map[string]any{payload, asMap(payload["result"])} {
		if len(source) == 0 {
			continue
		}
		for _, key := range []string{"participantAgentIds", "participants"} {
			if ids := uniqueTownStringSlice(source[key]); len(ids) > 0 {
				return ids
			}
		}
	}
	return nil
}

func extractTownBridgeSpawnedSessions(payload map[string]any) []townSharedSpawnedSession {
	for _, source := range []map[string]any{payload, asMap(payload["result"])} {
		if len(source) == 0 {
			continue
		}
		rawSessions, ok := source["spawnedSessions"].([]any)
		if !ok {
			continue
		}
		result := make([]townSharedSpawnedSession, 0, len(rawSessions))
		for _, rawSession := range rawSessions {
			session := asMap(rawSession)
			agentID := strings.TrimSpace(toString(session["agentId"]))
			if agentID == "" {
				continue
			}
			result = append(result, townSharedSpawnedSession{
				ID:      strings.TrimSpace(toString(session["id"])),
				AgentID: agentID,
				Status:  normalizeTownRunStatus(toString(session["status"])),
			})
		}
		if len(result) > 0 {
			return result
		}
	}
	return nil
}

func extractTownBridgePayloadTexts(raw any) []string {
	payloads, ok := raw.([]any)
	if !ok {
		return nil
	}
	texts := make([]string, 0, len(payloads))
	for _, item := range payloads {
		payload := asMap(item)
		text := strings.TrimSpace(toString(payload["text"]))
		if text == "" {
			continue
		}
		texts = append(texts, text)
	}
	return texts
}

func townBridgeParticipantAgentIDs(result townBridgeResult) []string {
	ids := append([]string(nil), result.ParticipantAgentIDs...)
	for _, session := range result.SpawnedSessions {
		ids = append(ids, session.AgentID)
	}
	return uniqueTownStringSlice(ids)
}

func normalizeTownBridgeSpawnedSessions(runID string, sessions []townSharedSpawnedSession, participantAgentIDs []string) []townSharedSpawnedSession {
	if len(sessions) == 0 {
		return buildTownDefaultSpawnedSessions(runID, participantAgentIDs, "completed")
	}
	result := make([]townSharedSpawnedSession, 0, len(sessions))
	seen := map[string]struct{}{}
	for _, session := range sessions {
		agentID := strings.TrimSpace(session.AgentID)
		if agentID == "" {
			continue
		}
		if _, exists := seen[agentID]; exists {
			continue
		}
		seen[agentID] = struct{}{}
		sessionID := strings.TrimSpace(session.ID)
		if sessionID == "" {
			sessionID = fmt.Sprintf("spawn-%s-%s", runID, agentID)
		}
		result = append(result, townSharedSpawnedSession{
			ID:      sessionID,
			AgentID: agentID,
			Status:  normalizeTownRunStatus(session.Status),
		})
	}
	for _, agentID := range participantAgentIDs {
		if _, exists := seen[agentID]; exists {
			continue
		}
		result = append(result, townSharedSpawnedSession{
			ID:      fmt.Sprintf("spawn-%s-%s", runID, agentID),
			AgentID: agentID,
			Status:  "completed",
		})
	}
	return result
}

func buildTownDefaultSpawnedSessions(runID string, participantAgentIDs []string, status string) []townSharedSpawnedSession {
	result := make([]townSharedSpawnedSession, 0, len(participantAgentIDs))
	for _, agentID := range participantAgentIDs {
		result = append(result, townSharedSpawnedSession{
			ID:      fmt.Sprintf("spawn-%s-%s", runID, agentID),
			AgentID: agentID,
			Status:  normalizeTownRunStatus(status),
		})
	}
	return result
}

func ensureTownRunInstances(instances []townSharedInstance, runID string, sessions []townSharedSpawnedSession, status string) []townSharedInstance {
	for _, session := range sessions {
		found := false
		for index := range instances {
			if instances[index].RunID != runID || instances[index].AgentID != session.AgentID {
				continue
			}
			instances[index].SessionID = session.ID
			instances[index].ZoneID = fmt.Sprintf("zone-%s", runID)
			instances[index].Status = normalizeTownInstanceStatus(status)
			found = true
		}
		if found {
			continue
		}
		instances = prependTownInstance(instances, townSharedInstance{
			ID:        fmt.Sprintf("instance-%s-%s", runID, session.AgentID),
			AgentID:   session.AgentID,
			RunID:     runID,
			SessionID: session.ID,
			ZoneID:    fmt.Sprintf("zone-%s", runID),
			Status:    normalizeTownInstanceStatus(status),
		})
	}
	return instances
}

func uniqueTownStringSlice(input any) []string {
	seen := map[string]struct{}{}
	rawItems := make([]string, 0)
	switch typed := input.(type) {
	case []string:
		rawItems = append(rawItems, typed...)
	case []any:
		for _, item := range typed {
			rawItems = append(rawItems, toString(item))
		}
	default:
		return nil
	}
	result := make([]string, 0, len(rawItems))
	for _, raw := range rawItems {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func asMap(raw any) map[string]any {
	mapped, _ := raw.(map[string]any)
	return mapped
}

func resolveTownOpenClawBinary() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("OPENCLAW_BIN")); explicit != "" {
		return explicit, nil
	}
	if found, err := exec.LookPath("openclaw"); err == nil {
		return found, nil
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".local", "bin", "openclaw"),
		filepath.Join(home, ".npm-global", "bin", "openclaw"),
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("找不到 openclaw 可执行文件")
}

func resolveTownBridgeTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("TOWN_RUN_BRIDGE_TIMEOUT_SECONDS"))
	if raw == "" {
		return townDefaultBridgeTimeoutSec * time.Second
	}
	seconds, err := time.ParseDuration(raw + "s")
	if err != nil || seconds <= 0 {
		return townDefaultBridgeTimeoutSec * time.Second
	}
	return seconds
}

func clearTownAgentSessions(cfg *config.Config, agentID string) error {
	sessionsDir := resolveAgentPath(cfg, agentID, "sessions")
	entries, err := os.ReadDir(sessionsDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".jsonl") {
			if err := os.Remove(filepath.Join(sessionsDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte("{}"), 0o644); err != nil {
		return err
	}
	return nil
}

func appendTownAuditRecord(cfg *config.Config, payload any) {
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	file, err := os.OpenFile(townAuditFilePath(cfg), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(raw, '\n'))
}

func recordTownRuntimeEvent(db *sql.DB, hub *ws.Hub, eventType, summary string, fields map[string]string) {
	detail := encodeTownEventDetail(fields)
	if err := validateTownEventFields(eventType, detail); err != nil {
		eventType = "openclaw.run.failed"
		detail = encodeTownEventDetail(map[string]string{
			"message": err.Error(),
			"runId":   strings.TrimSpace(fields["runId"]),
			"source":  strings.TrimSpace(fields["source"]),
		})
	}
	event := &model.Event{
		Source:  "openclaw",
		Type:    eventType,
		Summary: summary,
		Detail:  detail,
	}
	id, err := model.AddEvent(db, event)
	if err != nil || hub == nil {
		return
	}
	if payload, err := json.Marshal(map[string]any{
		"type": "log-entry",
		"data": map[string]any{
			"id":      id,
			"time":    event.Time,
			"source":  event.Source,
			"type":    event.Type,
			"summary": event.Summary,
			"detail":  event.Detail,
		},
	}); err == nil {
		hub.Broadcast(payload)
	}
}

func encodeTownEventDetail(fields map[string]string) string {
	keys := make([]string, 0, len(fields))
	for key, value := range fields {
		if strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, fmt.Sprintf("%s=%s", key, strings.TrimSpace(fields[key])))
	}
	return strings.Join(lines, "\n")
}

func validateTownEventFields(eventType, detail string) error {
	required := map[string][]string{
		"openclaw.run.started":      {"runId", "source"},
		"openclaw.run.completed":    {"runId", "source"},
		"openclaw.run.failed":       {"runId", "source"},
		"openclaw.run.single":       {"runId"},
		"openclaw.session.spawned":  {"runId", "agentId", "sessionId"},
		"openclaw.agent.busy":       {"runId", "agentId"},
		"openclaw.agent.idle":       {"runId", "agentId"},
		"openclaw.agent.auto_added": {"runId", "agentId"},
		"openclaw.agent.reset":      {"agentId"},
		"openclaw.im.received":      {"runId", "source", "prompt"},
	}
	need := required[eventType]
	if len(need) == 0 {
		return nil
	}
	values := map[string]string{}
	for _, line := range strings.Split(detail, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		values[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}
	missing := make([]string, 0, len(need))
	for _, key := range need {
		if strings.TrimSpace(values[key]) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf("%s 缺少字段: %s", eventType, strings.Join(missing, ", "))
}

func buildTownCompletionDetail(output string) string {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return "主任务已完成，办公室成员回到待命状态。"
	}
	if len(trimmed) > 280 {
		trimmed = trimmed[:280] + "..."
	}
	return trimmed
}

func handleTownOfficeMemberError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errTownVersionConflict):
		RecordTownStoreConflict()
		townError(c, http.StatusConflict, "town.office_members.version_conflict", "办公室成员池版本冲突，请刷新后重试")
	case errors.Is(err, errTownEmptyPatch):
		townError(c, http.StatusBadRequest, "town.office_members.empty_patch", "办公室成员池补丁为空")
	case errors.Is(err, errTownManagerLocked):
		townError(c, http.StatusBadRequest, "town.office_members.manager_locked", "主控 Agent 不能加入成员池")
	case errors.Is(err, errTownSelectedLimit):
		townError(c, http.StatusBadRequest, "town.office_members.selected_limit", "已超过手动选择上限")
	case strings.HasPrefix(err.Error(), "town.office_members.agent_not_found:"):
		townError(c, http.StatusBadRequest, "town.office_members.agent_not_found", strings.TrimPrefix(err.Error(), "town.office_members.agent_not_found:"))
	case strings.HasPrefix(err.Error(), "town.office_members.invalid_membership:"):
		townError(c, http.StatusBadRequest, "town.office_members.invalid_membership", "办公室成员状态无效")
	case err.Error() == "town.office_members.agent_required":
		townError(c, http.StatusBadRequest, "town.office_members.agent_required", "agentId 不能为空")
	default:
		townError(c, http.StatusInternalServerError, "town.office_members.state_write_failed", err.Error())
	}
}

func townError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{
		"ok":    false,
		"code":  code,
		"error": message,
	})
}

func minTownInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxTownInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func parseTownInt(s string, fallback int) int {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return fallback
		}
		n = n*10 + int(ch-'0')
	}
	if n == 0 && s != "0" {
		return fallback
	}
	return n
}
