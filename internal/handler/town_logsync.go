package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/zhaoxinyi02/ClawPanel/internal/config"
	ws "github.com/zhaoxinyi02/ClawPanel/internal/websocket"
)

// ---------------------------------------------------------------------------
// F-09: OpenClaw 日志实时监听引擎
//
// 借鉴 Star-Office-UI 的 office_sync.py 方案，通过 tail -F 实时监听
// OpenClaw 运行日志，解析 agent/embedded 和 diagnostic 子系统事件，
// 让 IM 模式下也能实时显示 agent 工作状态。
// ---------------------------------------------------------------------------

// agentLiveState 表示一个 agent 的实时工作状态（由日志监听推导）
type agentLiveState struct {
	AgentID   string
	State     string // idle / researching / executing / editing
	Detail    string
	RunID     string
	SessionID string
	UpdatedAt time.Time
}

// townLogSyncer 是日志监听引擎的主结构
type townLogSyncer struct {
	cfg          *config.Config
	hub          *ws.Hub
	mu           sync.Mutex
	agentStates  map[string]*agentLiveState
	sessionCache map[string]string // sessionId → agentId
	logDir       string
	cancel       context.CancelFunc
	idleTimeout  time.Duration
}

var (
	logSyncAgentRe    = regexp.MustCompile(`agent:([a-zA-Z0-9_-]+):`)
	logSyncLaneRe     = regexp.MustCompile(`lane=session:agent:([a-zA-Z0-9_-]+):`)
	logSyncDurationRe = regexp.MustCompile(`durationMs=(\d+)`)
	logSyncFieldRe    = regexp.MustCompile(`(\w+)=([^\s]+)`)
)

// StartTownLogSyncer 启动日志监听引擎。
// 在 InitTownStore 之后调用。
func StartTownLogSyncer(cfg *config.Config, hub *ws.Hub) {
	logDir := strings.TrimSpace(os.Getenv("OPENCLAW_LOG_DIR"))
	if logDir == "" {
		logDir = "/tmp/openclaw"
	}

	ctx, cancel := context.WithCancel(context.Background())
	syncer := &townLogSyncer{
		cfg:          cfg,
		hub:          hub,
		agentStates:  make(map[string]*agentLiveState),
		sessionCache: make(map[string]string),
		logDir:       logDir,
		cancel:       cancel,
		idleTimeout:  10 * time.Minute,
	}

	syncer.buildSessionCache()
	go syncer.watchLoop(ctx)
	go syncer.cleanupLoop(ctx)
	log.Printf("[TownLogSync] 引擎已启动，监听目录: %s", logDir)
}

// buildSessionCache 启动时扫描文件系统，构建 sessionId → agentId 映射
func (s *townLogSyncer) buildSessionCache() {
	agentIDs, _ := loadAgentIDs(s.cfg)
	count := 0
	for _, agentID := range agentIDs {
		sessionsDir := resolveAgentPath(s.cfg, agentID, "sessions")
		entries, err := os.ReadDir(sessionsDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if !strings.Contains(name, ".jsonl") {
				continue
			}
			sessionID := strings.Split(name, ".")[0]
			if sessionID != "" {
				s.sessionCache[sessionID] = agentID
				count++
			}
		}
	}
	log.Printf("[TownLogSync] 已缓存 %d 个 session → agent 映射", count)
}

// identifyAgent 三重策略识别日志行属于哪个 agent
func (s *townLogSyncer) identifyAgent(runID, sessionID, rawContent string) string {
	// 策略1: runId 解析
	if runID != "" {
		if m := logSyncAgentRe.FindStringSubmatch(runID); len(m) > 1 {
			_, agentSet := loadAgentIDs(s.cfg)
			if _, ok := agentSet[m[1]]; ok {
				return m[1]
			}
		}
	}
	// 策略2: sessionId 文件系统反查
	if sessionID != "" {
		s.mu.Lock()
		cached, ok := s.sessionCache[sessionID]
		s.mu.Unlock()
		if ok {
			return cached
		}
		if found := s.refreshSessionCache(sessionID); found != "" {
			return found
		}
	}
	// 策略3: 字符串匹配兜底
	agentIDs, _ := loadAgentIDs(s.cfg)
	lower := strings.ToLower(rawContent)
	for _, agentID := range agentIDs {
		if agentID == "main" {
			continue
		}
		if strings.Contains(lower, strings.ToLower(agentID)) {
			return agentID
		}
	}
	return "main"
}

func (s *townLogSyncer) refreshSessionCache(sessionID string) string {
	agentIDs, _ := loadAgentIDs(s.cfg)
	for _, agentID := range agentIDs {
		sessionPath := resolveAgentPath(s.cfg, agentID, "sessions", sessionID+".jsonl")
		if _, err := os.Stat(sessionPath); err == nil {
			s.mu.Lock()
			s.sessionCache[sessionID] = agentID
			s.mu.Unlock()
			return agentID
		}
	}
	return ""
}

// processLogLine 解析单行 JSON 日志
func (s *townLogSyncer) processLogLine(line string) {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "{") {
		return
	}
	var logData map[string]interface{}
	if err := json.Unmarshal([]byte(line), &logData); err != nil {
		return
	}
	meta, _ := logData["_meta"].(map[string]interface{})
	nameRaw := toString(meta["name"])

	subsystem := nameRaw
	if strings.HasPrefix(nameRaw, "{") {
		var nameObj map[string]interface{}
		if json.Unmarshal([]byte(nameRaw), &nameObj) == nil {
			if sub := toString(nameObj["subsystem"]); sub != "" {
				subsystem = sub
			}
		}
	}

	switch subsystem {
	case "agent/embedded":
		s.processEmbeddedSignal(logData)
	case "diagnostic":
		s.processDiagnosticSignal(logData)
	}
}

// processEmbeddedSignal 处理 agent/embedded 子系统的日志信号
func (s *townLogSyncer) processEmbeddedSignal(logData map[string]interface{}) {
	msg := strings.ToLower(toString(logData["1"]))
	contentF0 := strings.ToLower(toString(logData["0"]))
	fullMsg := msg + " " + contentF0

	if !strings.Contains(fullMsg, "embedded run") {
		return
	}

	fields := extractLogSyncFields(msg)
	runID := logSyncFirstNonEmpty(fields["runid"], fields["runId"])
	sessionID := logSyncFirstNonEmpty(fields["sessionid"], fields["sessionId"])
	toolName := fields["tool"]

	raw, _ := json.Marshal(logData)
	agentID := s.identifyAgent(runID, sessionID, string(raw))

	// 忽略 manager agent（openclaw-main）
	if agentID == loadDefaultAgentID(s.cfg) {
		return
	}

	switch {
	case strings.Contains(fullMsg, "embedded run done"):
		s.updateAgentState(agentID, "executing", "等待下一步指令...", runID, sessionID)

	case strings.Contains(fullMsg, "embedded run start") &&
		!strings.Contains(fullMsg, "tool") &&
		!strings.Contains(fullMsg, "prompt") &&
		!strings.Contains(fullMsg, "agent"):
		channel := logSyncFirstNonEmpty(fields["messagechannel"], fields["messageChannel"])
		detail := "接到新任务..."
		if channel != "" {
			detail = fmt.Sprintf("接到新任务 (%s)...", channel)
		}
		s.updateAgentState(agentID, "executing", detail, runID, sessionID)

	case strings.Contains(fullMsg, "embedded run prompt start"):
		s.updateAgentState(agentID, "researching", "正在思考分析...", runID, sessionID)

	case strings.Contains(fullMsg, "embedded run tool start"):
		detail := "正在执行工具..."
		state := "executing"
		if toolName != "" {
			detail = fmt.Sprintf("正在使用工具: %s", toolName)
			for _, kw := range []string{"edit", "write", "replace", "multi_replace"} {
				if strings.Contains(toolName, kw) {
					state = "editing"
					break
				}
			}
		}
		s.updateAgentState(agentID, state, detail, runID, sessionID)

	case strings.Contains(fullMsg, "embedded run tool end"):
		s.updateAgentState(agentID, "executing", "整理返回结果...", runID, sessionID)

	case strings.Contains(fullMsg, "embedded run prompt end"):
		s.updateAgentState(agentID, "executing", "思考完成，继续处理...", runID, sessionID)
	}
}

// processDiagnosticSignal 处理 diagnostic 子系统的日志信号
func (s *townLogSyncer) processDiagnosticSignal(logData map[string]interface{}) {
	msg := toString(logData["1"])
	if !strings.Contains(msg, "lane") {
		return
	}

	m := logSyncLaneRe.FindStringSubmatch(msg)
	if len(m) < 2 {
		return
	}
	agentID := m[1]
	_, agentSet := loadAgentIDs(s.cfg)
	if _, ok := agentSet[agentID]; !ok {
		return
	}

	switch {
	case strings.Contains(msg, "lane enqueue"):
		s.updateAgentState(agentID, "executing", "接到任务，启动中...", "", "")

	case strings.Contains(msg, "lane task done"):
		dur := "?"
		if dm := logSyncDurationRe.FindStringSubmatch(msg); len(dm) > 1 {
			dur = dm[1]
		}
		s.removeAgentState(agentID)
		log.Printf("[TownLogSync] %s lane 完成 (%sms) → idle", agentID, dur)
	}
}

// updateAgentState 更新 agent 实时状态，触发 snapshot 缓存失效 + WS 推送
func (s *townLogSyncer) updateAgentState(agentID, state, detail, runID, sessionID string) {
	s.mu.Lock()
	prev := s.agentStates[agentID]
	if prev != nil && prev.State == state && prev.Detail == detail {
		s.mu.Unlock()
		return // 防抖
	}
	s.agentStates[agentID] = &agentLiveState{
		AgentID:   agentID,
		State:     state,
		Detail:    detail,
		RunID:     runID,
		SessionID: sessionID,
		UpdatedAt: time.Now(),
	}
	s.mu.Unlock()

	s.syncInstanceToStore(agentID, state, runID, sessionID)
	InvalidateTownSnapshotCache()
	BroadcastTownInvalidate(s.hub, 0)
}

// removeAgentState 移除 agent 实时状态（任务完成，回到 idle）
func (s *townLogSyncer) removeAgentState(agentID string) {
	s.mu.Lock()
	delete(s.agentStates, agentID)
	s.mu.Unlock()

	s.cleanupInstanceFromStore(agentID)
	InvalidateTownSnapshotCache()
	BroadcastTownInvalidate(s.hub, 0)
}

// syncInstanceToStore 将日志监听到的 agent 状态同步到 townSharedState
func (s *townLogSyncer) syncInstanceToStore(agentID, state, runID, sessionID string) {
	instanceStatus := "executing"
	if state == "researching" {
		instanceStatus = "thinking"
	}

	_, _ = townStore.UpdateState(nil, func(st *townSharedState) error {
		// 查找已有活跃 instance
		for i := range st.Instances {
			if st.Instances[i].AgentID == agentID &&
				st.Instances[i].Status != "completed" &&
				st.Instances[i].Status != "error" {
				st.Instances[i].Status = instanceStatus
				if runID != "" {
					st.Instances[i].RunID = runID
				}
				if sessionID != "" {
					st.Instances[i].SessionID = sessionID
				}
				return nil
			}
		}

		// 创建新 instance
		effectiveRunID := runID
		if effectiveRunID == "" {
			effectiveRunID = fmt.Sprintf("logsync-%d", time.Now().UnixMilli())
		}
		st.Instances = prependTownInstance(st.Instances, townSharedInstance{
			ID:        fmt.Sprintf("instance-logsync-%s-%d", agentID, time.Now().UnixMilli()),
			AgentID:   agentID,
			RunID:     effectiveRunID,
			SessionID: sessionID,
			ZoneID:    fmt.Sprintf("zone-logsync-%s", agentID),
			Status:    instanceStatus,
		})

		// 尝试把 agent 加入已有 running run 的参与者
		for i := range st.Runs {
			if st.Runs[i].Status == "running" {
				alreadyIn := false
				for _, pid := range st.Runs[i].ParticipantAgentIDs {
					if pid == agentID {
						alreadyIn = true
						break
					}
				}
				if !alreadyIn {
					st.Runs[i].ParticipantAgentIDs = append(st.Runs[i].ParticipantAgentIDs, agentID)
				}
				return nil
			}
		}

		// 没有活跃 run → 创建虚拟 run
		st.Runs = prependTownRun(st.Runs, townSharedRun{
			ID:                  effectiveRunID,
			Title:               fmt.Sprintf("%s 正在工作", agentID),
			Source:              "logsync",
			Status:              "running",
			CreatedAt:           time.Now().UnixMilli(),
			UpdatedAt:           time.Now().UnixMilli(),
			ParticipantAgentIDs: []string{agentID},
		})
		return nil
	})
}

// cleanupInstanceFromStore 清理 agent 的 logsync instance
func (s *townLogSyncer) cleanupInstanceFromStore(agentID string) {
	officeSet := OfficeMemberSet(s.cfg)

	s.mu.Lock()
	activeAgents := make(map[string]bool, len(s.agentStates))
	for id := range s.agentStates {
		activeAgents[id] = true
	}
	s.mu.Unlock()

	_, _ = townStore.UpdateState(nil, func(st *townSharedState) error {
		cleaned := st.Instances[:0]
		for _, inst := range st.Instances {
			if inst.AgentID == agentID && strings.HasPrefix(inst.ID, "instance-logsync-") {
				if officeSet[agentID] {
					inst.Status = "completed"
					cleaned = append(cleaned, inst)
				}
				continue // 不在 OFFICE.md → 删除，回主镇
			}
			cleaned = append(cleaned, inst)
		}
		st.Instances = cleaned

		// 清理 logsync 虚拟 run
		for i := range st.Runs {
			if !strings.HasPrefix(st.Runs[i].ID, "logsync-") || st.Runs[i].Status != "running" {
				continue
			}
			allDone := true
			for _, pid := range st.Runs[i].ParticipantAgentIDs {
				if activeAgents[pid] {
					allDone = false
					break
				}
			}
			if allDone {
				st.Runs[i].Status = "completed"
				st.Runs[i].UpdatedAt = time.Now().UnixMilli()
			}
		}
		return nil
	})
}

// watchLoop 持续监听日志目录中的所有 .log 文件
func (s *townLogSyncer) watchLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if _, err := os.Stat(s.logDir); os.IsNotExist(err) {
			time.Sleep(5 * time.Second)
			continue
		}

		logFiles := s.findLogFiles()
		if len(logFiles) == 0 {
			time.Sleep(5 * time.Second)
			continue
		}

		log.Printf("[TownLogSync] 开始监控 %d 个日志文件", len(logFiles))

		args := append([]string{"-F", "-n", "0"}, logFiles...)
		cmd := exec.CommandContext(ctx, "tail", args...)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			log.Printf("[TownLogSync] 创建 tail 管道失败: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		if err := cmd.Start(); err != nil {
			log.Printf("[TownLogSync] 启动 tail 失败: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 256*1024), 256*1024)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "==>") && strings.Contains(line, "<==") {
				continue
			}
			s.processLogLine(line)
		}

		_ = cmd.Wait()
		log.Printf("[TownLogSync] tail 进程退出，5 秒后重启...")
		time.Sleep(5 * time.Second)
	}
}

func (s *townLogSyncer) findLogFiles() []string {
	entries, err := os.ReadDir(s.logDir)
	if err != nil {
		return nil
	}
	var files []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "openclaw-") && strings.HasSuffix(name, ".log") {
			files = append(files, filepath.Join(s.logDir, name))
		}
	}
	sort.Strings(files)
	return files
}

// cleanupLoop 定期清理超时的 agent 状态
func (s *townLogSyncer) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupStaleAgents()
		}
	}
}

func (s *townLogSyncer) cleanupStaleAgents() {
	now := time.Now()
	s.mu.Lock()
	var stale []string
	for agentID, state := range s.agentStates {
		if now.Sub(state.UpdatedAt) > s.idleTimeout {
			stale = append(stale, agentID)
		}
	}
	for _, agentID := range stale {
		delete(s.agentStates, agentID)
	}
	s.mu.Unlock()

	if len(stale) > 0 {
		for _, agentID := range stale {
			s.cleanupInstanceFromStore(agentID)
			log.Printf("[TownLogSync] %s 超时 (%v)，自动回到 idle", agentID, s.idleTimeout)
		}
		InvalidateTownSnapshotCache()
		BroadcastTownInvalidate(s.hub, 0)
	}
}

// --- helpers ---

func extractLogSyncFields(msg string) map[string]string {
	fields := make(map[string]string)
	for _, m := range logSyncFieldRe.FindAllStringSubmatch(msg, -1) {
		fields[m[1]] = m[2]
	}
	return fields
}

func logSyncFirstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
