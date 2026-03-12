import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import { api } from '../../lib/api';
import { TownAgent } from '../types/town';

interface Props {
  open: boolean;
  agents: TownAgent[];
  allAgents?: TownAgent[];
  query: string;
  selectedCount: number;
  maxSelectable: number;
  pendingAgentIds?: string[];
  interactionLocked?: boolean;
  onQueryChange: (value: string) => void;
  onToggleAgent: (agentId: string) => void;
  onOpenAgentConfig?: (agentId: string) => void;
  onRefreshTown?: () => Promise<void> | void;
  onClose: () => void;
}

type PanelTab = 'profile' | 'skills' | 'sessions' | 'permissions';
type CoreFileName = 'AGENTS.md' | 'SOUL.md' | 'MEMORY.md';

interface SkillEntry {
  id: string;
  toggleKey: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}

interface SessionEntry {
  sessionId: string;
  key: string;
  updatedAt: number;
  messageCount: number;
  lastChannel: string;
}

interface PermissionSummary {
  delegationMode: 'inherit' | 'enabled' | 'disabled';
  delegationAllow: string[];
  sessionVisibility: '' | 'self' | 'tree' | 'agent' | 'all';
  subagentAllow: string[];
}

const CORE_FILES: CoreFileName[] = ['AGENTS.md', 'SOUL.md', 'MEMORY.md'];
const PERMISSION_LIST_PREVIEW_LIMIT = 4;

const EMPTY_CORE_FILE_MAP: Record<CoreFileName, string> = {
  'AGENTS.md': '',
  'SOUL.md': '',
  'MEMORY.md': '',
};

const EMPTY_CORE_EXISTS_MAP: Record<CoreFileName, boolean> = {
  'AGENTS.md': false,
  'SOUL.md': false,
  'MEMORY.md': false,
};

const DEFAULT_PERMISSION_SUMMARY: PermissionSummary = {
  delegationMode: 'inherit',
  delegationAllow: [],
  sessionVisibility: '',
  subagentAllow: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNestedValue(raw: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, key) => {
    const record = asRecord(cursor);
    return record ? record[key] : undefined;
  }, raw);
}

function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map(item => (typeof item === 'string' ? item.trim() : String(item).trim()))
      .filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function isCoreFileName(name: string): name is CoreFileName {
  return name === 'AGENTS.md' || name === 'SOUL.md' || name === 'MEMORY.md';
}

function parseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

function describeDelegation(mode: PermissionSummary['delegationMode']) {
  if (mode === 'enabled') return '允许委派';
  if (mode === 'disabled') return '禁用委派';
  return '继承默认';
}

function describeSessionVisibility(visibility: PermissionSummary['sessionVisibility']) {
  if (visibility === 'self') return '仅当前会话';
  if (visibility === 'tree') return '当前会话树';
  if (visibility === 'agent') return '当前 Agent 全部会话';
  if (visibility === 'all') return '所有会话';
  return '继承默认';
}

function formatSessionUpdatedAt(updatedAt: number) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return '--';
  const date = new Date(updatedAt);
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function parsePermissionSummary(rawAgent: unknown): PermissionSummary {
  const tools = asRecord(getNestedValue(rawAgent, 'tools'));
  const subagents = asRecord(getNestedValue(rawAgent, 'subagents'));
  const delegationEnabled = getNestedValue(tools, 'agentToAgent.enabled');
  const delegationMode: PermissionSummary['delegationMode'] =
    delegationEnabled === true ? 'enabled' : delegationEnabled === false ? 'disabled' : 'inherit';
  const visibilityRaw = String(getNestedValue(tools, 'sessions.visibility') || '').trim();
  const sessionVisibility: PermissionSummary['sessionVisibility'] =
    visibilityRaw === 'self' || visibilityRaw === 'tree' || visibilityRaw === 'agent' || visibilityRaw === 'all'
      ? visibilityRaw
      : '';
  return {
    delegationMode,
    delegationAllow: parseStringList(getNestedValue(tools, 'agentToAgent.allow')),
    sessionVisibility,
    subagentAllow: parseStringList(getNestedValue(subagents, 'allowAgents')),
  };
}

function previewList(items: string[], expanded: boolean) {
  if (expanded || items.length <= PERMISSION_LIST_PREVIEW_LIMIT) return items;
  return items.slice(0, PERMISSION_LIST_PREVIEW_LIMIT);
}

function membershipLabel(agent: TownAgent) {
  if (agent.executionState === 'busy') return '忙碌中';
  if (agent.officeMembership === 'auto_added') return '自动加入';
  if (agent.officeMembership === 'selected') return '已选中';
  return '未选中';
}

function actionLabel(agent: TownAgent) {
  if (agent.executionState === 'busy') return '执行中';
  if (agent.officeMembership === 'unselected') return '选中';
  return '移出';
}

function actionDisabled(agent: TownAgent) {
  return agent.executionState === 'busy';
}

export default function TownAgentDrawer({
  open,
  agents,
  allAgents = [],
  query,
  selectedCount,
  maxSelectable,
  pendingAgentIds = [],
  interactionLocked = false,
  onQueryChange,
  onToggleAgent,
  onOpenAgentConfig,
  onRefreshTown,
  onClose,
}: Props) {
  const [panelAgentId, setPanelAgentId] = useState('');
  const [panelTab, setPanelTab] = useState<PanelTab>('profile');
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [panelNotice, setPanelNotice] = useState('');
  const [showMemoryEditor, setShowMemoryEditor] = useState(false);
  const [coreDraft, setCoreDraft] = useState<Record<CoreFileName, string>>(EMPTY_CORE_FILE_MAP);
  const [coreOriginal, setCoreOriginal] = useState<Record<CoreFileName, string>>(EMPTY_CORE_FILE_MAP);
  const [coreExists, setCoreExists] = useState<Record<CoreFileName, boolean>>(EMPTY_CORE_EXISTS_MAP);
  const [coreSaving, setCoreSaving] = useState<Record<CoreFileName, boolean>>({
    'AGENTS.md': false,
    'SOUL.md': false,
    'MEMORY.md': false,
  });
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [pendingSkillKeys, setPendingSkillKeys] = useState<string[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState('');
  const [permissionSummary, setPermissionSummary] = useState<PermissionSummary>(DEFAULT_PERMISSION_SUMMARY);
  const [expandDelegationAllow, setExpandDelegationAllow] = useState(false);
  const [expandSubagentAllow, setExpandSubagentAllow] = useState(false);
  const loadSequenceRef = useRef(0);

  const agentPool = useMemo(() => (allAgents.length > 0 ? allAgents : agents), [agents, allAgents]);
  const panelAgent = useMemo(
    () => agentPool.find(agent => agent.id === panelAgentId),
    [agentPool, panelAgentId]
  );
  const profileDirty = useMemo(
    () => CORE_FILES.some(fileName => coreDraft[fileName] !== coreOriginal[fileName]),
    [coreDraft, coreOriginal]
  );
  const delegationAllowPreview = useMemo(
    () => previewList(permissionSummary.delegationAllow, expandDelegationAllow),
    [expandDelegationAllow, permissionSummary.delegationAllow]
  );
  const subagentAllowPreview = useMemo(
    () => previewList(permissionSummary.subagentAllow, expandSubagentAllow),
    [expandSubagentAllow, permissionSummary.subagentAllow]
  );

  const setSkillPending = (skillKey: string, pending: boolean) => {
    setPendingSkillKeys(prev => {
      if (pending) {
        if (prev.includes(skillKey)) return prev;
        return [...prev, skillKey];
      }
      return prev.filter(item => item !== skillKey);
    });
  };

  const resetPanelContent = () => {
    setPanelTab('profile');
    setPanelError('');
    setPanelNotice('');
    setShowMemoryEditor(false);
    setCoreDraft(EMPTY_CORE_FILE_MAP);
    setCoreOriginal(EMPTY_CORE_FILE_MAP);
    setCoreExists(EMPTY_CORE_EXISTS_MAP);
    setSkills([]);
    setSessions([]);
    setPendingSkillKeys([]);
    setDeletingSessionId('');
    setPermissionSummary(DEFAULT_PERMISSION_SUMMARY);
    setExpandDelegationAllow(false);
    setExpandSubagentAllow(false);
  };

  useEffect(() => {
    if (!open) {
      setPanelAgentId('');
      resetPanelContent();
    }
  }, [open]);

  const loadCoreFiles = async (agentId: string, sequence: number) => {
    try {
      const response = await api.getAgentCoreFiles(agentId);
      if (loadSequenceRef.current !== sequence) return '';
      if (!response?.ok) return String(response?.error || '加载核心文件失败');
      const nextDraft: Record<CoreFileName, string> = {
        'AGENTS.md': '',
        'SOUL.md': '',
        'MEMORY.md': '',
      };
      const nextExists: Record<CoreFileName, boolean> = {
        'AGENTS.md': false,
        'SOUL.md': false,
        'MEMORY.md': false,
      };
      const entries: unknown[] = Array.isArray(response.files) ? (response.files as unknown[]) : [];
      entries.forEach((item: unknown) => {
        const entry = asRecord(item);
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        if (!isCoreFileName(name)) return;
        nextDraft[name] = typeof entry?.content === 'string' ? entry.content : '';
        nextExists[name] = Boolean(entry?.exists);
      });
      setCoreDraft(nextDraft);
      setCoreOriginal(nextDraft);
      setCoreExists(nextExists);
      return '';
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return '';
      return parseErrorMessage(error, '加载核心文件失败');
    }
  };

  const loadSkills = async (agentId: string, sequence: number) => {
    try {
      if (loadSequenceRef.current === sequence) setSkillsLoading(true);
      const response = await api.getSkills(agentId);
      if (loadSequenceRef.current !== sequence) return '';
      if (!response?.ok) return String(response?.error || '加载技能失败');
      const rawSkills: unknown[] = Array.isArray(response.skills) ? (response.skills as unknown[]) : [];
      const nextSkills = rawSkills
        .map((item: any): SkillEntry | null => {
          const toggleKey = String(item?.skillKey || item?.id || '').trim();
          const id = String(item?.id || toggleKey || '').trim();
          if (!id || !toggleKey) return null;
          return {
            id,
            toggleKey,
            name: String(item?.name || id).trim() || id,
            description: String(item?.description || '').trim(),
            source: String(item?.source || '').trim() || 'workspace',
            enabled: item?.enabled !== false,
          };
        })
        .filter((item: SkillEntry | null): item is SkillEntry => Boolean(item))
        .sort((left: SkillEntry, right: SkillEntry) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
      setSkills(nextSkills);
      return '';
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return '';
      return parseErrorMessage(error, '加载技能失败');
    } finally {
      if (loadSequenceRef.current === sequence) setSkillsLoading(false);
    }
  };

  const loadSessions = async (agentId: string, sequence: number) => {
    try {
      if (loadSequenceRef.current === sequence) setSessionsLoading(true);
      const response = await api.getSessions(agentId);
      if (loadSequenceRef.current !== sequence) return '';
      if (!response?.ok) return String(response?.error || '加载会话失败');
      const rawSessions: unknown[] = Array.isArray(response.sessions) ? (response.sessions as unknown[]) : [];
      const nextSessions = rawSessions
        .map((item: any): SessionEntry | null => {
          const sessionId = String(item?.sessionId || '').trim();
          if (!sessionId) return null;
          return {
            sessionId,
            key: String(item?.key || '').trim(),
            updatedAt: Number.isFinite(item?.updatedAt) ? Number(item.updatedAt) : 0,
            messageCount: Number.isFinite(item?.messageCount) ? Number(item.messageCount) : 0,
            lastChannel: String(item?.lastChannel || '').trim(),
          };
        })
        .filter((item: SessionEntry | null): item is SessionEntry => Boolean(item))
        .sort((left: SessionEntry, right: SessionEntry) => right.updatedAt - left.updatedAt);
      setSessions(nextSessions);
      return '';
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return '';
      return parseErrorMessage(error, '加载会话失败');
    } finally {
      if (loadSequenceRef.current === sequence) setSessionsLoading(false);
    }
  };

  const loadPermission = async (agentId: string, sequence: number) => {
    try {
      const response = await api.getAgentsConfig();
      if (loadSequenceRef.current !== sequence) return '';
      if (!response?.ok) return String(response?.error || '加载权限摘要失败');
      const list = Array.isArray(response?.agents?.list) ? response.agents.list : [];
      const target = list.find((item: any) => String(item?.id || '').trim() === agentId);
      if (!target) {
        setPermissionSummary(DEFAULT_PERMISSION_SUMMARY);
        return '';
      }
      setPermissionSummary(parsePermissionSummary(target));
      return '';
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return '';
      return parseErrorMessage(error, '加载权限摘要失败');
    }
  };

  const loadAgentPanelData = async (agentId: string) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setPanelLoading(true);
    setPanelError('');
    setPanelNotice('');
    const [coreErr, skillErr, sessionErr, permissionErr] = await Promise.all([
      loadCoreFiles(agentId, sequence),
      loadSkills(agentId, sequence),
      loadSessions(agentId, sequence),
      loadPermission(agentId, sequence),
    ]);
    if (loadSequenceRef.current !== sequence) return;
    const errors = [coreErr, skillErr, sessionErr, permissionErr].filter(Boolean);
    if (errors.length > 0) {
      setPanelError(errors[0]);
    }
    setPanelLoading(false);
  };

  const refreshAgentPanelRuntimeData = async (agentId: string) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const [skillErr, sessionErr, permissionErr] = await Promise.all([
      loadSkills(agentId, sequence),
      loadSessions(agentId, sequence),
      loadPermission(agentId, sequence),
    ]);
    if (loadSequenceRef.current !== sequence) return;
    const errors = [skillErr, sessionErr, permissionErr].filter(Boolean);
    if (errors.length > 0) {
      setPanelError(errors[0]);
    }
  };

  const openAgentPanel = (agentId: string) => {
    setPanelAgentId(agentId);
    setPanelTab('profile');
    setPanelError('');
    setPanelNotice('');
    setExpandDelegationAllow(false);
    setExpandSubagentAllow(false);
    setShowMemoryEditor(false);
    void loadAgentPanelData(agentId);
  };

  const closeAgentPanel = () => {
    setPanelAgentId('');
    resetPanelContent();
  };

  const handleCoreDraftChange = (name: CoreFileName, value: string) => {
    setCoreDraft(prev => ({ ...prev, [name]: value }));
  };

  const handleResetCoreFile = (name: CoreFileName) => {
    setCoreDraft(prev => ({ ...prev, [name]: coreOriginal[name] }));
  };

  const handleSaveCoreFile = async (name: CoreFileName) => {
    if (!panelAgentId || interactionLocked) return;
    if (coreDraft[name] === coreOriginal[name]) return;
    setCoreSaving(prev => ({ ...prev, [name]: true }));
    setPanelError('');
    try {
      const response = await api.saveAgentCoreFile(panelAgentId, name, coreDraft[name]);
      if (!response?.ok) {
        throw new Error(response?.error || `保存 ${name} 失败`);
      }
      setCoreOriginal(prev => ({ ...prev, [name]: coreDraft[name] }));
      setCoreExists(prev => ({ ...prev, [name]: true }));
      setPanelNotice(`${name} 已保存`);
      await refreshAgentPanelRuntimeData(panelAgentId);
      await onRefreshTown?.();
    } catch (error) {
      setPanelError(parseErrorMessage(error, `保存 ${name} 失败`));
    } finally {
      setCoreSaving(prev => ({ ...prev, [name]: false }));
    }
  };

  const handleToggleSkill = async (skill: SkillEntry) => {
    if (!panelAgentId || interactionLocked) return;
    if (pendingSkillKeys.includes(skill.toggleKey)) return;
    setSkillPending(skill.toggleKey, true);
    setPanelError('');
    try {
      const response = await api.toggleSkill(skill.toggleKey, !skill.enabled, [skill.id]);
      if (!response?.ok) {
        throw new Error(response?.error || '技能切换失败');
      }
      setSkills(prev =>
        prev.map(item =>
          item.toggleKey === skill.toggleKey ? { ...item, enabled: !item.enabled } : item
        )
      );
      setPanelNotice(`技能 ${skill.name} 已${skill.enabled ? '关闭' : '启用'}`);
      await refreshAgentPanelRuntimeData(panelAgentId);
      await onRefreshTown?.();
    } catch (error) {
      setPanelError(parseErrorMessage(error, '技能切换失败'));
    } finally {
      setSkillPending(skill.toggleKey, false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!panelAgentId || interactionLocked) return;
    if (deletingSessionId) return;
    const confirmed = window.confirm(`确认清理会话 ${sessionId} 吗？该操作不可撤销。`);
    if (!confirmed) return;
    setDeletingSessionId(sessionId);
    setPanelError('');
    try {
      const response = await api.deleteSession(sessionId, panelAgentId);
      if (!response?.ok) {
        throw new Error(response?.error || '会话清理失败');
      }
      setSessions(prev => prev.filter(item => item.sessionId !== sessionId));
      setPanelNotice(`会话 ${sessionId} 已清理`);
      await refreshAgentPanelRuntimeData(panelAgentId);
      await onRefreshTown?.();
    } catch (error) {
      setPanelError(parseErrorMessage(error, '会话清理失败'));
    } finally {
      setDeletingSessionId('');
    }
  };

  const handleOpenAgentConfigPage = () => {
    if (!panelAgentId) return;
    if (onOpenAgentConfig) {
      onOpenAgentConfig(panelAgentId);
      return;
    }
    window.location.href = '/agents';
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/40 backdrop-blur-[1px]">
      <button
        aria-label="关闭成员列表"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-[440px] overflow-y-auto border-l-[4px] border-[#2d1c0d] bg-[#fff6d8] p-5 font-mono shadow-[-12px_0_0_#2d1c0d]">
        {panelAgent ? (
          <div className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-[#fff6d8] p-5">
            <div className="flex items-start justify-between gap-3">
              <button
                onClick={closeAgentPanel}
                className="inline-flex items-center gap-2 border-[3px] border-[#2d1c0d] bg-[#fffdf2] px-3 py-2 text-xs font-bold text-stone-900"
              >
                <ArrowLeft size={14} />
                返回列表
              </button>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center border-[3px] border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 border-[3px] border-[#2d1c0d] bg-[#fff1bf] px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b45309]">成员轻量管理</div>
              <div className="mt-1 text-lg font-black text-stone-900">{panelAgent.name}</div>
              <div className="text-xs text-stone-600">{panelAgent.id} · {panelAgent.role}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => void loadAgentPanelData(panelAgent.id)}
                  className="inline-flex items-center gap-1 border-[2px] border-[#2d1c0d] bg-[#fffdf2] px-2.5 py-1 text-[11px] font-bold text-stone-900"
                >
                  <RotateCcw size={12} />
                  刷新
                </button>
                <button
                  onClick={handleOpenAgentConfigPage}
                  className="inline-flex items-center gap-1 border-[2px] border-[#2d1c0d] bg-[#ffe39a] px-2.5 py-1 text-[11px] font-bold text-stone-900"
                >
                  <ExternalLink size={12} />
                  打开智能体配置页
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
                {[
                  { id: 'profile' as const, label: '轻量编辑' },
                  { id: 'skills' as const, label: '技能' },
                  { id: 'sessions' as const, label: '会话' },
                  { id: 'permissions' as const, label: '权限摘要' },
                ].map(item => (
                <button
                  key={item.id}
                  onClick={() => setPanelTab(item.id)}
                  className={`border-[2px] px-2 py-2 text-[11px] font-bold ${
                    panelTab === item.id
                      ? 'border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]'
                      : 'border-[#2d1c0d] bg-[#fffdf2] text-stone-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {interactionLocked ? (
              <div className="mt-3 border-[2px] border-[#1d4ed8] bg-[#dbeafe] px-3 py-2 text-xs font-bold text-blue-800">
                当前处于回放模式，编辑与写入操作已锁定。请先退出回放。
              </div>
            ) : null}
            {panelError ? (
              <div className="mt-3 border-[2px] border-[#ef4444] bg-[#fef2f2] px-3 py-2 text-xs font-bold text-red-700">
                {panelError}
              </div>
            ) : null}
            {panelNotice ? (
              <div className="mt-3 border-[2px] border-[#16a34a] bg-[#dcfce7] px-3 py-2 text-xs font-bold text-[#166534]">
                {panelNotice}
              </div>
            ) : null}

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {panelLoading ? (
                <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fffdf2] px-4 py-4 text-sm text-stone-600">
                  正在加载 {panelAgent.name} 的配置与运行数据...
                </div>
              ) : null}

              {!panelLoading && panelTab === 'profile' ? (
                <div className="space-y-4">
                  <div className="border-[3px] border-[#2d1c0d] bg-[#fff1bf] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-stone-900">职业与人设（AGENTS.md）</div>
                      <span className="text-[10px] font-bold text-stone-500">
                        {coreExists['AGENTS.md'] ? '已存在' : '将创建'}
                      </span>
                    </div>
                    <textarea
                      value={coreDraft['AGENTS.md']}
                      onChange={event => handleCoreDraftChange('AGENTS.md', event.target.value)}
                      disabled={interactionLocked}
                      placeholder="描述该 Agent 的角色定位、职责边界、工作方式。"
                      className="mt-2 h-32 w-full resize-none border-[3px] border-[#2d1c0d] bg-[#fffdf2] px-3 py-2 text-xs leading-5 text-stone-900 outline-none placeholder:text-stone-400"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void handleSaveCoreFile('AGENTS.md')}
                        disabled={
                          interactionLocked ||
                          coreSaving['AGENTS.md'] ||
                          coreDraft['AGENTS.md'] === coreOriginal['AGENTS.md']
                        }
                        className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                          interactionLocked ||
                          coreSaving['AGENTS.md'] ||
                          coreDraft['AGENTS.md'] === coreOriginal['AGENTS.md']
                            ? 'border-stone-300 bg-stone-200 text-stone-500'
                            : 'border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]'
                        }`}
                      >
                        {coreSaving['AGENTS.md'] ? '保存中' : '保存'}
                      </button>
                      <button
                        onClick={() => handleResetCoreFile('AGENTS.md')}
                        disabled={interactionLocked || coreDraft['AGENTS.md'] === coreOriginal['AGENTS.md']}
                        className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                          interactionLocked || coreDraft['AGENTS.md'] === coreOriginal['AGENTS.md']
                            ? 'border-stone-300 bg-stone-200 text-stone-500'
                            : 'border-[#2d1c0d] bg-[#fffdf2] text-stone-900'
                        }`}
                      >
                        重置
                      </button>
                    </div>
                  </div>

                  <div className="border-[3px] border-[#2d1c0d] bg-[#fff1bf] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-stone-900">语气与风格（SOUL.md）</div>
                      <span className="text-[10px] font-bold text-stone-500">
                        {coreExists['SOUL.md'] ? '已存在' : '将创建'}
                      </span>
                    </div>
                    <textarea
                      value={coreDraft['SOUL.md']}
                      onChange={event => handleCoreDraftChange('SOUL.md', event.target.value)}
                      disabled={interactionLocked}
                      placeholder="描述输出语气、表达偏好、工作语境下的沟通风格。"
                      className="mt-2 h-32 w-full resize-none border-[3px] border-[#2d1c0d] bg-[#fffdf2] px-3 py-2 text-xs leading-5 text-stone-900 outline-none placeholder:text-stone-400"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void handleSaveCoreFile('SOUL.md')}
                        disabled={interactionLocked || coreSaving['SOUL.md'] || coreDraft['SOUL.md'] === coreOriginal['SOUL.md']}
                        className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                          interactionLocked || coreSaving['SOUL.md'] || coreDraft['SOUL.md'] === coreOriginal['SOUL.md']
                            ? 'border-stone-300 bg-stone-200 text-stone-500'
                            : 'border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]'
                        }`}
                      >
                        {coreSaving['SOUL.md'] ? '保存中' : '保存'}
                      </button>
                      <button
                        onClick={() => handleResetCoreFile('SOUL.md')}
                        disabled={interactionLocked || coreDraft['SOUL.md'] === coreOriginal['SOUL.md']}
                        className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                          interactionLocked || coreDraft['SOUL.md'] === coreOriginal['SOUL.md']
                            ? 'border-stone-300 bg-stone-200 text-stone-500'
                            : 'border-[#2d1c0d] bg-[#fffdf2] text-stone-900'
                        }`}
                      >
                        重置
                      </button>
                    </div>
                  </div>

                  <div className="border-[3px] border-[#2d1c0d] bg-[#fff1bf] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-stone-900">长期记忆（MEMORY.md）</div>
                      <button
                        onClick={() => setShowMemoryEditor(visible => !visible)}
                        className="border-[2px] border-[#2d1c0d] bg-[#fffdf2] px-2 py-1 text-[10px] font-bold text-stone-900"
                      >
                        {showMemoryEditor ? '折叠' : '展开'}
                      </button>
                    </div>
                    {showMemoryEditor ? (
                      <>
                        <textarea
                          value={coreDraft['MEMORY.md']}
                          onChange={event => handleCoreDraftChange('MEMORY.md', event.target.value)}
                          disabled={interactionLocked}
                          placeholder="保存长期约定、稳定偏好或需要跨会话保留的记忆。"
                          className="mt-2 h-36 w-full resize-none border-[3px] border-[#2d1c0d] bg-[#fffdf2] px-3 py-2 text-xs leading-5 text-stone-900 outline-none placeholder:text-stone-400"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => void handleSaveCoreFile('MEMORY.md')}
                            disabled={
                              interactionLocked ||
                              coreSaving['MEMORY.md'] ||
                              coreDraft['MEMORY.md'] === coreOriginal['MEMORY.md']
                            }
                            className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                              interactionLocked ||
                              coreSaving['MEMORY.md'] ||
                              coreDraft['MEMORY.md'] === coreOriginal['MEMORY.md']
                                ? 'border-stone-300 bg-stone-200 text-stone-500'
                                : 'border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]'
                            }`}
                          >
                            {coreSaving['MEMORY.md'] ? '保存中' : '保存'}
                          </button>
                          <button
                            onClick={() => handleResetCoreFile('MEMORY.md')}
                            disabled={interactionLocked || coreDraft['MEMORY.md'] === coreOriginal['MEMORY.md']}
                            className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                              interactionLocked || coreDraft['MEMORY.md'] === coreOriginal['MEMORY.md']
                                ? 'border-stone-300 bg-stone-200 text-stone-500'
                                : 'border-[#2d1c0d] bg-[#fffdf2] text-stone-900'
                            }`}
                          >
                            重置
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 text-xs leading-5 text-stone-600">
                        展开后可编辑长期记忆。该区域用于保留跨任务的稳定上下文。
                      </div>
                    )}
                  </div>

                  <div className="text-[11px] text-stone-500">
                    {profileDirty ? '有未保存的核心文件修改。' : '核心文件已与最新保存状态一致。'}
                  </div>
                </div>
              ) : null}

              {!panelLoading && panelTab === 'skills' ? (
                <div className="space-y-3">
                  <div className="text-xs leading-5 text-stone-600">
                    显示当前成员生效的技能，可直接开关。
                  </div>
                  {skillsLoading ? (
                    <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fffdf2] px-4 py-4 text-sm text-stone-600">
                      正在加载技能...
                    </div>
                  ) : skills.length === 0 ? (
                    <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fffdf2] px-4 py-4 text-sm text-stone-600">
                      暂无可显示的技能。
                    </div>
                  ) : (
                    skills.map(skill => (
                      <div key={skill.id} className="border-[3px] border-[#c89d49] bg-[#fffdf2] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black text-stone-900">{skill.name}</div>
                            <div className="mt-1 text-[11px] text-stone-500">{skill.source}</div>
                          </div>
                          <button
                            onClick={() => void handleToggleSkill(skill)}
                            disabled={interactionLocked || pendingSkillKeys.includes(skill.toggleKey)}
                            className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                              interactionLocked || pendingSkillKeys.includes(skill.toggleKey)
                                ? 'border-stone-300 bg-stone-200 text-stone-500'
                                : skill.enabled
                                  ? 'border-[#166534] bg-[#dcfce7] text-[#166534]'
                                  : 'border-[#7f1d1d] bg-[#fee2e2] text-[#7f1d1d]'
                            }`}
                          >
                            {pendingSkillKeys.includes(skill.toggleKey)
                              ? '处理中'
                              : skill.enabled
                                ? '已启用'
                                : '已关闭'}
                          </button>
                        </div>
                        <div className="mt-2 text-xs leading-5 text-stone-600">{skill.description || '暂无描述'}</div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {!panelLoading && panelTab === 'sessions' ? (
                <div className="space-y-3">
                  <div className="text-xs leading-5 text-stone-600">
                    支持按成员查看会话并清理异常会话。
                  </div>
                  {sessionsLoading ? (
                    <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fffdf2] px-4 py-4 text-sm text-stone-600">
                      正在加载会话...
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fffdf2] px-4 py-4 text-sm text-stone-600">
                      当前没有可清理的会话。
                    </div>
                  ) : (
                    sessions.map(item => (
                      <div key={item.sessionId} className="border-[3px] border-[#c89d49] bg-[#fffdf2] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-stone-900">{item.sessionId}</div>
                            <div className="mt-1 text-[11px] text-stone-500">
                              更新于 {formatSessionUpdatedAt(item.updatedAt)}
                              {item.lastChannel ? ` · ${item.lastChannel}` : ''}
                            </div>
                            <div className="mt-1 text-[11px] text-stone-500">
                              消息数 {item.messageCount}
                              {item.key ? ` · ${item.key}` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => void handleDeleteSession(item.sessionId)}
                            disabled={interactionLocked || deletingSessionId === item.sessionId}
                            className={`border-[2px] px-2.5 py-1 text-xs font-bold ${
                              interactionLocked || deletingSessionId === item.sessionId
                                ? 'border-stone-300 bg-stone-200 text-stone-500'
                                : 'border-[#7f1d1d] bg-[#fee2e2] text-[#7f1d1d]'
                            }`}
                          >
                            {deletingSessionId === item.sessionId ? '清理中' : '清理'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {!panelLoading && panelTab === 'permissions' ? (
                <div className="space-y-3">
                  <div className="border-[3px] border-[#c89d49] bg-[#fffdf2] p-3">
                    <div className="text-xs font-black text-stone-900">agentToAgent</div>
                    <div className="mt-2 text-sm text-stone-700">{describeDelegation(permissionSummary.delegationMode)}</div>
                  </div>

                  <div className="border-[3px] border-[#c89d49] bg-[#fffdf2] p-3">
                    <div className="text-xs font-black text-stone-900">allowAgents（委派白名单）</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {delegationAllowPreview.length > 0 ? (
                        delegationAllowPreview.map(item => (
                          <span
                            key={item}
                            className="border-[2px] border-[#c89d49] bg-white px-2 py-0.5 text-[11px] font-bold text-stone-700"
                          >
                            {item}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-stone-500">未设置（不额外限制）</span>
                      )}
                    </div>
                    {permissionSummary.delegationAllow.length > PERMISSION_LIST_PREVIEW_LIMIT ? (
                      <button
                        onClick={() => setExpandDelegationAllow(expanded => !expanded)}
                        className="mt-2 border-[2px] border-[#2d1c0d] bg-[#fff8df] px-2 py-1 text-[10px] font-bold text-stone-900"
                      >
                        {expandDelegationAllow
                          ? '收起'
                          : `展开全部（+${permissionSummary.delegationAllow.length - PERMISSION_LIST_PREVIEW_LIMIT}）`}
                      </button>
                    ) : null}
                  </div>

                  <div className="border-[3px] border-[#c89d49] bg-[#fffdf2] p-3">
                    <div className="text-xs font-black text-stone-900">sessions.visibility</div>
                    <div className="mt-2 text-sm text-stone-700">{describeSessionVisibility(permissionSummary.sessionVisibility)}</div>
                  </div>

                  <div className="border-[3px] border-[#c89d49] bg-[#fffdf2] p-3">
                    <div className="text-xs font-black text-stone-900">subagents.allowAgents</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {subagentAllowPreview.length > 0 ? (
                        subagentAllowPreview.map(item => (
                          <span
                            key={item}
                            className="border-[2px] border-[#c89d49] bg-white px-2 py-0.5 text-[11px] font-bold text-stone-700"
                          >
                            {item}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-stone-500">未设置（不额外限制）</span>
                      )}
                    </div>
                    {permissionSummary.subagentAllow.length > PERMISSION_LIST_PREVIEW_LIMIT ? (
                      <button
                        onClick={() => setExpandSubagentAllow(expanded => !expanded)}
                        className="mt-2 border-[2px] border-[#2d1c0d] bg-[#fff8df] px-2 py-1 text-[10px] font-bold text-stone-900"
                      >
                        {expandSubagentAllow
                          ? '收起'
                          : `展开全部（+${permissionSummary.subagentAllow.length - PERMISSION_LIST_PREVIEW_LIMIT}）`}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b45309]">成员列表</div>
            <h2 className="mt-1 text-2xl font-black text-stone-900">从这里选择协作成员</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              支持搜索。手动选择最多 {maxSelectable} 个 Agent；IM 自动调度拉进来的成员会单独标记。
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center border-[3px] border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3 border-[4px] border-[#2d1c0d] bg-[#fffdf2] px-4 py-3">
          <Search size={18} className="text-stone-500" />
          <input
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="搜索成员名称、职责或技能"
            className="w-full bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
        </div>

        <div className="mt-4 flex items-center justify-between text-xs font-semibold text-stone-600">
          <span>当前手动选择 {selectedCount} / {maxSelectable}</span>
          <span>总成员数 {agents.length}</span>
        </div>

        <div className="mt-4 space-y-3">
          {agents.map(agent => (
            <div key={agent.id} className="border-[4px] border-[#2d1c0d] bg-[#fff1bf] p-4 shadow-[0_6px_0_#2d1c0d]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`flex h-14 w-14 shrink-0 items-center justify-center border-[3px] border-[#2d1c0d] bg-gradient-to-br ${agent.avatarHue} text-2xl`}>
                    {agent.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-black text-stone-900">{agent.name}</div>
                    <div className="text-sm leading-6 text-stone-600">{agent.role}</div>
                    <div className="mt-2 inline-flex border-[3px] border-[#2d1c0d] bg-[#fffdf2] px-2.5 py-1 text-[11px] font-bold text-stone-800">
                      {membershipLabel(agent)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onToggleAgent(agent.id)}
                  disabled={actionDisabled(agent) || pendingAgentIds.includes(agent.id)}
                  className={`shrink-0 border-[3px] px-3 py-2 text-sm font-bold ${
                    actionDisabled(agent) || pendingAgentIds.includes(agent.id)
                      ? 'border-stone-300 bg-stone-200 text-stone-500'
                      : agent.officeMembership === 'unselected'
                        ? 'border-[#2d1c0d] bg-[#2d1c0d] text-[#fff6d8]'
                        : 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900'
                  }`}
                >
                  {pendingAgentIds.includes(agent.id) ? '处理中' : actionLabel(agent)}
                </button>
                <button
                  onClick={() => openAgentPanel(agent.id)}
                  disabled={pendingAgentIds.includes(agent.id)}
                  className={`shrink-0 border-[3px] px-3 py-2 text-sm font-bold ${
                    pendingAgentIds.includes(agent.id)
                      ? 'border-stone-300 bg-stone-200 text-stone-500'
                      : 'border-[#2d1c0d] bg-[#fffdf2] text-stone-900'
                  }`}
                >
                  管理
                </button>
              </div>

              <p className="mt-3 text-sm leading-6 text-stone-600">{agent.description}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {agent.skills.map(skill => (
                  <span key={skill.id} className="border-[2px] border-[#c89d49] bg-[#fffdf2] px-2.5 py-1 text-xs font-medium text-stone-700">
                    {skill.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
