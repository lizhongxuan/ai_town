import { TownLogEntry } from '../types/town';

export type TownSnapshotMode = 'api' | 'fallback';

export interface TownRunFailureHint {
  runId: string;
  summary: string;
}

export interface TownReplayState {
  active: boolean;
  runId: string;
  frameIndex: number;
  logs: TownLogEntry[];
}

export interface TownViewState {
  townDisabled: boolean;
  snapshotMode: TownSnapshotMode;
  syncMessage: string;
  imHint: string;
  runFailureHint: TownRunFailureHint | null;
  replayMode: TownReplayState;
}

export const TOWN_REPLAY_EVENT_LIMIT = 2000;

const EMPTY_REPLAY_STATE: TownReplayState = {
  active: false,
  runId: '',
  frameIndex: 0,
  logs: [],
};

export type TownViewAction =
  | { type: 'snapshotLoaded' }
  | { type: 'snapshotDisabled'; message: string }
  | { type: 'snapshotFailed'; message: string; fallback: boolean }
  | { type: 'setSyncMessage'; message: string }
  | { type: 'clearSyncMessage' }
  | { type: 'showImHint'; message: string }
  | { type: 'clearImHint' }
  | { type: 'setRunFailure'; runId: string; summary: string }
  | { type: 'clearRunFailure' }
  | { type: 'enterReplay'; runId: string; logs: TownLogEntry[] }
  | { type: 'exitReplay' }
  | { type: 'setReplayFrame'; frameIndex: number };

export function createInitialTownViewState(): TownViewState {
  return {
    townDisabled: false,
    snapshotMode: 'api',
    syncMessage: '',
    imHint: '',
    runFailureHint: null,
    replayMode: EMPTY_REPLAY_STATE,
  };
}

export function sortTownReplayLogs(logs: TownLogEntry[]) {
  return [...logs].sort((left, right) => {
    if (left.time !== right.time) return left.time - right.time;
    return left.id.localeCompare(right.id);
  });
}

export function limitTownReplayLogs(logs: TownLogEntry[], max = TOWN_REPLAY_EVENT_LIMIT) {
  if (logs.length <= max) return logs;
  return logs.slice(logs.length - max);
}

export function buildTownReplayState(runId: string, logs: TownLogEntry[]): TownReplayState {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    return EMPTY_REPLAY_STATE;
  }
  const limitedLogs = limitTownReplayLogs(sortTownReplayLogs(logs));
  if (limitedLogs.length === 0) {
    return EMPTY_REPLAY_STATE;
  }
  return {
    active: true,
    runId: normalizedRunId,
    frameIndex: limitedLogs.length - 1,
    logs: limitedLogs,
  };
}

export function isTownRealtimeFrozen(state: Pick<TownViewState, 'townDisabled' | 'replayMode'>) {
  return state.townDisabled || state.replayMode.active;
}

export function townViewReducer(state: TownViewState, action: TownViewAction): TownViewState {
  switch (action.type) {
    case 'snapshotLoaded':
      return {
        ...state,
        townDisabled: false,
        snapshotMode: 'api',
        syncMessage: '',
      };
    case 'snapshotDisabled':
      return {
        ...state,
        townDisabled: true,
        snapshotMode: 'api',
        syncMessage: action.message,
      };
    case 'snapshotFailed':
      return {
        ...state,
        snapshotMode: action.fallback ? 'fallback' : state.snapshotMode,
        syncMessage: action.message,
      };
    case 'setSyncMessage':
      return {
        ...state,
        syncMessage: action.message,
      };
    case 'clearSyncMessage':
      return {
        ...state,
        syncMessage: '',
      };
    case 'showImHint':
      return {
        ...state,
        imHint: action.message,
      };
    case 'clearImHint':
      return {
        ...state,
        imHint: '',
      };
    case 'setRunFailure':
      return {
        ...state,
        runFailureHint: {
          runId: action.runId,
          summary: action.summary,
        },
      };
    case 'clearRunFailure':
      return {
        ...state,
        runFailureHint: null,
      };
    case 'enterReplay': {
      const replayMode = buildTownReplayState(action.runId, action.logs);
      if (!replayMode.active) {
        return state;
      }
      return {
        ...state,
        syncMessage: '',
        replayMode,
      };
    }
    case 'exitReplay':
      return {
        ...state,
        replayMode: EMPTY_REPLAY_STATE,
      };
    case 'setReplayFrame': {
      if (!state.replayMode.active || state.replayMode.logs.length === 0) {
        return state;
      }
      const frameIndex = Math.max(0, Math.min(state.replayMode.logs.length - 1, action.frameIndex));
      if (frameIndex === state.replayMode.frameIndex) {
        return state;
      }
      return {
        ...state,
        replayMode: {
          ...state.replayMode,
          frameIndex,
        },
      };
    }
    default:
      return state;
  }
}
