# Town 模块说明

`/town` 正在从第一版可玩原型，重构为 `OpenClaw` 的协作观测皮肤。

当前结构：

- `components/`: HUD、Agent 选择抽屉、任务日志弹窗
- `mock/`: 小镇演示所需的 mock 数据与固定脚本
- `scene/`: 主镇和办公室两个场景，以及场景容器
- `state/`: `TownState` 构建、状态迁移和查询选择器
- `types/`: OpenClaw / Agent / session 映射所需的核心类型

当前技术方案：

- 使用 `React + CSS` 完成当前像素场景原型
- 优先把真实协作概念映射成状态层，再考虑更重的渲染层

当前 MVP 范围：

- 主镇选人
- 办公室待命与任务执行
- 主任务 session 与子 Agent 协作映射
- 日志与执行状态观察
