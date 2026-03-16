# AI 小镇 V2 详细方案设计

## 0. 文档定位

本文用于确定 `AI 小镇 /town` 的下一阶段功能设计，覆盖以下 6 个方向：

1. 单次任务执行过程回放，包括关键协作过程。
2. 主镇新增 3 个 NPC，各自做自己的事，点击会说冷笑话。
3. 主镇新增公告栏，点击后展示“昨天战报总结 / 今日工作面板”，并在每天过了 12 点后自动生成。
4. `OpenClaw(main)` 工作时可以组织多个 Agent 自动拆任务、分工、执行、汇总，并展示为什么选择这些 Agent。
5. 每次任务支持更细的可观测详情，包括模型对话、技能/工具调用、子任务时长、上下文、日志等。
6. 办公室内新增聊天框，承载 `OpenClaw(main)` 与 IM 的会话。

本文默认基于当前 Town V1/V3 语义继续演进，不推翻已有产品边界。

## 0.1 默认假设

- 路由仍固定为 `/town`。
- 页面仍只保留两个核心场景：
  - `mainTown`
  - `office`
- `AI 小镇` 仍是 `OpenClaw` 的可视化观测层，不定义新的 Agent Runtime。
- “每天过了 12 点”默认解释为：
  - 以服务端本地时区为准
  - 每日 `00:05` 触发自动汇总
- 任务回放优先做“事件回放”，不把视频录制作为第一阶段主交付。
- 办公室 IM 聊天框默认聚焦：
  - 当前选中 run 绑定的 IM 会话
  - 若当前 run 非 IM 来源，则显示最近活跃的 OpenClaw IM 会话

## 1. V2 目标

V2 的目标不是把 Town 做成更重的游戏，而是把它升级成一个：

- 更好看懂协作过程的观测页
- 更值得每天打开一次的工作入口
- 更能解释“为什么这样分工”的协调台
- 更能复盘“这轮到底发生了什么”的运行细节面板
- 更有人味、更有记忆点的小镇

一句话定义：

> `AI 小镇 V2 = 可观看、可解释、可复盘、可总览、可聊天的多 Agent 工作世界`

## 2. 产品边界

以下边界保持不变：

- `OpenClaw(main)` 是唯一可见主控角色。
- 办公室仍是共享大厅，不是一任务一房间。
- 一个 Agent 仍允许在多个任务中以多个 `instance` 形式出现。
- 实时同步仍以 `snapshot` 为最终一致来源，WebSocket 只负责触发刷新。
- 重量级详情数据不进入 `GET /api/town/snapshot`，避免首页被重数据拖慢。
- NPC 和公告栏主要提供氛围与总览，不参与真实任务调度。
- Town 不替代原有后台页：
  - 复杂配置仍在 Agent/Workflow/Channels 等原页面完成
  - Town 负责观测、发起、解释、轻量操作

明确不做：

- 重 RPG 数值体系
- 战斗系统
- 独立经济系统
- 全局视频化主存储
- 在 Town 内重建完整 OpenClaw 内核

## 3. 核心体验升级

V2 完成后，用户应能自然完成下面几条路径：

### 3.1 日常打开

- 用户打开 `/town`
- 先看主镇公告栏
- 直接知道：
  - 昨天做了什么
  - 今天要做什么
  - 哪些事情优先级最高

### 3.2 发起任务

- 用户在办公室输入一个目标
- `OpenClaw(main)` 先进行任务拆解与选人
- 用户能看到：
  - 任务被拆成哪些子任务
  - 为什么选择这些 Agent
  - 哪些 Agent 没被选中以及原因

### 3.3 跟踪执行

- 办公室内看到协作分工推进
- 能区分本轮调度是：
  - `并行`
  - `串行`
  - `混合`
- 能看到每个 Agent 的开始时间、结束时间、运行时长
- IM 来源任务可直接在办公室聊天框中查看上下文
- 能实时看到 `OpenClaw(main)` 或 Agent 正在做什么：
  - 例如正在调用哪个 skill
  - 正在执行哪条命令
  - 正在把哪个子任务派给谁
- 任务进行中可打开详细面板看调用链、日志、耗时与上下文

### 3.4 任务复盘

- 任务完成后可以进入回放
- 以“关键帧 + 时间线 + 分工轨道”方式回看协作过程
- 不只看到谁执行了，还能看到：
  - 什么时候规划
  - 什么时候拉起子 Agent
  - 调用了什么技能/工具
  - 为什么最后形成这个结果

### 3.5 轻松互动

- 主镇里始终有 3 个常驻 NPC
- 用户点一下就能听到冷笑话或闲聊
- Town 不会只有“工作压迫感”，而是有一点生活气

## 4. 信息架构调整

## 4.1 主镇新增元素

- `公告栏 BulletinBoard`
- `NPC-A`
- `NPC-B`
- `NPC-C`

主镇可交互入口变为：

- 公告栏：查看昨日战报 / 今日工作面板
- 办公室入口：进入协作场景
- Agent：查看成员信息
- NPC：点击冒泡说话

## 4.2 办公室新增元素

- 顶部或右侧新增“协作阶段条”
- 新增“调度拓扑条 / 串并行指示器”
- 任务卡支持“查看编排原因”
- 任务卡支持“查看 plan 计划”
- 新增“任务详情面板”入口
- 新增“办公室 IM 聊天框”
- 新增“场景实时聊天水泡层”

办公室侧栏建议收敛为 3 个区块：

1. 协作发起区
   - 办公室成员
   - 任务输入框
   - 开始协作按钮
2. 当前任务摘要区
   - 当前 run 状态
   - 选人原因摘要
   - 打开详情 / 打开回放
3. IM 会话区
   - 当前绑定会话
   - 消息列表
   - 回复输入框

## 4.3 弹层与抽屉

V2 建议新增 3 个面板：

- `TownBulletinModal`
  - 公告栏内容
- `TownRunReplayModal`
  - 单 run 回放中心
- `TownRunInspectorDrawer`
  - 单 run 详情观察台

其中：

- `回放` 专注看“过程”
- `详情观察台` 专注看“数据与细节”
- 二者不要混成一个超重弹窗

## 5. 功能一：任务执行回放

## 5.1 目标

回放的目标不是简单重播日志，而是回答 5 个问题：

1. 这轮任务从什么时候开始？
2. `OpenClaw(main)` 何时开始规划？
3. 何时选择了哪些 Agent？
4. 子任务是如何展开、推进、完成的？
5. 哪些关键事件导致了最终结果？

## 5.2 交互入口

入口建议保留 3 处：

- 办公室右侧当前任务摘要卡
- 任务日志弹窗中的“进入回放”
- 任务详情观察台中的“切到回放”

## 5.3 回放展示结构

单 run 回放中心建议拆成 4 层：

### A. 顶部概览条

- run 标题
- 来源：`manual / im`
- 开始时间
- 总时长
- 参与 Agent 数
- 子任务数
- 状态：运行中 / 已完成 / 异常

### B. 协作阶段条

固定阶段建议为：

- `intake`
  - 接收任务
- `planning`
  - `OpenClaw(main)` 规划与选人
- `dispatching`
  - 下发子任务
- `executing`
  - 多 Agent 并行执行
- `summarizing`
  - 汇总与收尾
- `completed / error`

用户拖动时间轴时，阶段条同步高亮当前阶段。

### C. 轨道式时间线

按 lane 展示关键协作过程：

- `OpenClaw(main)` lane
- `planner` lane
- 每个参与 Agent 一条 lane
- `skills/tools` lane
- `IM` lane

每条 lane 上仅显示关键帧，不直接展示所有原始日志。

时间线必须额外表达 3 类结构信息：

- `串行`
  - 一个子任务完成后，下一个才开始
- `并行`
  - 多个 Agent 同时执行不同子任务
- `混合`
  - 前半段串行规划，后半段并行执行，最后再串行汇总

对于每个 Agent 或子任务节点，需要展示：

- 开始时间
- 结束时间
- 运行时长
- 当前状态
- 父任务 / 前置依赖

关键帧示例：

- 任务开始
- 生成计划
- 选中 `coder`
- 没选 `writer`，原因：当前技能不匹配
- 创建子任务
- 调用 `workspace.search`
- 调用 `skill:doc`
- 收到 IM 追问
- 生成总结
- 回传结果

### D. 右侧帧详情卡

点击任意关键帧后展示：

- 事件标题
- 时间
- 当前阶段
- 发起者
- 影响对象
- 简述
- 对应原始证据入口
  - 日志片段
  - 调用记录
  - 会话消息
  - 产物链接

若当前帧是调度或执行节点，还应显示：

- 当前调度模式：并行 / 串行 / 混合
- 是否为 `OpenClaw(main)` 直接执行
- 涉及的 Agent
- 该节点耗时
- 若为命令或 skill 调用：
  - 调用名
  - 命令预览
  - skill 名

## 5.4 回放数据策略

V2 不建议把“完整原始 trace”直接用于回放，因为数据过重、用户也看不完。

建议拆成两层：

- `Replay Keyframes`
  - 给 UI 回放使用
  - 只保留关键节点
- `Raw Trace`
  - 给详情观察台按需查看

这样能同时满足：

- 回放足够顺滑
- 细节足够丰富

## 5.5 回放数据结构

建议新增：

```ts
type TownRunPhase =
  | 'intake'
  | 'planning'
  | 'dispatching'
  | 'executing'
  | 'summarizing'
  | 'completed'
  | 'error';

type TownRunExecutionMode = 'parallel' | 'serial' | 'mixed';

type TownReplayLaneType =
  | 'openclaw'
  | 'planner'
  | 'agent'
  | 'tool'
  | 'skill'
  | 'im';

type TownReplayKeyframe = {
  id: string;
  runId: string;
  phase: TownRunPhase;
  laneType: TownReplayLaneType;
  laneId: string;
  actorId?: string;
  targetId?: string;
  title: string;
  summary: string;
  time: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  executionMode?: TownRunExecutionMode;
  commandPreview?: string;
  skillName?: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  rawRefIds?: string[];
};

type TownRunExecutionSegment = {
  id: string;
  runId: string;
  agentId?: string;
  subtaskId?: string;
  parentSubtaskId?: string;
  title: string;
  status: 'planned' | 'running' | 'completed' | 'error';
  executionMode: TownRunExecutionMode;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  laneIndex: number;
};

type TownRunExecutionTopology = {
  runId: string;
  mode: TownRunExecutionMode;
  segments: TownRunExecutionSegment[];
  edges: Array<{
    fromSegmentId: string;
    toSegmentId: string;
    relation: 'serial' | 'parallel' | 'depends_on';
  }>;
};
```

## 5.6 新增接口建议

保留现有：

- `GET /api/town/runs/:id/logs`

新增：

- `GET /api/town/runs/:id/replay`
  - 返回回放关键帧
  - 默认只返回适合回放的事件
- `GET /api/town/runs/:id/replay/export`
  - 可选，导出分享用 replay JSON

响应建议：

```json
{
  "ok": true,
  "runId": "run-123",
  "phases": [],
  "lanes": [],
  "keyframes": [],
  "topology": {},
  "stats": {
    "durationMs": 183000,
    "participantCount": 3,
    "subtaskCount": 5
  }
}
```

## 5.7 与现有回放机制的兼容策略

- 现有前端 `2000` 事件上限继续保留。
- V2 的 `GET /replay` 返回“关键帧流”，不是完整原始日志。
- 若关键帧数量超过上限：
  - 合并重复事件
  - 保留阶段切换节点
  - 保留错误节点
  - 保留每个 Agent 的关键动作

## 5.8 视频录制建议

视频录制不建议作为 P0 主交付。

推荐顺序：

1. 先完成事件回放
2. 再做“导出回放 JSON / 分享链接”
3. 最后再评估“录制 GIF / MP4”

原因：

- 回放更利于复盘
- 视频更利于传播
- 视频渲染与导出成本更高，且不适合作为主数据格式

## 6. 功能二：新增 3 个 NPC

## 6.1 目标

NPC 的目标不是承载任务，而是：

- 提升主镇活气
- 让用户点击时有反馈
- 增加轻松记忆点

## 6.2 NPC 设计

建议先做 3 个常驻静态 NPC：

### NPC-1：老石

- 位置：公告栏旁长椅
- 状态：坐着看报
- 关键词：一本正经地讲冷笑话

### NPC-2：阿竹

- 位置：邮局外的小凳子
- 状态：低头写东西
- 关键词：像摸鱼文员，讲“工作梗”

### NPC-3：铁叔

- 位置：工具屋门口木箱旁
- 状态：坐着修小零件
- 关键词：工具、技能、程序员冷笑话

## 6.3 交互规则

- 鼠标悬停显示名字
- 点击后冒出对话泡泡
- 每次从冷笑话池中随机取一句
- 连续点击时进入短冷却：
  - 例如 `3s`
- 冷笑话重复命中率控制：
  - 最近 `5` 句不重复

## 6.4 数据建议

NPC 首版建议走前端静态配置，不依赖后端接口。

```ts
type TownNPC = {
  id: string;
  name: string;
  seatSceneId: 'mainTown';
  position: { x: number; y: number };
  animation: 'read' | 'write' | 'repair';
  jokes: string[];
  cooldownSeconds: number;
};
```

后续如要扩展，可再加：

- 节日台词
- 每日一句
- 根据天气切换台词
- 根据小镇繁忙程度切换吐槽

## 6.5 UI 表现

- 对话泡泡风格应与像素 HUD 保持统一
- 一次只显示一个 NPC 对话泡泡
- 气泡 `4-5s` 自动消失
- 不遮挡公告栏和办公室入口

## 7. 功能三：主镇公告栏

## 7.1 目标

公告栏要解决的不是“多一个面板”，而是用户每天一进 Town 就知道：

- 昨天 AI 团队交付了什么
- 今天有哪些优先工作
- 最近哪些消息值得注意

## 7.2 公告栏内容结构

点击公告栏后打开 `TownBulletinModal`，默认两个 tab：

- `昨天战报`
- `今日工作面板`

### A. 昨天战报

展示内容建议为：

- 昨日完成任务数
- 昨日异常任务数
- 参与最活跃 Agent
- 关键成果物列表
- 关键 IM 反馈
- 一段 100-200 字的战报摘要

### B. 今日工作面板

展示内容建议为：

- 今日优先级 `P0 / P1 / P2`
- 今日待办列表
- 今日约定事项 / 日程
- 待回复消息
- 推荐先处理的 3 件事
- 一段“开工建议”

## 7.3 数据来源

公告栏数据来源按优先级分层：

### 第一层：Town 内部运行数据

- `town_state` 中的 runs / events / logs
- 昨日完成任务与失败任务
- 关键成果链接

### 第二层：ClawPanel 已有模块

- `ActivityLog`
- `Sessions`
- `Workflows`
- `CronJobs`
- `Channels` 最近消息

### 第三层：外部接入数据

- 日历
- TODO 工具
- IM 渠道未读消息

### 降级策略

若未接入外部日程 / TODO：

- 仍生成今日工作面板
- 但明确标注：
  - `未接入外部日程`
  - `待办来自本地运行记录与未完成事项推断`

## 7.4 生成时机

默认生成策略：

- 每天 `00:05`
  - 生成“昨天战报”
  - 生成“今日工作面板”
- 当用户首次打开 Town 且当天尚未生成时：
  - 立即触发一次后台生成
- 公告栏里保留“手动刷新”按钮

## 7.5 生成流程

建议流程：

1. 收集前一日运行数据
2. 收集待处理事项、消息与计划
3. 归一化成结构化摘要输入
4. 调用模型生成战报文案与今日工作建议
5. 存档结构化结果与文案结果
6. 更新 snapshot 中的公告摘要

## 7.6 公告栏数据结构

```ts
type TownDailyBulletin = {
  date: string;
  timezone: string;
  generatedAt: number;
  yesterday: {
    summary: string;
    completedRuns: number;
    failedRuns: number;
    topAgents: Array<{ agentId: string; count: number }>;
    highlights: Array<{ title: string; runId?: string; artifactUrl?: string }>;
  };
  today: {
    summary: string;
    priorities: Array<{ level: 'P0' | 'P1' | 'P2'; title: string; reason?: string }>;
    schedule: Array<{ timeLabel?: string; title: string; source: string }>;
    todos: Array<{ title: string; source: string; status: 'pending' | 'suggested' }>;
    pendingMessages: Array<{ title: string; channel: string; conversationId?: string }>;
  };
};
```

## 7.7 新增接口建议

- `GET /api/town/bulletin`
  - 返回最近一期公告栏数据
- `POST /api/town/bulletin/rebuild`
  - 手动重建某天公告

## 7.8 存储建议

建议新建：

- `data/town_daily/YYYY-MM-DD.json`

不要把公告全文塞进 `town_state.json`。

`snapshot` 只返回轻量摘要：

- 是否已生成
- 昨日一句话摘要
- 今日一句话摘要
- 更新时间

## 8. 功能四：OpenClaw(main) 自动拆任务、选人、解释原因

## 8.1 目标

这一块是 V2 的核心升级，目的是让用户看到：

- `OpenClaw(main)` 不是直接瞎拉人
- 它先理解目标，再拆任务，再选人，再分工
- 用户可以知道“为什么是这些 Agent”

## 8.2 协调阶段设计

建议把 `OpenClaw(main)` 的一次协作拆成 6 步：

1. `intake`
   - 接收目标
2. `planning`
   - 生成主计划
3. `selecting`
   - 评估可用 Agent / skills / tools
4. `dispatching`
   - 创建子任务并指派
5. `executing`
   - 收集各 Agent 结果
6. `summarizing`
   - 汇总、交付、回传

## 8.3 选人逻辑解释

V2 需要把“选人理由”显式化。

每个被选中的 Agent 至少给出 1-3 条原因：

- 技能匹配
- 历史经验匹配
- 当前可用状态
- 与其他 Agent 的协作互补
- 当前上下文最相关

每个未被选中的候选 Agent 也允许给出简短原因：

- 当前未待命
- 技能不匹配
- 当前负载较高
- 与本轮任务关联较弱

## 8.4 UI 呈现建议

在办公室中，`OpenClaw(main)` 发起任务后应出现一个短暂的“编排中”阶段。

用户能看到：

- `OpenClaw(main) 正在拆解任务`
- 候选 Agent 卡片被高亮
- 最终选中的 Agent 被拉入协作区
- 可点开“为什么选他们”
- 可点开“本轮 plan”
- 可点开“本轮是并行还是串行，为什么这样安排”

“为什么选他们”卡片建议展示：

- 主目标
- 任务拆解摘要
- 选中 Agent 列表及理由
- 未选中候选列表及理由
- 调度方式：
  - 为什么串行
  - 为什么并行
  - 哪些步骤必须等待前置结果

## 8.5 数据结构建议

```ts
type TownRunCoordinationPlan = {
  runId: string;
  goal: string;
  executionMode: TownRunExecutionMode;
  planningSummary: string;
  planText?: string;
  planSteps?: Array<{
    id: string;
    title: string;
    summary: string;
    dependsOnStepIds?: string[];
    executionMode?: 'parallel' | 'serial';
  }>;
  subtasks: Array<{
    id: string;
    title: string;
    summary: string;
    requiredSkills?: string[];
    assignedAgentId?: string;
    assignedReasons?: string[];
    dependsOnSubtaskIds?: string[];
    executionMode?: 'parallel' | 'serial';
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
    status: 'planned' | 'running' | 'completed' | 'error';
  }>;
  candidates: Array<{
    agentId: string;
    score: number;
    selected: boolean;
    reasons: string[];
  }>;
};
```

## 8.6 运行模式建议

为了兼容当前 bridge 能力，建议分两层实现：

### Level 1：近似解释

当真实 bridge 暂时无法提供完整 planning trace 时，Town 用已有信息生成近似解释：

- 基于 Agent skills
- 基于办公池待命状态
- 基于任务文本关键词
- 基于最终实际参与者

### Level 2：真实解释

当 OpenClaw 内部能输出计划与选人理由时，Town 直接展示真实 planning 结果。

V2 文档与接口设计优先按 `Level 2` 设计，但首版允许 `Level 1` 降级。

## 8.7 新增事件建议

- `openclaw.run.plan.started`
- `openclaw.run.plan.ready`
- `openclaw.agent.considered`
- `openclaw.agent.selected`
- `openclaw.agent.rejected`
- `openclaw.subtask.created`
- `openclaw.subtask.assigned`
- `openclaw.subtask.completed`
- `openclaw.subtask.started`
- `openclaw.subtask.waiting`
- `openclaw.run.plan.step`
- `openclaw.run.execution.mode`
- `openclaw.command.started`
- `openclaw.command.completed`
- `openclaw.skill.started`
- `openclaw.skill.completed`
- `town.actor.bubble`
- `openclaw.run.summary.generated`

这些事件同时服务于：

- 回放
- 当前态 UI
- 详情观察台

## 9. 功能五：任务详情观察台

## 9.1 目标

任务详情观察台的目标是：

- 让用户看到一次协作到底怎么组织的
- 不只看最终结果，也看中间过程
- 出问题时能定位到哪个环节

它是“深挖面板”，不是首页默认全展开内容。

## 9.2 展示入口

入口建议放在：

- 办公室当前任务摘要卡
- 任务日志弹窗中的按钮
- 回放界面中的“查看原始细节”

## 9.3 面板结构

建议采用 `TownRunInspectorDrawer` 或大抽屉，分为 8 个 tab：

### 1. 概览 Overview

- 任务标题
- 来源
- 开始/结束时间
- 总耗时
- 参与 Agent
- 子任务数
- 结果摘要
- 产物链接

### 2. 编排 Coordination

- 规划摘要
- plan 原文 / 结构化计划
- 任务拆解
- 选人理由
- 未选中原因
- 串并行拓扑
- 阶段切换时间

### 3. OpenClaw 日志

- `OpenClaw(main)` 的主日志
- 模型思考摘要
- 调度动作
- 收尾动作

### 4. Agent 日志

- 每个 Agent 单独折叠面板
- 子任务目标
- 运行状态
- 耗时
- 最终产物

### 5. Commands / Tools / Skills 调用

- 调用时间
- 调用者
- 类型：`command / agent / skill / tool`
- 参数摘要
- 返回摘要
- 执行命令预览
- 持续时间
- 成功 / 失败

### 6. 模型对话 LLM Trace

- 模型 provider / model
- request / response 摘要
- token 统计
- 耗时
- 重试次数
- 可选展开原文

### 7. Context / Artifact

- 每个 Agent 的上下文摘要
- 关键输入来源
- 关键文件引用
- 产物文件
- 最终回传内容

### 8. Scene Bubble Feed

- 小人头顶实时聊天水泡历史
- 谁说的
- 说话时刻
- 类型：
  - plan
  - command
  - skill
  - dispatch
  - summary
- 对应 run / agent / command / skill 关联

## 9.4 数据结构建议

```ts
type TownRunDetail = {
  runId: string;
  overview: {
    title: string;
    source: 'manual' | 'im';
    status: 'running' | 'completed' | 'error';
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    participantAgentIds: string[];
    artifactRefs: Array<{ name: string; path?: string; url?: string }>;
    summary: string;
  };
  executionTopology?: TownRunExecutionTopology;
  coordination?: TownRunCoordinationPlan;
  openclawLogs: Array<{
    id: string;
    time: number;
    level: 'info' | 'warning' | 'error';
    title: string;
    detail: string;
  }>;
  agentRuns: Array<{
    agentId: string;
    subtaskId?: string;
    title: string;
    status: 'running' | 'completed' | 'error';
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
    summary?: string;
    logs: Array<{ id: string; time: number; title: string; detail: string }>;
  }>;
  toolCalls: Array<{
    id: string;
    time: number;
    actorId: string;
    kind: 'tool' | 'skill' | 'agent' | 'command';
    name: string;
    commandText?: string;
    inputSummary?: string;
    outputSummary?: string;
    durationMs?: number;
    status: 'success' | 'error';
  }>;
  llmTrace: Array<{
    id: string;
    time: number;
    actorId: string;
    provider?: string;
    model?: string;
    requestSummary?: string;
    responseSummary?: string;
    requestRaw?: string;
    responseRaw?: string;
    promptTokens?: number;
    completionTokens?: number;
    durationMs?: number;
  }>;
  contexts: Array<{
    actorId: string;
    summary: string;
    refs?: Array<{ type: 'file' | 'session' | 'message'; label: string; value: string }>;
    raw?: string;
  }>;
  speechFeed?: Array<{
    id: string;
    actorId: string;
    type: 'plan' | 'command' | 'skill' | 'dispatch' | 'summary';
    text: string;
    time: number;
    runId?: string;
    skillName?: string;
    commandText?: string;
  }>;
};
```

## 9.5 重数据处理原则

细节面板里会出现大量原始数据，必须遵守以下原则：

- 默认先展示摘要，不默认展开全部原文
- 原始上下文按需加载
- 大文本分页或折叠
- API 密钥、Cookie、敏感 token 必须脱敏
- IM 原文导出前需要二次确认

## 9.6 新增接口建议

- `GET /api/town/runs/:id/details`
  - 返回任务详情观察台所需数据
- `GET /api/town/runs/:id/details/section?name=llmTrace`
  - 可选，分段懒加载

首版也可以只做：

- `GET /api/town/runs/:id/details`

但实现上仍建议后端预留分段加载能力。

## 9.7 存储建议

建议将原始 trace 从 `town_state.json` 中拆出，单 run 存储。

推荐目录结构：

- `data/town_state.json`
- `data/town_runs/<runId>/summary.json`
- `data/town_runs/<runId>/replay.jsonl`
- `data/town_runs/<runId>/trace.jsonl`
- `data/town_runs/<runId>/artifacts.json`

## 9.8 保留策略

建议：

- `summary.json`
  - 长期保留
- `replay.jsonl`
  - 保留最近 `30` 天或最近 `500` 个 run
- `trace.jsonl`
  - 保留最近 `7-14` 天，支持压缩

## 10. 功能六：办公室内 IM 聊天框

## 10.1 目标

办公室聊天框要解决两个问题：

- 让 IM 来源任务不再像“后台触发的黑盒”
- 让用户在办公室就能看到 `OpenClaw(main)` 与外部会话的往来

## 10.2 会话绑定规则

办公室聊天框默认只聚焦一个会话线程。

优先级建议如下：

1. 若当前选中 run 且 `source=im`
   - 绑定该 run 的会话线程
2. 若当前选中 run 非 IM 来源
   - 显示最近活跃的 OpenClaw IM 会话
3. 若没有活跃 IM 会话
   - 显示空态提示

这样可以避免办公室里同时塞满多个聊天窗口。

## 10.3 UI 结构

聊天框建议放在办公室右下或侧栏底部，包含：

- 会话标题
  - 渠道名
  - 对话对象
  - 是否绑定当前 run
- 消息列表
  - 入站 / 出站消息
  - 时间
  - 消息状态
- 输入框
  - 回复内容
  - 发送按钮
- 快捷操作
  - 跳到完整消息页
  - 复制最近摘要
  - 绑定到当前 run

## 10.4 消息类型

聊天框首版只需支持：

- 文本消息
- 系统提示消息
- run 关联提示

后续再扩展：

- 文件
- 图片
- 快捷模板回复

## 10.5 数据结构建议

```ts
type TownIMConversation = {
  id: string;
  channel: string;
  title: string;
  peer?: string;
  runId?: string;
  unreadCount: number;
  updatedAt: number;
};

type TownIMMessage = {
  id: string;
  conversationId: string;
  runId?: string;
  direction: 'inbound' | 'outbound' | 'system';
  sender: string;
  text: string;
  time: number;
  status?: 'sent' | 'delivered' | 'failed';
};
```

## 10.6 新增接口建议

- `GET /api/town/im/conversations`
  - 获取会话列表与摘要
- `GET /api/town/im/conversations/:id/messages`
  - 拉取消息
- `POST /api/town/im/conversations/:id/reply`
  - 由 `OpenClaw(main)` 身份回复消息

如当前系统已有可复用消息发送接口，也可先由 Town 调用现有接口，再在 Town 层做绑定封装。

## 10.7 新增事件建议

- `openclaw.im.inbound`
- `openclaw.im.outbound`
- `openclaw.im.bound`
- `openclaw.im.reply_failed`

这些事件会被用于：

- 办公室聊天框实时刷新
- 公告栏“待回复消息”统计
- 任务详情观察台
- 回放中的 IM lane

## 11. Snapshot / API / 事件扩展总览

## 11.1 Snapshot 建议新增轻量字段

`GET /api/town/snapshot` 可新增以下轻量字段：

```ts
type TownSnapshot = {
  bulletin?: {
    generatedDate?: string;
    yesterdaySummary?: string;
    todaySummary?: string;
    generatedAt?: number;
  };
  npcs?: Array<{
    id: string;
    name: string;
    sceneId: 'mainTown';
    x: number;
    y: number;
    animation: string;
  }>;
  im?: {
    activeConversationId?: string;
    unreadCount?: number;
    latestSummary?: string;
  };
  liveActions?: Array<{
    actorId: string;
    sceneId: 'mainTown' | 'office';
    type: 'plan' | 'command' | 'skill' | 'dispatch' | 'summary';
    text: string;
    startedAt: number;
    expiresAt?: number;
    runId?: string;
  }>;
};
```

重数据不进 snapshot：

- replay keyframes
- detail trace
- 全量 IM 消息
- 全量公告正文

## 11.2 新增接口清单

建议新增：

- `GET /api/town/runs/:id/replay`
- `GET /api/town/runs/:id/details`
- `GET /api/town/runs/:id/plan`
- `GET /api/town/runs/:id/topology`
- `GET /api/town/bulletin`
- `POST /api/town/bulletin/rebuild`
- `GET /api/town/im/conversations`
- `GET /api/town/im/conversations/:id/messages`
- `POST /api/town/im/conversations/:id/reply`

## 11.3 新增事件清单

建议新增事件类型：

- `openclaw.run.plan.started`
- `openclaw.run.plan.ready`
- `openclaw.agent.considered`
- `openclaw.agent.selected`
- `openclaw.agent.rejected`
- `openclaw.subtask.created`
- `openclaw.subtask.assigned`
- `openclaw.subtask.completed`
- `openclaw.subtask.started`
- `openclaw.subtask.waiting`
- `openclaw.run.plan.step`
- `openclaw.run.execution.mode`
- `openclaw.run.summary.generated`
- `openclaw.command.started`
- `openclaw.command.completed`
- `openclaw.tool.called`
- `openclaw.skill.started`
- `openclaw.skill.completed`
- `openclaw.skill.used`
- `openclaw.model.requested`
- `openclaw.model.responded`
- `openclaw.im.inbound`
- `openclaw.im.outbound`
- `town.actor.bubble`
- `town.bulletin.generated`

## 12. 实现建议

## 12.1 后端

后端建议拆为 4 个子能力：

1. `run trace capture`
   - 负责记录回放关键帧与原始 trace
2. `coordination planner summary`
   - 负责存储规划结果与选人理由
3. `execution topology + command trace capture`
   - 负责记录并行/串行拓扑、Agent 时长、命令与 skill 调用
4. `live bubble emitter`
   - 负责把关键动作转换成小人实时聊天水泡
5. `bulletin generator`
   - 负责每日生成公告
6. `im conversation bridge`
   - 负责 Town 与现有消息系统衔接

## 12.2 前端

前端建议新增组件：

- `TownBulletinBoard`
- `TownBulletinModal`
- `TownNPCBubble`
- `TownRunReplayModal`
- `TownRunReplayTimeline`
- `TownRunInspectorDrawer`
- `TownIMChatPanel`
- `TownCoordinationCard`
- `TownRunTopologyPanel`
- `TownLiveSpeechBubbleLayer`

## 12.3 性能要求

- Town 首屏仍以 snapshot 为主，不能因 V2 新功能明显变慢。
- 任务详情使用惰性加载。
- 回放使用关键帧，不直接渲染原始 trace。
- 聊天消息列表分页加载，避免一次性拉太多。
- 公告栏摘要可进入 snapshot，但完整正文单独拉取。

## 12.4 安全与脱敏

以下内容默认需要脱敏或谨慎展示：

- 大模型 API 请求原文
- Headers / token / cookies
- Agent 原始上下文中的敏感文件路径或密钥
- IM 会话中的敏感个人信息

建议规则：

- 默认显示摘要
- 原文需显式展开
- 导出前再次确认

## 13. 分期建议

## 13.1 P0：强感知基础版

优先做：

- 公告栏
- 3 个 NPC
- 回放关键帧升级
- 办公室“编排中 + 为什么选他们”摘要
- 任务详情观察台基础版

P0 价值：

- 用户第一次就能明显感知 Town 变强了
- 能看、能懂、能复盘

## 13.2 P1：深细节可观测版

再做：

- LLM Trace
- Tools / Skills 调用链
- 子任务耗时与上下文面板
- IM 聊天框读写闭环

P1 价值：

- 让高级用户与开发者真的能排障、复盘、解释

## 13.3 P2：传播与增强版

最后考虑：

- 回放导出
- 分享链接
- 视频录制/GIF
- NPC 节日台词
- 公告栏更多外部源接入

## 14. 验收标准

## 14.1 回放

- 用户能看到单 run 的阶段推进
- 用户能分辨本轮是并行、串行还是混合执行
- 用户能识别关键协作节点
- 用户能看到每个 Agent 或子任务的运行时长
- 回放期间实时刷新冻结
- 退出回放后恢复实时态

## 14.2 NPC

- 主镇固定可见 3 个 NPC
- 点击能弹出冷笑话
- 有基础冷却与去重

## 14.3 公告栏

- 每日能自动生成昨日战报与今日工作面板
- 未接入外部数据时有明确降级文案
- 公告栏支持手动刷新

## 14.4 自动拆任务与解释

- 发起任务后能看到 `OpenClaw(main)` 进入编排阶段
- 用户能看到 plan 原文或结构化步骤
- 至少能展示选中 Agent 的理由
- 能解释为什么采用并行或串行调度
- 有能力时展示未选中原因

## 14.5 任务详情观察台

- 用户能查看 OpenClaw 日志、Agent 日志、子任务耗时、调用链
- 用户能查看执行命令、skills 调用和对应耗时
- 原始重数据默认不一股脑展开
- 敏感信息被脱敏

## 14.6 场景实时聊天水泡

- 场景中能实时显示 `OpenClaw(main)` 或 Agent 的关键动作水泡
- 水泡至少支持：
  - plan
  - dispatch
  - command
  - skill
  - summary
- 回放模式与实时模式都能看到对应的动作提示
## 14.7 办公室 IM 聊天框

- IM 来源任务时能看到对应会话
- 能收消息、看消息、发回复
- 能跳到完整消息页

## 15. 低风险待确认项

以下问题不影响文档落地，但建议后续确认：

- “过了 12 点”是否确定为 `00:05`，还是希望按中午 `12:05` 生成？
- 办公室聊天框是否需要首版就支持发送文件？
- `LLM Trace` 是否允许默认展示原文，还是只展示摘要？
- 公告栏中的“今日工作面板”是否要接入外部日历/待办，还是先只做 Town 内部推断？

## 16. 结论

V2 的关键不是单独堆一个功能，而是围绕 3 条主线形成闭环：

- `可看懂`
  - 回放、公告栏、NPC、编排过程
- `可解释`
  - 选人理由、任务拆解、工具链、模型调用
- `可操作`
  - 办公室 IM 聊天、任务详情、继续跟进

只要按这个方向推进，Town 会从“协作观测皮肤”升级为“真正让人愿意每天打开的 AI 工作小镇”。
