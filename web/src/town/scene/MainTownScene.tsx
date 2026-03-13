import type { CSSProperties } from 'react';
import { ListFilter, Sparkles } from 'lucide-react';
import TownHUD from '../components/TownHUD';
import TownScene from './TownScene';
import { TownAgent, TownAmbientResident, TownBoss, TownBuilding, TownFacing, TownSceneDef } from '../types/town';

const CLOUDS = [
  { id: 'cloud-1', left: '8%', top: '10%', scale: 1 },
  { id: 'cloud-2', left: '57%', top: '13%', scale: 0.88 },
  { id: 'cloud-3', left: '76%', top: '7%', scale: 0.74 },
];

const TREE_CLUSTERS = [
  { id: 'trees-1', left: '4%', top: '29%', scale: 1 },
  { id: 'trees-2', left: '18%', top: '25%', scale: 0.8 },
  { id: 'trees-3', left: '68%', top: '22%', scale: 1.06 },
  { id: 'trees-4', left: '84%', top: '27%', scale: 0.92 },
  { id: 'trees-5', left: '3%', top: '74%', scale: 1.1 },
  { id: 'trees-6', left: '87%', top: '76%', scale: 1.1 },
];

const FLOWER_PATCHES = [
  { id: 'flower-1', left: '34%', top: '74%', color: '#ffd166' },
  { id: 'flower-2', left: '58%', top: '72%', color: '#fb7185' },
  { id: 'flower-3', left: '71%', top: '66%', color: '#fde68a' },
];

const LAMP_POSTS = [
  { id: 'lamp-1', left: '27%', top: '61%' },
  { id: 'lamp-2', left: '73%', top: '61%' },
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
  buildings: TownBuilding[];
  boss: TownBoss;
  agents: TownAgent[];
  ambientResidents: TownAmbientResident[];
  selectedDisplayAgentId?: string;
  runningTasks: number;
  onOpenAgentDrawer: () => void;
  onOpenOffice: () => void;
  onToggleAgent: (agentId: string) => void;
  onSelectDisplayAgent?: (agentId: string) => void;
}

function positionFromGrid(scene: TownSceneDef, x: number, y: number) {
  return {
    left: `${(x / scene.width) * 100}%`,
    top: `${(y / scene.height) * 100}%`,
  };
}

function areaFromGrid(scene: TownSceneDef, x: number, y: number, w: number, h: number) {
  return {
    ...positionFromGrid(scene, x, y),
    width: `${(w / scene.width) * 100}%`,
    height: `${(h / scene.height) * 100}%`,
  };
}

function buildingSignStyle(scene: TownSceneDef, building: TownBuilding): CSSProperties {
  return {
    left: `${((building.position.x + building.size.w / 2) / scene.width) * 100}%`,
    top: `${((building.position.y + (building.type === 'boss' ? 0.5 : 0.35)) / scene.height) * 100}%`,
  };
}

function buildingTheme(type: TownBuilding['type']) {
  switch (type) {
    case 'boss':
      return {
        roof: 'linear-gradient(180deg,#2a5790,#14365b)',
        wall: 'linear-gradient(180deg,#ddefff,#a8cfff)',
        window: '#1c4270',
        sign: '#d9e9ff',
      };
    case 'office':
      return {
        roof: 'linear-gradient(180deg,#b16a42,#864624)',
        wall: 'linear-gradient(180deg,#f6ebd1,#e2c79d)',
        window: '#6d3410',
        sign: '#fff3c6',
      };
    default:
      return {
        roof: 'linear-gradient(180deg,#9f6fd1,#6f46a9)',
        wall: 'linear-gradient(180deg,#f2e6f9,#ddc3ef)',
        window: '#4c247a',
        sign: '#f4e7ff',
      };
  }
}

function Signboard({ title, subtitle, style }: { title: string; subtitle?: string; style: CSSProperties }) {
  return (
    <div
      className="absolute z-[18] -translate-x-1/2 -translate-y-1/2 border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-3 py-2 text-center shadow-[0_4px_0_#2d1c0d]"
      style={style}
    >
      <div className="text-[10px] font-black text-stone-900">{title}</div>
      {subtitle ? <div className="mt-0.5 text-[9px] font-semibold text-stone-600">{subtitle}</div> : null}
    </div>
  );
}

function PixelTree({ scale = 1 }: { scale?: number }) {
  return (
    <div className="[image-rendering:pixelated]" style={{ transform: `scale(${scale})` }}>
      <div className="relative h-[58px] w-[48px]">
        <div className="absolute left-[18px] top-[30px] h-[26px] w-[10px] border-[2px] border-[#2d1c0d] bg-[#6d3a1e]" />
        <div className="absolute left-[7px] top-[18px] h-[26px] w-[18px] border-[2px] border-[#2d1c0d] bg-[#4f9a4f]" />
        <div className="absolute right-[7px] top-[18px] h-[26px] w-[18px] border-[2px] border-[#2d1c0d] bg-[#4b8e47]" />
        <div className="absolute left-[12px] top-[4px] h-[26px] w-[24px] border-[2px] border-[#2d1c0d] bg-[#72bb58]" />
      </div>
    </div>
  );
}

function Cloud({ scale = 1 }: { scale?: number }) {
  return (
    <div className="[image-rendering:pixelated]" style={{ transform: `scale(${scale})` }}>
      <div className="relative h-[34px] w-[92px]">
        <div className="absolute left-[10px] top-[12px] h-[16px] w-[72px] border-[2px] border-[#2d1c0d]/40 bg-[#f7fdff]" />
        <div className="absolute left-0 top-[14px] h-[12px] w-[18px] border-[2px] border-[#2d1c0d]/40 bg-[#f7fdff]" />
        <div className="absolute left-[18px] top-0 h-[20px] w-[22px] border-[2px] border-[#2d1c0d]/40 bg-[#f7fdff]" />
        <div className="absolute left-[40px] top-[2px] h-[22px] w-[28px] border-[2px] border-[#2d1c0d]/40 bg-[#f7fdff]" />
        <div className="absolute right-[4px] top-[8px] h-[18px] w-[22px] border-[2px] border-[#2d1c0d]/40 bg-[#f7fdff]" />
      </div>
    </div>
  );
}

function LampPost() {
  return (
    <div className="relative h-[38px] w-[18px] [image-rendering:pixelated]">
      <div className="absolute left-[7px] top-[10px] h-[28px] w-[4px] bg-[#2d1c0d]" />
      <div className="absolute left-[2px] top-0 h-[14px] w-[14px] border-[2px] border-[#2d1c0d] bg-[#ffe38a]" />
      <div className="absolute left-[4px] top-[2px] h-[4px] w-[10px] bg-[#fff4c2]" />
    </div>
  );
}

function ForegroundRoof({ left, right, bottom, color }: { left?: string; right?: string; bottom: string; color: string }) {
  return (
    <div
      className="absolute z-[5] h-[18%] w-[22%] overflow-hidden border-[4px] border-[#2d1c0d]"
      style={{ left, right, bottom, background: color, clipPath: 'polygon(0 100%, 50% 0, 100% 100%)' }}
    />
  );
}

function VillageHouse({
  building,
  scene,
  onOpenOffice,
}: {
  building: TownBuilding;
  scene: TownSceneDef;
  onOpenOffice: () => void;
}) {
  const theme = buildingTheme(building.type);
  const signStyle = buildingSignStyle(scene, building);
  const decorative = building.type === 'decoration';

  return (
    <>
      {!decorative ? <Signboard title={building.name} subtitle={building.label} style={signStyle} /> : null}
      <button
        onClick={() => {
          if (building.type === 'office') onOpenOffice();
        }}
        disabled={!building.interactive}
        className={`absolute z-10 p-1 ${building.interactive ? 'cursor-pointer transition-transform duration-150 hover:-translate-y-1' : 'cursor-default'}`}
        style={areaFromGrid(scene, building.position.x, building.position.y, building.size.w, building.size.h)}
      >
        <div className={`relative h-full w-full [image-rendering:pixelated] ${decorative ? 'min-h-[88px]' : 'min-h-[112px]'}`}>
          <div
            className={`absolute left-[4%] w-[92%] border-[4px] border-[#2d1c0d] ${decorative ? 'top-[14%] h-[28%]' : 'top-[8%] h-[34%]'}`}
            style={{ background: theme.roof, clipPath: 'polygon(50% 0%, 100% 100%, 0 100%)' }}
          />
          <div
            className={`absolute bottom-[10%] left-[14%] w-[72%] border-[4px] border-[#2d1c0d] ${decorative ? 'h-[40%]' : 'h-[48%]'}`}
            style={{ background: theme.wall }}
          />
          <div className="absolute bottom-[10%] left-[42%] h-[22%] w-[16%] border-[4px] border-[#2d1c0d] bg-[#734521]" />
          <div className="absolute bottom-[28%] left-[20%] h-[12%] w-[14%] border-[3px] border-[#2d1c0d]" style={{ backgroundColor: theme.window }} />
          <div className="absolute bottom-[28%] right-[20%] h-[12%] w-[14%] border-[3px] border-[#2d1c0d]" style={{ backgroundColor: theme.window }} />
          {!decorative ? (
            <div
              className="absolute left-1/2 top-[44%] w-[58%] -translate-x-1/2 border-[3px] border-[#2d1c0d] px-2 py-1 text-center shadow-[0_4px_0_#2d1c0d]"
              style={{ background: theme.sign }}
            >
              <div className="truncate text-[10px] font-black text-stone-900">{building.label}</div>
              {building.type === 'boss' ? (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold text-[#1d4ed8]">
                  <Sparkles size={10} />
                  主控
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
    </>
  );
}

function PixelAgentSprite({ agent }: { agent: TownAgent }) {
  const theme = SPRITE_THEME[agent.id] || SPRITE_THEME.coder;
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
    </div>
  );
}

function AmbientSprite({ resident }: { resident: TownAmbientResident }) {
  return (
    <div className="relative h-[48px] w-[36px] [image-rendering:pixelated]">
      <div className="absolute left-[8px] top-0 h-[7px] w-[20px] border-[2px] border-[#2d1c0d] bg-[#7c5d3a]" />
      <div className="absolute left-[6px] top-[7px] h-[14px] w-[24px] border-[2px] border-[#2d1c0d] bg-[#f2cfaa]" />
      <div className="absolute left-[4px] top-[21px] h-[16px] w-[28px] border-[2px] border-[#2d1c0d] bg-[#c7a3ff]" />
      <div className="absolute left-[9px] top-[37px] h-[9px] w-[6px] border-[2px] border-[#2d1c0d] bg-[#71543e]" />
      <div className="absolute left-[21px] top-[37px] h-[9px] w-[6px] border-[2px] border-[#2d1c0d] bg-[#71543e]" />
      <div className="absolute -right-2 -top-2 border-[2px] border-[#2d1c0d] bg-[#fff8df] px-1 text-[9px] font-bold text-stone-800">
        {resident.emoji}
      </div>
    </div>
  );
}

function PixelBossSprite({ facing }: { facing: TownFacing }) {
  const singleEyeOffset =
    facing === 'left' ? 'left-[15px]' : facing === 'right' ? 'right-[15px]' : 'left-[14px]';
  return (
    <div className="relative h-[68px] w-[52px] [image-rendering:pixelated]">
      <div className="absolute left-[12px] top-0 h-[10px] w-[28px] border-[2px] border-[#2d1c0d] bg-[#1d4ed8]" />
      <div className="absolute left-[10px] top-[10px] h-[20px] w-[32px] border-[2px] border-[#2d1c0d] bg-[#f6d6ad]" />
      {facing === 'left' || facing === 'right' ? (
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
    </div>
  );
}

export default function MainTownScene({
  scene,
  buildings,
  boss,
  agents,
  ambientResidents,
  selectedDisplayAgentId,
  runningTasks,
  onOpenAgentDrawer,
  onOpenOffice,
  onToggleAgent,
  onSelectDisplayAgent,
}: Props) {
  return (
    <TownScene
      title="主镇"
      subtitle="这里只负责挑选协作成员，真正的任务输入和会话执行都在办公室里完成。"
      leftOverlay={<TownHUD runningTasks={runningTasks} sceneName="主镇" />}
      rightOverlay={
        <div className="absolute left-3 right-3 top-[250px] z-20 flex flex-row flex-wrap justify-end gap-2 sm:left-auto sm:right-4 sm:top-[92px] sm:flex-col sm:flex-nowrap">
          <button
            onClick={onOpenAgentDrawer}
            className="flex items-center gap-2 border-[4px] border-[#2d1c0d] bg-[#fff4cc] px-4 py-3 text-sm font-bold text-stone-900 shadow-[0_6px_0_#2d1c0d]"
          >
            <ListFilter size={16} />
            成员列表
          </button>
        </div>
      }
    >
      <div className="absolute inset-x-4 bottom-4 top-[78px] overflow-hidden border-[4px] border-[#2d1c0d] bg-[#7fcf6f]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#91dfff_0%,#91dfff_34%,#7bcf6e_34%,#7bcf6e_100%)]" />
        <div className="absolute inset-x-0 top-[30%] h-[14%] bg-[linear-gradient(180deg,#7cb764,#6fab56)]" />
        <div className="absolute inset-x-[8%] top-[26%] h-[14%] bg-[linear-gradient(180deg,#74a75b,#5a8b43)] [clip-path:polygon(0_100%,14%_36%,26%_82%,40%_30%,52%_74%,66%_24%,80%_80%,92%_40%,100%_100%)]" />
        <div className="grid h-full w-full grid-cols-20 grid-rows-12 opacity-35 [image-rendering:pixelated]">
          {Array.from({ length: scene.width * scene.height }, (_, index) => {
            const x = (index % scene.width) + 1;
            const y = Math.floor(index / scene.width) + 1;
            return <div key={`${x}-${y}`} className={`border border-black/5 ${(x + y) % 2 === 0 ? 'bg-[#8fcf62]' : 'bg-[#84c558]'}`} />;
          })}
        </div>

        <div className="absolute left-[46%] top-[26%] z-[2] h-[70%] w-[9%] border-x-[4px] border-[#8c6a38] bg-[#dfc88b]" />
        <div className="absolute left-[8%] top-[53%] z-[2] h-[11%] w-[84%] border-y-[4px] border-[#8c6a38] bg-[#dfc88b]" />
        <div className="absolute left-[47.5%] top-[26%] z-[2] h-[70%] w-[2%] bg-[#e8d9ad]" />
        <div className="absolute left-[8%] top-[57%] z-[2] h-[2%] w-[84%] bg-[#e8d9ad]" />

        {CLOUDS.map(cloud => (
          <div key={cloud.id} className="absolute z-[1] -translate-x-1/2 -translate-y-1/2" style={{ left: cloud.left, top: cloud.top }}>
            <Cloud scale={cloud.scale} />
          </div>
        ))}

        {TREE_CLUSTERS.map(tree => (
          <div key={tree.id} className="absolute z-[3] -translate-x-1/2 -translate-y-1/2" style={{ left: tree.left, top: tree.top }}>
            <PixelTree scale={tree.scale} />
          </div>
        ))}

        {FLOWER_PATCHES.map(flower => (
          <div key={flower.id} className="absolute z-[4] -translate-x-1/2 -translate-y-1/2" style={{ left: flower.left, top: flower.top }}>
            <div className="flex gap-[2px]">
              <div className="h-[6px] w-[6px] border border-[#2d1c0d] bg-[#fff4cc]" />
              <div className="h-[6px] w-[6px] border border-[#2d1c0d]" style={{ backgroundColor: flower.color }} />
              <div className="h-[6px] w-[6px] border border-[#2d1c0d] bg-[#fff4cc]" />
            </div>
          </div>
        ))}

        {LAMP_POSTS.map(lamp => (
          <div key={lamp.id} className="absolute z-[5] -translate-x-1/2 -translate-y-1/2" style={{ left: lamp.left, top: lamp.top }}>
            <LampPost />
          </div>
        ))}

        {buildings.map(building => (
          <VillageHouse key={building.id} building={building} scene={scene} onOpenOffice={onOpenOffice} />
        ))}

        <div
          className="absolute z-[19] -translate-x-1/2 -translate-y-1/2"
          style={positionFromGrid(scene, boss.mainTownPosition.x, boss.mainTownPosition.y)}
        >
          <div className="flex flex-col items-center">
            <PixelBossSprite facing={boss.mainTownFacing} />
            <div className="mt-1 min-w-[128px] border-[3px] border-[#2d1c0d] bg-[#dbeafe] px-2 py-1 text-center text-[10px] font-black text-[#1e3a8a] shadow-[0_4px_0_#2d1c0d]">
              <div>{boss.name}</div>
              <div className="mt-0.5 text-[9px] text-[#1d4ed8]">{runningTasks > 0 ? '主控处理中' : '主控待命'}</div>
            </div>
          </div>
        </div>

        <ForegroundRoof left="-2%" bottom="-2%" color="linear-gradient(180deg,#a66b42,#76411f)" />
        <ForegroundRoof right="-2%" bottom="-3%" color="linear-gradient(180deg,#8e6bca,#62379a)" />

        {ambientResidents.map(resident => (
          <div
            key={resident.id}
            className="absolute z-[6] -translate-x-1/2 -translate-y-1/2"
            style={positionFromGrid(scene, resident.position.x, resident.position.y)}
          >
            <AmbientSprite resident={resident} />
            <div className="mt-1 border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-2 py-1 text-center text-[10px] font-bold text-stone-800 shadow-[0_4px_0_#2d1c0d]">
              {resident.name}
            </div>
          </div>
        ))}

        {agents.map(agent => (
          <button
            key={agent.id}
            onClick={() => {
              onSelectDisplayAgent?.(agent.id);
              onToggleAgent(agent.id);
            }}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 text-left ${
              selectedDisplayAgentId === agent.id ? 'ring-4 ring-[#1d4ed8] ring-offset-2 ring-offset-[#7fcf6f]' : ''
            }`}
            style={positionFromGrid(scene, agent.position.x, agent.position.y)}
          >
            {agent.speech ? (
              <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap border-[3px] border-[#2d1c0d] bg-[#fff8df] px-2 py-1 text-[10px] font-bold text-stone-700 shadow-[0_4px_0_#2d1c0d]">
                {agent.speech}
              </div>
            ) : null}
            <PixelAgentSprite agent={agent} />
            <div className="mt-1 min-w-[110px] border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-2 py-1 text-center text-[10px] font-bold text-stone-800 shadow-[0_4px_0_#2d1c0d]">
              <div>{agent.name}</div>
              <div className="mt-0.5 text-[9px] text-stone-500">
                {selectedDisplayAgentId === agent.id ? '已选中' : '点击加入'}
              </div>
            </div>
          </button>
        ))}
      </div>
    </TownScene>
  );
}
