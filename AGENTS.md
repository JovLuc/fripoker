# AGENTS.md

AI / 新开发者入口文档。**本层只做导航与约定**，细节写进下级文档，避免每次塞满上下文。

## 文档规则（三级披露）

| 层级 | 位置 | 内容 | 何时读 |
|------|------|------|--------|
| L1 | 根目录 `AGENTS.md` | 功能地图、模块↔路径、环境、开发要求、文档写作规则 | 每次会话默认读 |
| L2 | 模块 `AGENTS.md` 或 `docs/<模块>.md` | 该模块职责、关键流程、文件职责表、入口函数 | 动到该模块时读 |
| L3 | 代码注释 | 非显然的 WHY、边界、协议字段 | 读实现时随文看 |

**L1 写作要求：** 短、全、可跳转；只写“有什么 / 在哪 / 怎么跑 / 注意什么”；不贴长代码、不复述 L2。跨目录复杂功能 → `docs/` 单文件；单目录模块 → 该目录 `AGENTS.md`。

**L2 写作要求：** 以文件为索引；写清输入输出与状态副作用；链回 L1 与下级路径。

**L3 写作要求：** 只写 WHY / 协议 / 陷阱；不写显而易见的 WHAT；英文或中文与现有文件一致。

## 项目是什么

局域网德州扑克（摸鱼用）：浏览器打开 URL，设昵称 → 房间 → 开局对打。单进程 Node 提供静态页 + WebSocket；前端 Vue 3 单页（本地 vendor，无构建）。

## 功能地图

- 昵称（localStorage 持久化）
- 房间：创建 / 加入未开局 / 观战已开局；1–6 真人，不足补机器人到 6；起始 **2000** 币，盲注 **10/20** 固定
- 一手结束 **不自动开下一手**；**所有有币玩家点「准备」后自动开局**（0 币不能准备，借钱后可以）；破产者观战，≥2 人有币则继续
- 操作：弃牌 / 过牌·跟注 / 加注 + 滑杆（±10、池比例）；**无操作超时**
- 断线可重连座位（`playerId` 本地保存）；空房（无人）立刻销毁
- 房间聊天（右下/可拖按钮 + 四象限展开面板）；河牌左侧「xxx已破产」记录
- 可选作弊：`CHEAT_ENABLED=1` 时，聊天「爸爸」借 200、「爷爷」借 500、「还钱」还清；刚借完下一手不计息，之后每手 ×1.1（`server/cheat.js`）
- 禁右键、禁框选（输入框除外）
- 可选路径前缀 `/fpk`（nginx 反代）

## 模块 ↔ 路径

| 模块 | 路径 | L2 文档 |
|------|------|---------|
| 进程入口 / HTTP+WS | `server/index.js` | `server/AGENTS.md` |
| 房间、聊天、广播、对局编排 | `server/rooms.js` | `server/AGENTS.md` |
| 规则引擎、牌型、边池、结算 | `server/engine.js` | `server/AGENTS.md` |
| 机器人决策 | `server/bot.js` | `server/AGENTS.md` |
| 聊天作弊（env 开关） | `server/cheat.js` | `server/AGENTS.md` |
| 前端单页（昵称/大厅/对局/聊天） | `index.html` + `js/app.js` + `css/style.css` | `docs/client.md` |
| 部署 | `Dockerfile` `docker-compose.yml` | 见下方环境 |
| Vue 运行时 | `vendor/vue.global.prod.js` | 只读依赖，勿改 |
| 参考实现（第三方） | `poker/` | **勿当本项目源码改**；只读参考 |

## 环境概要

- Node ≥ 18（开发用 24）；依赖仅 `ws`
- 本地：`npm start` → `http://127.0.0.1:3000`（可 `PORT`）
- 前缀：`BASE_PATH=/fpk`（默认空；`/fpk` 路径始终兼容）
- 作弊：`CHEAT_ENABLED=1`（可选 `CHEAT_BORROW_CHIPS=200`）；默认关闭
- Docker：`docker compose up -d --build`，端口映射 3000
- 无数据库；房间仅内存；静态资源 `Cache-Control: no-cache`

## 开发要求

1. **改规则/结算** → `server/engine.js`，并对照 `server/AGENTS.md` 单测点（筹码守恒、一对>高牌）
2. **改房间/聊天/广播** → `server/rooms.js` + `server/index.js` 消息 type 分支
3. **改 UI/交互** → `index.html` / `js/app.js` / `css/style.css`，见 `docs/client.md`；注意「预留高度」避免布局跳动
4. **消息协议**：客户端 `WebSocket` JSON `{ type, ... }`；服务端回 `{ type: rooms|profile|joined|room|error|left, payload }`。新增 type 先改 `server/index.js` 与 `docs/client.md` 协议段
5. **不要**引入构建链、TS、新框架；前端保持 Vue global + 相对路径资源
6. **poker/** 是外部参考，不遵守本仓文档；勿重构进去
7. 提交前：`node --check server/*.js js/app.js`；有行为变更跑引擎手牌冒烟（见 L2）

## 快速定位

- 找「谁处理 WS 消息」→ `server/index.js` `wss.on("message")`
- 找「谁发房间快照」→ `server/rooms.js` `serializeFor` / `broadcastRoom`
- 找「比牌/边池/发牌」→ `server/engine.js` `evaluate7` / `buildPots` / `showdown`
- 找「破产观战 / 借贷还钱」→ `server/rooms.js` `afterStep` / `handleRoomChat` + `server/engine.js` `borrowChips` `repayDebt` + `server/cheat.js`
- 找「聊天」「拖按钮」→ `js/app.js` chat* + `docs/client.md`
- 找「路径前缀」→ `server/index.js` `BASE_PATH` / `stripBase`
