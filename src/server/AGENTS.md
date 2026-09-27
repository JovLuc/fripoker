# server/AGENTS.md

服务端 L2 文档。总览与协议入口见根目录 `../../AGENTS.md`；wire 类型真身在 `src/shared/protocol.ts`。

## 分层与依赖方向（严格单向）

```
index.ts → app.ts ─→ lobby/ room/ ─→ game/(registry→core·holdem·tp)  cheat/
                └→ net/                                └→ (仅 game/core)
game/ 只 import shared —— 零 I/O、零定时器，全部可单测
room/ 只经 getMode(kind) 触碰规则；具体引擎（含各玩法机器人）全部封在 game/ 内
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
| `room/room.ts` | `Room` 实体（真人/机器人座位/观战/聊天/readyIds/`cheatEnabled`/`kind`/**唯一 botTimer**）+ `joinRoom`/`leaveRoom` 成员操作 + `addRoomBot`/`removeRoomBot`（房主增减机器人，仅 waiting，移除为 LIFO） | `Room` `joinRoom` `leaveRoom` `addRoomBot` `removeRoomBot` |
| `room/roomManager.ts` | 房间注册表（原全局 Map 的替代）+ 大厅列表（带 `kind`） | `RoomRegistry` |
| `room/gameHost.ts` | 对局编排：开局、ready→自动发牌、动作转发（含 `look` 不推进 / `compare` 带 `targetId`）、`afterStep`（破产登记/gameOver/机器人调度）；**规则全部经 `getMode(kind)`** | `GameHost` |
| `room/serializer.ts` | 房间级快照 + 广播；游戏段委托 `mode.serialize`（底牌可见性是玩法职责） | `serializeFor` `broadcastRoom` `sendRoomSnapshot` |
| `room/chat.ts` | 聊天入列（80 条上限、chatTotal 全量）+ 作弊集成 + 系统消息 | `handleRoomChat` `playerRepay` |
| `game/core/` | **跨玩法共享**：`types.ts`（`BaseGame`/`BasePlayer`/`ApplyResult.advance`）、`cards.ts` 牌堆、`flow.ts`（座位轮转/入池/重开行动/**边池分层 buildPots**/弃牌胜 endHandByFold）、`economy.ts`（借钱/还款/破产/**计息 accrueInterest**/**终局 endGameIfBusted**）、`mode.ts`（`GameMode` 接口 + `narrow` 守卫）、`serialize.ts`（快照公共字段） | `BaseGame` `GameMode` `buildPots` |
| `game/holdem/` | 德州：`types` `evaluator` `handFlow` `showdown` `bot` `equity`（原位平移）+ `mode.ts`（GameMode 适配） | `holdemMode` |
| `game/tp/` | 三张牌：`types` `evaluator`（3 张牌型+花色破平）`flow`（ante/连续下注/看牌/开牌/摊牌兜底）`bot` `mode.ts` | `tpMode` `evaluate3` `compare3` |
| `game/registry.ts` | `getMode(kind)` 唯一解析点 | `getMode` |
| `cheat/cheat.ts` | 作弊触发（精确匹配 爸爸/爷爷/还钱）；**房间级开关 `room.cheatEnabled`**（默认开，房主房间页 `setCheat` 切换），金额固定 200/500/500 | `tryChatCheat` |

## 生命周期（一局）

1. `registry.create`（**创建时定 `kind`，终生不变**）→ `status=waiting` → `roomsChanged()`
2. `gameHost.startGame`：席位 = 真人 + `room.botPlayers`（房主房间页增减，id `bot_<seq>`，名 东西南北中发白梅兰竹菊；<2 席拒绝开局）→ `getMode(kind).create(seats, {shortDeck})` → `mode.startHand`
3. 玩家动作：`playerAction` → `mode.applyAction`（返回 `advance:false` = 看牌等不消耗回合的动作，仅广播）→ `mode.stepAfterAction` → `broadcastRoom` → `afterStep`
4. 机器人：`afterStep("continue")` → `scheduleBot(700–1300ms)` → `runBotIfNeeded` → `mode.botDecide`；看牌返回同样走 `advance:false` → 再调度
5. `afterStep("hand-end")` → `noteBusted` + **清空 readyIds**；`endGameIfBusted`（<2 席有币 → gameOver 文案）；否则等 **所有 chips>0 玩家 ready**（bot 恒 ready）→ `startNextHand` 自动发牌
6. 断线/离开：`ws.close` 或 `leaveRoom` → `leaveAll` → `leaveRoom` + （playing 房）`gameHost.handleDeparture`：立即代弃（轮到他则走 `mode.stepAfterAction`，否则静默弃牌、只剩一人则 `mode.endHandByFold`）并标记 `Player.left`——之后每手 `sittingOut`，不参与 ready/续局判定；waiting 房最后一个真人离开即销毁。对局中离开者座位保留（快照 `humanPlayers` 不动、可重连），但大厅列表人数/名字排除 `left` 者（`publicRoomList` 派生）

## 关键不变量（测试锁死，勿破坏）

- 开局 2000×席位数（2–10 席，真人+机器人）；**无操作超时**；德州盲注 10/20 固定
- 任意时刻 `Σchips + pot` 守恒（e2e 与 bot 性质测试断言，两种玩法都断）
- `compareEval(a,b) > 0` ⇒ a 更好；平分余数给 players 数组序在前者
- raise 的 amount 语义是 **加注到**（total bet level），不是增量；低于 minRaiseTo 仅允许等于 maxRaiseTo 的全下
- `serializeFor` 房间字段 + `mode.serialize` 游戏字段；底牌可见性按玩法分：德州 `isMe || revealAll`，三张牌 `(isMe && looked) || revealed || (revealAll && !folded)`；观战者用连接稳定 viewerId
- `game.busted[]` **append-only**（借钱不清史）；座位角标 `chips<=0 && !allIn` 是另一回事
- `Player.left`（离开者）单向标记：`playersWithChips`、`allRequiredReady`、`requiredReady`、发牌 eligible、赢家文案均排除；无行动超时，故离开必须即时代弃，本手不能等他
- 借贷：`debtHands=0` 宽限一手，之后每手 `debt = ceil(debt*11/10)`；还款每次 `min(debt, 500)`（计息在 `core/economy.accrueInterest`，两种玩法的发牌都调）
- 作弊码：房间级 `cheatEnabled` **默认开**；仅房主可 `setCheat` 切换（等待/对局中均可）；金额固定「爸爸」200、「爷爷」500、「还钱」每次 `min(debt, 500)`
- 长短牌：房间级 `shortDeck` **默认关（长牌）**、**仅 `kind==='holdem'` 房间有效**（tp 房 `app.ts` 拒绝 `setShortDeck`）；仅房主可切换，且**本手未结束才可切**，生效于下一次 `resetHand` 重建牌堆；短牌规则 = 36 张（6..A）+ 6+ 排序 + A 低顺
- 房间内**唯一**定时器是 `Room.botTimer`；`destroyRoom`/close 时必须 clear
- **三张牌（tp）规则**：**无圈、无轮数上限的连续行动**——座位轮转，每次轮到必须行动：下注 ≥N（暗牌）/ ≥2N（已看牌）、弃牌、或开牌；**不能过牌**（`canCheck` 恒 false）。**庄位**：首手座位 0，此后**上一手赢家坐庄**（`TpState.lastWinnerId`），**庄先行动**（不能动则顺延）。基数 N 起始 10，**抬价即更新 N = ceil(实付 ÷ 倍数)**（暗除 1、明除 2，看牌注折半取整）；**开牌费 = 本回合下注成本（`N×倍数`，与下注同值）**入池但**不抬 N**。**看牌 `look` 仅自己回合、每手一次、免费不消耗回合**（`ApplyResult.advance:false`），看后全局明牌。**开牌对象只看看牌状态对等**：暗开所有暗牌对手、明开所有明牌对手（不限行动历史、含 all-in）；**输家亮牌（`revealed`）、赢家不亮**（暗开赢保持暗牌）。结束 = 弃/开到只剩一人；全员 all-in 无法行动时摊牌兜底。牌型 三条>同花顺>同花>顺子>对子>高牌（A23 最小顺），**同型比花色 spade>heart>club>diamond，永不平局**；底注/开牌费/下注都进 `totalBet` 参与边池分层
- **三张牌机器人**（`tp/bot.ts`）：**开牌判断先于看牌**（支持闷开，不开状态不对等的对手）——三条+必开、同花顺系 40%、对子+15%；牌力>0.6 有 35% 概率保持暗牌（省 1× 注且保留闷开权），否则先看牌再按底池赔率下注/弃牌
- `ApplyResult.advance:false` 只有三张牌看牌使用：GameHost 对人与机器人都只广播、不 step、不 afterStep（机器人看牌后再次调度）

## 消息路由

入站先经 `parseClientMessage` 宽容解析（字段缺失/类型不符 → `消息格式错误`），业务校验（空昵称、非法金额等）在各 handler。新增 type：先改 `shared/protocol.ts` 的 `ClientMessage`，再在 `parseClientMessage` + `routeMessage` 各加一分支（编译器会强制）。现有扩展点：`createRoom.payload.kind`（玩法，默认 holdem，白名单校验）、`action.payload.targetId`（三张牌比牌对象）、`ACTION_NAMES` 含 `look`/`compare`。

## 路径前缀

- 唯一前缀来源 `BASE_PATH`（**默认 `/fpk`**，空串回根）；裸前缀 302 到带斜杠；未知路径 SPA 回退 `index.html`；`..` 解码后逃逸 root → 403
- nginx：`location /fpk/ { proxy_pass .../fpk/; Upgrade/Connection }`；WS 客户端连**带尾斜杠**路径

## 测试

`npm test`：`game/holdem/*`（评估器/边池/守恒/借贷/机器人决策永不被引擎拒绝）、`game/tp/*`（牌型排序+花色破平/流程守恒/比牌/看牌翻倍/机器人不变量/快照可见性）、`cheat.test.ts`、`e2e/smoke.test.ts`（德州全流程 + 静态服务）、`e2e/tp.test.ts`（三张牌建房→摊牌→续局→弃牌，共用 `e2e/harness.ts`）。改引擎必须让这些保持绿。
