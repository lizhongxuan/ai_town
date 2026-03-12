package handler

type TownSnapshotSkill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Source      string `json:"source"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description"`
}

type TownSnapshotAgent struct {
	ID               string              `json:"id"`
	Name             string              `json:"name,omitempty"`
	Role             string              `json:"role,omitempty"`
	Description      string              `json:"description,omitempty"`
	Skills           []TownSnapshotSkill `json:"skills,omitempty"`
	Sessions         int                 `json:"sessions,omitempty"`
	LastActive       int64               `json:"lastActive,omitempty"`
	LastActiveRfc333 string              `json:"lastActiveRfc3339,omitempty"`
	RecentWeight     int                 `json:"recentWeight,omitempty"`
	OfficeMembership string              `json:"officeMembership,omitempty"`
	ExecutionState   string              `json:"executionState,omitempty"`
	SessionRole      string              `json:"sessionRole,omitempty"`
	Location         string              `json:"location,omitempty"`
}

type TownSnapshotOpenClaw struct {
	AgentID string `json:"agentId,omitempty"`
	Name    string `json:"name,omitempty"`
}

type TownSnapshotSync struct {
	Mode                  string `json:"mode,omitempty"`
	BusyWindowSeconds     int    `json:"busyWindowSeconds,omitempty"`
	StateDebounceSeconds  int    `json:"stateDebounceSeconds,omitempty"`
	CompletedWindowSecond int    `json:"completedWindowSeconds,omitempty"`
}

type TownSnapshotEvent struct {
	ID          string `json:"id"`
	Type        string `json:"type,omitempty"`
	Title       string `json:"title,omitempty"`
	Detail      string `json:"detail,omitempty"`
	TimeLabel   string `json:"timeLabel,omitempty"`
	Time        int64  `json:"time,omitempty"`
	TimeRfc3339 string `json:"timeRfc3339,omitempty"`
	RunID       string `json:"runId,omitempty"`
	SceneHint   string `json:"sceneHint,omitempty"`
}

type TownSnapshotLog struct {
	ID          string `json:"id"`
	RunID       string `json:"runId,omitempty"`
	AgentID     string `json:"agentId,omitempty"`
	Title       string `json:"title,omitempty"`
	Detail      string `json:"detail,omitempty"`
	TimeLabel   string `json:"timeLabel,omitempty"`
	Time        int64  `json:"time,omitempty"`
	TimeRfc3339 string `json:"timeRfc3339,omitempty"`
	Type        string `json:"type,omitempty"`
}

type TownSnapshotSpawnedSession struct {
	ID      string `json:"id,omitempty"`
	AgentID string `json:"agentId,omitempty"`
	Status  string `json:"status,omitempty"`
}

type TownSnapshotRun struct {
	ID                 string                      `json:"id,omitempty"`
	Title              string                      `json:"title,omitempty"`
	Prompt             string                      `json:"prompt,omitempty"`
	Source             string                      `json:"source,omitempty"`
	Status             string                      `json:"status,omitempty"`
	PrimarySessionID   string                      `json:"primarySessionId,omitempty"`
	CreatedAt          int64                       `json:"createdAt,omitempty"`
	CreatedAtRfc3339   string                      `json:"createdAtRfc3339,omitempty"`
	UpdatedAt          int64                       `json:"updatedAt,omitempty"`
	UpdatedAtRfc3339   string                      `json:"updatedAtRfc3339,omitempty"`
	CreatedAtLabel     string                      `json:"createdAtLabel,omitempty"`
	UpdatedAtLabel     string                      `json:"updatedAtLabel,omitempty"`
	ParticipantAgentID []string                    `json:"participantAgentIds,omitempty"`
	SpawnedSessions    []TownSnapshotSpawnedSession `json:"spawnedSessions,omitempty"`
}

type TownSnapshotInstance struct {
	ID        string `json:"id,omitempty"`
	AgentID   string `json:"agentId,omitempty"`
	RunID     string `json:"runId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	ZoneID    string `json:"zoneId,omitempty"`
	Status    string `json:"status,omitempty"`
}

type TownSnapshot struct {
	Clock              string                       `json:"clock,omitempty"`
	Weather            string                       `json:"weather,omitempty"`
	Version            int64                        `json:"version,omitempty"`
	Sync               TownSnapshotSync             `json:"sync,omitempty"`
	OpenClaw           TownSnapshotOpenClaw         `json:"openclaw,omitempty"`
	MaxSelectableAgent int                          `json:"maxSelectableAgents,omitempty"`
	OfficeMembers      map[string]string            `json:"officeMembers,omitempty"`
	Agents             []TownSnapshotAgent          `json:"agents,omitempty"`
	VisibleTownAgentID []string                     `json:"visibleTownAgentIds,omitempty"`
	Events             []TownSnapshotEvent          `json:"events,omitempty"`
	Logs               []TownSnapshotLog            `json:"logs,omitempty"`
	Runs               []TownSnapshotRun            `json:"runs,omitempty"`
	Instances          []TownSnapshotInstance       `json:"instances,omitempty"`
}

type townOfficeMembersRequest struct {
	AgentID         string                   `json:"agentId"`
	Membership      string                   `json:"membership"`
	Members         []townOfficeMemberPatch  `json:"members"`
	ExpectedVersion *int64                   `json:"expectedVersion"`
}

type townOfficeMemberPatch struct {
	AgentID    string `json:"agentId"`
	Membership string `json:"membership"`
}

type townCreateRunRequest struct {
	Title          string   `json:"title"`
	Prompt         string   `json:"prompt"`
	Source         string   `json:"source"`
	SelectedAgents []string `json:"selectedAgents"`
}

type townResetAgentRequest struct {
	KeepInOffice bool `json:"keepInOffice"`
}

type townSharedState struct {
	Version       int64                  `json:"version"`
	OfficeMembers map[string]string      `json:"officeMembers,omitempty"`
	Runs          []townSharedRun        `json:"runs,omitempty"`
	Logs          []townSharedLog        `json:"logs,omitempty"`
	Events        []townSharedEvent      `json:"events,omitempty"`
	Instances     []townSharedInstance   `json:"instances,omitempty"`
	RecentWeights map[string]int         `json:"recentWeights,omitempty"`
	UpdatedAt     int64                  `json:"updatedAt,omitempty"`
}

type townSharedRun struct {
	ID                  string                     `json:"id,omitempty"`
	Title               string                     `json:"title,omitempty"`
	Prompt              string                     `json:"prompt,omitempty"`
	Source              string                     `json:"source,omitempty"`
	Status              string                     `json:"status,omitempty"`
	PrimarySessionID    string                     `json:"primarySessionId,omitempty"`
	CreatedAt           int64                      `json:"createdAt,omitempty"`
	UpdatedAt           int64                      `json:"updatedAt,omitempty"`
	ParticipantAgentIDs []string                   `json:"participantAgentIds,omitempty"`
	SpawnedSessions     []townSharedSpawnedSession `json:"spawnedSessions,omitempty"`
	Error               string                     `json:"error,omitempty"`
}

type townSharedSpawnedSession struct {
	ID      string `json:"id,omitempty"`
	AgentID string `json:"agentId,omitempty"`
	Status  string `json:"status,omitempty"`
}

type townSharedLog struct {
	ID      string `json:"id"`
	RunID   string `json:"runId,omitempty"`
	AgentID string `json:"agentId,omitempty"`
	Title   string `json:"title,omitempty"`
	Detail  string `json:"detail,omitempty"`
	Time    int64  `json:"time,omitempty"`
	Type    string `json:"type,omitempty"`
}

type townSharedEvent struct {
	ID        string `json:"id"`
	Type      string `json:"type,omitempty"`
	Title     string `json:"title,omitempty"`
	Detail    string `json:"detail,omitempty"`
	Time      int64  `json:"time,omitempty"`
	RunID     string `json:"runId,omitempty"`
	SceneHint string `json:"sceneHint,omitempty"`
}

type townSharedInstance struct {
	ID        string `json:"id,omitempty"`
	AgentID   string `json:"agentId,omitempty"`
	RunID     string `json:"runId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	ZoneID    string `json:"zoneId,omitempty"`
	Status    string `json:"status,omitempty"`
}

type townBridgeRequest struct {
	RunID          string
	Title          string
	Prompt         string
	Source         string
	ManagerAgentID string
	SelectedAgents []string
}

type townBridgeResult struct {
	Output    string `json:"output,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}
