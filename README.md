# ClawPanel

OpenClaw 多 Agent 协作平台的管理面板，内置 AI 小镇可视化层。

## 功能概览

- **OpenClaw 管理**: Agent 配置、模型管理、渠道管理、进程控制、一键安装/更新
- **AI 小镇**: 把多 Agent 协作过程可视化为一个小镇，Agent 在主镇和办公室之间移动，实时展示工作状态
- **实时日志监听**: 通过 `tail -F` 监听 OpenClaw 运行日志，实时推导 Agent 工作状态（思考/编辑/执行），无需轮询
- **双任务模式**: IM 模式（被动触发，调度器自主选人）和办公室模式（主动发起，OFFICE.md 限定候选人）
- **工作流引擎**: 可视化编排自动化工作流，支持模板复用和消息拦截
- **插件系统**: 插件中心 + 市场，支持安装/卸载/配置/版本更新
- **多渠道接入**: QQ（NapCat）、微信、飞书
- **WebSocket 实时推送**: 日志流、状态变更、事件通知全部走 WS

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Go 1.24 + Gin |
| 数据库 | SQLite (modernc.org/sqlite, 纯 Go) |
| 前端 | React + Vite |
| 实时通信 | WebSocket (gorilla/websocket) |
| 认证 | JWT (golang-jwt) |
| 部署 | 单二进制（前端 embed 打包） |

## 项目结构

```
cmd/clawpanel/        # 入口 + 内嵌前端
internal/
  ├── config/         # 配置加载
  ├── handler/        # HTTP 路由处理（含 AI 小镇全部逻辑）
  ├── middleware/      # JWT 认证、CORS、日志
  ├── model/          # SQLite 数据库
  ├── monitor/        # NapCat 连接监控
  ├── plugin/         # 插件管理器
  ├── process/        # OpenClaw 进程管理
  ├── taskman/        # 异步任务管理
  ├── update/         # 面板自检更新
  ├── updater/        # 独立更新服务（进程隔离）
  ├── eventlog/       # 系统事件日志 + OneBot11 监听
  └── websocket/      # WS Hub
web/                  # React 前端源码
town/                 # AI 小镇设计文档
```

## 快速开始

### 环境要求

- Go 1.24+
- Node.js 18+（构建前端）

### 构建

```bash
# 完整构建（前端 + 后端）
make build

# 仅后端（前端已构建时）
make backend-only

# 交叉编译全平台
make cross
```

### 运行

```bash
./bin/clawpanel
```

默认端口 `19527`，浏览器访问 `http://localhost:19527`。

### 开发模式

```bash
# 终端 1: 前端热重载
cd web && npm run dev

# 终端 2: Go 后端
go run ./cmd/clawpanel/
```

## AI 小镇架构

```
用户 ──→ ClawPanel API ──→ Bridge ──→ OpenClaw (openclaw-main 调度)
                                          ↓
                              /tmp/openclaw/*.log
                                          ↓
                              town_logsync.go (tail -F)
                                          ↓
                              townSharedState (内存)
                                          ↓
                              WebSocket 推送 → 前端渲染小镇
```

核心原则：Town 是观测皮肤，不做调度决策。调度智能全部在 OpenClaw 侧。

### Agent 位置状态机

- `mainTown` — 不在 OFFICE.md 且未工作
- `office_idle` — 在 OFFICE.md 但未工作
- `office_busy` — 正在执行任务（工位上）

任务结束后按 OFFICE.md 归位：在名单中的回办公室闲逛，不在的回主镇。

## 许可证

[CC BY-NC-SA 4.0](LICENSE)

---

## 💡 产品思考

> 把 AI 团队协作变成一个看得见、摸得着、愿意反复打开的活世界。
> 发起需求 → 看到协作 → 拿到成果 → 小镇发生变化 → 用户愿意再来。

**核心判断**:
拉新靠"有趣"，留存靠"有用"，口碑靠"有结果"，破圈靠"可分享"。

**未来方向**: 任务回放、推荐阵容、成果卡、今日战报、模板市场、Agent 人设包、分享模式。
