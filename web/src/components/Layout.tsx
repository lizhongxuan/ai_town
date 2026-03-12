import { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ScrollText, Radio, Sparkles, Clock, Settings,
  Moon, Sun, LogOut, Menu, FolderOpen, Languages, MessageSquare,
  RotateCw, RefreshCw, Power, Puzzle, Bot, Bell, GitBranch, Map as MapIcon,
} from 'lucide-react';
import { useI18n } from '../i18n';
import AIAssistant from './AIAssistant';
import MessageCenter, { TaskInfo } from './MessageCenter';
import { api } from '../lib/api';
import { resolveOpenClawRuntime } from '../lib/openclawRuntime';

interface Props { onLogout: () => void; napcatStatus: any; wechatStatus?: any; openclawStatus?: any; processStatus?: any; wsMessages?: any[]; }

function mapWorkflowRunToTask(run: any): TaskInfo {
  let status: TaskInfo['status'] = 'pending';
  if (run?.status === 'completed') status = 'success';
  else if (run?.status === 'failed') status = 'failed';
  else if (run?.status === 'cancelled') status = 'canceled';
  else if (run?.status === 'running' || run?.status === 'paused' || run?.status === 'waiting_for_user' || run?.status === 'waiting_for_approval') status = 'running';

  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const finished = steps.filter((step: any) => step?.status === 'completed' || step?.status === 'skipped').length;
  const progress = run?.status === 'completed' ? 100 : steps.length > 0 ? Math.round((finished / steps.length) * 100) : 0;

  return {
    id: `workflow-${run.id}`,
    name: `${run.name || '工作流'} ${run.shortId || ''}`.trim(),
    type: 'workflow_run',
    status,
    progress,
    error: run?.status === 'failed' ? run?.lastMessage : undefined,
    createdAt: new Date(run?.createdAt || Date.now()).toISOString(),
    updatedAt: new Date(run?.updatedAt || Date.now()).toISOString(),
    logCount: run?.lastMessage ? 1 : 0,
    log: run?.lastMessage ? [run.lastMessage] : [],
  };
}

function mergeTasks(base: TaskInfo[], extra: TaskInfo[]) {
  const merged = new Map<string, TaskInfo>();
  [...extra, ...base].forEach(task => {
    merged.set(task.id, task);
  });
  return Array.from(merged.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function filterVisibleTasks(tasks: TaskInfo[]) {
  return tasks.filter(task => !(task.type === 'workflow_run' && task.status === 'canceled'));
}

export default function Layout({ onLogout, napcatStatus, wechatStatus, openclawStatus, processStatus, wsMessages }: Props) {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const isTownPage = location.pathname === '/town';
  const enableAgents = import.meta.env.VITE_FEATURE_AGENTS !== 'false';
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [taskLogs, setTaskLogs] = useState<Record<string, string[]>>({});

  const loadTasks = useCallback(async () => {
    try {
      const [taskRes, workflowRes] = await Promise.all([
        api.getTasks(),
        api.getWorkflowRuns(),
      ]);
      const taskItems = taskRes?.ok ? (taskRes.tasks || []) : [];
      const workflowItems = workflowRes?.ok ? (workflowRes.runs || []).map(mapWorkflowRunToTask) : [];
      setTasks(filterVisibleTasks(mergeTasks(taskItems, workflowItems)));
    } catch {}
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Listen for WebSocket task events
  useEffect(() => {
    if (!wsMessages || wsMessages.length === 0) return;
    const last = wsMessages[wsMessages.length - 1];
    if (last?.type === 'task_update') {
      setTasks(prev => {
        if (last.task?.type === 'workflow_run' && last.task?.status === 'canceled') {
          return prev.filter(t => t.id !== last.task.id);
        }
        const idx = prev.findIndex(t => t.id === last.task.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...last.task }; return n; }
        return [last.task, ...prev];
      });
    } else if (last?.type === 'task_log') {
      setTaskLogs(prev => ({
        ...prev,
        [last.taskId]: [...(prev[last.taskId] || []), last.line],
      }));
    }
  }, [wsMessages]);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t.nav.dashboard },
    { to: '/town', icon: MapIcon, label: locale === 'zh-CN' ? 'AI 小镇' : 'Town' },
    { to: '/logs', icon: ScrollText, label: t.nav.activityLog },
    { to: '/channels', icon: Radio, label: t.nav.channels },
    { to: '/skills', icon: Sparkles, label: t.nav.skills },
    { to: '/plugins', icon: Puzzle, label: locale === 'zh-CN' ? '插件中心' : 'Plugins' },
    ...(enableAgents ? [{ to: '/agents', icon: Bot, label: locale === 'zh-CN' ? '智能体' : 'Agents' }] : []),
    { to: '/workflows', icon: GitBranch, label: locale === 'zh-CN' ? '工作流' : 'Workflows' },
    { to: '/cron', icon: Clock, label: t.nav.cronJobs },
    { to: '/sessions', icon: MessageSquare, label: '会话管理' },
    { to: '/workspace', icon: FolderOpen, label: t.nav.workspace },
    { to: '/config', icon: Settings, label: t.nav.systemConfig },
  ];

  const mobileNavItems = [
    { to: '/', icon: LayoutDashboard, label: t.nav.dashboard },
    { to: '/channels', icon: Radio, label: t.nav.channels },
    ...(enableAgents ? [{ to: '/agents', icon: Bot, label: locale === 'zh-CN' ? '智能体' : 'Agents' }] : [{ to: '/plugins', icon: Puzzle, label: locale === 'zh-CN' ? '插件' : 'Plugins' }]),
    { to: '/workflows', icon: GitBranch, label: locale === 'zh-CN' ? '工作流' : 'Flows' },
    { to: '/config', icon: Settings, label: t.nav.systemConfig },
  ];

  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem('theme');
    if (s === 'dark' || (!s && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
      return true;
    }
    return false;
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.dataset.uiMode = 'modern';
    return () => {
      delete document.body.dataset.uiMode;
    };
  }, []);

  const toggleDark = () => {
    setDark(d => {
      const n = !d;
      localStorage.setItem('theme', n ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', n);
      return n;
    });
  };

  const toggleLocale = () => {
    setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN');
  };

  const goTo = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  // Build channel list from enabledChannels returned by /api/status
  const enabledChannels: { id: string; label: string }[] = openclawStatus?.enabledChannels || [];
  const connectedChannels: { label: string; detail: string; connected: boolean }[] = [];
  const runtime = resolveOpenClawRuntime(openclawStatus, processStatus);
  const openClawRestartHint = processStatus?.managedExternally
    ? (locale === 'zh-CN' ? '当前 OpenClaw 由外部进程管理，请改用“网关”按钮或在外部环境中重启。' : 'OpenClaw is managed externally. Use “Gateway” or restart it outside the panel.')
    : processStatus?.daemonized
      ? (locale === 'zh-CN' ? '当前 OpenClaw 以 daemon 模式运行，请改用“网关”按钮重启。' : 'OpenClaw is running in daemon mode. Use “Gateway” to restart it.')
      : '';
  const openClawRestartDisabled = !!openClawRestartHint;
  for (const ch of enabledChannels) {
    if (ch.id === 'qq') {
      const connected = napcatStatus?.connected;
      connectedChannels.push({
        label: 'QQ',
        detail: connected ? `${napcatStatus.nickname || 'QQ'} (${napcatStatus.selfId || ''})` : t.common.notLoggedIn,
        connected: !!connected,
      });
    } else if (ch.id === 'wechat') {
      connectedChannels.push({
        label: locale === 'zh-CN' ? '微信' : 'WeChat',
        detail: wechatStatus?.loggedIn ? (wechatStatus.name || t.common.connected) : t.common.notLoggedIn,
        connected: !!wechatStatus?.loggedIn,
      });
    } else {
      connectedChannels.push({ label: ch.label, detail: t.common.enabled, connected: true });
    }
  }

  return (
    <div className="flex h-screen overflow-hidden ui-modern-shell">
      {open && <div className="fixed inset-0 z-40 bg-slate-950/42 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-[320px] flex-col ui-modern-sidebar transition-transform duration-300 lg:static lg:w-64 lg:max-w-none lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand */}
        <div className="px-4 py-4 border-b border-slate-200/70">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-2xl border border-slate-200/70 bg-white/90 shadow-[0_10px_24px_rgba(15,23,42,0.06)] dark:border-slate-700/70 dark:bg-slate-900/90">
              <img src="/logo.jpg" alt="ClawPanel" className="w-8 h-8 rounded-xl object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-tight text-gray-900 dark:text-white">ClawPanel</h1>
              <p className="text-[10px] font-medium -mt-0.5 text-slate-500">{t.nav.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Connected channel indicators — only show if any connected */}
        {connectedChannels.length > 0 && (
          <div className="px-4 py-3 border-b space-y-1.5 border-slate-200/70">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-slate-400">{t.nav.runningStatus}</div>
            {connectedChannels.map(ch => (
              <div key={ch.label} className="flex items-center gap-2 text-xs">
                <span className={`relative flex h-2 w-2 shrink-0`}>
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${ch.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${ch.connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-gray-600 dark:text-gray-300 font-medium block truncate">{ch.label}</span>
                  <span className="text-[10px] text-gray-400 block truncate">{ch.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 ui-modern-scrollbar">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-all duration-200 group border ${isActive ? 'ui-modern-nav-link active font-semibold translate-x-0.5' : 'ui-modern-nav-link border-transparent hover:-translate-y-0.5 hover:translate-x-0.5 hover:border-blue-100/80 hover:text-slate-900'}`
              }>
              <Icon size={18} className="shrink-0 transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-3" />
              <span className="transition-all duration-200">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="space-y-0.5 border-t border-slate-200/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:pb-2">
          <button onClick={toggleDark} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 w-full">
            {dark ? <Sun size={16} /> : <Moon size={16} />}{locale === 'zh-CN' ? (dark ? '切换到浅色' : '切换到深色') : (dark ? 'Light Mode' : 'Dark Mode')}
          </button>
          <MessageCenter tasks={tasks} taskLogs={taskLogs} onRefresh={loadTasks} mode="sidebar" />
          <button onClick={toggleLocale} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 w-full">
            <Languages size={16} />{locale === 'zh-CN' ? 'English' : '中文（简体）'}
          </button>
          {/* Quick actions */}
          <div className="flex items-center gap-1 px-1 py-1">
            <button
              onClick={async () => {
                if (openClawRestartDisabled) {
                  window.alert(openClawRestartHint);
                  return;
                }
                if (!confirm(locale === 'zh-CN' ? '确定重启 OpenClaw？' : 'Restart OpenClaw?')) return;
                try {
                  const r = await api.restartProcess();
                  if (!r?.ok) window.alert(r?.error || (locale === 'zh-CN' ? '重启 OpenClaw 失败' : 'Failed to restart OpenClaw'));
                } catch {
                  window.alert(locale === 'zh-CN' ? '重启 OpenClaw 失败' : 'Failed to restart OpenClaw');
                }
              }}
              aria-disabled={openClawRestartDisabled}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                openClawRestartDisabled
                  ? 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60'
                  : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
              }`}
              title={openClawRestartHint || (locale === 'zh-CN' ? '重启 OpenClaw' : 'Restart OpenClaw')}
            >
              <RotateCw size={13} /><span>OpenClaw</span>
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await api.restartGateway();
                  if (!r?.ok) window.alert(r?.error || (locale === 'zh-CN' ? '重启网关失败' : 'Failed to restart gateway'));
                } catch {
                  window.alert(locale === 'zh-CN' ? '重启网关失败' : 'Failed to restart gateway');
                }
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              title={locale === 'zh-CN' ? '重启网关' : 'Restart Gateway'}
            >
              <RefreshCw size={13} /><span>{locale === 'zh-CN' ? '网关' : 'Gateway'}</span>
            </button>
            <button
              onClick={async () => { if (!confirm(locale === 'zh-CN' ? '确定重启 ClawPanel？页面将短暂断开。' : 'Restart ClawPanel? Page will briefly disconnect.')) return; try { await api.restartPanel(); setTimeout(() => window.location.reload(), 3000); } catch {} }}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              title={locale === 'zh-CN' ? '重启面板' : 'Restart Panel'}
            >
              <Power size={13} /><span>{locale === 'zh-CN' ? '面板' : 'Panel'}</span>
            </button>
          </div>
          <button onClick={onLogout} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 w-full">
            <LogOut size={16} />{t.nav.logout}
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
        {openclawStatus?.configured && !runtime.healthy && (
          <div className="px-3 pt-3 sm:px-4 lg:px-6 xl:px-7">
            <div className={`rounded-[24px] border px-4 py-3 shadow-[0_16px_34px_rgba(15,23,42,0.06)] backdrop-blur-xl ${runtime.state === 'offline' ? 'border-red-200/80 dark:border-red-900/40 bg-[linear-gradient(135deg,rgba(254,242,242,0.96),rgba(255,237,213,0.88))] dark:bg-[linear-gradient(135deg,rgba(127,29,29,0.24),rgba(120,53,15,0.18))]' : 'border-amber-200/80 dark:border-amber-900/40 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(254,249,195,0.86))] dark:bg-[linear-gradient(135deg,rgba(120,53,15,0.22),rgba(113,63,18,0.16))]'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-2xl p-2 ${runtime.state === 'offline' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  <Bell size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold ${runtime.state === 'offline' ? 'text-red-900 dark:text-red-100' : 'text-amber-900 dark:text-amber-100'}`}>{runtime.title}</div>
                  <div className={`mt-1 text-xs leading-5 ${runtime.state === 'offline' ? 'text-red-700 dark:text-red-200/90' : 'text-amber-800 dark:text-amber-200/90'}`}>{runtime.message}</div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className={`${isTownPage ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto ui-modern-scrollbar'} p-3 pb-24 sm:p-4 sm:pb-28 lg:p-6 lg:pb-6 xl:p-7`}>
          <Outlet context={{ uiMode: 'modern' }} />
        </div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-blue-100/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(239,246,255,0.84))] px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl dark:border-blue-400/15 dark:bg-[linear-gradient(180deg,rgba(7,17,31,0.96),rgba(11,26,46,0.92))] lg:hidden">
        <div className="grid grid-cols-6 gap-2">
          {mobileNavItems.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <button key={to} onClick={() => goTo(to)} className={`flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-2xl border text-[11px] font-medium transition-all ${active ? 'border-blue-200/80 bg-[linear-gradient(135deg,rgba(59,130,246,0.18),rgba(14,165,233,0.12))] text-blue-700 shadow-[0_12px_24px_rgba(37,99,235,0.12)] dark:border-blue-400/20 dark:bg-[linear-gradient(135deg,rgba(37,99,235,0.24),rgba(14,165,233,0.12))] dark:text-blue-100' : 'border-transparent bg-white/40 text-slate-500 dark:bg-slate-900/28 dark:text-slate-400'}`}>
                <Icon size={17} />
                <span className="truncate px-1">{label}</span>
              </button>
            );
          })}
          <button onClick={() => setOpen(true)} className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-2xl bg-white/40 text-[11px] font-medium text-slate-500 dark:bg-slate-900/28 dark:text-slate-400">
            <Menu size={17} />
            <span>{locale === 'zh-CN' ? '更多' : 'More'}</span>
          </button>
        </div>
      </nav>
      <AIAssistant />
    </div>
  );
}
