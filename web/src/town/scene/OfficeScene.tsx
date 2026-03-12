import { useEffect, useMemo, useState } from 'react';
import TownHUD from '../components/TownHUD';
import TownScene from './TownScene';
import { buildOfficeRenderedInstances, getTownLoadVisual } from './officeSceneModel';
import { TownAgent, TownAgentInstance, TownRun, TownSceneDef, TownZone } from '../types/town';

const ZONE_SLOTS_WIDE = [
  { x: 20, y: 38 },
  { x: 50, y: 38 },
  { x: 80, y: 38 },
  { x: 20, y: 71 },
  { x: 50, y: 71 },
  { x: 80, y: 71 },
];

const ZONE_SLOTS_COMPACT = [
  { x: 30, y: 32 },
  { x: 70, y: 32 },
  { x: 30, y: 52 },
  { x: 70, y: 52 },
  { x: 30, y: 72 },
  { x: 70, y: 72 },
];

const MANAGER_PATROL = [
  { x: 10, y: 16 },
  { x: 22, y: 20 },
  { x: 37, y: 16 },
  { x: 50, y: 21 },
  { x: 63, y: 16 },
  { x: 77, y: 20 },
  { x: 90, y: 16 },
];

const WINDOW_PANES = [
  { id: 'window-1', left: '16%', top: '8%' },
  { id: 'window-2', left: '40%', top: '8%' },
  { id: 'window-3', left: '64%', top: '8%' },
];

const SPRITE_THEME: Record<string, { hair: string; outfit: string; accent: string; skin: string }> = {
  coder: { hair: '#183153', outfit: '#55bbff', accent: '#f59e0b', skin: '#f6d6ad' },
  researcher: { hair: '#7c4a27', outfit: '#f6c84c', accent: '#fff5d6', skin: '#f6d6ad' },
  reviewer: { hair: '#5431a3', outfit: '#a780ff', accent: '#eee6ff', skin: '#f5d4a6' },
  writer: { hair: '#8f3365', outfit: '#f58cb6', accent: '#ffd4e8', skin: '#f6d6ad' },
  designer: { hair: '#266b49', outfit: '#48c685', accent: '#d9ffec', skin: '#f2cfa4' },
  ops: { hair: '#566372', outfit: '#8da0b8', accent: '#dbe8ef', skin: '#efcc9f' },
};

interface Props {
  scene: TownSceneDef;
  agents: TownAgent[];
  runs: TownRun[];
  instances: TownAgentInstance[];
  zones: TownZone[];
  zoneLoads: Record<string, number>;
  agentLoads: Record<string, number>;
  selectedDisplayAgentId?: string;
  runningTasks: number;
  onSelectDisplayAgent?: (agentId: string) => void;
}

function statusLabel(agent: TownAgent) {
  if (agent.executionState === 'busy') return '忙碌中';
  if (agent.executionState === 'completed') return '已完成';
  if (agent.executionState === 'error') return '异常';
  return '待命';
}

function zoneStatusLabel(zone: TownZone) {
  if (zone.status === 'running') return '执行中';
  if (zone.status === 'error') return '异常';
  return '收尾中';
}

function zoneStatusColors(zone: TownZone) {
  if (zone.status === 'error') {
    return {
      border: '#7f1d1d',
      background: 'linear-gradient(180deg,#fee2e2,#fecaca)',
      title: '#7f1d1d',
    };
  }
  if (zone.status === 'running') {
    return {
      border: '#1e3a8a',
      background: 'linear-gradient(180deg,#dbeafe,#bfdbfe)',
      title: '#1e3a8a',
    };
  }
  return {
    border: '#713f12',
    background: 'linear-gradient(180deg,#fef3c7,#fde68a)',
    title: '#78350f',
  };
}

function PixelAgentSprite({ agent, mode }: { agent: TownAgent; mode: 'idle' | 'busy' }) {
  const theme = SPRITE_THEME[agent.id] || SPRITE_THEME.coder;
  const highlight = mode === 'busy' ? 'border-[#fde68a]' : 'border-transparent';
  const eyeOffset = agent.facing === 'left' ? 'left-[10px]' : agent.facing === 'right' ? 'right-[10px]' : 'left-[12px]';
  const armAccent =
    agent.facing === 'left'
      ? 'left-0'
      : agent.facing === 'right'
        ? 'right-0'
        : 'left-[2px]';

  return (
    <div className="relative h-[60px] w-[44px] [image-rendering:pixelated]">
      <div className="absolute left-[10px] top-0 h-[8px] w-[24px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.hair }} />
      <div className="absolute left-[8px] top-[8px] h-[18px] w-[28px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.skin }} />
      <div className={`absolute top-[14px] h-[4px] w-[4px] bg-[#2d1c0d] ${eyeOffset}`} />
      <div className="absolute left-[4px] top-[26px] h-[20px] w-[36px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.outfit }} />
      <div className={`absolute top-[28px] h-[8px] w-[6px] border-[2px] border-[#2d1c0d] ${armAccent}`} style={{ backgroundColor: theme.accent }} />
      <div className="absolute right-0 top-[28px] h-[8px] w-[6px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.accent }} />
      <div className="absolute left-[8px] top-[46px] h-[12px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className="absolute left-[24px] top-[46px] h-[12px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className={`absolute inset-0 border-[3px] ${highlight}`} />
    </div>
  );
}

function OpenClawSprite({ busy }: { busy: boolean }) {
  return (
    <div className="relative h-[68px] w-[50px] [image-rendering:pixelated]">
      <div className="absolute left-[11px] top-0 h-[9px] w-[28px] border-[2px] border-[#2d1c0d] bg-[#224a8a]" />
      <div className="absolute left-[9px] top-[9px] h-[18px] w-[32px] border-[2px] border-[#2d1c0d] bg-[#dbeafe]" />
      <div className="absolute left-[5px] top-[27px] h-[22px] w-[40px] border-[2px] border-[#2d1c0d] bg-[#3b82f6]" />
      <div className="absolute left-[3px] top-[30px] h-[9px] w-[6px] border-[2px] border-[#2d1c0d] bg-[#93c5fd]" />
      <div className="absolute right-[3px] top-[30px] h-[9px] w-[6px] border-[2px] border-[#2d1c0d] bg-[#93c5fd]" />
      <div className="absolute left-[10px] top-[49px] h-[14px] w-[9px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className="absolute left-[29px] top-[49px] h-[14px] w-[9px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div
        className={`absolute -right-6 -top-1 border-[2px] px-1.5 py-0.5 text-[9px] font-black ${
          busy ? 'border-[#1e3a8a] bg-[#dbeafe] text-[#1e3a8a]' : 'border-[#713f12] bg-[#fef3c7] text-[#78350f]'
        }`}
      >
        {busy ? '忙碌' : '待命'}
      </div>
    </div>
  );
}

function WindowPane({ left, top }: { left: string; top: string }) {
  return (
    <div
      className="absolute z-[2] -translate-x-1/2 -translate-y-1/2 border-[4px] border-[#2d1c0d] bg-[#d8f0ff] shadow-[0_6px_0_#2d1c0d]"
      style={{ left, top, width: '18%', height: '16%' }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#97dcff_0%,#d7f6ff_48%,#8fd17a_48%,#6eb55d_100%)]" />
      <div className="absolute left-1/2 top-0 h-full w-[4px] -translate-x-1/2 bg-[#2d1c0d]" />
      <div className="absolute left-0 top-1/2 h-[4px] w-full -translate-y-1/2 bg-[#2d1c0d]" />
      <div className="absolute inset-x-[18%] bottom-[17%] h-[18%] bg-[#5f954e] [clip-path:polygon(0_100%,14%_42%,28%_100%,44%_36%,60%_100%,78%_44%,100%_100%)]" />
    </div>
  );
}

export default function OfficeScene({
  scene,
  agents,
  runs,
  instances,
  zones,
  zoneLoads,
  agentLoads,
  selectedDisplayAgentId,
  runningTasks,
  onSelectDisplayAgent,
}: Props) {
  const [patrolStep, setPatrolStep] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const compactLayout = viewportWidth < 1380;
  const zoneSlots = compactLayout ? ZONE_SLOTS_COMPACT : ZONE_SLOTS_WIDE;
  const zoneCardWidth = compactLayout ? 154 : 180;
  const zoneCardHeight = compactLayout ? 112 : 122;
  const zoneHeatWidth = compactLayout ? 186 : 220;
  const zoneHeatHeight = compactLayout ? 64 : 76;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const runningZones = useMemo(() => zones.filter(zone => zone.status === 'running'), [zones]);
  const managerBusy = runningZones.length > 0;
  const renderedInstances = useMemo(
    () => buildOfficeRenderedInstances(agents, runs, zones, instances, zoneSlots),
    [agents, runs, zones, instances, zoneSlots]
  );
  const activeInstanceAgentIds = useMemo(
    () => new Set(renderedInstances.map(item => item.agent.id)),
    [renderedInstances]
  );
  const standbyAgents = useMemo(
    () =>
      agents.filter(agent => {
        if (activeInstanceAgentIds.has(agent.id) && agent.executionState === 'busy') {
          return false;
        }
        return true;
      }),
    [agents, activeInstanceAgentIds]
  );

  const managerPosition = useMemo(() => {
    if (managerBusy) {
      const focusRunId = runningZones[0]?.runId;
      const focusZoneIndex = zones.findIndex(zone => zone.runId === focusRunId);
      if (focusZoneIndex >= 0 && focusZoneIndex < zoneSlots.length) {
        const slot = zoneSlots[focusZoneIndex];
        return { x: slot.x, y: Math.max(14, slot.y - 16) };
      }
      return { x: 50, y: 16 };
    }
    return MANAGER_PATROL[patrolStep % MANAGER_PATROL.length];
  }, [managerBusy, patrolStep, runningZones, zones, zoneSlots]);

  useEffect(() => {
    if (managerBusy) return;
    const timer = window.setInterval(() => {
      setPatrolStep(step => (step + 1) % MANAGER_PATROL.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [managerBusy]);

  return (
    <TownScene
      title="办公室"
      subtitle="单办公室并行执行。每个任务占一个分区，亮度取决于最近 30 秒事件数。"
      leftOverlay={<TownHUD runningTasks={runningTasks} sceneName="办公室" />}
    >
      <div className="absolute inset-x-4 bottom-4 top-[78px] overflow-hidden border-[4px] border-[#2d1c0d] bg-[#c89f6b]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#ead9b1_0%,#ead9b1_28%,#c89f6b_28%,#c89f6b_100%)]" />
        <div className="absolute inset-x-0 top-[28%] h-[72%] bg-[linear-gradient(180deg,#c89f6b,#b88955)]" />
        <div className="grid h-full w-full grid-cols-16 grid-rows-10 opacity-30 [image-rendering:pixelated]">
          {Array.from({ length: scene.width * scene.height }, (_, index) => {
            const x = index % scene.width;
            const y = Math.floor(index / scene.width);
            const dark = (x + y) % 2 === 0;
            return <div key={`${x}-${y}`} className={`border border-black/10 ${dark ? 'bg-[#cfac73]' : 'bg-[#c29561]'}`} />;
          })}
        </div>

        {WINDOW_PANES.map(windowPane => (
          <WindowPane key={windowPane.id} left={windowPane.left} top={windowPane.top} />
        ))}

        <div className="absolute inset-x-0 top-[26%] z-[1] h-[3%] bg-[#8e6137]" />
        <div className="absolute left-[6%] top-[30%] z-[2] h-[6%] w-[12%] border-[3px] border-[#2d1c0d] bg-[#8d5d37]" />
        <div className="absolute right-[6%] top-[30%] z-[2] h-[6%] w-[12%] border-[3px] border-[#2d1c0d] bg-[#8d5d37]" />

        <div
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${managerPosition.x}%`, top: `${managerPosition.y}%` }}
        >
          <OpenClawSprite busy={managerBusy} />
          <div className="mt-1 border-[3px] border-[#2d1c0d] bg-[#fff8df] px-2 py-1 text-center text-[10px] font-bold text-stone-800 shadow-[0_4px_0_#2d1c0d]">
            OpenClaw(main)
          </div>
        </div>

        {zones.map((zone, index) => {
          const slot = zoneSlots[index];
          if (!slot) return null;
          const colors = zoneStatusColors(zone);
          const zoneLoad = zoneLoads[zone.runId] || 0;
          const level = getTownLoadVisual(zoneLoad);
          return (
            <div key={zone.id}>
              <div
                className="absolute z-[2] -translate-x-1/2 -translate-y-1/2 border-[4px] border-[#2d1c0d] bg-[#8d5d37]"
                style={{
                  width: zoneCardWidth + 26,
                  height: zoneCardHeight + 18,
                  left: `${slot.x}%`,
                  top: `${slot.y + 4}%`,
                }}
              />
              <div
                className="absolute z-[3] -translate-x-1/2 -translate-y-1/2 rounded-[999px] border-[2px] border-[#2d1c0d]"
                style={{
                  width: zoneHeatWidth,
                  height: zoneHeatHeight,
                  left: `${slot.x}%`,
                  top: `${slot.y + 11}%`,
                  background: level.heat,
                  opacity: 0.28 + Math.min(0.5, zone.brightness * 0.45),
                }}
              />
              <div
                className="absolute z-[4] -translate-x-1/2 -translate-y-1/2 border-[4px] p-3 shadow-[0_8px_0_#6f4a28]"
                style={{
                  width: zoneCardWidth,
                  height: zoneCardHeight,
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                  borderColor: colors.border,
                  background: colors.background,
                  opacity: zone.brightness,
                }}
              >
                <div className="absolute inset-[6px] border border-black/10" />
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: colors.title }}>
                    分区 {index + 1}
                  </div>
                  <div className="border-[2px] border-[#2d1c0d] bg-[#fff8df] px-1.5 py-0.5 text-[9px] font-bold text-stone-800">
                    {zoneStatusLabel(zone)}
                  </div>
                </div>
                <div className="mt-2 line-clamp-1 text-sm font-black text-stone-900">{zone.title}</div>
                <div className="mt-2 text-[10px] leading-4 text-stone-700">
                  参与 Agent：{zone.participantAgentIds.length > 0 ? zone.participantAgentIds.length : 'OpenClaw(main) 单独执行'}
                </div>
                <div className="mt-1 text-[10px] leading-4 text-stone-700">最近30秒事件：{zone.recentEvents}</div>
                <div className={`mt-1 inline-flex border-[2px] px-1.5 py-0.5 text-[9px] font-black ${level.badgeClassName}`}>
                  分身热力：{zoneLoad}（{level.shortLabel}）
                </div>
                <div className="mt-1 h-2 border-[2px] border-[#2d1c0d] bg-[#fff8df]">
                  <div className="h-full" style={{ width: `${Math.round(zone.brightness * 100)}%`, backgroundColor: level.bar }} />
                </div>
              </div>
            </div>
          );
        })}

        {renderedInstances.map(item => (
          <button
            key={item.key}
            onClick={() => onSelectDisplayAgent?.(item.agent.id)}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 ${
              selectedDisplayAgentId === item.agent.id ? 'ring-4 ring-[#1d4ed8] ring-offset-2 ring-offset-[#c89f6b]' : ''
            }`}
            style={{ left: item.left, top: item.top }}
          >
            <PixelAgentSprite agent={item.agent} mode="busy" />
            <div className="mt-1 border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-2 py-1 text-center text-[10px] font-bold text-stone-800 shadow-[0_4px_0_#2d1c0d]">
              <div>{item.agent.name}</div>
              <div className="mt-0.5 text-[9px] text-stone-500">
                {item.statusLabel} · {item.runId}
              </div>
            </div>
          </button>
        ))}

        {standbyAgents.map(agent => (
          <button
            key={agent.id}
            onClick={() => onSelectDisplayAgent?.(agent.id)}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 ${
              selectedDisplayAgentId === agent.id ? 'ring-4 ring-[#1d4ed8] ring-offset-2 ring-offset-[#c89f6b]' : ''
            }`}
            style={{ left: `${(agent.position.x / scene.width) * 100}%`, top: `${(agent.position.y / scene.height) * 100}%` }}
          >
            <PixelAgentSprite agent={agent} mode={agent.executionState === 'busy' ? 'busy' : 'idle'} />
            <div className="mt-1 border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-2 py-1 text-center text-[10px] font-bold text-stone-800 shadow-[0_4px_0_#2d1c0d]">
              <div>{agent.name}</div>
              <div className="mt-0.5 text-[9px] text-stone-500">{statusLabel(agent)}</div>
              <div className="mt-0.5 text-[8px] font-semibold text-stone-500">
                {selectedDisplayAgentId === agent.id ? '已选中，可键盘移动' : '点击选中'}
              </div>
              <div className={`mt-0.5 inline-flex border px-1 py-0.5 text-[8px] font-black ${getTownLoadVisual(agentLoads[agent.id] || 0).badgeClassName}`}>
                负载 {agentLoads[agent.id] || 0}
              </div>
            </div>
          </button>
        ))}

        {zones.length === 0 && agents.length === 0 ? (
          <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 border-[4px] border-[#2d1c0d] bg-[#fff4cc] px-6 py-5 text-center shadow-[0_8px_0_#2d1c0d]">
            <div className="text-lg font-black text-stone-900">办公室暂时没人</div>
            <div className="mt-2 text-sm leading-6 text-stone-600">你可以从主镇把 Agent 带进来，也可以让 OpenClaw(main) 先独自开始处理任务。</div>
          </div>
        ) : null}

        {zones.length === 0 && agents.length > 0 ? (
          <div className="absolute left-1/2 top-[74%] z-10 -translate-x-1/2 border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-4 py-2 text-xs font-bold text-stone-700 shadow-[0_4px_0_#2d1c0d]">
            当前无活跃任务，成员在办公室待命中。
          </div>
        ) : null}
      </div>
    </TownScene>
  );
}
