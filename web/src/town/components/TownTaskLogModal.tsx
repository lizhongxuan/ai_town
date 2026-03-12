import { X } from 'lucide-react';
import { TownAgent, TownLogEntry, TownRun } from '../types/town';

interface Props {
  open: boolean;
  runs: TownRun[];
  logs: TownLogEntry[];
  agents: TownAgent[];
  selectedRunId?: string;
  loading?: boolean;
  replayActive?: boolean;
  replayRunId?: string;
  replayFrameIndex?: number;
  replayTotalFrames?: number;
  onSelectRun?: (runId: string) => void;
  onEnterReplay?: () => void;
  onExitReplay?: () => void;
  onReplayFrameChange?: (index: number) => void;
  onClose: () => void;
}

function agentName(agents: TownAgent[], agentId: string) {
  return agents.find(agent => agent.id === agentId)?.name || agentId;
}

export default function TownTaskLogModal({
  open,
  runs,
  logs,
  agents,
  selectedRunId,
  loading,
  replayActive,
  replayRunId,
  replayFrameIndex,
  replayTotalFrames,
  onSelectRun,
  onEnterReplay,
  onExitReplay,
  onReplayFrameChange,
  onClose,
}: Props) {
  if (!open) return null;
  const selectedRun = runs.find(run => run.id === selectedRunId) || runs[0];
  const summaryLogs = logs.slice(Math.max(0, logs.length - 8));
  const spawnCount = selectedRun?.spawnedSessions.length || 0;
  const participantCount = selectedRun?.participantAgentIds.length || 0;
  const runStatusLabel =
    selectedRun?.status === 'running' ? '运行中' : selectedRun?.status === 'error' ? '异常' : '已完成';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-950/45 px-2 py-3 backdrop-blur-[1px] sm:items-center sm:px-4 sm:py-8">
      <div className="flex h-full max-h-full w-full max-w-5xl flex-col overflow-hidden border-[4px] border-[#2d1c0d] bg-[#fff6d8] font-mono shadow-[0_16px_0_#2d1c0d] sm:h-auto">
        <div className="flex items-start justify-between gap-4 border-b-[4px] border-[#2d1c0d] bg-[#4b3319] px-4 py-3 text-[#fff6d8] sm:px-5 sm:py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2d58b]">任务日志</div>
            <h2 className="mt-1 text-2xl font-black">主任务与子会话观察台</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center border-[3px] border-[#f2d58b] text-[#fff6d8]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[320px_1fr]">
          <div className="overflow-y-auto border-r-[4px] border-[#2d1c0d] bg-[#fff1bf] p-5">
            <div className="text-sm font-black text-stone-900">最近任务</div>
            <div className="mt-4 space-y-3">
              {runs.length > 0 ? (
                runs.map(run => (
                  <button
                    key={run.id}
                    onClick={() => onSelectRun?.(run.id)}
                    className={`w-full border-[4px] bg-[#fffdf2] p-4 text-left ${
                      run.id === selectedRunId ? 'border-[#1d4ed8]' : 'border-[#2d1c0d]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-stone-900">{run.title}</div>
                        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          {run.source === 'im' ? 'IM 自动任务' : '手动发起'} · {run.status === 'running' ? '运行中' : '已完成'}
                        </div>
                      </div>
                      <div className="border-[3px] border-[#2d1c0d] bg-[#fff1bf] px-2 py-1 text-[11px] font-bold text-stone-900">
                        {run.createdAtLabel}
                      </div>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-stone-600">{run.prompt}</div>
                    <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">子会话</div>
                    <div className="mt-2 space-y-2">
                      {run.spawnedSessions.length > 0 ? (
                        run.spawnedSessions.map(session => (
                          <div key={session.id} className="border-[3px] border-[#c89d49] bg-[#fff8df] px-3 py-2 text-sm text-stone-700">
                            {agentName(agents, session.agentId)} · {session.status === 'running' ? '执行中' : '已完成'}
                          </div>
                        ))
                      ) : (
                        <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fff8df] px-3 py-3 text-sm leading-6 text-stone-600">
                          这一轮没有拉起子 Agent，当前由 OpenClaw(main) 单独处理。
                        </div>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="border-[4px] border-dashed border-[#c89d49] bg-[#fffdf2] p-4 text-sm leading-6 text-stone-600">
                  还没有任务开始。进入办公室后输入任务，OpenClaw(main) 发起会话后这里会出现主任务和子任务结构。
                </div>
              )}
            </div>
          </div>

          <div className="overflow-y-auto p-5">
            <div className="text-sm font-black text-stone-900">执行时间线</div>
            {selectedRun ? (
              <div className="mt-3 border-[3px] border-[#2d1c0d] bg-[#fffdf2] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">高层级摘要</div>
                <div className="mt-2 text-sm font-black text-stone-900">{selectedRun.title}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-stone-600">
                  <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">状态：{runStatusLabel}</span>
                  <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">参与 Agent：{participantCount}</span>
                  <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">子会话：{spawnCount}</span>
                  <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">日志：{logs.length}</span>
                </div>
                <div className="mt-2 text-[11px] leading-5 text-stone-600">
                  最近关键事件：{summaryLogs.map(item => item.title).join(' / ') || '暂无'}
                </div>
              </div>
            ) : null}
            <div className="mt-3 border-[3px] border-[#2d1c0d] bg-[#fff1bf] p-3">
              <div className="flex flex-wrap items-center gap-2">
                {replayActive ? (
                  <button
                    onClick={onExitReplay}
                    className="border-[3px] border-[#1d4ed8] bg-[#dbeafe] px-3 py-1 text-xs font-black text-[#1d4ed8]"
                  >
                    退出回放
                  </button>
                ) : (
                  <button
                    onClick={onEnterReplay}
                    disabled={!selectedRunId || logs.length === 0}
                    className={`border-[3px] px-3 py-1 text-xs font-black ${
                      !selectedRunId || logs.length === 0
                        ? 'border-stone-300 bg-stone-200 text-stone-500'
                        : 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900'
                    }`}
                  >
                    进入回放
                  </button>
                )}
                {replayActive ? (
                  <div className="text-xs font-semibold text-stone-700">
                    任务：{replayRunId} · 帧 {Math.max(1, (replayFrameIndex ?? 0) + 1)} / {Math.max(1, replayTotalFrames || 0)}
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-stone-700">按单个任务回放，进入后会冻结实时视图。</div>
                )}
              </div>
              {replayActive ? (
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, (replayTotalFrames || 1) - 1)}
                  step={1}
                  value={Math.max(0, replayFrameIndex || 0)}
                  onChange={event => onReplayFrameChange?.(Number(event.target.value))}
                  className="mt-3 w-full accent-[#1d4ed8]"
                />
              ) : null}
            </div>
            {loading ? (
              <div className="mt-3 text-xs font-semibold text-stone-500">正在加载任务日志...</div>
            ) : null}
            <div className="mt-4 space-y-3">
              {logs.length > 0 ? (
                logs.map(log => (
                  <div key={log.id} className="border-[4px] border-[#2d1c0d] bg-[#fffdf2] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black text-stone-900">{log.title}</div>
                      <div className="text-[11px] font-semibold text-stone-500">{log.timeLabel}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-stone-600">{log.detail}</div>
                    {(log.runId || log.agentId) && (
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-stone-500">
                        {log.runId ? <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">任务：{log.runId}</span> : null}
                        {log.agentId ? <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">成员：{agentName(agents, log.agentId)}</span> : null}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="border-[4px] border-dashed border-[#c89d49] bg-[#fffdf2] p-4 text-sm leading-6 text-stone-600">
                  当前没有任务时间线。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
