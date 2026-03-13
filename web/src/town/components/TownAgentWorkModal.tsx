import { X } from 'lucide-react';
import { TownLogEntry } from '../types/town';

interface Props {
  open: boolean;
  title: string;
  subtitle: string;
  runId?: string;
  runTitle?: string;
  logs: TownLogEntry[];
  loading?: boolean;
  onClose: () => void;
}

export default function TownAgentWorkModal({
  open,
  title,
  subtitle,
  runId,
  runTitle,
  logs,
  loading,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-950/45 px-2 py-3 backdrop-blur-[1px] sm:items-center sm:px-4 sm:py-8">
      <div className="flex h-full max-h-full w-full max-w-4xl flex-col overflow-hidden border-[4px] border-[#2d1c0d] bg-[#fff6d8] font-mono shadow-[0_16px_0_#2d1c0d] sm:h-auto">
        <div className="flex items-start justify-between gap-4 border-b-[4px] border-[#2d1c0d] bg-[#4b3319] px-4 py-3 text-[#fff6d8] sm:px-5 sm:py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2d58b]">工作记录</div>
            <h2 className="mt-1 text-2xl font-black">{title}</h2>
            <div className="mt-1 text-[12px] leading-5 text-[#f4e7c0]">{subtitle}</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center border-[3px] border-[#f2d58b] text-[#fff6d8]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="border-[3px] border-[#2d1c0d] bg-[#fffdf2] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">当前工作上下文</div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-stone-600">
              <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">日志：{logs.length}</span>
              {runId ? <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">任务：{runId}</span> : null}
              {runTitle ? <span className="border-[2px] border-[#c89d49] bg-[#fff8df] px-2 py-1">标题：{runTitle}</span> : null}
            </div>
          </div>

          {loading ? <div className="mt-4 text-xs font-semibold text-stone-500">正在加载工作日志...</div> : null}

          <div className="mt-4 space-y-3">
            {logs.length > 0 ? (
              logs.map(log => (
                <div key={log.id} className="border-[4px] border-[#2d1c0d] bg-[#fffdf2] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-stone-900">{log.title}</div>
                    <div className="text-[11px] font-semibold text-stone-500">{log.timeLabel}</div>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-stone-600">{log.detail}</div>
                </div>
              ))
            ) : (
              <div className="border-[4px] border-dashed border-[#c89d49] bg-[#fffdf2] p-4 text-sm leading-6 text-stone-600">
                当前还没有同步到这位成员的工作日志。任务运行一段时间后，这里会显示它与 AI 的交互记录和自身日志。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
