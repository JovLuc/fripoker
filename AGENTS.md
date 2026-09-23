# AGENTS.md

AI / 新开发者入口文档。**本层只做导航与约定**，细节写进下级文档，避免每次塞满上下文。

## 文档规则（三级披露）

| 层级 | 位置 | 内容 | 何时读 |
|------|------|------|--------|
| L1 | 根目录 `AGENTS.md` | 功能地图、模块↔路径、环境、开发要求、文档写作规则 | 每次会话默认读 |
| L2 | 模块 `AGENTS.md` 或 `docs/<模块>.md` | 该模块职责、关键流程、文件职责表、入口函数 | 动到该模块时读 |
| L3 | 代码注释 | 非显然的 WHY、边界、协议字段 | 读实现时随文看 |

**L1 写作要求：** 短、全、可跳转；只写"有什么 / 在哪 / 怎么跑 / 注意什么"；不贴长代码、不复述 L2。

**L2 写作要求：** 以文件为索引；写清输入输出与状态副作用；链回 L1 与下级路径。

**L3 写作要求：** 只写 WHY / 协议 / 陷阱；不写显而易见的 WHAT；英文或中文与现有文件一致。

## 项目是什么

局域网德州扑克（摸鱼用）：浏览器打开 URL，设昵称 → 房间 → 开局对打。**TypeScript 全栈**：服务端 tsc 编译为纯 JS 单进程（静态页 + WebSocket，运行依赖仅 `ws`）；前端 Vue 3 SFC（Vite 构建）。消息协议由 `src/shared/protocol.ts` 前后端共享，双向统一 `{ type, payload? }`。

## 功能地图

- 昵称（localStorage 持久化）
- 房间：创建 / 加入未开局 / 观战已开局；1–10 席（真人 + 机器人），**机器人由房主在房间页增/减**（仅等待中；开局不自动补）；起始 **2000** 币，盲注 **10/20** 固定
- 一手结束 **不自动开下一手**；**所有有币玩家点「准备」后自动开局**（0 币不能准备，借钱后可以）；破产者观战，≥2 人有币则继续
- 操作：弃牌 / 过牌·跟注 / 加注 + 滑杆（±10、池比例）；**无操作超时**
- 断线可重连座位（`playerId` 本地保存）；空房（无人）立刻销毁
- 房间聊天（可拖按钮 + 四象限展开面板）；河牌左侧「xxx已破产」记录
- 作弊码：**房间页房主开关，默认开**（状态栏「借钱:开/关」，协议仍为 `setCheat`）；开时聊天「爸爸」借 200、「爷爷」借 500、「还钱」还清；刚借完下一手不计息，之后每手 ×1.1（`src/server/cheat/`）
- 禁右键、禁框选（输入框除外）
- 路径前缀 `BASE_PATH`（**默认 `/frp`**；设空串回根路径，nginx 反代）

## 模块 ↔ 路径

| 模块 | 路径 | L2 文档 |
|------|------|---------|
| **共享协议**（消息联合类型、常量） | `src/shared/protocol.ts` `constants.ts` | 文件头注释即文档；改协议必读 |
| 进程入口 / 组装根 | `src/server/index.ts` / `app.ts` | `src/server/AGENTS.md` |
| HTTP 静态 / 连接上下文 | `src/server/net/` | `src/server/AGENTS.md` |
| 大厅 / 房间 / 编排 / 序列化 | `src/server/lobby/` `room/` | `src/server/AGENTS.md` |
| 规则引擎（牌型、边池、结算、借贷） | `src/server/game/` | `src/server/AGENTS.md` |
| 机器人决策 / 聊天作弊 | `src/server/bot/` `cheat/` | `src/server/AGENTS.md` |
| 前端组件 / stores / composables | `src/client/` | `docs/client.md` |
| 类型化 WS 客户端 | `src/client/api/ws.ts` | `docs/client.md` |
| 单测 + e2e 冒烟 | `src/**/*.test.ts` | `npm test` |
| 部署 | `Dockerfile` `docker-compose.yml` | 见下方环境 |
| 参考实现（第三方） | `poker/` | **勿当本项目源码改**；只读参考 |

## 环境概要

- Node ≥ 18.19（开发用 24）；运行依赖仅 `ws`；vue 等均在 devDependencies（由 Vite 打进客户端产物）
- 本地开发：`npm run dev`（tsx watch 服务端 :3000 + Vite 客户端 :5173；dev 模式 WS 直连 `ws://<host>:3000/`，可用 `VITE_DEV_WS_URL` 覆盖）
- 构建：`npm run build` → `dist/server`（tsc）+ `dist/public`（Vite）+ `dist/start.sh`（从 `scripts/start.sh` 拷入的运行入口，dist 可整体搬迁）；`npm start` = `node dist/server/index.js`
- `dist/start.sh`：纯启动器（定位自身 + `exec node`），无任何 env 预设
- 测试 / 类型：`npm test`（vitest，含 e2e）；`npm run typecheck`（tsc + vue-tsc 双零错误）
- 环境变量只剩两个：`PORT`(3000)、`BASE_PATH`(**默认 `/frp`**，设空串回到无前缀)。HOST 固定 0.0.0.0、静态目录固定在构建产物旁、作弊金额固定 200/500 且开关在房间页——均不可配；所有默认值收敛在 `src/server/config.ts`，`dist/start.sh` 只是纯启动器
- Docker：`docker compose up -d --build`；多阶段（build 阶段编译 + vite，runtime 只装生产依赖并拷 `dist/`）
- 无数据库；房间仅内存；静态资源 `Cache-Control: no-cache`

## 开发要求

1. **改消息协议** → `src/shared/protocol.ts` 是唯一契约：先改类型，再同步 `server/app.ts`（`parseClientMessage` + `routeMessage`）与 `client/stores/session.ts`（分发），最后更新 `docs/client.md` 协议段
2. **改规则/结算/借贷** → `src/server/game/`，补/改对应 `*.test.ts`（筹码守恒、牌型排序、边池分层是回归底线）
3. **改房间/聊天/广播** → `src/server/room/` + `app.ts` 路由分支
4. **改 UI/交互** → `src/client/`（组件 + stores + composables），见 `docs/client.md`；注意「预留高度」避免布局跳动
5. **不要**手改 `dist/`（gitignore 的构建产物）；后端保持零框架零额外依赖，前端保持 Vue 3 + Vite
6. **`poker/` 是外部参考**，不遵守本仓文档；勿重构进去
7. 提交前：`npm run typecheck && npm test`

## 快速定位

- 找「谁处理 WS 消息」→ `src/server/app.ts` `routeMessage` / `parseClientMessage`
- 找「谁发房间快照」→ `src/server/room/serializer.ts` `serializeFor` / `broadcastRoom`
- 找「比牌/边池/结算」→ `src/server/game/evaluator.ts` `evaluate7` / `showdown.ts` `buildPots` / `showdown`
- 找「破产观战 / 借贷还钱」→ `src/server/room/gameHost.ts` `afterStep` + `src/server/game/economy.ts`
- 找「机器人增/减」→ `src/server/room/room.ts` `addRoomBot` / `removeRoomBot`（仅房主、仅 waiting）
- 找「聊天 / 拖按钮」→ `src/client/components/ChatDock.vue` + `src/client/composables/useChatDock.ts`
- 找「路径前缀」→ `src/server/net/staticFiles.ts` `pathPrefixes` / `stripBase`
- 找「连接 / 重连」→ `src/client/api/ws.ts`（客户端）+ `src/server/net/connections.ts`（服务端）
