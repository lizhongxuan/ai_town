import { TownAgent, TownAgentInstance, TownLogEntry, TownRun, TownSkill, TownState, TownZone } from '../types/town';

const TOWN_ZONE_VISIBLE_LIMIT = 6;
const TOWN_ZONE_ACTIVE_WINDOW_MS = 30 * 1000;
const TOWN_ZONE_FADE_WINDOW_MS = 60 * 1000;

function uniqueSkills(agents: TownAgent[]): TownSkill[] {
  const seen = new Map<string, TownSkill>();
  agents.forEach(agent => {
    agent.skills.forEach(skill => {
      if (!seen.has(skill.id)) {
        seen.set(skill.id, skill);
      }
    });
  });
  return Array.from(seen.values());
}

export function getTownVisibleAgents(state: TownState): TownAgent[] {
  return state.visibleTownAgentIds
    .map(id => state.agents.find(agent => agent.id === id))
    .filter((agent): agent is TownAgent => Boolean(agent));
}

export function getTownSelectedAgents(state: TownState): TownAgent[] {
  return state.agents.filter(agent => agent.officeMembership === 'selected');
}

export function getTownOfficeAgents(state: TownState): TownAgent[] {
  return state.agents.filter(agent => agent.officeMembership !== 'unselected');
}

export function getTownOfficeSkillSummary(state: TownState): TownSkill[] {
  return uniqueSkills(getTownOfficeAgents(state));
}

export function getTownSelectedSkillSummary(state: TownState): TownSkill[] {
  return uniqueSkills(getTownSelectedAgents(state));
}

export function getTownBusyAgents(state: TownState): TownAgent[] {
  return state.agents.filter(agent => agent.executionState === 'busy');
}

export function getTownRunningTaskCount(state: TownState): number {
  return state.runs.filter(run => run.status === 'running').length;
}

export function getTownLatestEvent(state: TownState) {
  return state.events[0];
}

export function getTownRecentLogs(state: TownState, runId?: string): TownLogEntry[] {
  const logs = runId ? state.logs.filter(log => log.runId === runId || !log.runId) : state.logs;
  return logs.slice(0, 12);
}

export function getTownLatestRun(state: TownState) {
  return state.runs[0];
}

function zoneCandidateRuns(state: TownState, now: number): TownRun[] {
  const candidates = state.runs.filter(run => {
    if (run.status === 'running') return true;
    if (run.updatedAt <= 0) return false;
    return now - run.updatedAt <= TOWN_ZONE_FADE_WINDOW_MS;
  });
  candidates.sort((left, right) => {
    const leftRunning = left.status === 'running' ? 1 : 0;
    const rightRunning = right.status === 'running' ? 1 : 0;
    if (leftRunning !== rightRunning) return rightRunning - leftRunning;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.id.localeCompare(right.id);
  });
  return candidates;
}

function countRecentRunEvents(state: TownState, now: number) {
  const countMap = new Map<string, number>();
  const minTime = now - TOWN_ZONE_ACTIVE_WINDOW_MS;
  state.logs.forEach(log => {
    if (!log.runId || log.time < minTime) return;
    countMap.set(log.runId, (countMap.get(log.runId) ?? 0) + 1);
  });
  state.events.forEach(event => {
    if (!event.runId || event.time < minTime) return;
    countMap.set(event.runId, (countMap.get(event.runId) ?? 0) + 1);
  });
  return countMap;
}

function computeZoneBrightness(run: TownRun, recentEvents: number, now: number) {
  if (run.status === 'running') {
    return Math.min(1, 0.28 + recentEvents * 0.12);
  }
  const age = Math.max(0, now - run.updatedAt);
  const remain = Math.max(0, 1 - age / TOWN_ZONE_FADE_WINDOW_MS);
  return Math.max(0.18, Math.min(0.75, remain));
}

function isActiveInstanceStatus(status: string) {
  return status === 'thinking' || status === 'executing';
}

function buildRunMap(state: TownState) {
  return new Map(state.runs.map(run => [run.id, run]));
}

function buildAgentMap(state: TownState) {
  return new Map(state.agents.map(agent => [agent.id, agent]));
}

function normalizeInstanceStatus(instance: TownAgentInstance, run: TownRun): TownAgentInstance['status'] {
  if (run.status === 'running') {
    if (instance.status === 'error') return 'error';
    if (instance.status === 'thinking') return 'thinking';
    if (instance.status === 'executing') return 'executing';
    return 'executing';
  }
  if (run.status === 'error') return 'error';
  return 'completed';
}

export function getTownValidatedInstances(state: TownState): TownAgentInstance[] {
  const runMap = buildRunMap(state);
  const agentMap = buildAgentMap(state);
  const result: TownAgentInstance[] = [];
  for (const instance of state.instances) {
    const run = runMap.get(instance.runId);
    if (!run) continue;
    const agent = agentMap.get(instance.agentId);
    if (!agent) continue;
    if (agent.officeMembership === 'unselected') continue;

    if (instance.sessionId) {
      const matchedSession = run.spawnedSessions.find(session => session.id === instance.sessionId);
      if (!matchedSession) continue;
      if (matchedSession.agentId !== instance.agentId) continue;
    } else if (!run.participantAgentIds.includes(instance.agentId)) {
      continue;
    }

    const expectedZonePrefix = `zone-${run.id}`;
    if (instance.zoneId && !instance.zoneId.startsWith(expectedZonePrefix)) {
      continue;
    }

    result.push({
      ...instance,
      zoneId: instance.zoneId || expectedZonePrefix,
      status: normalizeInstanceStatus(instance, run),
    });
  }
  return result;
}

export function getTownOfficeZones(state: TownState, now = Date.now()): TownZone[] {
  const candidates = zoneCandidateRuns(state, now);
  const recentEventMap = countRecentRunEvents(state, now);
  return candidates.slice(0, TOWN_ZONE_VISIBLE_LIMIT).map((run, index) => ({
    id: `zone-${run.id}-${index + 1}`,
    title: run.title,
    runId: run.id,
    state: run.status === 'running' ? 'running' : 'fading',
    status: run.status,
    brightness: computeZoneBrightness(run, recentEventMap.get(run.id) ?? 0, now),
    updatedAt: run.updatedAt,
    recentEvents: recentEventMap.get(run.id) ?? 0,
    participantAgentIds: run.participantAgentIds,
  }));
}

export function getTownOverflowRuns(state: TownState, now = Date.now()): TownRun[] {
  const candidates = zoneCandidateRuns(state, now);
  return candidates.slice(TOWN_ZONE_VISIBLE_LIMIT);
}

export function getTownAgentLoadMap(state: TownState): Record<string, number> {
  const counts = new Map<string, number>();
  getTownValidatedInstances(state).forEach(instance => {
    if (!isActiveInstanceStatus(instance.status)) return;
    counts.set(instance.agentId, (counts.get(instance.agentId) ?? 0) + 1);
  });
  return Object.fromEntries(counts.entries());
}

export function getTownZoneLoadMap(state: TownState): Record<string, number> {
  const counts = new Map<string, number>();
  getTownValidatedInstances(state).forEach(instance => {
    if (!isActiveInstanceStatus(instance.status)) return;
    counts.set(instance.runId, (counts.get(instance.runId) ?? 0) + 1);
  });
  return Object.fromEntries(counts.entries());
}
