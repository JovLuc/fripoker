# server/AGENTS.md

服务端 L2 文档。总览与协议入口见根目录 `../../AGENTS.md`；wire 类型真身在 `src/shared/protocol.ts`。

## 分层与依赖方向（严格单向）

```
index.ts → app.ts ─→ lobby/ room/ ─→ game/  bot/  cheat/
                └→ net/                       └→ (仅 game/)
game/ 只 import shared —— 零 I/O、零定时器，全部可单测
```

## 文件职责

| 文件 | 职责 | 关键导出 / 入口 |
|------|------|-----------------|
| `index.ts` | 进程入口：`loadConfig` → `createServerApp` → listen + LAN 日志 | — |
| `app.ts` | **组装根**：http+ws 装配、`parseClientMessage`（入站宽容解析）、`routeMessage`（类型化路由）、`leaveAll`（断线/退房清理） | `createServerApp(config)`（测试直接调用） |
| `config.ts` | 唯一读 env 处：仅 `PORT` / `BASE_PATH`（默认 `/fpk`，空串回根）；其余默认全在此收敛 | `loadConfig(env?)` |
| `net/staticFiles.ts` | 静态服务：`/fpk` 别名 + BASE_PATH、`stripBase`、`safeJoin` 防穿越、SPA 回退、`no-cache` | `createStaticHandler` |
| `net/connections.ts` | `ClientConn`：playerId/nickname/roomId 不再挂 ws 上；稳定观战 viewerId；`send/sendError/close` | `ClientConn` |
| `lobby/lobby.ts` | 大厅 socket 集合 + `rooms` 广播 | `LobbyHub` |
| `room/room.ts` | `Room` 实体（真人/机器人座位/观战/聊天/readyIds/`cheatEnabled`/`shortDeck`/**唯一 botTimer**）+ `joinRoom`/`leaveRoom` 成员操作 + `addRoomBot`/`removeRoomBot`（房主增减机器人，仅 waiting，移除为 LIFO） | `Room` `joinRoom` `leaveRoom` `addRoomBot` `removeRoomBot` |
| `room/roomManager.ts` | 房间注册表（原全局 Map 的替代）+ 大厅列表 | `RoomRegistry` |
| `room/gameHost.ts` | 对局编排：开局、ready→自动发牌、动作转发、`afterStep`（破产登记/gameOver/机器人调度） | `GameHost` |
| `room/serializer.ts` | 按视角快照（底牌可见性）+ 广播 + 单连接快照 | `serializeFor` `broadcastRoom` `sendRoomSnapshot` |
| `room/chat.ts` | 聊天入列（80 条上限、chatTotal 全量）+ 作弊集成 + 系统消息 | `handleRoomChat` `playerRepay` |
| `game/cards.ts` | 牌堆（长 52 / 短 36 张）/ Fisher-Yates / `RANK_VALUE` | `createDeck(shortDeck?)` `shuffle` |
| `game/evaluator.ts` | 5–7 张牌型评估（category 0–8；短牌模式重排序：三条>顺子、同花>葫芦、A6789 低顺）、比较、UI 牌名 | `evaluate7(cards, shortDeck?)` `compareEval` `describeHand` |
| `game/handFlow.ts` | 建局（按 `SeatSeed` 席位种子，**不自动补机器人**）、发牌、盲注、动作合法性、街推进、计息 | `createGameState` `startHand` `applyAction` `stepAfterAction` `legalActions` |
| `game/showdown.ts` | 边池分层、摊牌结算、弃牌获胜、runout | `buildPots` `awardPots` `showdown` `endHandByFold` |
| `game/economy.ts` | 借钱/还款/破产登记 | `borrowChips` `repayDebt` `noteBusted` `playersWithChips` |
| `bot/bot.ts` | 决策：全街由 `equity.ts` 蒙特卡洛胜率驱动——跟注看 equity vs 底池赔率（翻前面对真实加注打 1.15 折扣；**limp/补盲便宜行动走牌力表**，因对手未投钱时 potOdds 与多人 equity 错配），加注看 `norm = equity×(对手数+1)`；牌力表另用于翻前开池尺寸；**返回值经 clampRaise 钳制在合法区间** | `botDecide` |
| `bot/equity.ts` | 纯函数胜率模拟：随机补全对手底牌+剩余公共牌 N 次数胜场（平分计 1/n）；**必须走引擎 `evaluate7`/`compareEval`** 保证与真实结算同一套比牌规则（含短牌重排序）；不读其他玩家真实底牌；`rng` 可注入供测试 | `estimateEquity` |
| `cheat/cheat.ts` | 作弊触发（精确匹配 爸爸/爷爷/还钱）；**房间级开关 `room.cheatEnabled`**（默认开，房主房间页 `setCheat` 切换），金额固定 200/500/500 | `tryChatCheat` |

## 生命周期（一局）

1. `registry.create` → `status=waiting` → `roomsChanged()`
2. `gameHost.startGame`：席位 = 真人 + `room.botPlayers`（房主房间页增减，id `bot_<seq>`，名 东西南北中发白梅兰竹菊；<2 席拒绝开局）→ `createGameState(seats)` → `startHand`
3. 玩家动作：`playerAction` → `applyAction` → `stepAfterAction` → `broadcastRoom` → `afterStep`
4. 机器人：`afterStep("continue")` → `scheduleBot(700–1300ms)` → `runBotIfNeeded`
5. `afterStep("hand-end")` → `noteBusted` + **清空 readyIds**；有币者 <2 → `gameOver`；否则等 **所有 chips>0 玩家 ready**（bot 恒 ready）→ `startNextHand` 自动发牌
6. 断线/离开：`ws.close` 或 `leaveRoom` → `leaveAll` → `leaveRoom` + （playing 房）`gameHost.handleDeparture`：立即代弃（轮到他则走引擎推进，否则静默弃牌、只剩一人则 `endHandByFold`）并标记 `Player.left`——之后每手 `sittingOut`，不参与 ready/续局判定；waiting 房最后一个真人离开即销毁。对局中离开者座位保留（快照 `humanPlayers` 不动、可重连），但大厅列表人数/名字排除 `left` 者（`publicRoomList` 派生）

## 关键不变量（测试锁死，勿破坏）

- 开局 2000×席位数（2–10 席，真人+机器人）；盲注 10/20 固定；**无操作超时**
- 任意时刻 `Σchips + pot` 守恒（e2e 与 bot 性质测试断言）
- `compareEval(a,b) > 0` ⇒ a 更好；平分余数给 players 数组序在前者
- raise 的 amount 语义是 **加注到**（total bet level），不是增量；低于 minRaiseTo 仅允许等于 maxRaiseTo 的全下
- `serializeFor`：底牌仅 `isMe` 或 `revealAll` 可见；观战者用连接稳定 viewerId
- `game.busted[]` **append-only**（借钱不清史）；座位角标 `chips<=0 && !allIn` 是另一回事
- `Player.left`（离开者）单向标记：`playersWithChips`、`allRequiredReady`、`requiredReady`、发牌 eligible、赢家文案均排除；无行动超时，故离开必须即时代弃，本手不能等他
- 借贷：`debtHands=0` 宽限一手，之后每手 `debt = ceil(debt*11/10)`；还款每次 `min(debt, 500)`
- 作弊码：房间级 `cheatEnabled` **默认开**；仅房主可 `setCheat` 切换（等待/对局中均可）；金额固定「爸爸」200、「爷爷」500、「还钱」每次 `min(debt, 500)`
- 长短牌：房间级 `shortDeck` **默认关（长牌）**；仅房主可 `setShortDeck` 切换，且**本手未结束才可切**（进行中由 `app.ts` 拒绝），生效于下一次 `resetHand` 重建牌堆；短牌规则 = 36 张（6..A）+ 6+ 排序 + A 低顺
- 房间内**唯一**定时器是 `Room.botTimer`；`destroyRoom`/close 时必须 clear

## 消息路由

入站先经 `parseClientMessage` 宽容解析（字段缺失/类型不符 → `消息格式错误`），业务校验（空昵称、非法金额等）在各 handler。新增 type：先改 `shared/protocol.ts` 的 `ClientMessage`，再在 `parseClientMessage` + `routeMessage` 各加一分支（编译器会强制）。

## 路径前缀

- 唯一前缀来源 `BASE_PATH`（**默认 `/fpk`**，空串回根）；裸前缀 302 到带斜杠；未知路径 SPA 回退 `index.html`；`..` 解码后逃逸 root → 403
- nginx：`location /fpk/ { proxy_pass .../fpk/; Upgrade/Connection }`；WS 客户端连**带尾斜杠**路径

## 测试

`npm test`：`game/*.test.ts`（评估器/边池/守恒/借贷）、`bot.test.ts`（决策永不被引擎拒绝）、`cheat.test.ts`、`e2e/smoke.test.ts`（真实起服 + ws 客户端走完整流程）。改引擎必须让这些保持绿。
