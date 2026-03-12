import { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle: string;
  leftOverlay?: ReactNode;
  rightOverlay?: ReactNode;
  footerOverlay?: ReactNode;
  children: ReactNode;
}

export default function TownScene({ title, subtitle, leftOverlay, rightOverlay, footerOverlay, children }: Props) {
  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-[12px] border-[4px] border-[#1a1308] bg-[#7ec45e] font-mono shadow-[0_0_0_4px_#f0d48a,0_0_0_8px_#1a1308,0_18px_0_#1a1308,0_28px_40px_rgba(26,19,8,0.28)]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent_18%),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:100%_100%,32px_32px,32px_32px] [image-rendering:pixelated]" />
      <div className="pointer-events-none absolute inset-[8px] border-[2px] border-black/25" />
      <div className="relative h-full min-h-0">
        <div className="absolute inset-x-0 top-0 z-20 border-b-[4px] border-[#1a1308] bg-[linear-gradient(180deg,#4e351c,#2f1d0d)] px-4 py-3 text-[#fff6d6]">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-black uppercase tracking-[0.12em]">{title}</div>
            <div className="text-[11px] leading-5 text-[#f2d58b]">{subtitle}</div>
          </div>
        </div>
        {leftOverlay}
        {rightOverlay}
        {footerOverlay}
        <div className="relative h-full min-h-0 pt-[64px]">{children}</div>
      </div>
    </div>
  );
}
