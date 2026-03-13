import { Users, X } from 'lucide-react';
import { getTownLoadVisual } from '../scene/officeSceneModel';
import { TownAgent } from '../types/town';

interface Props {
  open: boolean;
  agents: TownAgent[];
  agentLoads: Record<string, number>;
  pendingAgentIds: string[];
  interactionLocked?: boolean;
  onToggleAgent: (agentId: string) => void;
  onClose: () => void;
}

function officeStatusLabel(agent: TownAgent) {
  if (agent.executionState === 'busy') return '执行中';
  if (agent.executionState === 'completed') return '已完成';
  if (agent.executionState === 'error') return '异常';
  if (agent.officeMembership === 'auto_added') return '自动加入';
  if (agent.officeMembership === 'selected') return '已选中';
  return '待命';
}

export default function TownOfficeMembersModal({
  open,
  agents,
  agentLoads,
  pendingAgentIds,
  interactionLocked,
  onToggleAgent,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-950/45 px-2 py-3 backdrop-blur-[1px] sm:items-center sm:px-4 sm:py-8">
      <div className="flex h-full max-h-full w-full max-w-3xl flex-col overflow-hidden border-[4px] border-[#2d1c0d] bg-[#fff6d8] font-mono shadow-[0_16px_0_#2d1c0d] sm:h-auto">
        <div className="flex items-start justify-between gap-4 border-b-[4px] border-[#2d1c0d] bg-[#4b3319] px-4 py-3 text-[#fff6d8] sm:px-5 sm:py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2d58b]">办公室成员</div>
            <h2 className="mt-1 text-2xl font-black">成员状态与移出操作</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center border-[3px] border-[#f2d58b] text-[#fff6d8]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="flex items-center gap-2 text-sm font-black text-stone-900">
            <Users size={16} className="text-amber-700" />
            当前共 {agents.length} 位办公室成员
          </div>

          <div className="mt-4 space-y-3">
            {agents.length > 0 ? (
              agents.map(agent => {
                const load = agentLoads[agent.id] || 0;
                const loadVisual = getTownLoadVisual(load);
                const disabled = agent.executionState === 'busy' || pendingAgentIds.includes(agent.id) || interactionLocked;
                return (
                  <div key={agent.id} className="border-[4px] border-[#2d1c0d] bg-[#fffdf2] p-4">
                    <div className={`inline-flex border-[2px] px-2 py-0.5 text-[10px] font-black ${loadVisual.badgeClassName}`}>
                      当前负载：{load}（{loadVisual.summaryLabel}）
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-stone-900">{agent.name}</div>
                        <div className="text-xs leading-5 text-stone-600">{agent.role}</div>
                      </div>
                      <div className="border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-2 py-1 text-[11px] font-bold text-stone-900">
                        {officeStatusLabel(agent)}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {agent.skills.slice(0, 3).map(skill => (
                        <span key={skill.id} className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1 text-[11px] font-medium text-stone-700">
                          {skill.name}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={() => onToggleAgent(agent.id)}
                        disabled={disabled}
                        className={`border-[3px] px-3 py-2 text-xs font-bold ${
                          disabled
                            ? 'border-stone-300 bg-stone-200 text-stone-500'
                            : 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900'
                        }`}
                      >
                        {pendingAgentIds.includes(agent.id) ? '处理中' : interactionLocked ? '回放锁定' : '移出办公室'}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="border-[4px] border-dashed border-[#c89d49] bg-[#fffdf2] p-4 text-sm leading-6 text-stone-600">
                现在只有 OpenClaw 主控在办公室。你可以直接开始任务，也可以回主镇再带一些成员进来。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
