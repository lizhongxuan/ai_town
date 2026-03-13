import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollText, Sparkles, Users } from 'lucide-react';
import { api } from '../lib/api';
import TownAgentDrawer from '../town/components/TownAgentDrawer';
import TownAgentWorkModal from '../town/components/TownAgentWorkModal';
import TownOfficeMembersModal from '../town/components/TownOfficeMembersModal';
import TownTaskLogModal from '../town/components/TownTaskLogModal';
import { buildTownStateFromMock } from '../town/state/townState';
import { isTownSnapshotPayload, buildTownStateFromSnapshot } from '../town/state/townSnapshot';
import {
  getTownAgentLoadMap,
  getTownLatestEvent,
  getTownLatestRun,
  getTownOfficeAgents,
  getTownOfficeSkillSummary,
  getTownRecentLogs,
  getTownRunningTaskCount,
  getTownSelectedAgents,
  getTownSelectedSkillSummary,
  getTownValidatedInstances,
  getTownVisibleAgents,
} from '../town/state/townSelectors';
import { advanceTownAmbient, setTownScene, toggleTownAgentSelection } from '../town/state/townState';
import {
  createInitialTownViewState,
  isTownRealtimeFrozen,
  townViewReducer,
} from '../town/state/townViewState';
import MainTownScene from '../town/scene/MainTownScene';
import OfficeScene from '../town/scene/OfficeScene';
import { TownLogEntry, TownRun, TownState } from '../town/types/town';

const POSITION_STORAGE_KEY = 'town-position-overrides-v1';

type PositionOverride = {
  sceneId: 'mainTown' | 'office';
  x: number;
  y: number;
};

type WorkerInspectTarget = { kind: 'openclaw' } | { kind: 'agent'; agentId: string };

type WorkModalState = {
  open: boolean;
  title: string;
  subtitle: string;
  runId: string;
  runTitle: string;
  logs: TownLogEntry[];
  loading: boolean;
};

function loadPositionOverrides(): Record<string, PositionOverride> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PositionOverride>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePositionOverrides(value: Record<string, PositionOverride>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore local storage failures. Town keeps running without keyboard-position persistence.
  }
}

function parseErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '请求失败';
}

function summarizeRunTitle(prompt: string) {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (!compact) return '未命名任务';
  return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact;
}

function extractRunId(detail: string) {
  const match = detail.match(/(?:^|\n)runId=([^\n]+)/);
  return match?.[1]?.trim() || '';
}

function filterAgents(state: TownState, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return state.agents;
  return state.agents.filter(agent => {
    const haystack = [agent.id, agent.name, agent.role, agent.description, ...agent.skills.map(skill => skill.name)]
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

function buildAgentMap(state: TownState) {
  return Object.fromEntries(state.agents.map(agent => [agent.id, agent] as const));
}

function createEmptyWorkModalState(): WorkModalState {
  return {
    open: false,
    title: '',
    subtitle: '',
    runId: '',
    runTitle: '',
    logs: [],
    loading: false,
  };
}

function mapRemoteTownLogs(runId: string, items: any[]): TownLogEntry[] {
  return (Array.isArray(items) ? items : []).map((item: any, index: number) => ({
    id: typeof item?.id === 'string' && item.id ? item.id : `run-log-${index + 1}`,
    runId,
    agentId: typeof item?.agentId === 'string' && item.agentId.trim() ? item.agentId.trim() : undefined,
    title: typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : '日志更新',
    detail: typeof item?.detail === 'string' && item.detail.trim() ? item.detail.trim() : '暂无详情',
    timeLabel: typeof item?.timeLabel === 'string' && item.timeLabel.trim() ? item.timeLabel.trim() : '--:--',
    time: Number.isFinite(item?.time) && Number(item.time) > 0 ? Number(item.time) : Date.now() - index * 1000,
    type: item?.type === 'session' || item?.type === 'spawn' || item?.type === 'im' ? item.type : 'system',
  })) as TownLogEntry[];
}

function compareRuns(left: TownRun, right: TownRun) {
  const score = (run: TownRun) => {
    if (run.status === 'running') return 2;
    if (run.status === 'error') return 1;
    return 0;
  };
  const byStatus = score(right) - score(left);
  if (byStatus !== 0) return byStatus;
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
  return right.id.localeCompare(left.id);
}

export default function Town() {
  const navigate = useNavigate();
  const [townState, setTownState] = useState(() => buildTownStateFromMock());
  const [viewState, dispatchView] = useReducer(townViewReducer, undefined, createInitialTownViewState);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [officeMembersModalOpen, setOfficeMembersModalOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [workModalState, setWorkModalState] = useState<WorkModalState>(createEmptyWorkModalState);
  const [searchQuery, setSearchQuery] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runLogs, setRunLogs] = useState<TownLogEntry[]>(() => getTownRecentLogs(buildTownStateFromMock()));
  const [logsLoading, setLogsLoading] = useState(false);
  const [keyboardMoveEnabled, setKeyboardMoveEnabled] = useState(false);
  const [selectedDisplayAgentId, setSelectedDisplayAgentId] = useState('');
  const [positionOverrides, setPositionOverrides] = useState<Record<string, PositionOverride>>(loadPositionOverrides);

  const socketRef = useRef<WebSocket | null>(null);
  const refreshTimerRef = useRef<number | undefined>(undefined);
  const imHintTimerRef = useRef<number | undefined>(undefined);
  const snapshotReadyRef = useRef(false);
  const replayActiveRef = useRef(false);

  const {
    townDisabled,
    snapshotMode,
    syncMessage,
    imHint,
    runFailureHint,
    replayMode,
  } = viewState;
  const realtimeFrozen = isTownRealtimeFrozen(viewState);

  const visibleAgents = useMemo(() => getTownVisibleAgents(townState), [townState]);
  const selectedAgents = useMemo(() => getTownSelectedAgents(townState), [townState]);
  const officeAgents = useMemo(() => getTownOfficeAgents(townState), [townState]);
  const selectedSkillSummary = useMemo(() => getTownSelectedSkillSummary(townState), [townState]);
  const officeSkillSummary = useMemo(() => getTownOfficeSkillSummary(townState), [townState]);
  const latestEvent = useMemo(() => getTownLatestEvent(townState), [townState]);
  const runningTasks = useMemo(() => getTownRunningTaskCount(townState), [townState]);
  const latestRun = useMemo(() => getTownLatestRun(townState), [townState]);
  const validatedInstances = useMemo(() => getTownValidatedInstances(townState), [townState]);
  const agentLoads = useMemo(() => getTownAgentLoadMap(townState), [townState]);
  const defaultModalLogs = useMemo(() => getTownRecentLogs(townState), [townState]);
  const filteredAgents = useMemo(() => filterAgents(townState, searchQuery), [townState, searchQuery]);
  const agentMap = useMemo(() => buildAgentMap(townState), [townState]);
  const runMap = useMemo(() => new Map(townState.runs.map(run => [run.id, run] as const)), [townState.runs]);

  const displayMainTownAgents = useMemo(
    () =>
      visibleAgents.map(agent => {
        const override = positionOverrides[agent.id];
        if (!override || override.sceneId !== 'mainTown') return agent;
        return { ...agent, position: { x: override.x, y: override.y } };
      }),
    [positionOverrides, visibleAgents]
  );

  const displayOfficeAgents = useMemo(
    () =>
      officeAgents.map(agent => {
        if (agent.executionState === 'busy') return agent;
        const override = positionOverrides[agent.id];
        if (override && override.sceneId === 'office') {
          return { ...agent, position: { x: override.x, y: override.y } };
        }
        return { ...agent, position: { ...agent.officePosition } };
      }),
    [officeAgents, positionOverrides]
  );

  const modalLogs = useMemo(
    () => (replayMode.active ? replayMode.logs.slice(0, replayMode.frameIndex + 1) : runLogs),
    [replayMode, runLogs]
  );
  const replayFrameLog = useMemo(
    () => (replayMode.active ? replayMode.logs[replayMode.frameIndex] : undefined),
    [replayMode]
  );

  useEffect(() => {
    replayActiveRef.current = replayMode.active;
  }, [replayMode.active]);

  useEffect(() => {
    if (!selectedDisplayAgentId) return;
    const selectedAgent = townState.agents.find(agent => agent.id === selectedDisplayAgentId);
    if (!selectedAgent) return;
    if (selectedAgent.executionState !== 'busy' && selectedAgent.executionState !== 'error') {
      setKeyboardMoveEnabled(true);
    }
  }, [selectedDisplayAgentId, townState.agents]);

  useEffect(() => {
    if (!keyboardMoveEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (replayActiveRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
          return;
        }
      }

      const key = event.key.toLowerCase();
      let dx = 0;
      let dy = 0;
      if (key === 'arrowup' || key === 'w') dy = -1;
      else if (key === 'arrowdown' || key === 's') dy = 1;
      else if (key === 'arrowleft' || key === 'a') dx = -1;
      else if (key === 'arrowright' || key === 'd') dx = 1;
      else return;

      if (!selectedDisplayAgentId) return;

      const sceneId = townState.activeSceneId;
      const renderPool = sceneId === 'mainTown' ? displayMainTownAgents : displayOfficeAgents;
      const current = renderPool.find(agent => agent.id === selectedDisplayAgentId);
      if (!current || current.executionState === 'busy') return;

      const scene = townState.scenes[sceneId];
      const nextX = Math.max(1, Math.min(scene.width - 2, current.position.x + dx));
      const nextY = Math.max(1, Math.min(scene.height - 2, current.position.y + dy));
      const blocked = renderPool
        .filter(agent => agent.id !== current.id)
        .some(agent => agent.position.x === nextX && agent.position.y === nextY);
      if (blocked) return;

      event.preventDefault();
      setPositionOverrides(prev => {
        const next = {
          ...prev,
          [current.id]: {
            sceneId,
            x: nextX,
            y: nextY,
          },
        };
        savePositionOverrides(next);
        return next;
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    displayMainTownAgents,
    displayOfficeAgents,
    keyboardMoveEnabled,
    selectedDisplayAgentId,
    townState.activeSceneId,
    townState.scenes,
  ]);

  const loadSnapshot = useCallback(async (background = false) => {
    if (replayActiveRef.current) return;
    try {
      const response = await api.getTownSnapshot();
      if (response?.code === 'town.disabled') {
        dispatchView({
          type: 'snapshotDisabled',
          message: response?.error || 'AI 小镇功能未启用',
        });
        snapshotReadyRef.current = true;
        return;
      }
      if (!response?.ok || !isTownSnapshotPayload(response.snapshot)) {
        throw new Error(response?.error || 'snapshot 数据格式不正确');
      }

      setTownState(previous => buildTownStateFromSnapshot(response.snapshot, previous));
      dispatchView({ type: 'snapshotLoaded' });
      snapshotReadyRef.current = true;
    } catch (error) {
      dispatchView({
        type: 'snapshotFailed',
        message: parseErrorMessage(error),
        fallback: !snapshotReadyRef.current,
      });
      if (!background) {
        setTownState(current => current);
      }
    }
  }, []);

  useEffect(() => {
    if (realtimeFrozen) return;
    loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadSnapshot, realtimeFrozen]);

  useEffect(() => {
    if (realtimeFrozen) return;
    const timer = window.setInterval(() => {
      setTownState(current => advanceTownAmbient(current));
    }, 2400);
    return () => window.clearInterval(timer);
  }, [realtimeFrozen]);

  const scheduleRefresh = useCallback(() => {
    if (snapshotMode === 'fallback' || townDisabled || replayActiveRef.current || refreshTimerRef.current !== undefined) {
      return;
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = undefined;
      void loadSnapshot(true);
    }, 900);
  }, [loadSnapshot, snapshotMode, townDisabled]);

  useEffect(() => {
    if (snapshotMode === 'fallback' || townDisabled) return;
    const token = window.localStorage.getItem('admin-token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);
    socketRef.current = socket;

    socket.onmessage = event => {
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload?.type !== 'log-entry' || !payload.data) return;

      const source = String(payload.data.source || '').toLowerCase();
      const eventType = String(payload.data.type || '').toLowerCase();
      const summary = String(payload.data.summary || '').trim();
      const detail = String(payload.data.detail || '').trim();
      const isTownRelevant = source === 'openclaw' || source === 'im' || eventType.startsWith('openclaw.');

      if (source === 'im' || eventType.includes('im.received')) {
        dispatchView({
          type: 'showImHint',
          message: 'OpenClaw 主控正在办公室执行任务',
        });
        if (imHintTimerRef.current !== undefined) {
          window.clearTimeout(imHintTimerRef.current);
        }
        imHintTimerRef.current = window.setTimeout(() => {
          dispatchView({ type: 'clearImHint' });
          imHintTimerRef.current = undefined;
        }, 6000);
      }

      if (eventType.includes('run.failed')) {
        dispatchView({
          type: 'setRunFailure',
          runId: extractRunId(detail),
          summary: summary || '任务执行失败',
        });
      }

      if (isTownRelevant) {
        scheduleRefresh();
      }
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
    };
  }, [scheduleRefresh, snapshotMode, townDisabled]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== undefined) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = undefined;
      }
      if (imHintTimerRef.current !== undefined) {
        window.clearTimeout(imHintTimerRef.current);
        imHintTimerRef.current = undefined;
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    },
    []
  );

  const markAgentPending = (agentId: string, pending: boolean) => {
    setPendingAgentIds(previous => {
      if (pending) {
        if (previous.includes(agentId)) return previous;
        return [...previous, agentId];
      }
      return previous.filter(id => id !== agentId);
    });
  };

  const handleToggleAgent = async (agentId: string) => {
    if (townDisabled) {
      dispatchView({
        type: 'setSyncMessage',
        message: 'AI 小镇功能未启用，当前不能修改办公室成员。',
      });
      return;
    }
    if (replayMode.active) {
      dispatchView({
        type: 'setSyncMessage',
        message: '当前处于回放模式，暂不支持修改办公室成员。请先退出回放。',
      });
      return;
    }

    const target = townState.agents.find(agent => agent.id === agentId);
    if (!target || pendingAgentIds.includes(agentId)) return;
    if (agentId === townState.boss.id) {
      dispatchView({
        type: 'setSyncMessage',
        message: 'OpenClaw(main) 是固定主控角色，不需要加入办公室成员池。',
      });
      return;
    }

    if (snapshotMode === 'fallback') {
      setTownState(current => toggleTownAgentSelection(current, agentId));
      return;
    }
    if (target.executionState === 'busy') return;

    const membership = target.officeMembership === 'unselected' ? 'selected' : 'unselected';
    markAgentPending(agentId, true);
    try {
      const response = await api.updateTownOfficeMembers({ agentId, membership });
      if (!response?.ok) {
        throw new Error(response?.error || '更新办公室成员失败');
      }
      await loadSnapshot(true);
      dispatchView({ type: 'clearSyncMessage' });
    } catch (error) {
      dispatchView({
        type: 'setSyncMessage',
        message: parseErrorMessage(error),
      });
    } finally {
      markAgentPending(agentId, false);
    }
  };

  const handleOpenOffice = () => {
    setOfficeMembersModalOpen(false);
    setTownState(current => setTownScene(current, 'office'));
  };

  useEffect(() => {
    if (townState.activeSceneId !== 'office') {
      setOfficeMembersModalOpen(false);
    }
  }, [townState.activeSceneId]);

  const handleSelectDisplayAgent = (agentId: string) => {
    setSelectedDisplayAgentId(agentId);
    const agent = townState.agents.find(item => item.id === agentId);
    if (agent && agent.executionState !== 'busy' && agent.executionState !== 'error') {
      setKeyboardMoveEnabled(true);
    }
  };

  const handleStartRun = async () => {
    if (townDisabled) {
      dispatchView({
        type: 'setSyncMessage',
        message: 'AI 小镇功能未启用，当前不能发起任务。',
      });
      return;
    }
    if (replayMode.active) {
      dispatchView({
        type: 'setSyncMessage',
        message: '当前处于回放模式，暂不支持发起新任务。请先退出回放。',
      });
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    if (snapshotMode === 'fallback') {
      dispatchView({
        type: 'setSyncMessage',
        message: '当前为降级模式，无法发起真实协作任务。请恢复小镇快照接口后重试。',
      });
      return;
    }

    try {
      const response = await api.createTownRun({
        title: summarizeRunTitle(trimmedPrompt),
        prompt: trimmedPrompt,
        source: 'manual',
        selectedAgents: officeAgents.map(agent => agent.id),
      });
      if (!response?.ok) {
        throw new Error(response?.error || '任务创建失败');
      }
      setPrompt('');
      dispatchView({ type: 'clearRunFailure' });
      await loadSnapshot(true);
      dispatchView({ type: 'clearSyncMessage' });
    } catch (error) {
      dispatchView({
        type: 'setSyncMessage',
        message: parseErrorMessage(error),
      });
      dispatchView({
        type: 'setRunFailure',
        runId: '',
        summary: '任务创建失败，可重试或查看日志。',
      });
    }
  };

  const loadRunLogs = useCallback(
    async (runId: string) => {
      const normalizedRunId = runId.trim();
      if (replayActiveRef.current) {
        dispatchView({ type: 'exitReplay' });
      }

      if (!normalizedRunId) {
        setSelectedRunId('');
        setRunLogs(getTownRecentLogs(townState));
        return;
      }

      if (snapshotMode === 'fallback') {
        setSelectedRunId(normalizedRunId);
        setRunLogs(getTownRecentLogs(townState, normalizedRunId));
        return;
      }

      setLogsLoading(true);
      try {
        const response = await api.getTownRunLogs(normalizedRunId);
        if (!response?.ok) {
          throw new Error(response?.error || '任务日志加载失败');
        }
        const mappedLogs = mapRemoteTownLogs(normalizedRunId, response.logs);

        setSelectedRunId(normalizedRunId);
        setRunLogs(mappedLogs);
        dispatchView({ type: 'clearSyncMessage' });
      } catch (error) {
        dispatchView({
          type: 'setSyncMessage',
          message: parseErrorMessage(error),
        });
      } finally {
        setLogsLoading(false);
      }
    },
    [snapshotMode, townState]
  );

  const pickWorkerLogs = useCallback(
    (logs: TownLogEntry[], target: WorkerInspectTarget) => {
      if (target.kind === 'openclaw') {
        const managerLogs = logs.filter(log => !log.agentId || log.agentId === townState.boss.id);
        return managerLogs.length > 0 ? managerLogs : logs;
      }

      const directLogs = logs.filter(log => !log.agentId || log.agentId === target.agentId);
      return directLogs.some(log => log.agentId === target.agentId) ? directLogs : logs;
    },
    [townState.boss.id]
  );

  const findWorkerRun = useCallback(
    (target: WorkerInspectTarget) => {
      const candidates = new Map<string, TownRun>();
      const pushCandidate = (run?: TownRun) => {
        if (run) {
          candidates.set(run.id, run);
        }
      };

      if (target.kind === 'openclaw') {
        pushCandidate(townState.runs.find(run => run.status === 'running'));
        pushCandidate(latestRun);
      } else {
        const agent = agentMap[target.agentId];
        if (agent?.currentRunId) {
          pushCandidate(runMap.get(agent.currentRunId));
        }
        validatedInstances
          .filter(instance => instance.agentId === target.agentId)
          .forEach(instance => pushCandidate(runMap.get(instance.runId)));
        townState.runs
          .filter(run => run.participantAgentIds.includes(target.agentId))
          .forEach(run => pushCandidate(run));
      }

      return Array.from(candidates.values()).sort(compareRuns)[0];
    },
    [agentMap, latestRun, runMap, townState.runs, validatedInstances]
  );

  const handleInspectWorker = useCallback(
    async (target: WorkerInspectTarget) => {
      const run = findWorkerRun(target);
      const workerName = target.kind === 'openclaw' ? 'OpenClaw(main)' : agentMap[target.agentId]?.name || target.agentId;
      const subtitle =
        target.kind === 'openclaw'
          ? '主控当前正在办公室工位处理任务。这里展示本次运行里的对话和工作日志。'
          : `${workerName} 当前正在工位前处理任务。这里展示它与 AI 的交互记录和自身日志。`;
      const localLogs = pickWorkerLogs(run?.id ? getTownRecentLogs(townState, run.id) : defaultModalLogs, target);

      setWorkModalState({
        open: true,
        title: workerName,
        subtitle,
        runId: run?.id || '',
        runTitle: run?.title || '',
        logs: localLogs,
        loading: snapshotMode !== 'fallback' && Boolean(run?.id),
      });

      if (snapshotMode === 'fallback' || !run?.id) {
        return;
      }

      try {
        const response = await api.getTownRunLogs(run.id);
        if (!response?.ok) {
          throw new Error(response?.error || '工作日志加载失败');
        }
        const mappedLogs = mapRemoteTownLogs(run.id, response.logs);
        const filteredLogs = pickWorkerLogs(mappedLogs, target);
        setWorkModalState(current => ({
          ...current,
          logs: filteredLogs.length > 0 ? filteredLogs : localLogs,
          loading: false,
        }));
        dispatchView({ type: 'clearSyncMessage' });
      } catch (error) {
        dispatchView({
          type: 'setSyncMessage',
          message: parseErrorMessage(error),
        });
        setWorkModalState(current => ({
          ...current,
          loading: false,
        }));
      }
    },
    [agentMap, defaultModalLogs, findWorkerRun, pickWorkerLogs, snapshotMode, townState]
  );

  const openLatestRunLogs = async () => {
    setLogModalOpen(true);
    const runId = latestRun?.id || '';
    if (!runId) {
      setSelectedRunId('');
      setRunLogs(defaultModalLogs);
      return;
    }
    await loadRunLogs(runId);
  };

  const openNamedRunLogs = async (runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      await openLatestRunLogs();
      return;
    }
    setLogModalOpen(true);
    await loadRunLogs(normalizedRunId);
  };

  const handleEnterReplay = () => {
    if (!selectedRunId) return;
    dispatchView({
      type: 'enterReplay',
      runId: selectedRunId,
      logs: runLogs,
    });
  };

  const handleExitReplay = () => {
    dispatchView({ type: 'exitReplay' });
    void loadSnapshot(true);
  };

  const handleReplayFrameChange = (frameIndex: number) => {
    dispatchView({
      type: 'setReplayFrame',
      frameIndex,
    });
  };

  if (townDisabled) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden font-mono">
        <div className="border-[4px] border-[#2d1c0d] bg-[linear-gradient(180deg,#4b3319,#302110)] px-4 py-3 text-[#fff6d8] shadow-[0_8px_0_#2d1c0d]">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2d58b]">AI 小镇</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-white">功能未启用</h2>
          <div className="mt-1 text-[12px] leading-5 text-[#f4e7c0]">
            当前环境没有打开 `townV3Enabled`，所以不会加载小镇观测页、办公室成员池和任务桥接。
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="w-full max-w-3xl border-[4px] border-[#2d1c0d] bg-[#fff1bf] p-6 text-stone-900 shadow-[0_8px_0_#2d1c0d]">
            <div className="text-lg font-black">启用方式</div>
            <div className="mt-3 text-sm leading-7 text-stone-700">
              在 ClawPanel 配置里将 `townV3Enabled` 设为 `true`，或设置环境变量 `TOWN_V3_ENABLED=true` 后重启服务。
            </div>
            {syncMessage ? (
              <div className="mt-4 border-[3px] border-[#c89d49] bg-[#fffdf2] px-4 py-3 text-sm font-bold text-stone-700">
                当前状态：{syncMessage}
              </div>
            ) : null}
            <button
              onClick={() => void loadSnapshot()}
              className="mt-5 border-[4px] border-[#2d1c0d] bg-[#2d1c0d] px-4 py-3 text-sm font-black text-[#fff1bf] shadow-[0_6px_0_#2d1c0d]"
            >
              重新检测
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden font-mono">
      {imHint ? (
        <div className="shrink-0 border-[3px] border-[#1d4ed8] bg-[#dbeafe] px-4 py-3 text-sm font-bold text-blue-800">
          {imHint}
        </div>
      ) : null}

      {runFailureHint ? (
        <div className="shrink-0 border-[3px] border-[#ef4444] bg-[#fef2f2] px-4 py-3 text-sm font-bold text-red-700">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <span>
              {runFailureHint.summary}
              {runFailureHint.runId ? `（${runFailureHint.runId}）` : ''}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const failedRun = runFailureHint.runId ? townState.runs.find(run => run.id === runFailureHint.runId) : undefined;
                  if (failedRun?.prompt) {
                    setPrompt(failedRun.prompt);
                    setTownState(current => setTownScene(current, 'office'));
                  }
                }}
                disabled={!runFailureHint.runId || !townState.runs.some(run => run.id === runFailureHint.runId && run.prompt)}
                className={`border-[3px] px-3 py-1 text-xs font-black ${
                  runFailureHint.runId && townState.runs.some(run => run.id === runFailureHint.runId && run.prompt)
                    ? 'border-red-700 bg-white text-red-700'
                    : 'border-stone-300 bg-stone-200 text-stone-500'
                }`}
              >
                填充重试输入
              </button>
              <button
                onClick={() => void openNamedRunLogs(runFailureHint.runId)}
                className="border-[3px] border-red-700 bg-white px-3 py-1 text-xs font-black text-red-700"
              >
                查看日志
              </button>
              <button
                onClick={() => dispatchView({ type: 'clearRunFailure' })}
                className="border-[3px] border-red-700 bg-[#fee2e2] px-3 py-1 text-xs font-black text-red-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {replayMode.active ? (
        <div className="shrink-0 border-[3px] border-[#1d4ed8] bg-[#dbeafe] px-4 py-3 text-sm font-bold text-blue-900">
          <div className="flex items-center justify-between gap-3">
            <span>
              回放模式（{replayMode.runId}）已开启，实时视图已冻结。当前帧：
              {replayMode.frameIndex + 1}/{replayMode.logs.length}
              {replayFrameLog ? ` · ${replayFrameLog.timeLabel} ${replayFrameLog.title}` : ''}
            </span>
            <button
              onClick={handleExitReplay}
              className="border-[3px] border-[#1d4ed8] bg-white px-3 py-1 text-xs font-black text-[#1d4ed8]"
            >
              退出回放
            </button>
          </div>
        </div>
      ) : null}

      {snapshotMode === 'fallback' ? (
        <div className="shrink-0 border-[3px] border-[#c89d49] bg-[#fff1bf] px-4 py-3 text-sm font-bold text-stone-800">
          小镇快照接口不可用，已降级为本地演示模式。{syncMessage ? `原因：${syncMessage}` : ''}
        </div>
      ) : syncMessage ? (
        <div className="shrink-0 border-[3px] border-[#ef4444] bg-[#fef2f2] px-4 py-3 text-sm font-bold text-red-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>同步异常：{syncMessage}</span>
            <button
              onClick={() => void loadSnapshot()}
              className="border-[3px] border-red-700 bg-white px-3 py-1 text-xs font-black text-red-700"
            >
              立即重试
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative shrink-0 border-[4px] border-[#2d1c0d] bg-[linear-gradient(180deg,#4b3319,#302110)] px-4 py-3 text-[#fff6d8] shadow-[0_8px_0_#2d1c0d]">
        <div className="pointer-events-none absolute inset-[8px] border-[2px] border-[#8f6c32]" />
        <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2d58b]">
              AI / 小镇 / 协作观测台
            </div>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-white">AI 小镇</h2>
            <div className="mt-1 text-[12px] leading-5 text-[#f4e7c0]">
              主镇负责选人，办公室负责发起主任务并观察执行。这里不是智能体配置台，而是 OpenClaw 主控的协作观测页面。
            </div>
            <div className="mt-1 text-[11px] leading-5 text-[#f2d58b]">
              状态同步：近似模式（事件 + 最近会话更新时间，含短时去抖）。
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 xl:items-end">
            {latestEvent ? (
              <div className="max-w-xl border-[3px] border-[#f2d58b] bg-[#fff1bf] px-3 py-1.5 text-[11px] font-bold text-stone-900 shadow-[0_4px_0_#2d1c0d]">
                {latestEvent.timeLabel} · {latestEvent.title}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setKeyboardMoveEnabled(value => !value)}
                className={`border-[3px] px-4 py-2 text-xs font-bold ${
                  keyboardMoveEnabled
                    ? 'border-[#1d4ed8] bg-[#dbeafe] text-[#1d4ed8]'
                    : 'border-[#2d1c0d] bg-[#fff4cc] text-stone-900'
                }`}
              >
                {keyboardMoveEnabled ? '键控已开' : '键控已关'}
              </button>
              <button
                onClick={() => setTownState(current => setTownScene(current, 'mainTown'))}
                className={`border-[3px] px-4 py-2 text-sm font-bold ${
                  townState.activeSceneId === 'mainTown'
                    ? 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900'
                    : 'border-[#2d1c0d] bg-[#fff4cc] text-stone-900'
                }`}
              >
                主镇
              </button>
              <button
                onClick={() => setTownState(current => setTownScene(current, 'office'))}
                className={`border-[3px] px-4 py-2 text-sm font-bold ${
                  townState.activeSceneId === 'office'
                    ? 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900'
                    : 'border-[#2d1c0d] bg-[#fff4cc] text-stone-900'
                }`}
              >
                办公室
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-[440px] flex-1 sm:min-h-[520px] lg:min-h-0">
              {townState.activeSceneId === 'mainTown' ? (
                <MainTownScene
                  scene={townState.scenes.mainTown}
                  buildings={townState.buildings.filter(building => building.sceneId === 'mainTown')}
                  boss={townState.boss}
                  agents={displayMainTownAgents}
                  ambientResidents={townState.ambientResidents}
                  selectedDisplayAgentId={selectedDisplayAgentId}
                  runningTasks={runningTasks}
                  onOpenAgentDrawer={() => setDrawerOpen(true)}
                  onOpenOffice={handleOpenOffice}
                  onToggleAgent={handleToggleAgent}
                  onSelectDisplayAgent={handleSelectDisplayAgent}
                />
              ) : (
                <OfficeScene
                  scene={townState.scenes.office}
                  boss={townState.boss}
                  agents={displayOfficeAgents}
                  runs={townState.runs}
                  selectedDisplayAgentId={selectedDisplayAgentId}
                  runningTasks={runningTasks}
                  onSelectDisplayAgent={handleSelectDisplayAgent}
                  onInspectWorker={target => void handleInspectWorker(target)}
                />
              )}
            </div>
          </div>

          <div className="flex h-[360px] min-h-0 flex-col gap-3 overflow-y-auto pr-1 lg:h-full lg:w-[360px] lg:pr-0">
            {townState.activeSceneId === 'mainTown' ? (
              <>
                <div className="relative border-[4px] border-[#2d1c0d] bg-[#f7efc7] p-5 shadow-[0_8px_0_#2d1c0d]">
                  <div className="pointer-events-none absolute inset-[8px] border-[2px] border-[#c89d49] opacity-60" />
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b45309]">已选协作成员</div>
                      <h3 className="mt-1 text-xl font-black text-stone-900">当前协作组</h3>
                    </div>
                    <button
                      onClick={() => setDrawerOpen(true)}
                      className="flex items-center gap-2 border-[3px] border-[#2d1c0d] bg-[#fffaf0] px-3 py-2 text-xs font-bold text-stone-900"
                    >
                      <Users size={14} />
                      成员列表
                    </button>
                  </div>
                  <div className="relative mt-4 max-h-64 space-y-3 overflow-y-auto pr-1 sm:max-h-72 xl:max-h-[min(44vh,420px)]">
                    {selectedAgents.length > 0 ? (
                      selectedAgents.map(agent => (
                        <div
                          key={agent.id}
                          className="flex items-center justify-between gap-3 border-[3px] border-[#c89d49] bg-[#fffaf0] px-3 py-3 shadow-[0_3px_0_#d0af68]"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`flex h-11 w-11 items-center justify-center border-[3px] border-[#2d1c0d] bg-gradient-to-br ${agent.avatarHue} text-xl`}
                            >
                              {agent.emoji}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-black text-stone-900">{agent.name}</div>
                              <div className="text-xs leading-5 text-stone-600">{agent.role}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => void handleToggleAgent(agent.id)}
                            disabled={pendingAgentIds.includes(agent.id) || replayMode.active}
                            className={`border-[3px] px-3 py-2 text-xs font-bold ${
                              pendingAgentIds.includes(agent.id) || replayMode.active
                                ? 'border-stone-300 bg-stone-200 text-stone-500'
                                : 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900'
                            }`}
                          >
                            {pendingAgentIds.includes(agent.id) ? '处理中' : replayMode.active ? '回放锁定' : '移出'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="border-[3px] border-dashed border-[#c89d49] bg-[#fffaf0] px-4 py-4 text-sm leading-6 text-stone-600">
                        目前还没选协作成员。你也可以不选任何成员，直接让 OpenClaw 主控独自去办公室执行。
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative border-[4px] border-[#2d1c0d] bg-[#f7efc7] p-5 shadow-[0_8px_0_#2d1c0d]">
                  <div className="pointer-events-none absolute inset-[8px] border-[2px] border-[#c89d49] opacity-60" />
                  <div className="flex items-center gap-2 text-sm font-black text-stone-900">
                    <Sparkles size={16} className="text-amber-700" />
                    技能汇总
                  </div>
                  <div className="relative mt-4 flex flex-wrap gap-2">
                    {selectedSkillSummary.length > 0 ? (
                      selectedSkillSummary.map(skill => (
                        <span key={skill.id} className="border-[2px] border-[#c89d49] bg-[#fffaf0] px-2.5 py-1 text-xs font-medium text-stone-700">
                          {skill.name}
                        </span>
                      ))
                    ) : (
                      <div className="text-sm leading-6 text-stone-600">当前协作组为空，技能汇总会在选人后出现。</div>
                    )}
                  </div>
                </div>

              </>
            ) : (
              <>
                <div className="relative border-[4px] border-[#2d1c0d] bg-[#f7efc7] p-5 shadow-[0_8px_0_#2d1c0d]">
                  <div className="pointer-events-none absolute inset-[8px] border-[2px] border-[#c89d49] opacity-60" />
                  <div className="flex items-center gap-2 text-sm font-black text-stone-900">
                    <Sparkles size={16} className="text-amber-700" />
                    发起任务
                  </div>
                  <textarea
                    value={prompt}
                    onChange={event => setPrompt(event.target.value)}
                    disabled={replayMode.active}
                    placeholder="例如：分析 AI 小镇页面，并整理一版可执行的优化方案"
                    className="relative mt-4 h-28 w-full resize-none border-[4px] border-[#2d1c0d] bg-[#fffaf0] px-4 py-3 text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400"
                  />
                  <div className="relative mt-4 grid grid-cols-2 gap-3">
                    <button
                      onClick={handleStartRun}
                      disabled={!prompt.trim() || replayMode.active}
                      className={`flex items-center justify-center gap-2 border-[4px] px-4 py-3 text-sm font-black ${
                        prompt.trim() && !replayMode.active
                          ? 'border-[#2d1c0d] bg-[#ffe39a] text-stone-900 shadow-[0_6px_0_#2d1c0d]'
                          : 'border-stone-300 bg-stone-300 text-stone-600'
                      }`}
                    >
                      <Sparkles size={16} />
                      开始协作
                    </button>
                    <button
                      onClick={() => void openLatestRunLogs()}
                      className="flex items-center justify-center gap-2 border-[4px] border-[#2d1c0d] bg-[#fffaf0] px-4 py-3 text-sm font-black text-stone-900 shadow-[0_6px_0_#2d1c0d]"
                    >
                      <ScrollText size={16} />
                      任务日志
                    </button>
                  </div>
                  <div className="relative mt-3 text-xs leading-5 text-stone-600">
                    {snapshotMode === 'fallback'
                      ? `当前为演示模式。运行中任务：${runningTasks}。`
                      : `当前有 ${runningTasks} 个运行中任务；没有选中协作成员也可以单独执行。`}
                  </div>
                </div>

                <div className="relative border-[4px] border-[#2d1c0d] bg-[#f7efc7] p-5 shadow-[0_8px_0_#2d1c0d]">
                  <div className="pointer-events-none absolute inset-[8px] border-[2px] border-[#c89d49] opacity-60" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-black text-stone-900">
                      <Users size={16} className="text-amber-700" />
                      办公室成员
                    </div>
                    <div className="border-[3px] border-[#2d1c0d] bg-[#fff4cc] px-2 py-1 text-[11px] font-bold text-stone-900">
                      {officeAgents.length}
                    </div>
                  </div>
                  <div className="relative mt-4 text-sm leading-6 text-stone-600">
                    成员列表改为弹框查看。你可以在弹框里查看成员状态、当前负载，并移出非忙碌成员。
                  </div>
                  <button
                    onClick={() => setOfficeMembersModalOpen(true)}
                    className="relative mt-4 flex w-full items-center justify-center gap-2 border-[4px] border-[#2d1c0d] bg-[#fffaf0] px-4 py-3 text-sm font-black text-stone-900 shadow-[0_6px_0_#2d1c0d]"
                  >
                    <Users size={16} />
                    查看办公室成员列表
                  </button>
                </div>

                <div className="relative border-[4px] border-[#2d1c0d] bg-[#f7efc7] p-5 shadow-[0_8px_0_#2d1c0d]">
                  <div className="pointer-events-none absolute inset-[8px] border-[2px] border-[#c89d49] opacity-60" />
                  <div className="flex items-center gap-2 text-sm font-black text-stone-900">
                    <Sparkles size={16} className="text-amber-700" />
                    办公室技能汇总
                  </div>
                  <div className="relative mt-4 flex flex-wrap gap-2">
                    {officeSkillSummary.length > 0 ? (
                      officeSkillSummary.map(skill => (
                        <span key={skill.id} className="border-[2px] border-[#c89d49] bg-[#fffaf0] px-2.5 py-1 text-xs font-medium text-stone-700">
                          {skill.name}
                        </span>
                      ))
                    ) : (
                      <div className="text-sm leading-6 text-stone-600">当前没有办公室成员的技能汇总，OpenClaw 主控会按需单独执行。</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <TownAgentDrawer
        open={drawerOpen}
        agents={filteredAgents}
        allAgents={townState.agents}
        query={searchQuery}
        selectedCount={selectedAgents.length}
        maxSelectable={townState.maxSelectableAgents}
        pendingAgentIds={pendingAgentIds}
        interactionLocked={replayMode.active}
        onQueryChange={setSearchQuery}
        onToggleAgent={agentId => void handleToggleAgent(agentId)}
        onOpenAgentConfig={() => navigate('/agents')}
        onRefreshTown={() => loadSnapshot(true)}
        onClose={() => setDrawerOpen(false)}
      />

      <TownTaskLogModal
        open={logModalOpen}
        runs={townState.runs}
        logs={modalLogs}
        agents={Object.values(agentMap)}
        selectedRunId={selectedRunId}
        loading={logsLoading}
        replayActive={replayMode.active}
        replayRunId={replayMode.runId}
        replayFrameIndex={replayMode.frameIndex}
        replayTotalFrames={replayMode.logs.length}
        onSelectRun={runId => void loadRunLogs(runId)}
        onEnterReplay={handleEnterReplay}
        onExitReplay={handleExitReplay}
        onReplayFrameChange={handleReplayFrameChange}
        onClose={() => {
          if (replayMode.active) {
            handleExitReplay();
          }
          setLogModalOpen(false);
        }}
      />

      <TownOfficeMembersModal
        open={officeMembersModalOpen}
        agents={officeAgents}
        agentLoads={agentLoads}
        pendingAgentIds={pendingAgentIds}
        interactionLocked={replayMode.active}
        onToggleAgent={agentId => void handleToggleAgent(agentId)}
        onClose={() => setOfficeMembersModalOpen(false)}
      />

      <TownAgentWorkModal
        open={workModalState.open}
        title={workModalState.title}
        subtitle={workModalState.subtitle}
        runId={workModalState.runId}
        runTitle={workModalState.runTitle}
        logs={workModalState.logs}
        loading={workModalState.loading}
        onClose={() => setWorkModalState(createEmptyWorkModalState())}
      />
    </div>
  );
}
