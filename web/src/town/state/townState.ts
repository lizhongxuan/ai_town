import { TOWN_MOCK_STATE } from '../mock/townMock';
import { TownAgent, TownFacing, TownPosition, TownRunSource, TownSceneId, TownState } from '../types/town';

const MAIN_TOWN_VISIBLE_AGENT_LIMIT = 4;

const IDLE_LINES = [
  '今天轮到谁进办公室？',
  'OpenClaw(main) 一发指令我就能上。',
  '先在广场这边待命。',
];

const STANDBY_LINES = [
  '我先在办公室等下一轮任务。',
  'OpenClaw(main) 有新指令再叫我。',
  '当前在办公室待命。',
];

const BUSY_LINES: Record<string, string[]> = {
  coder: ['我来处理实现细节。', '命令和修复我来跑。'],
  researcher: ['我先去补充背景。', '资料和证据我来找。'],
  reviewer: ['我来盯回归风险。', '这轮改动我先审一遍。'],
  writer: ['我负责把结果写清楚。', '文档和说明我来整理。'],
  designer: ['界面我来收敛。', '交互细节我先捋一遍。'],
  ops: ['部署和重启我来处理。', '运行状态我先验证。'],
};

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function parseClock(clock: string): { hour: number; minute: number } {
  const [hourRaw, minuteRaw] = clock.split(':');
  return {
    hour: Number(hourRaw) || 9,
    minute: Number(minuteRaw) || 0,
  };
}

function formatClock(hour: number, minute: number) {
  const totalMinutes = ((hour * 60 + minute) % (24 * 60) + 24 * 60) % (24 * 60);
  const nextHour = Math.floor(totalMinutes / 60);
  const nextMinute = totalMinutes % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

function addMinutes(clock: string, step = 5) {
  const { hour, minute } = parseClock(clock);
  return formatClock(hour, minute + step);
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function speechForBusyAgent(agentId: string) {
  return randomFrom(BUSY_LINES[agentId] || BUSY_LINES.coder);
}

function randomIdleSpeech() {
  return randomFrom(IDLE_LINES);
}

function randomStandbySpeech() {
  return randomFrom(STANDBY_LINES);
}

function pushTownEvent(
  state: TownState,
  type: TownState['events'][number]['type'],
  title: string,
  detail: string,
  sceneHint?: TownSceneId
) {
  const now = Date.now();
  state.events.unshift({
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    title,
    detail,
    timeLabel: state.clock,
    time: now,
    sceneHint,
  });
  state.events = state.events.slice(0, 8);
}

function pushTownLog(
  state: TownState,
  title: string,
  detail: string,
  type: TownState['logs'][number]['type'],
  options?: { runId?: string; agentId?: string }
) {
  const now = Date.now();
  state.logs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    detail,
    timeLabel: state.clock,
    time: now,
    type,
    runId: options?.runId,
    agentId: options?.agentId,
  });
  state.logs = state.logs.slice(0, 60);
}

function facingFromDelta(dx: number, dy: number): TownFacing {
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return 'down';
}

function clampPosition(position: TownPosition, sceneId: TownSceneId, state: TownState): TownPosition {
  const scene = state.scenes[sceneId];
  return {
    x: Math.max(1, Math.min(scene.width - 2, position.x)),
    y: Math.max(1, Math.min(scene.height - 2, position.y)),
  };
}

function clampBossPosition(position: TownPosition, sceneId: TownSceneId): TownPosition {
  if (sceneId === 'mainTown') {
    return {
      x: Math.max(7, Math.min(12, position.x)),
      y: Math.max(3, Math.min(7, position.y)),
    };
  }
  return {
    x: Math.max(6, Math.min(10, position.x)),
    y: Math.max(4, Math.min(7, position.y)),
  };
}

function countManualSelection(state: TownState) {
  return state.agents.filter(agent => agent.officeMembership === 'selected').length;
}

function pickWeightedAgents(agents: TownAgent[], maxCount: number) {
  const pool = agents.map(agent => ({
    id: agent.id,
    weight: Math.max(1, agent.recentWeight),
  }));
  const result: string[] = [];

  while (pool.length > 0 && result.length < maxCount) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    let chosenIndex = 0;
    for (let index = 0; index < pool.length; index += 1) {
      roll -= pool[index].weight;
      if (roll <= 0) {
        chosenIndex = index;
        break;
      }
    }
    result.push(pool[chosenIndex].id);
    pool.splice(chosenIndex, 1);
  }

  return result;
}

function refreshVisibleTownAgents(state: TownState) {
  const candidates = state.agents.filter(
    agent => agent.officeMembership === 'unselected' && agent.location === 'mainTown'
  );

  const stillVisible = state.visibleTownAgentIds.filter(id => candidates.some(agent => agent.id === id));
  const remaining = candidates.filter(agent => !stillVisible.includes(agent.id));
  const nextIds = [...stillVisible];

  if (nextIds.length < MAIN_TOWN_VISIBLE_AGENT_LIMIT) {
    nextIds.push(...pickWeightedAgents(remaining, MAIN_TOWN_VISIBLE_AGENT_LIMIT - nextIds.length));
  }

  state.visibleTownAgentIds = nextIds.slice(0, MAIN_TOWN_VISIBLE_AGENT_LIMIT);
}

function resetAgentToTown(agent: TownAgent) {
  agent.location = 'mainTown';
  agent.officeMembership = 'unselected';
  agent.executionState = 'idle';
  agent.sessionRole = 'none';
  agent.currentRunId = undefined;
  agent.position = { ...agent.homePosition };
  agent.speech = randomIdleSpeech();
}

export function buildTownStateFromMock(): TownState {
  const next = cloneState(TOWN_MOCK_STATE);
  refreshVisibleTownAgents(next);
  return next;
}

export function setTownScene(state: TownState, sceneId: TownSceneId): TownState {
  const next = cloneState(state);
  next.activeSceneId = sceneId;
  return next;
}

export function toggleTownAgentSelection(state: TownState, agentId: string): TownState {
  const next = cloneState(state);
  const agent = next.agents.find(item => item.id === agentId);
  if (!agent) return next;

  if (agent.executionState === 'busy') {
    pushTownEvent(next, 'warning', '该成员正在忙碌', `${agent.name} 当前有活跃会话，暂时不能移出办公室。`, next.activeSceneId);
    return next;
  }

  if (agent.officeMembership === 'unselected') {
    if (countManualSelection(next) >= next.maxSelectableAgents) {
      pushTownEvent(next, 'warning', '已达到选择上限', `当前最多只允许手动选择 ${next.maxSelectableAgents} 个成员。`, 'mainTown');
      return next;
    }
    agent.officeMembership = 'selected';
    agent.executionState = 'idle';
    agent.speech = '已加入协作组，等你带我进办公室。';
    pushTownEvent(next, 'info', '成员已加入协作组', `${agent.name} 已加入待进入办公室的协作组。`, 'mainTown');
  } else {
    resetAgentToTown(agent);
    pushTownEvent(next, 'info', '成员已返回主镇', `${agent.name} 已移出办公室成员池，回到主镇待命。`, next.activeSceneId);
  }

  refreshVisibleTownAgents(next);
  return next;
}

export function moveSelectedAgentsToOffice(state: TownState): TownState {
  const next = cloneState(state);
  next.activeSceneId = 'office';

  const selectedAgents = next.agents.filter(agent => agent.officeMembership !== 'unselected');
  if (selectedAgents.length === 0) {
    pushTownEvent(next, 'info', 'OpenClaw(main) 已进入办公室', '当前没有选中成员，OpenClaw(main) 将独自进入办公室待命。', 'office');
    return next;
  }

  selectedAgents.forEach(agent => {
    agent.location = 'office';
    agent.executionState = agent.executionState === 'busy' ? 'busy' : 'standby';
    agent.position = { ...agent.officePosition };
    if (agent.executionState !== 'busy') {
      agent.speech = randomStandbySpeech();
    }
  });

  pushTownEvent(
    next,
    'success',
    '协作组已进入办公室',
    `${selectedAgents.length} 个成员已进入办公室待命，可以由 OpenClaw(main) 发起任务。`,
    'office'
  );
  pushTownLog(
    next,
    '办公室成员池已更新',
    `${selectedAgents.map(agent => agent.name).join('、')} 已进入办公室待命。`,
    'system'
  );
  refreshVisibleTownAgents(next);
  return next;
}

export function startTownRun(
  state: TownState,
  input: { runId: string; title: string; prompt: string; source: TownRunSource; autoAgentIds?: string[] }
): TownState {
  const next = cloneState(state);
  next.activeSceneId = 'office';
  next.boss.officePosition = { ...next.boss.officeDeskPosition };
  next.boss.officeFacing = 'up';
  const now = Date.now();

  input.autoAgentIds?.forEach(agentId => {
    const agent = next.agents.find(item => item.id === agentId);
    if (!agent) return;
    agent.officeMembership = 'auto_added';
    agent.location = 'office';
    if (agent.executionState !== 'busy') {
      agent.executionState = 'standby';
      agent.position = { ...agent.officePosition };
    }
  });

  const availableAgents = next.agents.filter(
    agent => agent.officeMembership !== 'unselected' && agent.executionState !== 'busy'
  );

  const participantIds = availableAgents.map(agent => agent.id);

  next.runs.unshift({
    id: input.runId,
    title: input.title,
    prompt: input.prompt,
    source: input.source,
    status: 'running',
    primarySessionId: `session-${input.runId}`,
    createdAt: now,
    updatedAt: now,
    createdAtLabel: next.clock,
    updatedAtLabel: next.clock,
    participantAgentIds: participantIds,
    spawnedSessions: participantIds.map(agentId => ({
      id: `spawn-${input.runId}-${agentId}`,
      agentId,
      status: 'running',
    })),
  });
  participantIds.forEach((agentId, index) => {
    next.instances.unshift({
      id: `instance-${input.runId}-${agentId}-${index + 1}`,
      agentId,
      runId: input.runId,
      sessionId: `spawn-${input.runId}-${agentId}`,
      zoneId: `zone-${input.runId}`,
      status: 'executing',
    });
  });

  participantIds.forEach(agentId => {
    const agent = next.agents.find(item => item.id === agentId);
    if (!agent) return;
    agent.location = 'office';
    agent.executionState = 'busy';
    agent.sessionRole = 'spawned';
    agent.currentRunId = input.runId;
    agent.position = { ...agent.officePosition };
    agent.speech = speechForBusyAgent(agent.id);
    agent.recentWeight += 2;
  });

  const participantLabel = participantIds.length > 0 ? participantIds.map(agentId => next.agents.find(agent => agent.id === agentId)?.name).filter(Boolean).join('、') : 'OpenClaw(main) 单独执行';

  pushTownEvent(
    next,
    input.source === 'im' ? 'im' : 'success',
    input.source === 'im' ? 'OpenClaw(main) 正在办公室执行任务' : 'OpenClaw(main) 已发起协作任务',
    participantIds.length > 0 ? `${participantLabel} 已被拉入当前任务。` : '当前任务将由 OpenClaw(main) 单独执行。',
    'office'
  );
  pushTownLog(
    next,
    '主任务会话已创建',
    `OpenClaw(main) 已为「${input.title}」创建主任务会话。`,
    input.source === 'im' ? 'im' : 'session',
    { runId: input.runId }
  );

  if (participantIds.length > 0) {
    participantIds.forEach(agentId => {
      const agent = next.agents.find(item => item.id === agentId);
      if (!agent) return;
      pushTownLog(
        next,
        `${agent.name} 已被拉入协作`,
        `OpenClaw(main) 通过子会话调用 ${agent.name} 参与「${input.title}」。`,
        input.source === 'im' ? 'im' : 'spawn',
        { runId: input.runId, agentId }
      );
    });
  } else {
    pushTownLog(
      next,
      '本轮由 OpenClaw(main) 单独执行',
      `「${input.title}」当前没有启用子成员，由 OpenClaw(main) 自行处理。`,
      input.source === 'im' ? 'im' : 'session',
      { runId: input.runId }
    );
  }

  refreshVisibleTownAgents(next);
  return next;
}

export function completeTownRun(state: TownState, runId: string): TownState {
  const next = cloneState(state);
  const run = next.runs.find(item => item.id === runId);
  if (!run || run.status !== 'running') return next;

  run.status = 'completed';
  run.updatedAt = Date.now();
  run.updatedAtLabel = next.clock;
  run.spawnedSessions.forEach(session => {
    session.status = 'completed';
  });
  next.instances.forEach(instance => {
    if (instance.runId !== runId) return;
    if (instance.status === 'executing' || instance.status === 'thinking') {
      instance.status = 'completed';
    }
  });

  next.agents.forEach(agent => {
    if (agent.currentRunId !== runId) return;
    agent.executionState = 'standby';
    agent.sessionRole = 'none';
    agent.currentRunId = undefined;
    agent.location = 'office';
    agent.position = clampPosition(
      {
        x: agent.officePosition.x + (Math.random() > 0.5 ? 1 : -1),
        y: agent.officePosition.y + (Math.random() > 0.5 ? 0 : 1),
      },
      'office',
      next
    );
    agent.facing = randomFrom<TownFacing>(['left', 'right', 'down']);
    agent.speech = '这一轮处理完了，继续待命。';
  });

  next.boss.officePosition = clampBossPosition(
    {
      x: next.boss.officeDeskPosition.x + (Math.random() > 0.5 ? 1 : -1),
      y: next.boss.officeDeskPosition.y + 2,
    },
    'office'
  );
  next.boss.officeFacing = randomFrom<TownFacing>(['left', 'right', 'down']);

  pushTownEvent(next, 'success', '办公室任务已完成', `主任务「${run.title}」已完成，相关成员留在办公室继续待命。`, 'office');
  pushTownLog(next, '任务已完成', `主任务「${run.title}」已结束，办公室成员已回到待命状态。`, 'session', { runId });
  return next;
}

export function advanceTownAmbient(state: TownState): TownState {
  const next = cloneState(state);
  next.clock = addMinutes(next.clock, 5);
  const openclawBusy = next.runs.some(run => run.status === 'running');

  next.agents.forEach(agent => {
    if (agent.location === 'mainTown' && agent.officeMembership === 'unselected') {
      const deltaX = [-1, 0, 1][Math.floor(Math.random() * 3)];
      const deltaY = [-1, 0, 1][Math.floor(Math.random() * 3)];
      agent.position = clampPosition(
        { x: agent.position.x + deltaX, y: agent.position.y + deltaY },
        'mainTown',
        next
      );
      if (deltaX !== 0 || deltaY !== 0) {
        agent.facing = facingFromDelta(deltaX, deltaY);
      }
      if (Math.random() > 0.82) {
        agent.speech = randomIdleSpeech();
      }
      return;
    }

    if (agent.location === 'office' && agent.executionState === 'standby') {
      const deltaX = [-1, 0, 1][Math.floor(Math.random() * 3)];
      const deltaY = [0, 0, 1][Math.floor(Math.random() * 3)];
      agent.position = clampPosition(
        { x: agent.position.x + deltaX, y: agent.position.y + deltaY },
        'office',
        next
      );
      if (deltaX !== 0 || deltaY !== 0) {
        agent.facing = facingFromDelta(deltaX, deltaY);
      }
      if (Math.random() > 0.7) {
        agent.speech = randomStandbySpeech();
      }
    }
  });

  {
    const mainDeltaX = [-1, 0, 1][Math.floor(Math.random() * 3)];
    const mainDeltaY = [-1, 0, 1][Math.floor(Math.random() * 3)];
    next.boss.mainTownPosition = clampBossPosition(
      {
        x: next.boss.mainTownPosition.x + mainDeltaX,
        y: next.boss.mainTownPosition.y + mainDeltaY,
      },
      'mainTown'
    );
    if (mainDeltaX !== 0 || mainDeltaY !== 0) {
      next.boss.mainTownFacing = facingFromDelta(mainDeltaX, mainDeltaY);
    }
  }

  if (openclawBusy) {
    next.boss.officePosition = { ...next.boss.officeDeskPosition };
    next.boss.officeFacing = 'up';
  } else {
    const officeDeltaX = [-1, 0, 1][Math.floor(Math.random() * 3)];
    const officeDeltaY = [-1, 0, 1][Math.floor(Math.random() * 3)];
    next.boss.officePosition = clampBossPosition(
      {
        x: next.boss.officePosition.x + officeDeltaX,
        y: next.boss.officePosition.y + officeDeltaY,
      },
      'office'
    );
    if (officeDeltaX !== 0 || officeDeltaY !== 0) {
      next.boss.officeFacing = facingFromDelta(officeDeltaX, officeDeltaY);
    }
  }

  next.ambientResidents.forEach(resident => {
    const deltaX = [-1, 0, 1][Math.floor(Math.random() * 3)];
    const deltaY = [-1, 0, 1][Math.floor(Math.random() * 3)];
    resident.position = clampPosition(
      { x: resident.position.x + deltaX, y: resident.position.y + deltaY },
      'mainTown',
      next
    );
    if (deltaX !== 0 || deltaY !== 0) {
      resident.facing = facingFromDelta(deltaX, deltaY);
    }
  });

  refreshVisibleTownAgents(next);
  return next;
}
