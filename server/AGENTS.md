# server/AGENTS.md

服务端 L2 文档。入口与协议总览见根目录 `../AGENTS.md`。

## 文件职责

| 文件 | 职责 | 关键导出 / 入口 |
|------|------|-----------------|
| `index.js` | HTTP 静态 + 路径前缀；`WebSocketServer`；消息路由；`leaveAll` 销毁空房 | `server.listen`；`wss.on("message")` |
| `rooms.js` | 房间 CRUD、座位、聊天、开局/下一手、机器人调度、按视角序列化、破产编排 | `createRoom` `joinRoom` `startGame` `startNextHand` `handleRoomChat` `serializeFor` `broadcastRoom` |
| `engine.js` | 纯规则：发牌、盲注、动作合法性、街推进、牌型、边池、结算、破产/借贷 | `createGameState` `startHand` `applyAction` `stepAfterAction` `noteBusted` `borrowChips` `repayDebt` `evaluate7` `describeHand` `compareEval` |
| `bot.js` | 翻前/翻后启发式决策（无 UI） | `botDecide` |
| `cheat.js` | **env 门控**聊天作弊表；只调 `engine.borrowChips` / `repayDebt` | `tryChatCheat` `CHEAT_ENABLED` |

依赖方向：`index` → `rooms` → `engine` / `bot` / `cheat`。**engine 不 import rooms/index**；**cheat 不 import rooms/index**，保持可单测。

## 生命周期（一局）

1. `createRoom` → `status=waiting`，真人列表；广播 `rooms` 大厅
2. `startGame`：`createGameState(humans)` **补机器人至 6 人**，`startHand`
3. 动作：`playerAction` → `applyAction` → `stepAfterAction` → `broadcastRoom` → `afterStep`
4. `afterStep`：`hand-end` → `noteBusted` + **清空 ready**；**有币者 <2 → `gameOver`**；否则等 **所有 `chips>0` 玩家 `ready` → 自动下一局**
5. `playerReady`：`chips<=0` 拒绝；机器人视为已准备；不依赖房主
5. 聊天：`handleRoomChat` → 普通入 `room.chat` → 可选 `tryChatCheat`（`CHEAT_ENABLED`）→ 系统提示 + 广播
6. 机器人回合：`scheduleBot` / `runBotIfNeeded` → `botDecide`
7. `leaveAll`：socket 清空且无观战 → `destroyRoom`

## 关键不变量

- 开局筹码 **2000**×6（`STARTING_CHIPS`）；盲注 10/20；**无 `ACTION_TIMEOUT` 自动弃牌**
- `compareEval(a,b) > 0` ⇒ **a 更好**（结算用此方向）
- 摊牌后 `lastResults` 与 UI 结算区展示；`message` 在有 results 时前端可隐藏重复行
- `serializeFor(viewerId)`：仅 `isMe` 或 `revealAll` 可见底牌；`handLabel` 用 `describeHand`（翻前 2 张也可显示）
- 破产：`chips<=0` → `game.busted[]`（**append-only，不清史**）+ 下一手 `sittingOut`；**<2 人有币才 `gameOver`**
- 借贷：`爸爸` +200、`爷爷` +500 进 `debt`；`还钱` **每次还 500**（欠款 &lt;500 则一次还清）；**刚借完 `debtHands=0`，下一手开局不计息，再往后每手 `debt *= 1.1`（ceil）**
- 入池：`resetHand` 仅 `chips>0` 发牌；本手中途借钱（曾破产）保持 `sittingOut`，下一手才参战
- 复活提示：破产后借钱仍发「重回战局」，**不清破产记录**；再次破产再追加一条
- 聊天：`room.chat` 最多约 80 条，随 `room` 快照下发
- 作弊默认关；`CHEAT_ENABLED=1|true|yes|on`：`爸爸`→+200（`CHEAT_BORROW_CHIPS`），`爷爷`→+500（`CHEAT_GRANDPA_CHIPS`），`还钱`→还清欠款

## 协议（WS）

客户端 → 服务端 `type`：  
`setNickname` `listRooms` `createRoom` `joinRoom` `leaveRoom` `startGame` `nextHand` `action` `chat` `sync`

服务端 → 客户端 `type`：  
`rooms` `profile` `joined` `room` `error` `left`

`action` 载荷：`{ action: fold|check|call|raise|allin, amount? }`（raise 的 amount 为 **加注到** 的总 bet level）。

`room.game` 快照额外：`busted: [{id,name}]`；`players[].chips<=0` 为破产观战。

## 路径前缀

- `BASE_PATH` 环境变量（默认空）；**始终**额外兼容 `/fpk` 前缀
- `stripBase` 剥前缀后读盘；`/fpk` → 302 `/fpk/`
- nginx：`location /fpk/ { proxy_pass .../fpk/; Upgrade/Connection }`；WS 客户端连 **带尾斜杠** 路径

## 冒烟

```bash
node --check server/*.js
# 引擎：一对应胜高牌；20 手后 12000 筹码守恒（6×2000）
# 破产续战：≥2 人剩币 → 不 gameOver；rebuy 清 busted 且可恢复非 gameOver
```
