import { useMemo } from 'react';
import TownHUD from '../components/TownHUD';
import TownScene from './TownScene';
import { TownAgent, TownBoss, TownFacing, TownRun, TownSceneDef } from '../types/town';

const WINDOW_PANES = [
  { id: 'window-1', left: '16%', top: '8%' },
  { id: 'window-2', left: '40%', top: '8%' },
  { id: 'window-3', left: '64%', top: '8%' },
];

const WORK_DESKS = [
  { id: 'desk-1', x: 24, y: 54 },
  { id: 'desk-2', x: 50, y: 54 },
  { id: 'desk-3', x: 76, y: 54 },
  { id: 'desk-4', x: 24, y: 76 },
  { id: 'desk-5', x: 50, y: 76 },
  { id: 'desk-6', x: 76, y: 76 },
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
  boss: TownBoss;
  agents: TownAgent[];
  runs: TownRun[];
  selectedDisplayAgentId?: string;
  runningTasks: number;
  onSelectDisplayAgent?: (agentId: string) => void;
  onInspectWorker?: (target: { kind: 'openclaw' } | { kind: 'agent'; agentId: string }) => void;
}

function statusLabel(agent: TownAgent) {
  if (agent.executionState === 'busy') return '工作中';
  if (agent.executionState === 'completed') return '已完成';
  if (agent.executionState === 'error') return '异常';
  return '待命';
}

function PixelAgentSprite({ agent, mode, working }: { agent: TownAgent; mode: 'idle' | 'busy'; working?: boolean }) {
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
      <div
        className={`absolute left-[8px] top-0 border-[2px] border-[#2d1c0d] ${working ? 'h-[11px] w-[28px]' : 'h-[8px] w-[24px]'}`}
        style={{ backgroundColor: theme.hair }}
      />
      <div className="absolute left-[8px] top-[8px] h-[18px] w-[28px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.skin }} />
      {working ? null : <div className={`absolute top-[14px] h-[4px] w-[4px] bg-[#2d1c0d] ${eyeOffset}`} />}
      <div className="absolute left-[4px] top-[26px] h-[20px] w-[36px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.outfit }} />
      <div className={`absolute top-[28px] h-[8px] w-[6px] border-[2px] border-[#2d1c0d] ${armAccent}`} style={{ backgroundColor: theme.accent }} />
      <div className="absolute right-0 top-[28px] h-[8px] w-[6px] border-[2px] border-[#2d1c0d]" style={{ backgroundColor: theme.accent }} />
      <div className="absolute left-[8px] top-[46px] h-[12px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className="absolute left-[24px] top-[46px] h-[12px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className={`absolute inset-0 border-[3px] ${highlight}`} />
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

function WorkDesk({ x, y, active }: { x: number; y: number; active?: boolean }) {
  return (
    <div className="absolute z-[3] -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      <div className="relative h-[88px] w-[120px] [image-rendering:pixelated]">
        <div
          className={`absolute left-[20px] top-[10px] h-[14px] w-[52px] border-[3px] border-[#2d1c0d] ${
            active ? 'animate-pulse bg-[#bef264]' : 'bg-[#d7ecff]'
          }`}
        />
        <div className="absolute left-[42px] top-[24px] h-[10px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#6b7280]" />
        <div className="absolute left-[12px] top-[34px] h-[14px] w-[96px] border-[3px] border-[#2d1c0d] bg-[#8e6137]" />
        <div className="absolute left-[18px] top-[48px] h-[26px] w-[8px] bg-[#5b3a28]" />
        <div className="absolute right-[18px] top-[48px] h-[26px] w-[8px] bg-[#5b3a28]" />
        <div className="absolute left-[38px] top-[58px] h-[18px] w-[42px] border-[3px] border-[#2d1c0d] bg-[#3f3f46]" />
      </div>
    </div>
  );
}

function WorkerPlate({ label, action }: { label: string; action: string }) {
  return (
    <div className="mt-0 inline-flex items-center overflow-hidden border-[3px] border-[#2d1c0d] bg-[#fff4cc] text-[10px] font-bold text-stone-800 shadow-[0_4px_0_#2d1c0d]">
      <span className="px-2 py-0.5">{label}</span>
      <span className="border-l-[3px] border-[#2d1c0d] bg-[#fff8df] px-2 py-0.5 text-[9px] text-stone-600">{action}</span>
    </div>
  );
}

function PixelBossSprite({ busy, facing, working }: { busy?: boolean; facing: TownFacing; working?: boolean }) {
  const highlight = busy ? 'border-[#fde68a]' : 'border-transparent';
  const singleEyeOffset =
    facing === 'left' ? 'left-[15px]' : facing === 'right' ? 'right-[15px]' : 'left-[14px]';
  return (
    <div className="relative h-[68px] w-[52px] [image-rendering:pixelated]">
      <div className="absolute left-[12px] top-0 h-[10px] w-[28px] border-[2px] border-[#2d1c0d] bg-[#1d4ed8]" />
      <div className="absolute left-[10px] top-[10px] h-[20px] w-[32px] border-[2px] border-[#2d1c0d] bg-[#f6d6ad]" />
      {working ? null : facing === 'left' || facing === 'right' ? (
        <div className={`absolute top-[16px] h-[4px] w-[4px] bg-[#2d1c0d] ${singleEyeOffset}`} />
      ) : (
        <>
          <div className="absolute left-[14px] top-[16px] h-[4px] w-[4px] bg-[#2d1c0d]" />
          <div className="absolute right-[14px] top-[16px] h-[4px] w-[4px] bg-[#2d1c0d]" />
        </>
      )}
      <div className="absolute left-[8px] top-[30px] h-[22px] w-[36px] border-[2px] border-[#2d1c0d] bg-[#2563eb]" />
      <div className="absolute left-[3px] top-[32px] h-[8px] w-[7px] border-[2px] border-[#2d1c0d] bg-[#dbeafe]" />
      <div className="absolute right-[3px] top-[32px] h-[8px] w-[7px] border-[2px] border-[#2d1c0d] bg-[#dbeafe]" />
      <div className="absolute left-[12px] top-[52px] h-[12px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className="absolute right-[12px] top-[52px] h-[12px] w-[8px] border-[2px] border-[#2d1c0d] bg-[#5b3a28]" />
      <div className="absolute -right-1 -top-1 border-[2px] border-[#2d1c0d] bg-[#fff4cc] px-1 text-[9px] font-black text-[#1d4ed8]">
        AI
      </div>
      <div className={`absolute inset-0 border-[3px] ${highlight}`} />
    </div>
  );
}

export default function OfficeScene({
  scene,
  boss,
  agents,
  runs,
  selectedDisplayAgentId,
  runningTasks,
  onSelectDisplayAgent,
  onInspectWorker,
}: Props) {
  const runningRunIds = useMemo(
    () => new Set(runs.filter(run => run.status === 'running').map(run => run.id)),
    [runs]
  );
  const isAgentActivelyWorking = useMemo(
    () => (agent: TownAgent) => {
      if (agent.executionState !== 'busy') return false;
      if (runningRunIds.size === 0) return false;
      if (agent.currentRunId && runningRunIds.has(agent.currentRunId)) return true;
      return runs.some(run => run.status === 'running' && run.participantAgentIds.includes(agent.id));
    },
    [runningRunIds, runs]
  );
  const busyAgents = useMemo(
    () => agents.filter(agent => isAgentActivelyWorking(agent)),
    [agents, isAgentActivelyWorking]
  );
  const standbyAgents = useMemo(
    () => agents.filter(agent => !isAgentActivelyWorking(agent)),
    [agents, isAgentActivelyWorking]
  );
  const visibleBusyAgents = busyAgents.slice(0, WORK_DESKS.length);
  const activeDeskIds = useMemo(() => {
    const deskIds = visibleBusyAgents.map((_, index) => WORK_DESKS[index]?.id).filter((id): id is string => Boolean(id));
    return new Set(deskIds);
  }, [visibleBusyAgents]);
  const openclawBusy = useMemo(() => runs.some(run => run.status === 'running'), [runs]);
  const bossPosition = openclawBusy ? boss.officeDeskPosition : boss.officePosition;
  const bossFacing = openclawBusy ? 'up' : boss.officeFacing;

  return (
    <TownScene
      title="办公室"
      subtitle="办公室只保留固定工位。工作中的小人直接在工位前处理任务，点击即可查看工作日志。"
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
        <div className="absolute left-1/2 top-[37%] z-[4] h-[6%] w-[18%] -translate-x-1/2 border-[3px] border-[#2d1c0d] bg-[#8d5d37]" />

        {WORK_DESKS.map(desk => (
          <WorkDesk key={desk.id} x={desk.x} y={desk.y} active={activeDeskIds.has(desk.id)} />
        ))}

        <div
          className="absolute z-20 flex -translate-x-1/2 -translate-y-[60%] flex-col items-center"
          style={{ left: `${(bossPosition.x / scene.width) * 100}%`, top: `${(bossPosition.y / scene.height) * 100}%` }}
        >
          <button
            type="button"
            onClick={() => onInspectWorker?.({ kind: 'openclaw' })}
            className="flex h-[86px] w-[86px] items-center justify-center"
          >
            <PixelBossSprite busy={openclawBusy} facing={bossFacing} working={openclawBusy} />
          </button>
          <button
            type="button"
            onClick={() => onInspectWorker?.({ kind: 'openclaw' })}
          >
            <WorkerPlate label={boss.name} action="查看" />
          </button>
        </div>

        {visibleBusyAgents.map((agent, index) => {
          const desk = WORK_DESKS[index];
          return (
            <div
              key={agent.id}
              className="absolute z-20 flex -translate-x-1/2 -translate-y-[50%] flex-col items-center"
              style={{ left: `${desk.x}%`, top: `${desk.y}%` }}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectDisplayAgent?.(agent.id);
                }}
                className={`flex h-[78px] w-[78px] items-center justify-center ${
                  selectedDisplayAgentId === agent.id ? 'rounded-xl ring-4 ring-[#1d4ed8] ring-offset-2 ring-offset-[#c89f6b]' : ''
                }`}
              >
                <PixelAgentSprite agent={agent} mode="busy" working />
              </button>
              <button
                type="button"
                onClick={() => onInspectWorker?.({ kind: 'agent', agentId: agent.id })}
              >
                <WorkerPlate label={agent.name} action="查看" />
              </button>
            </div>
          );
        })}

        {standbyAgents.map(agent => (
          <div
            key={agent.id}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 ${
              selectedDisplayAgentId === agent.id ? '' : ''
            }`}
            style={{ left: `${(agent.position.x / scene.width) * 100}%`, top: `${(agent.position.y / scene.height) * 100}%` }}
          >
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => onSelectDisplayAgent?.(agent.id)}
                className={`flex h-[78px] w-[78px] items-center justify-center ${
                  selectedDisplayAgentId === agent.id ? 'rounded-xl ring-4 ring-[#1d4ed8] ring-offset-2 ring-offset-[#c89f6b]' : ''
                }`}
              >
                <PixelAgentSprite agent={agent} mode="idle" />
              </button>
              <button
                type="button"
                onClick={() => onInspectWorker?.({ kind: 'agent', agentId: agent.id })}
              >
                <WorkerPlate label={agent.name} action="查看" />
              </button>
            </div>
          </div>
        ))}

        {agents.length === 0 ? (
          <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 border-[4px] border-[#2d1c0d] bg-[#fff4cc] px-6 py-5 text-center shadow-[0_8px_0_#2d1c0d]">
            <div className="text-lg font-black text-stone-900">办公室里当前只有主控</div>
            <div className="mt-2 text-sm leading-6 text-stone-600">你可以从主镇把 Agent 带进来，也可以让 OpenClaw(main) 先独自开始处理任务。</div>
          </div>
        ) : null}

        {runningTasks === 0 && agents.length > 0 ? (
          <div className="absolute left-1/2 top-[74%] z-10 -translate-x-1/2 border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-4 py-2 text-xs font-bold text-stone-700 shadow-[0_4px_0_#2d1c0d]">
            当前无活跃任务，成员在办公室待命中。
          </div>
        ) : null}
      </div>
    </TownScene>
  );
}
