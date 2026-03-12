import { TownAgent, TownAgentInstance, TownRun, TownZone } from '../types/town';

const INSTANCE_OFFSETS = [
  { x: -30, y: -14 },
  { x: -4, y: -18 },
  { x: 22, y: -14 },
  { x: -34, y: 12 },
  { x: -8, y: 16 },
  { x: 18, y: 12 },
  { x: -20, y: 32 },
  { x: 6, y: 34 },
];

export interface TownLoadVisual {
  shortLabel: '无' | '低' | '中' | '高';
  summaryLabel: '空闲' | '低负载' | '中负载' | '高负载';
  bar: string;
  heat: string;
  badgeClassName: string;
}

export interface OfficeZoneSlot {
  x: number;
  y: number;
}

export interface RenderedOfficeInstance {
  key: string;
  left: string;
  top: string;
  agent: TownAgent;
  runId: string;
  statusLabel: string;
}

export function getTownLoadVisual(count: number): TownLoadVisual {
  if (count >= 3) {
    return {
      shortLabel: '高',
      summaryLabel: '高负载',
      bar: '#b91c1c',
      heat: 'rgba(239,68,68,0.35)',
      badgeClassName: 'border-[#7f1d1d] bg-[#fee2e2] text-[#7f1d1d]',
    };
  }
  if (count === 2) {
    return {
      shortLabel: '中',
      summaryLabel: '中负载',
      bar: '#ca8a04',
      heat: 'rgba(234,179,8,0.32)',
      badgeClassName: 'border-[#78350f] bg-[#fef3c7] text-[#78350f]',
    };
  }
  if (count === 1) {
    return {
      shortLabel: '低',
      summaryLabel: '低负载',
      bar: '#16a34a',
      heat: 'rgba(34,197,94,0.28)',
      badgeClassName: 'border-[#166534] bg-[#dcfce7] text-[#166534]',
    };
  }
  return {
    shortLabel: '无',
    summaryLabel: '空闲',
    bar: '#64748b',
    heat: 'rgba(148,163,184,0.2)',
    badgeClassName: 'border-[#57534e] bg-[#f5f5f4] text-[#57534e]',
  };
}

function instanceStatusLabel(status: TownAgentInstance['status']) {
  if (status === 'thinking') return '思考';
  if (status === 'executing') return '执行';
  if (status === 'error') return '异常';
  return '完成';
}

function instanceOffset(index: number) {
  if (index < INSTANCE_OFFSETS.length) return INSTANCE_OFFSETS[index];
  const ring = Math.floor(index / INSTANCE_OFFSETS.length);
  const inner = index % INSTANCE_OFFSETS.length;
  const radius = 40 + ring * 12;
  const angle = (Math.PI * 2 * inner) / INSTANCE_OFFSETS.length;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

function isRenderableInstanceStatus(status: TownAgentInstance['status']) {
  return status === 'thinking' || status === 'executing' || status === 'error';
}

export function buildOfficeRenderedInstances(
  agents: TownAgent[],
  runs: TownRun[],
  zones: TownZone[],
  instances: TownAgentInstance[],
  zoneSlots: OfficeZoneSlot[]
): RenderedOfficeInstance[] {
  const result: RenderedOfficeInstance[] = [];
  const zoneIndexByRunId = new Map(zones.map((zone, index) => [zone.runId, index]));
  const runMap = new Map(runs.map(run => [run.id, run]));
  const agentMap = new Map(agents.map(agent => [agent.id, agent]));
  const instancesByRunId = new Map<string, TownAgentInstance[]>();

  for (const instance of instances) {
    if (!isRenderableInstanceStatus(instance.status)) continue;
    const run = runMap.get(instance.runId);
    if (!run) continue;
    const agent = agentMap.get(instance.agentId);
    if (!agent) continue;
    if (instance.sessionId) {
      const session = run.spawnedSessions.find(item => item.id === instance.sessionId);
      if (!session || session.agentId !== instance.agentId) continue;
    }
    if (!instancesByRunId.has(instance.runId)) {
      instancesByRunId.set(instance.runId, []);
    }
    instancesByRunId.get(instance.runId)!.push(instance);
  }

  for (const [runId, runInstances] of instancesByRunId.entries()) {
    const zoneIndex = zoneIndexByRunId.get(runId);
    if (zoneIndex === undefined || zoneIndex < 0 || zoneIndex >= zoneSlots.length) continue;
    const slot = zoneSlots[zoneIndex];
    const ordered = [...runInstances].sort((left, right) => left.id.localeCompare(right.id));
    ordered.forEach((instance, index) => {
      const offset = instanceOffset(index);
      const agent = agentMap.get(instance.agentId);
      if (!agent) return;
      result.push({
        key: `${instance.id}:${index}`,
        left: `calc(${slot.x}% + ${offset.x}px)`,
        top: `calc(${slot.y + 12}% + ${offset.y}px)`,
        agent,
        runId: instance.runId,
        statusLabel: instanceStatusLabel(instance.status),
      });
    });
  }

  return result;
}
