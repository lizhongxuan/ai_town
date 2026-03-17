import { buildTownStateFromMock } from './townState';
import {
  TownAgentInstance,
  TownAgent,
  TownEvent,
  TownExecutionState,
  TownFacing,
  TownLogEntry,
  TownOfficeMembership,
  TownRun,
  TownRunSource,
  TownRunStatus,
  TownSceneId,
  TownSessionRole,
  TownSkill,
  TownSnapshot,
  TownSnapshotAgent,
  TownSnapshotInstance,
  TownSnapshotRun,
  TownState,
} from '../types/town';

const MAIN_TOWN_VISIBLE_AGENT_LIMIT = 6;

const KNOWN_AGENT_VISUALS: Record<string, { emoji: string; avatarHue: string }> = {
  coder: { emoji: '🛠', avatarHue: 'from-sky-500 to-cyan-400' },
  researcher: { emoji: '🔎', avatarHue: 'from-amber-500 to-orange-400' },
  reviewer: { emoji: '🧪', avatarHue: 'from-violet-500 to-fuchsia-400' },
  writer: { emoji: '📝', avatarHue: 'from-rose-500 to-pink-400' },
  designer: { emoji: '🎨', avatarHue: 'from-emerald-500 to-teal-400' },
  ops: { emoji: '⚙️', avatarHue: 'from-stone-500 to-slate-400' },
};

const FALLBACK_EMOJIS = ['🧠', '📦', '🛰', '🧩', '🧭', '🛡️', '🧯', '🧱', '🔧', '📎'];
const FALLBACK_HUES = [
  'from-indigo-500 to-blue-400',
  'from-cyan-500 to-sky-400',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-400',
  'from-fuchsia-500 to-pink-400',
  'from-slate-500 to-zinc-400',
];
const OFFICE_SLOT_POSITIONS = [
  { x: 4, y: 6 },
  { x: 7, y: 6 },
  { x: 10, y: 6 },
  { x: 13, y: 6 },
  { x: 5, y: 8 },
  { x: 9, y: 8 },
  { x: 12, y: 8 },
  { x: 14, y: 8 },
];
const MAIN_TOWN_HOME_POSITIONS: Record<string, { x: number; y: number }> = {
  coder: { x: 4, y: 9 },
  researcher: { x: 7, y: 6 },
  reviewer: { x: 10, y: 10 },
  writer: { x: 12, y: 6 },
  designer: { x: 15, y: 9 },
  ops: { x: 16, y: 7 },
};

function cloneState(value: TownState): TownState {
  return JSON.parse(JSON.stringify(value));
}

function hashText(value: string) {
  let hash = 0;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = (hash * 31 + value.charCodeAt(idx)) >>> 0;
  }
  return hash;
}

function pickVisual(agentId: string) {
  if (KNOWN_AGENT_VISUALS[agentId]) {
    return KNOWN_AGENT_VISUALS[agentId];
  }
  const hash = hashText(agentId);
  return {
    emoji: FALLBACK_EMOJIS[hash % FALLBACK_EMOJIS.length],
    avatarHue: FALLBACK_HUES[hash % FALLBACK_HUES.length],
  };
}

function normalizeRole(raw: unknown) {
  const role = typeof raw === 'string' ? raw.trim() : '';
  return role || '协作成员';
}

function normalizeName(rawName: unknown, agentId: string) {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name) return name;
  const readable = agentId.replace(/[_-]+/g, ' ').trim();
  if (!readable) return agentId;
  return readable.replace(/\b\w/g, token => token.toUpperCase());
}

function sanitizeMembership(raw: unknown): TownOfficeMembership {
  if (raw === 'selected') return 'selected';
  if (raw === 'auto_added') return 'auto_added';
  return 'unselected';
}

function sanitizeExecutionState(raw: unknown, membership: TownOfficeMembership): TownExecutionState {
  if (raw === 'busy' || raw === 'standby' || raw === 'completed' || raw === 'error' || raw === 'idle') {
    return raw;
  }
  return membership === 'unselected' ? 'idle' : 'standby';
}

function sanitizeSessionRole(raw: unknown, executionState: TownExecutionState): TownSessionRole {
  if (raw === 'none' || raw === 'primary' || raw === 'spawned') {
    return raw;
  }
  return executionState === 'busy' ? 'spawned' : 'none';
}

function sanitizeScene(raw: unknown, membership: TownOfficeMembership): TownSceneId {
  if (raw === 'office') return 'office';
  if (raw === 'mainTown') return 'mainTown';
  return membership === 'unselected' ? 'mainTown' : 'office';
}

function inferSpeech(executionState: TownExecutionState, membership: TownOfficeMembership) {
  if (executionState === 'busy') return '处理中…';
  if (executionState === 'error') return '出现异常，等待处理。';
  if (membership === 'auto_added') return 'OpenClaw(main) 自动拉入待命。';
  if (membership !== 'unselected') return '在办公室待命。';
  return '主镇待命中。';
}

function computeHomePosition(agentId: string) {
  if (MAIN_TOWN_HOME_POSITIONS[agentId]) {
    return MAIN_TOWN_HOME_POSITIONS[agentId];
  }
  const hash = hashText(agentId);
  return {
    x: 2 + (hash % 16),
    y: 2 + (Math.floor(hash / 17) % 8),
  };
}

function computeOfficePosition(index: number, agentId: string) {
  if (index < OFFICE_SLOT_POSITIONS.length) {
    return OFFICE_SLOT_POSITIONS[index];
  }
  const hash = hashText(agentId);
  return {
    x: 3 + (hash % 11),
    y: 5 + (Math.floor(hash / 13) % 4),
  };
}

function sanitizeFacing(raw: unknown): TownFacing {
  if (raw === 'up' || raw === 'down' || raw === 'left' || raw === 'right') {
    return raw;
  }
  return 'down';
}

function mapSkill(raw: any, index: number, agentId: string): TownSkill {
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `${agentId}-skill-${index + 1}`;
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const source = typeof raw?.source === 'string' && raw.source.trim() ? raw.source.trim() : 'workspace';
  const description =
    typeof raw?.description === 'string' && raw.description.trim() ? raw.description.trim() : '暂无描述';
  return {
    id,
    name,
    source,
    enabled: raw?.enabled !== false,
    description,
  };
}

function mapAgent(raw: TownSnapshotAgent, index: number, prevAgent: TownAgent | undefined): TownAgent {
  const agentId = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const visual = pickVisual(agentId || `agent-${index}`);
  const membership = sanitizeMembership(raw?.officeMembership);
  const executionState = sanitizeExecutionState(raw?.executionState, membership);
  const location = sanitizeScene(raw?.location, membership);
  const officePosition = prevAgent?.officePosition ?? computeOfficePosition(index, agentId);
  const homePosition = prevAgent?.homePosition ?? computeHomePosition(agentId);
  const position = location === 'office' ? officePosition : homePosition;
  const skillsRaw = Array.isArray(raw?.skills) ? raw.skills : [];
  const skills = skillsRaw.map((item, skillIndex) => mapSkill(item, skillIndex, agentId)).slice(0, 20);
  const recentWeight = Number.isFinite(raw?.recentWeight) ? Math.max(1, Number(raw.recentWeight)) : 1;

  return {
    id: agentId,
    name: normalizeName(raw?.name, agentId),
    role: normalizeRole(raw?.role),
    emoji: prevAgent?.emoji || visual.emoji,
    avatarHue: prevAgent?.avatarHue || visual.avatarHue,
    description:
      typeof raw?.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : normalizeRole(raw?.role),
    skills,
    facing: sanitizeFacing(prevAgent?.facing),
    speech: inferSpeech(executionState, membership),
    location,
    officeMembership: membership,
    executionState,
    sessionRole: sanitizeSessionRole(raw?.sessionRole, executionState),
    position,
    homePosition,
    officePosition,
    currentRunId: prevAgent?.currentRunId,
    recentWeight,
  };
}

function mapEvent(raw: any, index: number): TownEvent {
  const type = raw?.type === 'success' || raw?.type === 'warning' || raw?.type === 'im' ? raw.type : 'info';
  const sceneHint = raw?.sceneHint === 'office' ? 'office' : raw?.sceneHint === 'mainTown' ? 'mainTown' : undefined;
  const eventTime =
    Number.isFinite(raw?.time) && Number(raw.time) > 0 ? Number(raw.time) : Date.now() - index * 1000;
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `event-${index + 1}`,
    runId: typeof raw?.runId === 'string' && raw.runId.trim() ? raw.runId.trim() : undefined,
    type,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : '事件更新',
    detail: typeof raw?.detail === 'string' && raw.detail.trim() ? raw.detail.trim() : '暂无详情',
    timeLabel: typeof raw?.timeLabel === 'string' && raw.timeLabel.trim() ? raw.timeLabel.trim() : '--:--',
    time: eventTime,
    sceneHint,
  };
}

function mapLog(raw: any, index: number): TownLogEntry {
  const type = raw?.type === 'session' || raw?.type === 'spawn' || raw?.type === 'im' ? raw.type : 'system';
  const logTime =
    Number.isFinite(raw?.time) && Number(raw.time) > 0 ? Number(raw.time) : Date.now() - index * 1000;
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `log-${index + 1}`,
    runId: typeof raw?.runId === 'string' && raw.runId.trim() ? raw.runId.trim() : undefined,
    agentId: typeof raw?.agentId === 'string' && raw.agentId.trim() ? raw.agentId.trim() : undefined,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : '日志更新',
    detail: typeof raw?.detail === 'string' && raw.detail.trim() ? raw.detail.trim() : '暂无详情',
    timeLabel: typeof raw?.timeLabel === 'string' && raw.timeLabel.trim() ? raw.timeLabel.trim() : '--:--',
    time: logTime,
    type,
  };
}

function mapRun(raw: TownSnapshotRun, index: number): TownRun {
  const runId = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `run-${index + 1}`;
  const source: TownRunSource = raw?.source === 'im' ? 'im' : 'manual';
  const status: TownRunStatus = raw?.status === 'running' || raw?.status === 'error' ? raw.status : 'completed';
  const participants = Array.isArray(raw?.participantAgentIds)
    ? raw.participantAgentIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const spawnedSessions = Array.isArray(raw?.spawnedSessions)
    ? raw.spawnedSessions
        .map((session, sessionIndex) => {
          const sessionId =
            typeof session?.id === 'string' && session.id.trim() ? session.id.trim() : `spawn-${runId}-${sessionIndex + 1}`;
          const agentId = typeof session?.agentId === 'string' ? session.agentId.trim() : '';
          if (!agentId) return null;
          return {
            id: sessionId,
            agentId,
            status: session?.status === 'running' || session?.status === 'error' ? session.status : 'completed',
          };
        })
        .filter((session): session is TownRun['spawnedSessions'][number] => Boolean(session))
    : [];
  const createdAt =
    Number.isFinite(raw?.createdAt) && Number(raw.createdAt) > 0
      ? Number(raw.createdAt)
      : Date.now() - (index + 1) * 1000;
  const updatedAt =
    Number.isFinite(raw?.updatedAt) && Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : createdAt;

  return {
    id: runId,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : runId,
    prompt: typeof raw?.prompt === 'string' ? raw.prompt : '',
    source,
    status,
    primarySessionId:
      typeof raw?.primarySessionId === 'string' && raw.primarySessionId.trim()
        ? raw.primarySessionId.trim()
        : `session-${runId}`,
    createdAt,
    updatedAt,
    createdAtLabel:
      typeof raw?.createdAtLabel === 'string' && raw.createdAtLabel.trim() ? raw.createdAtLabel.trim() : '--:--',
    updatedAtLabel:
      typeof raw?.updatedAtLabel === 'string' && raw.updatedAtLabel.trim() ? raw.updatedAtLabel.trim() : '--:--',
    participantAgentIds: participants,
    spawnedSessions,
  };
}

function mapInstance(raw: TownSnapshotInstance, index: number): TownAgentInstance | null {
  const runId = typeof raw?.runId === 'string' && raw.runId.trim() ? raw.runId.trim() : '';
  const agentId = typeof raw?.agentId === 'string' && raw.agentId.trim() ? raw.agentId.trim() : '';
  if (!runId || !agentId) {
    return null;
  }
  const instanceStatus =
    raw?.status === 'thinking' || raw?.status === 'executing' || raw?.status === 'error' ? raw.status : 'completed';
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `instance-${runId}-${index + 1}`,
    agentId,
    runId,
    sessionId: typeof raw?.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId.trim() : undefined,
    zoneId: typeof raw?.zoneId === 'string' && raw.zoneId.trim() ? raw.zoneId.trim() : `zone-${runId}`,
    status: instanceStatus,
  };
}

function buildVisibleAgentIds(agents: TownAgent[], preferredIds: unknown) {
  const available = agents.filter(agent => agent.officeMembership === 'unselected' && agent.location === 'mainTown');
  const availableSet = new Set(available.map(agent => agent.id));
  const preferred = Array.isArray(preferredIds)
    ? preferredIds
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .filter(id => availableSet.has(id))
    : [];
  if (preferred.length >= MAIN_TOWN_VISIBLE_AGENT_LIMIT || preferred.length === available.length) {
    return preferred.slice(0, MAIN_TOWN_VISIBLE_AGENT_LIMIT);
  }
  const remaining = available
    .filter(agent => !preferred.includes(agent.id))
    .sort((left, right) => right.recentWeight - left.recentWeight);
  return [...preferred, ...remaining.map(agent => agent.id)].slice(0, MAIN_TOWN_VISIBLE_AGENT_LIMIT);
}

function normalizeClock(raw: unknown, fallback: string) {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  return /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

export function isTownSnapshotPayload(value: unknown): value is TownSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as TownSnapshot;
  return Array.isArray(snapshot.agents);
}

export function buildTownStateFromSnapshot(snapshot: TownSnapshot, prevState?: TownState): TownState {
  const base = prevState ? cloneState(prevState) : buildTownStateFromMock();
  const previousAgents = new Map(base.agents.map(agent => [agent.id, agent]));
  const managerAgentId =
    typeof snapshot.openclaw?.agentId === 'string' && snapshot.openclaw.agentId.trim()
      ? snapshot.openclaw.agentId.trim()
      : 'main';
  const incomingAgents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const mappedAgents = incomingAgents
    .map((agent, index) => mapAgent(agent, index, previousAgents.get(agent.id)))
    .filter(agent => agent.id && agent.id !== managerAgentId);

  const mappedRuns = Array.isArray(snapshot.runs) ? snapshot.runs.map((run, index) => mapRun(run, index)) : [];
  const mappedInstances = Array.isArray(snapshot.instances)
    ? snapshot.instances
        .map((item, index) => mapInstance(item, index))
        .filter((item): item is TownAgentInstance => Boolean(item))
    : [];
  const mappedEvents = Array.isArray(snapshot.events) ? snapshot.events.map((event, index) => mapEvent(event, index)) : [];
  const mappedLogs = Array.isArray(snapshot.logs) ? snapshot.logs.map((log, index) => mapLog(log, index)) : [];
  const openClawName = typeof snapshot.openclaw?.name === 'string' && snapshot.openclaw.name.trim()
    ? snapshot.openclaw.name.trim()
    : 'OpenClaw(main)';

  base.clock = normalizeClock(snapshot.clock, base.clock);
  base.weather = typeof snapshot.weather === 'string' && snapshot.weather.trim() ? snapshot.weather.trim() : base.weather;
  base.version = typeof snapshot.version === 'number' ? snapshot.version : base.version;
  base.maxSelectableAgents =
    Number.isFinite(snapshot.maxSelectableAgents) && Number(snapshot.maxSelectableAgents) > 0
      ? Number(snapshot.maxSelectableAgents)
      : base.maxSelectableAgents;
  base.boss = {
    ...base.boss,
    id: managerAgentId,
    name: openClawName,
    title: '总控 / 主任务发起者',
    summary: 'OpenClaw(main) 负责创建主任务并调度协作 Agent。AI 小镇只做观测展示。',
    location: 'office',
  };
  base.agents = mappedAgents;
  base.visibleTownAgentIds = buildVisibleAgentIds(mappedAgents, snapshot.visibleTownAgentIds);
  base.runs = mappedRuns;
  base.instances = mappedInstances;
  base.events = mappedEvents.slice(0, 12);
  base.logs = mappedLogs.slice(0, 80);
  return base;
}
