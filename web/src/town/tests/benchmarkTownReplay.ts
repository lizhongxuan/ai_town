import { createInitialTownViewState, townViewReducer } from '../state/townViewState';
import { TownLogEntry } from '../types/town';

type PerfSample = {
  buildReplayStateMs: number;
  sweepFramesMs: number;
};

function getEnvNumber(name: string, fallback: number) {
  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const raw = processLike?.env?.[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getOptionalEnvNumber(name: string) {
  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const raw = processLike?.env?.[name];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function buildLogs(count: number): TownLogEntry[] {
  const baseTime = 1_700_000_000_000;
  return Array.from({ length: count }, (_, index) => ({
    id: `log-${index + 1}`,
    runId: 'run-bench',
    title: `Replay event ${index + 1}`,
    detail: `Replay detail ${index + 1}`,
    timeLabel: '09:00',
    time: baseTime + count - index,
    type: index % 3 === 0 ? 'spawn' : index % 2 === 0 ? 'session' : 'system',
  }));
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function runSample(logs: TownLogEntry[]): PerfSample {
  const buildStartedAt = performance.now();
  let state = townViewReducer(createInitialTownViewState(), {
    type: 'enterReplay',
    runId: 'run-bench',
    logs,
  });
  const buildReplayStateMs = performance.now() - buildStartedAt;

  const sweepStartedAt = performance.now();
  for (let frameIndex = 0; frameIndex < logs.length; frameIndex += 1) {
    state = townViewReducer(state, { type: 'setReplayFrame', frameIndex });
  }
  const sweepFramesMs = performance.now() - sweepStartedAt;

  if (!state.replayMode.active || state.replayMode.logs.length !== logs.length) {
    throw new Error('benchmark produced an invalid replay state');
  }

  return {
    buildReplayStateMs,
    sweepFramesMs,
  };
}

const sampleCount = getEnvNumber('TOWN_REPLAY_BENCH_SAMPLES', 40);
const eventCount = getEnvNumber('TOWN_REPLAY_BENCH_EVENTS', 2000);
const logs = buildLogs(eventCount);
const samples = Array.from({ length: sampleCount }, () => runSample(logs));

const buildTimes = samples.map(sample => sample.buildReplayStateMs);
const sweepTimes = samples.map(sample => sample.sweepFramesMs);

const result = {
  generatedAt: new Date().toISOString(),
  nodeVersion:
    (globalThis as typeof globalThis & { process?: { version?: string } }).process?.version || 'unknown',
  samples: sampleCount,
  events: eventCount,
  buildReplayStateMs: {
    mean: round(mean(buildTimes)),
    p95: round(percentile(buildTimes, 0.95)),
    max: round(Math.max(...buildTimes)),
  },
  sweepFramesMs: {
    mean: round(mean(sweepTimes)),
    p95: round(percentile(sweepTimes, 0.95)),
    max: round(Math.max(...sweepTimes)),
  },
};

const buildP95MaxMs = getOptionalEnvNumber('TOWN_REPLAY_BUILD_P95_MAX_MS');
const sweepP95MaxMs = getOptionalEnvNumber('TOWN_REPLAY_SWEEP_P95_MAX_MS');

if (buildP95MaxMs !== undefined && result.buildReplayStateMs.p95 > buildP95MaxMs) {
  throw new Error(`buildReplayStateMs.p95 exceeded threshold: ${result.buildReplayStateMs.p95}ms > ${buildP95MaxMs}ms`);
}
if (sweepP95MaxMs !== undefined && result.sweepFramesMs.p95 > sweepP95MaxMs) {
  throw new Error(`sweepFramesMs.p95 exceeded threshold: ${result.sweepFramesMs.p95}ms > ${sweepP95MaxMs}ms`);
}

console.log(JSON.stringify(result, null, 2));
