# AI 小镇 V3 设计稿

## 0. 跨项目复现前置设计

这一节不是概念说明，而是给另一个 `ClawPanel` 项目直接复现 `/town` 用的前置规格。

如果另一个项目只读这一节，也应能做出和当前版本语义一致、交互一致、接口边界一致的 `AI 小镇` 页面。

### 0.1 交付目标

需要复现的不是“一个像素风页面”，而是一个挂在 `ClawPanel` 里的 `OpenClaw` 协作观测页：

- 路由固定为 `/town`
- 页面固定为 `主镇 + 办公室` 两个场景
- 页面固定保留：
  - 左侧主场景
  - 右侧信息与操作栏
  - `Agent 列表` 抽屉
  - `任务日志` 弹窗
- 数据固定优先来自 `OpenClaw + ClawPanel` 真实接口
- 页面允许退化到演示态，但必须明确标识是 `fallback/demo`

### 0.2 必须保持不变的产品边界

另一个项目在重写时，必须保持以下约束不变：

- `AI 小镇` 是 `OpenClaw` 的可视化皮肤，不是新的 Agent 系统
- `Town` 不能自己定义另一套真实任务、真实成员、真实 session 关系
- `OpenClaw(main)` 在视觉上必须是可见的单一主控角色
- 页面只保留两个核心场景：
  - `mainTown`
  - `office`
- 主镇最多展示 `6` 个可见 Agent
- 手动加入办公室待命的 Agent 上限是 `10`
- 即使 `0` 个成员被手动选中，也允许由 `OpenClaw(main)` 单独发起任务
- 办公室始终是一个共享大厅，不是一任务一房间
- 同一个 Agent 允许在多个主任务中以多个 `instance` 分身同时出现

### 0.3 路由、权限、开关和运行模式

跨项目复现时，建议保留同样的入口与运行方式：

- 路由：`/town`
- 权限：沿用 `ClawPanel` 管理员登录态，Bearer token 与现有面板一致
- 功能开关：沿用 `townV3Enabled`
- WebSocket：沿用面板现有 `/ws?token=...`
- 快照刷新：前台每 `8s` 拉取一次 `snapshot`
- 场景环境动画：每 `2.4s` 推进一次本地环境帧
- 日志回放模式开启时，实时刷新必须冻结

Town 页面必须支持三种运行模式：

- `api`
  - 正常接真实接口
- `fallback`
  - snapshot 拉取失败后退回演示态或最后一份可用状态
- `disabled`
  - 服务端返回 `town.disabled` 时，页面显示不可用提示，而不是空白页或 404

### 0.4 页面结构必须长什么样

无论视觉是否重画，结构建议保持一致：

- 页面外层：像素风标题条 + 内容容器
- 左侧：场景区
  - `主镇` 或 `办公室`
- 左上叠层：`HUD`
  - 时间
  - 天气
  - 当前办公室成员数
  - 当前运行中任务数
- 右侧边栏：
  - 在主镇时显示：
    - 已选成员
    - 技能汇总
    - `去办公室`
  - 在办公室时显示：
    - 办公室成员
    - 办公室技能汇总
    - 任务输入框
    - `开始协作`
    - `任务日志`
- 浮层：
  - `Agent 列表` 抽屉
  - `任务日志` 弹窗

这一层结构建议不要改成：

- 全屏大地图无侧栏
- 纯后台表格页
- 多标签后台页
- 一堆常驻大卡片把场景挤没

### 0.5 必须复现的核心组件

建议在另一个项目里仍按下面的职责拆组件：

- `Town`
  - 页面总控、拉取 snapshot、接 WebSocket、管理抽屉和弹窗
- `TownScene`
  - 场景外框、标题条、像素边框、左右 overlay 容器
- `MainTownScene`
  - 主镇背景、建筑、主镇成员、主镇入口按钮
- `OfficeScene`
  - 办公室分区、主控位、忙碌分身、待命成员、回主镇入口
- `TownHUD`
  - 时间、天气、人数、任务数
- `TownAgentDrawer`
  - 搜索全部 Agent、勾选/移出成员、跳到完整配置台
- `TownTaskLogModal`
  - run 列表、时间线、spawned session、日志回放

建议保留“页面容器”和“场景组件”分离的结构。不要把所有逻辑都塞进一个大页面文件里。

### 0.6 必须对齐的后端 API 契约

另一个项目如果想复现同样功能，最小接口集至少要有：

```text
GET  /api/town/snapshot
PUT  /api/town/office-members
POST /api/town/runs
GET  /api/town/runs/:id/logs
POST /api/town/agents/:id/reset
```

其中 `GET /api/town/snapshot` 必须一次性返回页面主渲染所需的完整快照，避免前端自己拼大量 N+1 请求。

最小快照字段建议固定为：

```ts
type TownSnapshot = {
  clock: string;
  weather: string;
  version: number;
  sync: {
    mode: 'approximate';
    busyWindowSeconds: number;
    stateDebounceSeconds: number;
    completedWindowSeconds: number;
  };
  openclaw: {
    agentId: string;
    name: string;
  };
  maxSelectableAgents: number;
  officeMembers: Record<string, 'selected' | 'auto_added'>;
  agents: TownSnapshotAgent[];
  visibleTownAgentIds: string[];
  events: TownSnapshotEvent[];
  logs: TownSnapshotLog[];
  runs: TownSnapshotRun[];
  instances: TownSnapshotInstance[];
};
```

成员池写接口建议支持乐观并发版本控制：

```ts
type UpdateTownOfficeMembersRequest = {
  agentId?: string;
  membership?: 'unselected' | 'selected' | 'auto_added';
  members?: Array<{
    agentId: string;
    membership: 'unselected' | 'selected' | 'auto_added';
  }>;
  expectedVersion?: number;
};
```

任务发起接口最小请求体：

```ts
type CreateTownRunRequest = {
  title?: string;
  prompt: string;
  source?: 'manual' | 'im';
  selectedAgents?: string[];
};
```

日志接口最小要求：

- 能按 `runId` 返回时间线
- 能返回主任务日志和 `spawned session` 相关日志
- 日志条目必须带稳定 `id` 和时间字段，便于回放

Agent 急救接口最小请求体：

```ts
type ResetTownAgentRequest = {
  keepInOffice?: boolean;
};
```

### 0.7 必须对齐的前端状态命名

为了让不同项目之间的语义保持一致，建议直接复用当前命名，不要再发明一套新词：

```ts
type TownSceneId = 'mainTown' | 'office';
type TownOfficeMembership = 'unselected' | 'selected' | 'auto_added';
type TownExecutionState = 'idle' | 'standby' | 'busy' | 'completed' | 'error';
type TownSessionRole = 'none' | 'primary' | 'spawned';
type TownRunStatus = 'running' | 'completed' | 'error';
type TownRunSource = 'manual' | 'im';
type TownZoneState = 'running' | 'fading';
type TownAgentInstanceStatus = 'thinking' | 'executing' | 'completed' | 'error';
```

其中有三层语义不能混：

- `TownAgent`
  - 真实 Agent 配置本体
- `TownRun`
  - 一次主任务运行
- `TownAgentInstance`
  - 某个 Agent 在某个 run 里的可视化分身

如果改掉这套命名，另一个项目很容易又回到“一个角色只对应一个任务态”的错误模型。

### 0.8 页面行为和状态推进规则

另一个项目要复现“同样的功能效果”，至少要遵守这些交互规则：

#### 主镇

- 只展示 `visibleTownAgentIds` 指定的可见成员
- 已在办公室中的 Agent 不应继续出现在主镇
- 点击角色或列表项可加入办公室成员池
- 主镇右侧只做“选人准备”，不做任务输入

#### 办公室

- 永远有 `OpenClaw(main)` 主控位
- 选中的成员和自动加入成员都在办公室里可见
- 运行中的任务按 `run` 生成分区
- 同一 Agent 若参与多个运行中任务，可出现多个分身
- 没选人也允许直接提交任务

#### 任务发起

- 点击 `开始协作` 后，必须调用真实后端接口
- 任务开始后：
  - 页面锁住重复提交
  - 新 run 立即出现在办公室
  - 相关 Agent 进入忙碌或思考态
- 任务失败时，要有明确错误提示，且不能把失败伪装成完成

#### 实时同步

- WebSocket 只负责触发刷新，不要求前端直接在浏览器里重建全部运行态
- 收到关键事件后，前端可做一次 `900ms` 内合并刷新的 debounce
- snapshot 才是最终一致的主数据

#### 回放模式

- 打开某个 run 的日志回放后：
  - 实时刷新冻结
  - 时间线可拖动 frame
  - 退出回放后恢复实时模式

#### IM 自动任务

- 如果 run 来源是 `im`
  - 页面只显示轻提示
  - 不强制跳转办公室
  - 进入办公室后仍能看到它对应的 run 和成员变化

### 0.9 视觉复现规则

如果另一个项目希望做出“同样观感”，视觉上建议遵守这些规则：

- 整页不是后台卡片墙，而是“场景 + 右侧控制栏”
- 主镇像“选择协作组的村镇广场”
- 办公室像“多任务并行执行现场”
- `OpenClaw(main)` 必须视觉上比普通成员更像主控角色
- 状态优先级高于装饰优先级
- 主按钮尽量少，避免把像素场景重新做成传统后台

如果要从“代码绘制”升级成“图片驱动”，建议直接采用下面的素材结构：

- 背景图：
  - `town-main-bg.png`
  - `town-office-bg.png`
- 角色透明图：
  - 每个 Agent 至少一张透明底 `png`
- 面板素材：
  - `panel-frame.png`
  - `button.png`
  - `nameplate.png`

也就是说，跨项目复现时，功能层和视觉层应该解耦：

- 功能层：
  - 仍用 `snapshot + run + instance + event`
- 视觉层：
  - 可以继续用纯 CSS 像素风
  - 也可以替换成图片驱动渲染

### 0.10 Town 专属持久化要求

另一个项目不能把所有 Town 状态都塞进 `openclaw.json`。

Town 自己需要单独维护的状态至少包括：

- 办公室成员池
- 最近使用权重
- runs
- logs
- events
- instances
- 共享版本号

建议仍落到独立文件中，例如：

- `data/town_state.json`
- `data/town_office_audit.jsonl`

其中：

- `town_state.json`
  - 保存共享办公室状态和运行态快照
- `town_office_audit.jsonl`
  - 保存成员池变更审计记录

### 0.11 复现实施顺序

另一个项目建议按下面顺序做，不要一上来先画地图：

1. 先接路由、鉴权和 `/api/town/snapshot`
2. 先把统一 `TownState` 和 `TownViewState` 跑通
3. 先做主镇 / 办公室双场景切换
4. 再接成员池增删、最大选择数和版本冲突处理
5. 再接 `POST /api/town/runs` 和运行中状态
6. 再接 `GET /api/town/runs/:id/logs` 和回放
7. 最后再替换视觉素材、像素背景和人物 sprite

顺序反过来会导致页面“好看但没语义”。

### 0.12 跨项目验收清单

如果另一个项目要做到“基本等价复现”，至少要满足：

- `/town` 页面可以独立访问
- 登录态与主面板一致
- 主镇和办公室双场景都能切换
- 主镇可见 Agent 最多 `6` 个
- 手动选择上限是 `10`
- 可以 `0` 成员直接发起任务
- 办公室能同时展示多个主任务分区
- 同一 Agent 可出现多个 run 分身
- 有 `Agent 列表` 抽屉
- 有 `任务日志` 弹窗
- 日志支持回放并冻结实时刷新
- snapshot 失败时页面会退回 fallback，而不是直接崩

### 0.13 可直接复制给另一个项目或 AI 的描述模板

如果要把这页交给另一个开发者或 AI，建议直接用下面这段描述：

```text
请在另一个 ClawPanel 项目中重写 /town 页面，但不要把它做成独立产品。它必须是 OpenClaw 的可视化观测皮肤，而不是新的 Agent 系统。

页面固定保留两个场景：mainTown 和 office。主镇用于选择协作成员，办公室用于发起任务和观察多 Agent 协作。页面结构固定为：左侧像素场景，右侧信息与操作栏，外加 Agent 列表抽屉和任务日志弹窗。

所有真实数据优先来自 /api/town/snapshot、/api/town/office-members、/api/town/runs、/api/town/runs/:id/logs、/api/town/agents/:id/reset。前端必须维护统一 TownState，不允许在多个组件里散落维护另一套任务语义。保留以下状态命名：officeMembership、executionState、sessionRole、run、instance。允许同一个 Agent 在办公室里以多个 instance 分身同时参与多个 run。

产品边界必须保持：OpenClaw(main) 是唯一主控角色；主镇最多显示 6 个成员；手动选择成员上限 10 个；允许 0 成员时由 OpenClaw 单独执行；办公室是共享协作大厅，不是一任务一房间；实时同步以 snapshot 为主，WebSocket 仅触发刷新；日志回放期间必须冻结实时刷新。

视觉风格可以重画，但不能破坏页面语义。推荐做成像素村镇 + 办公工坊风格：主镇像协作组准备区，办公室像执行现场。状态优先于装饰，少按钮，少后台卡片，重点表现 OpenClaw 主控位、任务分区、忙碌成员、日志入口和成员池。
```

## 1. 定位

`AI 小镇` 不是独立产品，也不是新的 Agent 配置中心。

它的定位是：

- `OpenClaw` 的可视化皮肤
- `OpenClaw` 多 Agent 协作过程的网页观测层
- 在不改变 OpenClaw 真实配置与运行逻辑的前提下，提供更直观的游戏化界面

一句话定义：

`AI 小镇 = 完全按 OpenClaw 配置与运行时状态驱动的可视化观测页`

因此设计上必须遵守一个原则：

- 不能在前端重新发明一套独立的 Agent 系统
- 不能让 Town 自己维护一套与 OpenClaw 脱节的协作逻辑
- 不能为了“像游戏”而丢失对真实状态的映射

## 2. 设计目标

AI 小镇需要帮助用户完成 4 件事：

1. 看见当前 OpenClaw 有哪些 Agent，以及它们各自会什么
2. 看见当前谁在待命、谁在工作、谁刚完成
3. 看见 OpenClaw 如何创建主任务、如何拉起子 Agent 协作
4. 在必要时快速管理 Agent 的核心配置、技能、会话与记忆

## 3. 非目标

AI 小镇不负责：

- 取代 `智能体` 页面成为完整配置台
- 维护一套独立于 OpenClaw 的 Agent 定义
- 自己决定真实路由、真实委派、真实 session 结构
- 做大量与协作无关的小游戏功能

## 4. 核心原则

### 4.1 OpenClaw 是唯一主控

- 每个任务都由 `OpenClaw` 发起、接管或调度
- Agent 是 OpenClaw 可调用的协作成员，不是各自独立运转的主角
- Town 展示的是 `OpenClaw -> session -> spawned session -> Agent` 的关系

### 4.2 OpenClaw 是主要数据源

AI 小镇的真实数据优先来自：

- `openclaw.json`
- Agent workspace 下的核心文件
- skills / plugins 发现结果
- sessions 索引与会话内容
- OpenClaw 运行事件与日志

Town 自己只允许维护很少的“皮肤态”：

- 地图坐标
- 角色外观
- 主镇展示权重
- 办公室座位布局
- 动画状态缓存

也就是说：

- Agent 是谁、会什么、能不能委派、会话可见性如何，这些都应来自 OpenClaw
- 小人在地图上站哪里、走去哪个工位，这是 Town 自己的表现层

### 4.3 先真实映射，再做游戏包装

如果底层没有对应状态，就不要先造一个看起来很像的假状态。

例如：

- 如果后端暂时拿不到真实 `spawn` 关系，就不要在页面上伪造非常确定的“父子树”
- 如果还没有真实运行中状态，就明确标为“最近活跃”或“推测忙碌”，不要冒充强一致状态

### 4.4 尽量复用现有 ClawPanel 能力

当前项目后端是 `Go + Gin`，不是 Node.js。

因此不建议单独做一个 Node 后端再用 `child_process.spawn` 去包 OpenClaw。

更合理的方式是直接复用当前已有能力：

- 进程管理器
- `/api/events/log`
- `/api/openclaw/*`
- `/api/system/skills`
- `/api/sessions`
- WebSocket 推送

## 5. 数据源分层

## 5.1 OpenClaw 原生数据

这部分必须视为主数据源：

### Agent 配置

来源：

- `/api/openclaw/agents`
- `openclaw.json`

可得到：

- Agent 列表
- 默认 Agent
- bindings
- workspace / agentDir / model / tools / subagents 等配置
- 会话数量与最后活跃时间统计

其中需要特别统一一个语义：

- OpenClaw 在配置层通常对应默认主 Agent，也就是 `main`
- 在 AI 小镇的视觉层，不应把 `OpenClaw` 和 `main` 画成两个角色
- 应统一表现为一个固定的 `OpenClaw（main）管理者小人`

也就是说：

- 数据层仍然使用真实 `agentId = main`
- 页面文案显示为 `OpenClaw（main）`
- 主镇与办公室中都由它承担“主控 / 管理者 / 指挥者”的视觉角色

### 技能与插件

来源：

- `/api/system/skills`

可得到：

- 当前 Agent 生效的 skills
- 来源路径
- enabled 状态
- plugins 列表

### 核心文件

来源：

- `/api/openclaw/agents/:id/core-files`
- `/api/openclaw/agents/:id/core-files` `PUT`

当前已有能力适合读取和编辑：

- `AGENTS.md`
- `SOUL.md`
- `MEMORY.md`
- 其他被允许的核心文件

### 会话与记忆

来源：

- `/api/sessions`
- `/api/sessions/:id`

当前实现里，会话主要来自 `sessions.json` 和 `*.jsonl`，不是必须假设成 SQLite。

因此 Town 的“记忆查看”设计应基于：

- 会话索引
- 最近消息
- 事件日志

而不是先假设底层一定是数据库。

### 事件日志

来源：

- `/api/events`
- `/api/events/log`
- WebSocket 广播

当前已经有基础事件总线，可以作为 Town 实时联动的第一层数据来源。

## 5.2 Town 自己维护的皮肤态

Town 只维护以下衍生数据：

- 主镇可见角色池
- 最近使用权重缓存
- 办公室座位和寻路节点
- 角色当前像素动画帧
- 泡泡文案和动效

这些状态都不应该反向污染 OpenClaw 配置。

## 5.3 Town 专属状态

有两类状态不是 OpenClaw 原生概念，但 Town 仍然需要：

### 办公室成员池

这个概念用于表达：

- 哪些 Agent 被用户“带进办公室待命”
- 哪些 Agent 是 IM 自动任务时被 OpenClaw 临时拉进来的

建议将这类状态保存在 ClawPanel 自己的数据文件中，例如：

- `data/town_state.json`

而不是写进 `openclaw.json`。

原因：

- 它是 UI/观测态，不属于 OpenClaw 官方配置
- 不应该影响 OpenClaw 在 CLI 或其他入口下的行为

办公室成员池还应被定义为：

- 全局共享状态
- 不是某个管理员单独的本地视图

也就是说：

- 任一管理员把 Agent 带进办公室后，其他管理员进入 Town 时也应看到同样的办公室成员池
- IM 自动拉入的 Agent 也应写入同一份全局办公室状态

### 地图显示偏好

例如：

- 哪些角色在主镇展示
- 用户最后停留在哪个场景
- 是否折叠某些面板

同样应属于 Town UI 状态，而不是 OpenClaw 配置。

## 6. 页面信息架构

新版只保留两个核心场景：

1. 主镇
2. 办公室

## 6.1 主镇

主镇负责：

- 展示像素小镇视觉
- 展示少量常用 Agent 与装饰 NPC
- 展示 OpenClaw 当前总体状态
- 提供 `Agent 列表` 入口
- 提供 `去办公室` 入口

主镇不负责：

- 长日志阅读
- 复杂配置编辑
- 会话详情主阅读
- 任务输入

### 主镇角色显示规则

- 最多显示 `6` 个角色
- 使用“完全随机，但对最近使用 Agent 提高权重”的抽样
- 已经进入办公室待命的 Agent 不再出现在主镇

### 主镇可见元素

- `OpenClaw` 指挥台
- 办公室入口
- 常用 Agent 小人
- 少量装饰角色
- 一个简洁的状态提示条

删除：

- 邮局
- 仓库
- 主镇任务板
- 心情 / 体力
- 复杂属性卡
- 手动移动十字键

## 6.2 办公室

办公室是执行现场。

办公室中固定展示：

- `OpenClaw（main）`
- 办公室待命成员
- 正在忙碌的成员
- 刚完成任务的成员
- 当前任务输入区
- 任务日志按钮

办公室的核心作用：

- 发起任务
- 观察协作
- 查看 session / spawned session / 日志

### 办公室场景模型

办公室始终只有一个场景，不做多个办公室地图实例。

但如果同时有多个主任务 `session` 在运行：

- 它们会在同一个办公室内并行展示
- 办公室内部按任务进行分区
- 每个分区对应一个正在运行的主任务

这意味着办公室更像：

- 共享协作大厅
- 多任务并行执行区

而不是一任务一房间。

### OpenClaw（main）的空闲表现

`OpenClaw（main）` 不是固定不动的雕像。

设计上应把它视为：

- 管理者小人
- 主控角色
- 空闲时会在办公室或主镇内自由移动

只有在真正发起或调度任务时，它才会明确回到主控位或对应任务分区。

### 办公室右侧栏原则

办公室右侧栏空间有限，因此不应长期堆叠很多常驻组件。

右侧栏应收缩为“控制条 + 按钮入口”。

建议只保留 3 类常驻内容：

#### 1. 顶部状态块

- `OpenClaw（main）`
- 当前运行中任务数
- 当前办公室成员数

#### 2. 任务输入块

- 简短任务输入框
- `开始协作` 按钮

#### 3. 功能按钮组

- `成员`
- `技能`
- `日志`

其余信息尽量通过按钮后打开抽屉或弹窗来承载，不常驻右栏。

适合改成弹窗 / 抽屉的内容：

- 办公室成员明细
- 办公室技能汇总
- 任务日志详情
- Agent 详情
- 记忆 / 急救

这样可以保证：

- 右侧栏足够清爽
- 主场景仍然是办公室画面本身
- 页面不会再次变成后台卡片堆叠

## 6.3 抽屉与弹窗

### Agent 列表抽屉

用途：

- 搜索全部 Agent
- 查看职责摘要
- 查看技能列表
- 查看是否已在办公室待命

### Agent 检视抽屉

用途：

- 查看 Agent 详情
- 快速编辑身份卡片
- 快速开关技能
- 查看最近会话和记忆

注意：

- 这是“轻量编辑入口”
- 不能替代 `智能体` 页的完整配置台

### 任务日志弹窗

用途：

- 展示一个主任务对应的执行日志
- 展示它拉起的子 Agent
- 展示当前状态时间线

### 记忆 / 急救弹窗

用途：

- 查看最近会话上下文
- 删除异常会话
- 手动恢复 Agent 到正常状态

## 7. 功能设计

## 7.1 功能一：看看有哪些 Agent 在工作

这是 AI 小镇最重要的功能。

目标：

- 用户一眼看见谁在工作
- 用户能看懂这些工作是 OpenClaw 自己做的，还是调用子 Agent 做的

### 后端设计

不要使用“前端轮询 stdout”的方式。

建议方案：

1. OpenClaw 运行日志和关键行为先进入 ClawPanel 后端
2. 后端把原始日志归一化为 Town 可用事件
3. Town 前端只消费结构化事件

推荐事件类型：

- `openclaw.run.started`
- `openclaw.run.completed`
- `openclaw.run.failed`
- `openclaw.session.started`
- `openclaw.session.completed`
- `openclaw.session.spawned`
- `openclaw.agent.enter_office`
- `openclaw.agent.leave_office`
- `openclaw.agent.busy`
- `openclaw.agent.idle`
- `openclaw.im.received`

当前项目里已经有：

- `/api/events/log`
- `/api/events`
- WebSocket 广播

因此第一阶段可以先基于现有事件总线做映射，而不是另起一套通道。

### 前端设计

前端维护统一的 `TownSnapshot`，而不是散落的页面局部状态。

每个 Agent 至少要有两类状态：

- `presence`
  - `town`
  - `office`
- `execution`
  - `idle`
  - `standby`
  - `thinking`
  - `executing`
  - `completed`
  - `error`

### 小镇表现

当监听到 Agent 状态变化时，映射为明确动画：

- `idle`
  - 在主镇闲逛或站立
- `standby`
  - 在办公室工位附近待命
- `thinking`
  - 从主镇走进办公室，头顶出现思考泡泡
- `executing`
  - 坐到工位，出现敲键盘或忙碌动画
- `completed`
  - 在办公室短暂停留，状态条显示完成
- `error`

第一阶段允许使用近似判定：

- 事件流
- session 最近更新时间

来推断：

- 谁在忙碌
- 谁刚完成
- 哪个任务最近活跃

但在文案和实现上要明确这是“运行时近似同步”，不是绝对强一致。
  - 显示告警色或卡顿图标

关键点：

- 动画只是状态的表现层
- 真正的状态来源仍是后端结构化事件

## 7.2 功能二：修改与管理 Agent

这里需要控制边界。

AI 小镇可以提供“沉浸式轻编辑”，但不能再造一套与现有配置台冲突的管理方式。

建议拆成三层：

### 第一层：只读卡片

在主镇或办公室点击 Agent，可看到：

- 名称
- 职责摘要
- 模型
- 工作目录
- skills
- 当前协作权限摘要

### 第二层：轻量编辑

只编辑最适合游戏化表达的内容：

- `AGENTS.md`
- `SOUL.md`
- `MEMORY.md`
- skills enabled 状态

### 第三层：跳转到完整配置台

复杂配置仍跳转到 `智能体` 页面处理，例如：

- bindings
- sandbox
- tools.agentToAgent
- subagents.allowAgents
- routing context

这样 Town 不会再次变成后台堆叠页。

## 7.3 身份卡片编辑器

你的思路可以保留，但建议适配当前项目的已有能力。

### 不建议的做法

- 直接在新接口里手搓读写 `~/.openclaw/agents/*` 的任意文件
- 让 Town 自己绕过现有安全校验去写文件

### 建议的做法

复用当前已有接口：

- `GET /api/openclaw/agents/:id/core-files`
- `PUT /api/openclaw/agents/:id/core-files`

编辑器分为两个面板：

- 左侧：职业与人设
  - 对应 `AGENTS.md`
- 右侧：性格与口癖
  - 对应 `SOUL.md`

如果 `MEMORY.md` 存在，则在下方作为“长期记忆”折叠区显示。

### 保存逻辑

1. 前端提交结构化表单
2. Town 前端把结构化内容映射为 Markdown 文本
3. 调用现有 `core-files` 保存接口
4. 保存后提示“已写回 Agent 核心文件”

### 热重载策略

不要默认实现成“保存后立即强杀 Agent 再重启”。

优先顺序建议：

1. 先只写文件并提示“新任务会使用新配置”
2. 如果 OpenClaw 未来提供 reload 能力，再加“热重载”按钮
3. 只有在明确需要时，才做强制 restart

## 7.4 技能商店与开关

你的建议是对的，但数据源不该写死在 YAML frontmatter。

当前项目已有真实技能来源：

- `/api/system/skills`
- `/api/system/skills/:id/toggle`

因此建议这样做：

### 前端展示

- 在 Agent 检视抽屉中展示 skills 列表
- 按来源分组：
  - workspace
  - global-agent
  - plugin-skill
  - managed
  - installed

### 交互形式

- 用 `Switch` 或像素风拨杆表示 `enabled / disabled`
- 每个技能显示：
  - 名称
  - 描述
  - 来源
  - 是否生效

### 后端交互

优先复用现有接口：

- `GET /api/system/skills?agentId=:id`
- `PUT /api/system/skills/:id/toggle`

如果需要做“按 Agent 切换某个 skill”的精确控制，再新增更窄的接口，但应沿用当前 `openclaw.json skills.entries` 结构，而不是重新创造一套 `skills:` frontmatter 标准。

## 7.5 记忆与会话管理

这是 AI 小镇里非常有价值的“急救大师”功能，但实现要贴近当前真实数据。

### 查看短期记忆

建议不要叫“数据库内存查看”，而叫：

- 最近会话
- 最近上下文
- 短期记忆

来源：

- `/api/sessions?agent=:id`
- `/api/sessions/:id?agent=:id`
- `/api/events?source=openclaw`

前端展示形式：

- 类似聊天记录时间线
- 支持只看最近 20 条
- 支持过滤：
  - 用户消息
  - assistant 回复
  - system / tool / spawn 事件

### 会话急救

建议拆成三档，而不是默认 `kill -9`：

#### 轻量清理

- 删除某个异常 session
- 清空最近会话上下文

可优先复用：

- `DELETE /api/sessions/:id?agent=:id`

#### 中度恢复

- 结束当前任务
- 把 Agent 状态从 `busy` 恢复到 `standby`
- 保留办公室成员身份

这需要新增 Town 运行态接口。

#### 重度重置

- 清理异常 session
- 如有必要重启 OpenClaw 进程或该 Agent 对应的运行实例

不建议直接把 `kill -9` 暴露成默认按钮。

更合适的产品文案是：

- `重置运行态`
- `清理异常会话`
- `强制恢复`

只有在最后一级确认弹窗里，才说明可能涉及强制终止进程。

### 小镇表现

当发生重置时：

- 小人从忙碌工位回到办公室待命区
- 如果是完全移出办公室，则传送回主镇
- 可以加一次短暂“断电重启”动效

## 7.6 OpenClaw 与子 Agent 的协作可视化

这是 Town 是否“像 OpenClaw 皮肤”的关键。

Town 必须明确区分：

- 主任务
- 子任务
- 成员池
- 活跃执行者
- Agent 配置本体
- Agent 运行分身

### 推荐数据模型

```ts
type TownRun = {
  id: string;
  source: 'manual' | 'im' | 'workflow' | 'external';
  status: 'queued' | 'running' | 'completed' | 'failed';
  ownerAgentId: 'openclaw';
  title: string;
  startedAt: string;
  endedAt?: string;
  primarySessionId?: string;
  spawnedSessions: TownSpawnedSession[];
};

type TownSpawnedSession = {
  id: string;
  parentRunId: string;
  parentSessionId?: string;
  sessionId?: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed';
  reason?: string;
};
```

为了支持“同一个 Agent 同时参与多个活跃主任务”，还需要引入运行分身概念：

```ts
type TownAgentInstance = {
  id: string;
  agentId: string;
  runId: string;
  sessionId?: string;
  zoneId: string;
  status: 'thinking' | 'executing' | 'completed' | 'error';
};
```

这里要明确两层：

- `TownAgent`
  - 表示真实 Agent 配置本体
- `TownAgentInstance`
  - 表示这个 Agent 在某个运行中的任务里产生的可视化分身

因此设计上允许：

- 一个 Agent 配置只有一份
- 但同一时刻在办公室内出现多个运行分身
- 每个分身分别属于不同主任务分区

这样才能正确表达：

- 同一个 Agent 同时参与多个活跃主任务
- 并且每个任务里都能看见它的“工作状态”

### 页面表现

- OpenClaw 自己执行时：
  - 办公室只看到 OpenClaw 忙碌
- OpenClaw 调子 Agent 时：
  - 对应 Agent 进入忙碌态
  - 日志弹窗展示 `spawned session`
- IM 自动任务时：
  - 页面右上角出现轻提示
  - 不强制跳转
  - 用户进入办公室后可看到被自动拉入的 Agent
- 如果同一个 Agent 同时参与多个主任务：
  - 办公室内会出现多个该 Agent 的分身
  - 每个分身绑定各自任务分区与 run/session

## 8. 后端架构建议

## 8.1 不建议方案

- 新做 Node 后端
- 靠 `child_process.spawn` 直接管理 OpenClaw
- 前端直接解析 stdout

这和当前项目技术栈冲突，也会造成重复进程管理。

## 8.2 建议方案

继续沿用当前 Go 后端，在其上新增 Town 聚合层。

### 推荐新增接口

#### `GET /api/town/snapshot`

返回 Town 首页渲染所需的完整快照：

- OpenClaw 总状态
- Agent 列表
- skills 摘要
- 办公室成员池
- 当前运行中的 runs
- 最近事件
- 主镇展示角色
- 全局办公室成员池
- 办公室分区状态
- Agent 分身实例

#### `PUT /api/town/office-members`

写入 Town 自己的办公室成员池状态：

- 手动选中
- 手动取消选中
- 是否固定待命

这部分是 Town 专属状态，不属于 OpenClaw 官方配置。

#### `POST /api/town/runs`

表示“在办公室里由 OpenClaw 发起一个任务”。

它的作用不是自己执行任务，而是：

1. 把用户输入转给 OpenClaw 正常入口
2. 记录一个可被 Town 观测的 run
3. 建立 Town 和真实 session 的映射

这是 Town 专用桥接接口，允许 ClawPanel 负责：

- 接收办公室里的任务输入
- 转给 OpenClaw
- 再将后续 session 与事件回灌给 Town

#### `GET /api/town/runs/:id/logs`

返回某个 run 的时间线：

- 主 session
- spawned sessions
- 关键事件

#### `POST /api/town/agents/:id/reset`

用于急救恢复：

- 清理异常 session
- 解除忙碌状态
- 可选触发运行时重置

### 推荐事件

Town 最终应基于 WebSocket 或统一事件流实时同步，事件至少包括：

- `town.snapshot.updated`
- `openclaw.run.started`
- `openclaw.run.completed`
- `openclaw.session.spawned`
- `openclaw.agent.status.changed`
- `openclaw.agent.auto_added`
- `openclaw.agent.reset`

## 8.3 后端聚合器职责

需要一个 Town 聚合器，把现有分散数据整合成 Town 可消费的结构：

- `/openclaw/agents`
- `/system/skills`
- `/sessions`
- `/events`
- 办公室成员池持久化文件

Town 前端不应自己拼很多 N+1 请求去构造世界状态。

## 9. 前端状态设计

建议 Town 前端只维护一个统一快照：

```ts
type TownSnapshot = {
  openclaw: {
    status: 'online' | 'offline' | 'busy' | 'degraded';
    activeRunCount: number;
  };
  agents: TownAgent[];
  office: {
    memberIds: string[];
    autoAddedIds: string[];
    zones: TownZone[];
  };
  runs: TownRun[];
  instances: TownAgentInstance[];
  recentEvents: TownEvent[];
  visibleTownAgentIds: string[];
};
```

其中：

- `agents` 的真实能力来自 OpenClaw
- `office` 属于 Town 自己的观测态
- `runs` 用来桥接真实任务与前端表现
- `instances` 用来表达一个 Agent 在多个任务中的分身状态

其中 `TownZone` 表示办公室内的任务分区。

## 10. 视觉设计方向

## 10.1 主镇

主镇要像“观测总览”而不是“地图编辑器”。

视觉重点：

- 像素风保留
- 视野干净
- 少按钮
- 强状态

主按钮只保留：

- `Agent 列表`
- `去办公室`

## 10.2 办公室

办公室要像“执行现场”。

应重点突出：

- OpenClaw（main）主控位
- 办公室分区
- 工位上的忙碌成员
- 当前任务输入区
- 任务日志按钮

不应该出现：

- 大量后台统计卡
- 无关建筑功能
- 与协作无关的养成属性

办公室右侧栏的视觉策略应是：

- 少量常驻信息
- 大部分能力通过像素风按钮打开弹窗
- 让用户视线优先落在办公室内的角色状态，而不是右侧卡片墙

## 10.3 动效原则

- 只在状态变化时动
- 不做常驻无意义动画
- 每个动效都必须对应一个真实事件

例如：

- 进入办公室
- 开始思考
- 开始执行
- 完成任务
- 重置恢复
- OpenClaw 空闲巡逻
- Agent 分身进入不同任务分区

## 11. 分阶段实施建议

## Phase 1：完全配置驱动

目标：

- Town 不再使用 mock Agent 数据
- Agent、skills、基本会话信息全部改为真实接口驱动
- 支持轻量编辑与会话清理
- 使用事件 + session 更新时间做第一阶段运行状态近似

交付：

- 主镇和办公室接上真实 Agent 列表
- Agent 抽屉支持真实搜索
- 技能展示来自 `/api/system/skills`
- 身份卡片读取来自 `core-files`
- 支持编辑 `AGENTS.md / SOUL.md / MEMORY.md`
- 支持 skills 开关
- 支持 session 清理
- 可视化显示协作权限摘要

## Phase 2：运行时同步

目标：

- Town 能看到谁在工作

交付：

- 新增 `town snapshot` 聚合接口
- 接入事件总线
- 办公室状态由真实事件驱动
- IM 自动任务有轻提示
- 单办公室多任务并行分区
- Agent 分身实例同步

## Phase 3：高保真协作可视化

目标：

- 把 OpenClaw 多 Agent 协作过程更准确地映射到游戏页面

交付：

- run 与 session 图谱
- spawned session 关系线
- 自动拉入 Agent 动画
- 更细粒度的日志和状态气泡
- 更准确的多任务分区与分身调度表现

## 12. 需要补充的关键后端能力

为了让 Town 真正变成 OpenClaw 皮肤，还需要补以下能力：

1. Town 聚合快照接口
2. Town 专属办公室成员池持久化
3. 真实任务启动到 OpenClaw 的桥接入口
4. 更细粒度的运行时事件
5. 更丰富的 session 元数据
6. Agent 重置与异常恢复接口
7. 办公室分区与 Agent 分身实例的后端快照字段

## 13. 验收标准

以下条件满足时，可认为这版设计达标：

1. Town 中的 Agent 列表、skills、基础资料都来自真实 OpenClaw 配置
2. Town 不再维护一套独立的 Agent 定义
3. 用户能看见 OpenClaw 和子 Agent 的真实工作状态变化
4. 用户能在 Town 里完成轻量编辑，但复杂配置仍回到 `智能体` 页面
5. IM 自动任务能被 Town 非打断式地观察到
6. Town 的动画和像素风只是状态表现层，不会替代真实协作语义
7. 单办公室内可以并行展示多个主任务，并用分区表达任务边界
8. 同一个 Agent 可在多个任务中以多个分身实例出现

## 14. 一句话结论

AI 小镇最正确的方向不是“再做一个有趣的小游戏”，而是：

`把 OpenClaw 现有的配置、会话、日志、委派和运行状态，包装成一个用户能看懂、能观察、能轻量管理的像素世界。`

## 15. 当前已实现功能盘点

基于当前 `/town` 已实现页面，这一版其实已经具备了不少可复用的骨架，不需要推倒重来。

当前已经实现的内容主要有：

### 页面结构

- 已经有 `主镇 / 办公室` 双场景切换
- 已经有像素风主视觉
- 已经有右侧信息栏
- 已经有 `Agent 列表` 抽屉
- 已经有 `任务日志` 弹窗

### 主镇侧

- 主镇里已经只保留了少量建筑和角色
- 主镇支持点击角色加入协作组
- 主镇右侧已经有：
  - 已选 Agent
  - 技能汇总
  - 去办公室按钮
- 主镇地图已支持“少量可见角色”的展示思路

### 办公室侧

- 办公室已经有 OpenClaw 主控位的视觉表达
- 办公室已经区分成员池和任务执行区
- 办公室右侧已经有：
  - 办公室成员
  - 办公室技能汇总
  - 任务输入框
  - 开始协作按钮
  - 任务日志按钮

### 状态模型

- 已有 `officeMembership`
  - `unselected`
  - `selected`
  - `auto_added`
- 已有 `executionState`
  - `idle`
  - `standby`
  - `busy`
  - `completed`
  - `error`
- 已有 `sessionRole`
  - `none`
  - `primary`
  - `spawned`

这套状态命名本身是合理的，后面应尽量保留，不要再换一套名词。

### 交互骨架

- 已支持最多 10 个 Agent 的手动选择
- 已支持搜索 Agent
- 已支持从办公室移出非忙碌成员
- 已支持“0 个 Agent，仅 OpenClaw 执行”
- 已有任务日志时间线和 spawned session 的基本展示框架

## 16. 建议保留的现有页面能力

如果目标是“尽量保留现有页面”，下面这些内容建议直接保留，只做数据源和语义调整：

### 16.1 保留整体页面骨架

保留：

- 顶部像素风标题区
- 左侧主场景 + 右侧信息栏的双栏结构
- `主镇 / 办公室` 两场景切换

原因：

- 这套结构已经能承载“准备区 + 执行区”的产品语义
- 不需要再重新设计一整套新布局

### 16.2 保留主镇场景

保留：

- 主镇地图
- OpenClaw 指挥点
- 办公室入口
- 少量常用 Agent 展示
- `Agent 列表`
- `去办公室`

原因：

- 当前主镇已经比较接近“选人入口页”
- 和新的 OpenClaw 驱动目标并不冲突

### 16.3 保留办公室场景

保留：

- OpenClaw（main）主控位
- 办公室工位
- 成员待命 / 忙碌展示
- 任务输入区
- 开始协作按钮
- 日志按钮

原因：

- 这已经是很适合做“执行现场”的视觉壳
- 主要问题不在页面，而在它还没接到真实数据

### 16.4 保留 Agent 列表抽屉

保留：

- 右侧抽屉形式
- 搜索框
- Agent 卡片
- 选中 / 移出按钮
- skills 标签

原因：

- 对几十到上百个 Agent 的场景，这已经是合理交互
- 不需要再换成全屏或表格页

### 16.5 保留任务日志弹窗

保留：

- 弹窗而不是常驻日志面板
- 左侧任务列表 + 右侧时间线的结构

原因：

- 这能在不破坏页面清爽度的情况下展示复杂运行信息
- 很适合后续接真实 run / session 数据

## 17. 在保留现有页面前提下需要调整的内容

当前页面最大的问题，不是布局错了，而是“真实语义和真实数据还没接上”。

下面这些是必须改的。

### 17.1 从 mock 数据切到 OpenClaw 真实数据

当前问题：

- 角色、skills、日志、任务和 spawned session 都还是前端 mock
- 页面长得像 OpenClaw 皮肤，但本质还是演示版

需要调整：

- Agent 列表改为来自 `/api/openclaw/agents`
- skills 改为来自 `/api/system/skills`
- core files 改为来自 `/api/openclaw/agents/:id/core-files`
- sessions / recent memory 改为来自 `/api/sessions`
- recent events 改为来自 `/api/events`

原则：

- 页面结构尽量不改
- 只替换数据来源和状态推进方式

### 17.2 把“开始协作”从假动作改成真实动作

当前问题：

- 现在点击 `开始协作` 只是前端本地创建 run
- 过几秒自动完成
- 并没有真的让 OpenClaw 发起任务

需要调整：

- 保留当前办公室任务输入区和按钮位置
- 但按钮动作要改成调用真正的后端桥接接口
- 后端再把任务交给 OpenClaw

结论：

- UI 不需要重做
- 只需要把当前本地 `startTownRun()` 替换成真实任务入口

### 17.3 把日志弹窗从“演示日志”改成“真实日志”

当前问题：

- 现在日志弹窗结构是对的
- 但内容还是前端拼出来的 run / spawn / timeline

需要调整：

- 保留现有弹窗结构
- run 列表改成真实任务列表
- timeline 改成事件流与 session 映射
- spawned session 只在后端能确认时展示

注意：

- 在还拿不到真实 parent / child session 关系前，不要过度承诺“完整树”
- 可以先显示：
  - 主任务
  - 参与 Agent
  - 最近活跃 session
  - 关键事件

### 17.4 明确“办公室成员池”和“活跃执行者”的边界

当前问题：

- 现有页面已经有这两个概念
- 但目前还是前端自己定义、自己推进

需要调整：

- 办公室成员池继续保留
- 但要明确它属于 Town 自己的 UI 状态
- 忙碌 / 完成 / 出错 这些状态则必须尽量来自后端运行时

结论：

- 现有设计思路是对的
- 只是要把“成员池”与“真实执行状态”分层存储

### 17.5 主镇可见角色要改为真实 Agent 的展示子集

当前问题：

- 当前主镇角色虽然已经做了“少量展示”
- 但来源还是 mock Agent

需要调整：

- 保留“最多 6 个角色、随机显示、最近使用加权”规则
- 但角色来源要改成真实 Agent 列表
- 已在办公室成员池里的 Agent 不再出现在主镇

结论：

- 展示规则可直接保留
- 只改角色来源

### 17.6 Agent 抽屉需要增加“真实能力摘要”和“跳转完整配置”

当前问题：

- 当前抽屉已经能选人和看 skills
- 但还没有把 OpenClaw 的真实协作配置信息带出来

建议调整：

- 保留当前卡片布局
- 增加轻量信息：
  - 当前模型
  - 最近活跃时间
  - 当前活跃会话数
  - 是否允许 Agent 间委派
  - 会话可见性
  - 允许协作的 Agent 摘要
- 增加一个按钮：
  - `打开智能体配置`

原因：

- Town 需要能看懂协作能力
- 但不应该把复杂配置全塞回抽屉里

### 17.6A OpenClaw 与 main 的视觉语义需要统一

当前设计后续落地时，必须避免把 `OpenClaw` 和 `main` 当成两个不同对象。

建议统一规则：

- 数据源中仍使用真实默认 Agent `main`
- 页面上统一显示为 `OpenClaw（main）`
- 主镇里它是管理者 / 指挥台对应的小人或主控角色
- 办公室里它固定占据主控工位

这样做的好处是：

- 用户不会困惑“OpenClaw”和“main”是不是两个人
- Town 视觉角色和真实配置模型可以一一对应

### 17.6B 办公室右侧栏需要从“常驻面板”改成“按钮入口”

当前页面右侧栏已经具备很多正确元素，但长期看仍然容易拥挤。

建议调整为：

- 常驻：
  - OpenClaw 状态
  - 任务输入
  - 开始协作
  - 3 个主按钮：`成员` / `技能` / `日志`
- 弹出层承载：
  - 办公室成员详情
  - 技能汇总详情
  - 任务日志详情
  - Agent 详情与记忆

核心原则：

- 保留现有右栏位置
- 不继续往里堆组件
- 把复杂信息迁移到弹窗 / 抽屉

### 17.7 办公室成员状态标签要更精确

当前问题：

- 当前已有 `待命 / 忙碌 / 自动加入 / 已完成`
- 但这些标签还没有真实运行时依据

建议调整：

- 保留现有标签体系
- 但显示逻辑改为：
  - `自动加入`：来源于 Town 办公室成员池记录
  - `待命`：在办公室，但没有活跃任务
  - `忙碌中`：有活跃 session
  - `已完成`：任务刚结束的短暂状态
  - `异常`：后端确认任务失败或恢复失败

并且要补充“分身态”：

- 右侧成员列表展示 Agent 本体
- 办公室画面展示 Agent 运行分身
- 成员详情里要能看到：
  - 当前活跃分身数
  - 每个分身正在参与哪个任务

### 17.8 IM 自动任务建议保持现有轻提示路线

当前页面方向：

- 不强制跳转办公室
- 以事件提示用户“OpenClaw 正在办公室执行任务”

这个方向建议保留。

只需要调整：

- 提示文案来自真实事件
- 自动拉入的 Agent 进入办公室成员池
- 这些 Agent 在任务完成后继续留在办公室待命

### 17.9 顶部说明文字要降噪

当前问题：

- 顶部说明区信息量略多
- 有些文案带有“原型演示 / observer skin”的开发中语气

建议调整：

- 保留顶部标题区
- 文案改得更产品化
- 少解释“这里不是配置台”
- 多强调“查看 OpenClaw 当前协作状态”

也就是说：

- 保留头部区域
- 收紧内容
- 不必整块删除

## 18. 最小调整策略

如果要尽量保留现有页面，推荐按下面顺序改，而不是大改版：

1. 保留现有主镇 / 办公室 / 抽屉 / 日志弹窗布局
2. 先把 mock 数据替换成真实 OpenClaw 数据
3. 再补 Town 专属的办公室成员池持久化
4. 再把 `开始协作` 接到真实 OpenClaw 入口
5. 第一阶段同时接入轻量编辑、skills 开关和 session 清理
6. 再补单办公室多任务分区与 Agent 分身同步

## 19. 结论

当前 AI 小镇页面其实已经有一套可以继续发展的壳：

- 场景结构可以保留
- 交互骨架可以保留
- 像素风可以保留
- 抽屉和日志弹窗也可以保留

真正需要改的，不是“把页面推倒重做”，而是：

- 把 mock 语义改成真实 OpenClaw 语义
- 把前端自演的协作流程改成真实任务流
- 把显示状态和运行时状态真正同步起来

因此下一阶段的重点应该是：

`保留现有页面，替换其底层数据源、任务入口和状态同步机制。`

## 20. 可玩性扩展定稿（已确认）

本节用于锁定“在不偏离 OpenClaw 观测目标前提下”的玩法参数，作为实现时的硬约束。

扩展范围：

1. 办公室分区占领
2. 任务回放模式
3. 分身热力图
4. 选中小人的键盘移动

### 20.1 办公室分区占领

- 办公室场景仍然只有一个
- 多个主任务 `session` 在同一个办公室并行展示
- 办公室按任务分区
- 同时可见的活跃分区上限为 `6`
- 超过 `6` 个活跃任务时：
  - 主画面只显示 6 个分区
  - 其余任务进入“其他任务”列表
- 分区亮度仅按“最近 30 秒事件数”计算
- 分区任务完成后，`60` 秒后淡出

### 20.2 任务回放模式

- 回放按“单个 run”进行，不做全局混合回放
- 回放数据最多保留 `2000` 条事件
- 进入回放时冻结实时视图
- 退出回放后恢复实时视图
- 日志默认展示高层级信息：
  - 主任务
  - 参与 Agent
  - 关键事件
  - 完成/失败

### 20.3 分身热力图

- 同一 Agent 可同时参与多个活跃主任务
- 办公室中允许出现同一 Agent 的多个分身实例
- 热力图采用双通道展示：
  - 办公室地面热区
  - Agent 卡片负载标签
- 负载阈值统一为：
  - `1` = 低（绿）
  - `2` = 中（黄）
  - `>=3` = 高（红）

### 20.4 键盘移动（仅增强可玩性）

- 仅允许移动“当前选中的展示小人”
- 忙碌中的小人不允许手动移动
- 手动移动位置仅当前用户本地可见，不写入全局状态
- 该交互属于表现层，不得覆盖真实运行状态

### 20.5 与主模型的关系

以上玩法全部必须遵守：

- 不修改 OpenClaw 原生协作语义
- 不替代真实 session / spawn / event 状态
- 只做可视化和交互增强
