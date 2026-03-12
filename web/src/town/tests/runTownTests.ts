import {
  createInitialTownViewState,
  isTownRealtimeFrozen,
  TOWN_REPLAY_EVENT_LIMIT,
  townViewReducer,
} from '../state/townViewState';
import { buildTownStateFromMock } from '../state/townState';
import { buildTownStateFromSnapshot } from '../state/townSnapshot';
import {
  getTownOfficeZones,
  getTownOverflowRuns,
  getTownValidatedInstances,
} from '../state/townSelectors';
import { TownLogEntry, TownRun } from '../types/town';
import { buildOfficeRenderedInstances, getTownLoadVisual } from '../scene/officeSceneModel';

const TEST_ZONE_SLOTS = [
  { x: 20, y: 38 },
  { x: 50, y: 38 },
  { x: 80, y: 38 },
  { x: 20, y: 71 },
  { x: 50, y: 71 },
  { x: 80, y: 71 },
];

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function equal<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    fail(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    fail(`${message}: expected ${expectedText}, got ${actualText}`);
  }
}

function makeLog(index: number, time: number): TownLogEntry {
  return {
    id: `log-${index}`,
    runId: 'run-1',
    title: `log ${index}`,
    detail: `detail ${index}`,
    timeLabel: '09:00',
    time,
    type: 'system',
  };
}

function makeRun(runId: string, agentId: string, updatedAt: number): TownRun {
  return {
    id: runId,
    title: `Task ${runId}`,
    prompt: `Prompt ${runId}`,
    source: 'manual',
    status: 'running',
    primarySessionId: `session-${runId}`,
    createdAt: updatedAt - 5_000,
    updatedAt,
    createdAtLabel: '09:00',
    updatedAtLabel: '09:01',
    participantAgentIds: [agentId],
    spawnedSessions: [
      {
        id: `spawn-${runId}-${agentId}`,
        agentId,
        status: 'running',
      },
    ],
  };
}

function makeEvent(index: number, runId: string, time: number) {
  return {
    id: `event-${index}`,
    type: index % 4 === 0 ? 'warning' : index % 3 === 0 ? 'success' : 'info',
    title: `event ${index}`,
    detail: `detail ${index}`,
    timeLabel: '09:00',
    time,
    runId,
  } as const;
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'town view switches to fallback mode on initial snapshot failure',
    run: () => {
      const next = townViewReducer(createInitialTownViewState(), {
        type: 'snapshotFailed',
        message: 'network down',
        fallback: true,
      });
      equal(next.snapshotMode, 'fallback', 'snapshot mode should switch to fallback');
      equal(next.syncMessage, 'network down', 'sync message should keep failure reason');
      equal(next.townDisabled, false, 'failure should not mark town disabled');
    },
  },
  {
    name: 'replay enter sorts, caps, freezes and exits cleanly',
    run: () => {
      const logs = Array.from({ length: TOWN_REPLAY_EVENT_LIMIT + 5 }, (_, index) =>
        makeLog(index, 1_700_000_000_000 + (TOWN_REPLAY_EVENT_LIMIT + 5 - index))
      );
      const withReplay = townViewReducer(createInitialTownViewState(), {
        type: 'enterReplay',
        runId: 'run-1',
        logs,
      });

      equal(withReplay.replayMode.active, true, 'replay should become active');
      equal(withReplay.replayMode.runId, 'run-1', 'replay should keep selected run');
      equal(withReplay.replayMode.logs.length, TOWN_REPLAY_EVENT_LIMIT, 'replay logs should be capped');
      assert(
        withReplay.replayMode.logs[0].time < withReplay.replayMode.logs[withReplay.replayMode.logs.length - 1].time,
        'replay logs should be sorted ascending by time'
      );
      equal(withReplay.replayMode.frameIndex, TOWN_REPLAY_EVENT_LIMIT - 1, 'replay should start at latest frame');
      equal(isTownRealtimeFrozen(withReplay), true, 'realtime should freeze in replay mode');

      const clamped = townViewReducer(withReplay, { type: 'setReplayFrame', frameIndex: 99_999 });
      equal(clamped.replayMode.frameIndex, TOWN_REPLAY_EVENT_LIMIT - 1, 'frame index should clamp to max');

      const exited = townViewReducer(clamped, { type: 'exitReplay' });
      equal(exited.replayMode.active, false, 'replay should exit');
      equal(exited.replayMode.logs.length, 0, 'replay logs should clear after exit');
      equal(isTownRealtimeFrozen(exited), false, 'realtime should resume after exit');
    },
  },
  {
    name: 'snapshot loaded clears disabled banner after recovery',
    run: () => {
      const disabled = townViewReducer(createInitialTownViewState(), {
        type: 'snapshotDisabled',
        message: 'town disabled',
      });
      equal(disabled.townDisabled, true, 'disabled snapshot should mark town disabled');
      equal(isTownRealtimeFrozen(disabled), true, 'disabled state should freeze realtime');

      const recovered = townViewReducer(disabled, { type: 'snapshotLoaded' });
      equal(recovered.townDisabled, false, 'snapshot recovery should clear disabled state');
      equal(recovered.snapshotMode, 'api', 'snapshot recovery should return to api mode');
      equal(recovered.syncMessage, '', 'snapshot recovery should clear sync banner');
    },
  },
  {
    name: 'snapshot excludes default manager from selectable agents when manager is a real agent id',
    run: () => {
      const state = buildTownStateFromSnapshot({
        openclaw: {
          agentId: 'coder',
          name: 'OpenClaw(main)',
        },
        agents: [
          {
            id: 'coder',
            name: '编程高手',
            role: '默认主控',
            description: '默认主控 Agent',
            officeMembership: 'unselected',
            executionState: 'idle',
            sessionRole: 'none',
            location: 'mainTown',
          },
          {
            id: 'reviewer',
            name: '审查员',
            role: '代码审查',
            description: '负责审查',
            officeMembership: 'unselected',
            executionState: 'idle',
            sessionRole: 'none',
            location: 'mainTown',
          },
        ],
        visibleTownAgentIds: ['coder', 'reviewer'],
      });

      equal(state.boss.id, 'coder', 'boss should use snapshot manager agent id');
      equal(state.agents.length, 1, 'manager should not remain in selectable agent list');
      equal(state.agents[0].id, 'reviewer', 'non-manager agent should remain selectable');
      deepEqual(state.visibleTownAgentIds, ['reviewer'], 'main town should not render manager as a selectable resident');
    },
  },
  {
    name: 'office scene keeps six visible zones and skips overflow clones',
    run: () => {
      const state = buildTownStateFromMock();
      const now = 1_700_000_000_000;
      const agentIds = state.agents.map(agent => agent.id);

      state.agents.forEach(agent => {
        agent.officeMembership = 'selected';
        agent.location = 'office';
        agent.executionState = 'standby';
      });

      state.runs = Array.from({ length: 7 }, (_, index) =>
        makeRun(`run-${index + 1}`, agentIds[index % agentIds.length], now - index * 1_000)
      );
      state.instances = state.runs.map(run => ({
        id: `instance-${run.id}`,
        agentId: run.participantAgentIds[0],
        runId: run.id,
        sessionId: run.spawnedSessions[0].id,
        zoneId: `zone-${run.id}`,
        status: 'executing',
      }));

      const zones = getTownOfficeZones(state, now);
      const overflowRuns = getTownOverflowRuns(state, now);
      const rendered = buildOfficeRenderedInstances(
        state.agents,
        state.runs,
        zones,
        getTownValidatedInstances(state),
        TEST_ZONE_SLOTS
      );

      equal(zones.length, 6, 'office should show at most six zones');
      equal(overflowRuns.length, 1, 'extra runs should move to overflow');
      equal(overflowRuns[0].id, 'run-7', 'oldest run should overflow first');
      equal(rendered.length, 6, 'only visible zone clones should render');
      deepEqual(
        rendered.map(item => item.runId).sort(),
        ['run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6'],
        'rendered clones should only belong to visible runs'
      );
    },
  },
  {
    name: 'office scene keeps visible zones and clone bindings stable during burst traffic',
    run: () => {
      const state = buildTownStateFromMock();
      const now = 1_700_000_000_000;
      const participantIds = state.agents.slice(0, 3).map(agent => agent.id);

      state.agents.forEach(agent => {
        agent.officeMembership = 'selected';
        agent.location = 'office';
        agent.executionState = 'standby';
      });

      state.runs = Array.from({ length: 8 }, (_, index) => {
        const runId = `burst-run-${index + 1}`;
        const run = makeRun(runId, participantIds[index % participantIds.length], now - index * 1_000);
        run.participantAgentIds = participantIds;
        run.spawnedSessions = participantIds.map(agentId => ({
          id: `spawn-${runId}-${agentId}`,
          agentId,
          status: 'running',
        }));
        return run;
      });
      state.instances = state.runs.flatMap((run, runIndex) =>
        run.participantAgentIds.map((agentId, agentIndex) => ({
          id: `instance-${run.id}-${agentId}`,
          agentId,
          runId: run.id,
          sessionId: run.spawnedSessions[agentIndex].id,
          zoneId: `zone-${run.id}`,
          status: runIndex % 3 === 0 && agentIndex === 2 ? 'error' : agentIndex % 2 === 0 ? 'executing' : 'thinking',
        }))
      );
      state.logs = Array.from({ length: 120 }, (_, index) => {
        const run = state.runs[index % state.runs.length];
        return {
          id: `log-burst-${index}`,
          runId: run.id,
          agentId: participantIds[index % participantIds.length],
          title: `burst log ${index}`,
          detail: `burst detail ${index}`,
          timeLabel: '09:00',
          time: now - (index % 24) * 450,
          type: index % 5 === 0 ? ('spawn' as const) : index % 2 === 0 ? ('session' as const) : ('system' as const),
        };
      });
      state.events = Array.from({ length: 120 }, (_, index) => {
        const run = state.runs[index % state.runs.length];
        return makeEvent(index, run.id, now - (index % 20) * 500);
      });

      const baselineZones = getTownOfficeZones(state, now).map(zone => zone.runId);
      equal(baselineZones.length, 6, 'burst baseline should still cap visible zones to six');

      for (let tick = 0; tick < 12; tick += 1) {
        const tickNow = now + tick * 800;
        const zones = getTownOfficeZones(state, tickNow);
        const overflowRuns = getTownOverflowRuns(state, tickNow);
        const validatedInstances = getTownValidatedInstances(state);
        const rendered = buildOfficeRenderedInstances(
          state.agents,
          state.runs,
          zones,
          validatedInstances,
          TEST_ZONE_SLOTS
        );

        equal(zones.length, 6, 'burst traffic should keep visible zones capped at six');
        equal(overflowRuns.length, 2, 'burst traffic should keep overflow size stable');
        deepEqual(
          zones.map(zone => zone.runId),
          baselineZones,
          'burst traffic should not reshuffle visible run-to-zone bindings while active set is unchanged'
        );

        zones.forEach(zone => {
          const expectedCount = validatedInstances.filter(
            instance =>
              instance.runId === zone.runId &&
              (instance.status === 'thinking' || instance.status === 'executing' || instance.status === 'error')
          ).length;
          equal(
            rendered.filter(instance => instance.runId === zone.runId).length,
            expectedCount,
            `rendered clone count should stay aligned for ${zone.runId}`
          );
        });

        overflowRuns.forEach(run => {
          equal(
            rendered.some(instance => instance.runId === run.id),
            false,
            `overflow run ${run.id} should not leak clones into visible slots`
          );
        });

        state.logs.unshift(
          ...state.runs.map((run, index) => ({
            id: `tick-log-${tick}-${run.id}`,
            runId: run.id,
            agentId: participantIds[index % participantIds.length],
            title: `tick ${tick}`,
            detail: `tick detail ${tick}`,
            timeLabel: '09:00',
            time: tickNow - index * 25,
            type: index % 2 === 0 ? ('session' as const) : ('spawn' as const),
          }))
        );
        state.events.unshift(
          ...state.runs.map((run, index) => makeEvent(1_000 + tick * 10 + index, run.id, tickNow - index * 30))
        );
      }
    },
  },
  {
    name: 'shared load thresholds stay green/yellow/red across town views',
    run: () => {
      equal(getTownLoadVisual(0).summaryLabel, '空闲', 'zero load should stay idle');
      equal(getTownLoadVisual(1).summaryLabel, '低负载', 'one clone should be low load');
      equal(getTownLoadVisual(2).summaryLabel, '中负载', 'two clones should be medium load');
      equal(getTownLoadVisual(3).summaryLabel, '高负载', 'three clones should be high load');
      assert(getTownLoadVisual(1).badgeClassName.includes('166534'), 'low load should keep green badge');
      assert(getTownLoadVisual(2).badgeClassName.includes('78350f'), 'medium load should keep yellow badge');
      assert(getTownLoadVisual(4).badgeClassName.includes('7f1d1d'), 'high load should keep red badge');
    },
  },
];

let passed = 0;
for (const testCase of tests) {
  try {
    testCase.run();
    passed += 1;
    console.log(`ok - ${testCase.name}`);
  } catch (error) {
    console.error(`not ok - ${testCase.name}`);
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    throw error;
  }
}

console.log(`${passed} town tests passed`);
