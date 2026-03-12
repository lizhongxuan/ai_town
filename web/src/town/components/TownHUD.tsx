import { Workflow } from 'lucide-react';

interface Props {
  runningTasks: number;
  sceneName: string;
}

export default function TownHUD({ runningTasks, sceneName }: Props) {
  return (
    <div className="pointer-events-none absolute left-3 top-[86px] z-20 w-[160px] border-[4px] border-[#2d1c0d] bg-[#f7efc7] p-2.5 text-stone-900 shadow-[0_8px_0_#2d1c0d,0_16px_24px_rgba(45,28,13,0.18)] sm:left-4 sm:w-[176px]">
      <div className="absolute inset-[6px] border-[2px] border-[#c89d49] opacity-65" />
      <div className="relative text-[9px] font-bold uppercase tracking-[0.16em] text-[#a16207]">{sceneName}状态</div>
      <div className="relative mt-2 border-[3px] border-[#b89554] bg-[#fffaf0] px-2.5 py-2 text-stone-700 shadow-[0_3px_0_#c89d49]">
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] text-stone-500">
          <Workflow size={12} />
          <span>运行中 session</span>
        </div>
        <div className="mt-1 text-lg font-black text-stone-900">{runningTasks}</div>
      </div>
    </div>
  );
}
