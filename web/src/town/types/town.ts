export type TownSceneId = 'mainTown' | 'office';
export type TownFacing = 'up' | 'down' | 'left' | 'right';
export type TownOfficeMembership = 'unselected' | 'selected' | 'auto_added';
export type TownExecutionState = 'idle' | 'standby' | 'busy' | 'completed' | 'error';
export type TownSessionRole = 'none' | 'primary' | 'spawned';
export type TownRunStatus = 'running' | 'completed' | 'error';
export type TownRunSource = 'manual' | 'im';
export type TownBuildingType = 'boss' | 'office' | 'decoration';
export type TownLogType = 'system' | 'session' | 'spawn' | 'im';
export type TownEventType = 'info' | 'success' | 'warning' | 'im';
export type TownZoneState = 'running' | 'fading';
export type TownAgentInstanceStatus = 'thinking' | 'executing' | 'completed' | 'error';

export interface TownPosition {
  x: number;
  y: number;
}

export interface TownSceneDef {
  id: TownSceneId;
  name: string;
  subtitle: string;
  width: number;
  height: number;
}

export interface TownSkill {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  description: string;
}

export interface TownAgent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  avatarHue: string;
  description: string;
  skills: TownSkill[];
  facing: TownFacing;
  speech?: string;
  location: TownSceneId;
  officeMembership: TownOfficeMembership;
  executionState: TownExecutionState;
  sessionRole: TownSessionRole;
  position: TownPosition;
  homePosition: TownPosition;
  officePosition: TownPosition;
  currentRunId?: string;
  recentWeight: number;
}

export interface TownAmbientResident {
  id: string;
  name: string;
  emoji: string;
  facing: TownFacing;
  speech?: string;
  position: TownPosition;
  homePosition: TownPosition;
}

export interface TownBoss {
  id: string;
  name: string;
  title: string;
  location: TownSceneId;
  summary: string;
  mainTownPosition: TownPosition;
  officePosition: TownPosition;
  officeDeskPosition: TownPosition;
  mainTownFacing: TownFacing;
  officeFacing: TownFacing;
}

export interface TownBuilding {
  id: string;
  name: string;
  label: string;
  type: TownBuildingType;
  sceneId: TownSceneId;
  position: TownPosition;
  size: { w: number; h: number };
  description: string;
  interactive?: boolean;
}

export interface TownSpawnedSession {
  id: string;
  agentId: string;
  status: TownRunStatus;
}

export interface TownRun {
  id: string;
  title: string;
  prompt: string;
  source: TownRunSource;
  status: TownRunStatus;
  primarySessionId: string;
  createdAt: number;
  updatedAt: number;
  createdAtLabel: string;
  updatedAtLabel: string;
  participantAgentIds: string[];
  spawnedSessions: TownSpawnedSession[];
}

export interface TownZone {
  id: string;
  title: string;
  runId: string;
  state: TownZoneState;
  status: TownRunStatus;
  brightness: number;
  updatedAt: number;
  recentEvents: number;
  participantAgentIds: string[];
}

export interface TownAgentInstance {
  id: string;
  agentId: string;
  runId: string;
  sessionId?: string;
  zoneId: string;
  status: TownAgentInstanceStatus;
}

export interface TownLogEntry {
  id: string;
  runId?: string;
  agentId?: string;
  title: string;
  detail: string;
  timeLabel: string;
  time: number;
  type: TownLogType;
}

export interface TownEvent {
  id: string;
  type: TownEventType;
  title: string;
  detail: string;
  timeLabel: string;
  time: number;
  runId?: string;
  sceneHint?: TownSceneId;
}

export interface TownState {
  scenes: Record<TownSceneId, TownSceneDef>;
  activeSceneId: TownSceneId;
  clock: string;
  weather: string;
  version: number;
  boss: TownBoss;
  agents: TownAgent[];
  ambientResidents: TownAmbientResident[];
  buildings: TownBuilding[];
  runs: TownRun[];
  instances: TownAgentInstance[];
  logs: TownLogEntry[];
  events: TownEvent[];
  visibleTownAgentIds: string[];
  maxSelectableAgents: number;
}

export interface TownSnapshotSkill {
  id: string;
  name: string;
  source: string;
  enabled?: boolean;
  description?: string;
}

export interface TownSnapshotAgent {
  id: string;
  name?: string;
  role?: string;
  description?: string;
  skills?: TownSnapshotSkill[];
  sessions?: number;
  lastActive?: number;
  recentWeight?: number;
  officeMembership?: string;
  executionState?: string;
  sessionRole?: string;
  location?: string;
}

export interface TownSnapshotOpenClaw {
  agentId?: string;
  name?: string;
}

export interface TownSnapshotSync {
  mode?: string;
  busyWindowSeconds?: number;
  stateDebounceSeconds?: number;
  completedWindowSeconds?: number;
}

export interface TownSnapshotEvent {
  id: string;
  type?: string;
  title?: string;
  detail?: string;
  timeLabel?: string;
  time?: number;
  timeRfc3339?: string;
  runId?: string;
  sceneHint?: string;
}

export interface TownSnapshotLog {
  id: string;
  runId?: string;
  agentId?: string;
  title?: string;
  detail?: string;
  timeLabel?: string;
  time?: number;
  timeRfc3339?: string;
  type?: string;
}

export interface TownSnapshotRun {
  id?: string;
  title?: string;
  prompt?: string;
  source?: string;
  status?: string;
  primarySessionId?: string;
  createdAt?: number;
  createdAtRfc3339?: string;
  updatedAt?: number;
  updatedAtRfc3339?: string;
  createdAtLabel?: string;
  updatedAtLabel?: string;
  participantAgentIds?: string[];
  spawnedSessions?: Array<{ id?: string; agentId?: string; status?: string }>;
}

export interface TownSnapshotInstance {
  id?: string;
  agentId?: string;
  runId?: string;
  sessionId?: string;
  zoneId?: string;
  status?: string;
}

export interface TownSnapshot {
  clock?: string;
  weather?: string;
  version?: number;
  sync?: TownSnapshotSync;
  openclaw?: TownSnapshotOpenClaw;
  maxSelectableAgents?: number;
  officeMembers?: Record<string, string>;
  agents?: TownSnapshotAgent[];
  visibleTownAgentIds?: string[];
  events?: TownSnapshotEvent[];
  logs?: TownSnapshotLog[];
  runs?: TownSnapshotRun[];
  instances?: TownSnapshotInstance[];
}
