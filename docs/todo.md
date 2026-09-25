# docs/todo.md — 优化与玩法路线图

来源：2026-09 全量代码走查。总览见 `../AGENTS.md`；协议唯一契约 `../src/shared/protocol.ts`。

**约定**

- 每项独立可交付，做完勾选；按批次顺序做（第一批是体验修复，互相独立、风险低）。
- 动协议的项遵守 AGENTS.md 开发要求 1：先改 `protocol.ts` → 同步 `app.ts`（parse + route）→ `client/stores/session.ts` → `docs/client.md` 协议段。
- 提交前：`npm run typecheck && npm test`；改规则/结算必须补 `*.test.ts`（筹码守恒、边池分层是回归底线）。
- 服务端默认值收敛在 `src/server/config.ts`，**不新增环境变量**（保持只有 PORT / BASE_PATH）。

---

## 第一批 · 体验修复

### 1. 真人行动超时（P0，全桌卡死风险）

- **现状**：全服唯一 timer 是 bot 延迟（`room.ts` `botTimer`，注释声明"room 里唯一的 timer 概念"）；`gameHost.ts:91` 注释明确 *"There is no action timeout"*。断线会立即代弃牌，但**在线挂机的人会让整手牌永远停住**。AGENTS.md 写的「无操作超时」与实现不符（本项完成后即吻合）。
- **方案**：把"bot 延迟"和"真人超时"合并进同一个 timer——轮到真人时也 `scheduleTimer`，到点后按当前 actor 分派：是 bot 走 `runBotIfNeeded`，是真人走超时自动行动（`myLegal.canCheck` → check，否则 fold）。超时自动行动必须走 `applyAction + stepAfterAction + broadcast` 的正常人路径。任何真人 action、hand-end、离房都要先 `clearTimeout`。
- **落点**：`src/server/room/gameHost.ts`（scheduleBot 泛化为 scheduleTurn）、`src/server/room/room.ts`（`botTimer` 改名 `timer`）、`src/server/config.ts`（`actionTimeoutMs` 默认 30s，与 `botDelay` 并列）、`src/server/config.test.ts`。
- **边界**：倒计时最后一刻真人操作 vs 超时竞态（timer 回调里先校验 actionIndex/actor 未变）；观战与 waiting 状态不启 timer。
- **验收**：新增测试——挂机真人被自动 check/fold，手推进到下一街/结束；正常操作不触发；bot 行为不受影响。

### 2. 轮到你提醒（P1，切屏不知道该自己）

- **方案**：纯客户端。`myActionState` 从 null → 非 null 时：`document.title` 闪烁「▶ 该你了 · fripoker」，Web Audio 短 beep（可选，存 localStorage 偏好）；轮次结束恢复原 title。切回标签页（`visibilitychange`）立即停闪。
- **落点**：新建 `src/client/composables/useTurnAlert.ts`，在 `stores/room.ts` 的 `myActionState` 上 watch（或 GameView 挂载处接入）。
- **验收**：手动验证三种结束路径（自己操作/超时/本手结束）title 都能复原。

### 3. All-in 分阶段发牌（P1，摊牌悬念）

- **现状**：全员 all-in 后引擎内多处直接 `showdown()`（`handFlow.ts` `advanceAction` / `startNextPhase` / `startHand` 盲注全 all-in 边界），`dealRemainingBoard` 一次发完并结算，一次 broadcast 全亮。
- **方案**：引擎把"需要 runout"改为返回新 `HandStep` 值（如 `"runout"`）而非就地 showdown；`GameHost.afterStep` 收到后用房间唯一 timer 每 ~800ms 发一条街（flop→turn→river 各 broadcast 一次），发满 5 张再调 `showdown`。引擎其余逻辑不动。
- **落点**：`src/server/game/types.ts`（HandStep 联合类型）、`src/server/game/handFlow.ts`、`src/server/room/gameHost.ts`（runout 状态机 + 与第 1 项共用 timer）、`src/server/room/room.ts`。
- **边界**：runout 期间不接受任何 action（`handOver=false` 但 actionIndex=-1 已天然保证）；中途无人可弃牌；`clearTimers` 要覆盖 runout 中的房间（房间销毁路径）。
- **验收**：测试——全员 all-in 后 board 按 0/3/4/5 渐进到 5 张、最终结算与直接 showdown 逐筹码一致（对照既有结算测试）；与第 1 项共用 timer 不互相打断。

### 4. 摊牌不亮弃牌者的牌（P2）

- **现状**：`serializer.ts:45` `revealHole = isMe || g.revealAll`，弃牌玩家（fold 不清 holeCards）在摊牌时对所有人亮牌，不合 muck 惯例。
- **方案**：加 `!p.folded`；`isMe` 分支保留（自己弃牌后自己仍能看到自己的牌）。
- **落点**：`src/server/room/serializer.ts` 一行。
- **验收**：serializer 测试——showdown 后 folded 玩家的 holeCards 对他人是 `["back","back"]`、对自己是明牌。

### 5. 边池可视化（P1，多路 all-in 看不懂钱怎么分）

- **现状**：`showdown.ts` `buildPots` 分层结算完整，但快照只有总 `pot` 数字。
- **方案**：`GameSnapshot` 增加 `pots: { amount: number; eligibleNames: string[] }[]`；仅 `handOver && lastResults` 时由 `buildPots` 生成（摊牌时 `totalBet` 尚未清零，可直接复用），平时给单层总池或空数组。客户端 `BoardArea` 在结果期显示「主池 240 · 边池 120(限东、南)」。
- **协议改动**：是 → 按约定四处同步 + `docs/client.md`。
- **落点**：`src/shared/protocol.ts`、`src/server/room/serializer.ts`、`src/client/components/BoardArea.vue`。
- **验收**：测试——两个不同深度 all-in 产生两层池、金额合计等于总投入；前端手动验证。

### 6. 重开一局（P2，gameOver 后只能散伙重建房）

- **现状**：`gameOver` 后唯一出路是回大厅重建房间，赢家带着巨款开新桌。
- **方案**：协议新增 `{ type: "restartGame" }`，仅房主、仅 `game.gameOver` 可用：用原座位（含 bot）重建 `createGameState`（沿用房间 `shortDeck`），全员筹码回 `STARTING_CHIPS`、**债务一并清零**（message 注明"重开，筹码已重置"）；`busted` 随新 GameState 自然清空，`readyIds` 清空。可复用 `startGame` 的主体逻辑。
- **协议改动**：是。
- **落点**：`src/shared/protocol.ts`、`src/server/app.ts`、`src/server/room/gameHost.ts`、`src/client/components/ActionBar.vue`（gameOver 时房主显示「重开新局」按钮，与「返回大厅」并列）。
- **验收**：测试——重开后 handId=1、全员 2000、debt=0；非房主/未 gameOver 被拒绝。

---

## 第二批 · 玩法扩展

### 7. 锦标赛盲注递增（最推荐的新玩法）

- **方案**：房主开关（等待页，与「牌型」开关并列；协议如 `{ type: "setBlindUp", payload: { enabled } }`）。开启后每 N 手（建议 8）盲注 ×2，封顶 160/320。**陷阱**：`handFlow.ts:182` `postBlind` 用的是常量 `SMALL_BLIND/BIG_BLIND` 而非 `state.smallBlind/bigBlind`，且 `legalActions`/`resetHand` 里多处 `state.bigBlind || BIG_BLIND` 混用常量——本项第一步先把引擎统一改为读 state 字段，再实现递增（这一步独立可测）。
- **协议改动**：是（开关 + `GameSnapshot` 带下一级预告「第 X 手起 20/40」）。
- **落点**：`src/shared/protocol.ts`、`src/server/game/handFlow.ts`（resetHand 开头按 handId 调整 state 盲注）、`src/server/app.ts`、`src/server/room/room.ts`（blindUp 标志）、房间页 + 状态栏 UI。
- **验收**：单测——统一读 state 后既有测试全绿；第 N+1 手盲注翻倍、minRaise 跟随 state.bigBlind。

### 8. 机器人性格（persona）

- **现状**：11 个 bot 共用同一套阈值 + 随机数，决策同质。
- **方案**：`bot.ts` 增加 persona 表（按名字映射：紧凶/松弱/跟注站/疯子），实现为对 `decide()` 现有阈值的偏置（紧：equity 门槛 +、open 率 −；跟注站：potOdds 门槛 −、bluff 率≈0；疯子：raise 率 +）。保持 `bot.test.ts` 不变量：任何决策都能被 `applyAction` 接受（`clampRaise` 已兜底）。
- **落点**：`src/server/bot/bot.ts`（`decide` 加 persona 参数，由 `botDecide(state, playerId)` 查表注入）、`src/server/bot/bot.test.ts`。
- **验收**：既有测试全绿；可选统计测试——紧 bot 大样本弃牌率显著高于疯子。

### 9. 机器人聊天

- **方案**：bot 在关键事件以低概率（~15%）通过 `room.appendChat(botId, botName, line)` 发台词：大加注/全下、赢大池（`afterStep` hand-end 时看 `lastResults`）、被 bad beat（输给听牌逆转难判定，简化为"输了大池"）。词库独立文件。遵守 `CHAT_HISTORY_KEEP`/`CHAT_TEXT_MAX` 既有约束。
- **落点**：新建 `src/server/bot/lines.ts`、`src/server/room/gameHost.ts`（afterStep / runBotIfNeeded 挂钩）。
- **验收**：手动验证 + 不破坏 chat 上限与广播。

### 10. 观战者竞猜

- **方案**：协议新增 `{ type: "spectatorBet", payload: { targetId, amount } }`（仅观战者、仅 `phase !== showdown && handOver=false`）。`Room` 加内存虚拟积分（`spectatorPoints: Map<id, number>`，初始 1000，不进主经济、不持久化）与当前手押注记录；本手结束后统一结算：押中 +amount×(对手数)，押空 −amount（赔率可后调）。快照带观战者自己的积分与本手押注。
- **协议改动**：是。
- **落点**：`src/shared/protocol.ts`、`src/server/room/room.ts`、`src/server/room/gameHost.ts`（afterStep hand-end 结算，注意只结算一次）、`src/server/app.ts`、`src/client/components/BoardArea.vue`（观战视角押注按钮）。
- **验收**：单测——押中/押空积分变化正确、重复押注被拒、结算只发生一次。

### 11. 新手训练模式：实时胜率

- **方案**：房主开关（复用 `setCheat` 的模式，如 `setCoach`）。开启时，`GameHost` 在轮到**真人**行动时调 `equity.estimateEquity`（iterations 降到 ~300）并把结果放进**该 viewer 的快照**（`myLegal` 加 `winRate?: number`）。只在行动者本人快照出现，别人看不到。
- **成本注意**：每次轮到才算一次，不在每街重复算；bot 决策不受影响。
- **落点**：`src/shared/protocol.ts`、`src/server/room/gameHost.ts`、`src/server/room/serializer.ts`、房间页开关 + `ActionBar.vue` 显示「胜率 ~62%」。
- **验收**：单测——开关关时无字段；开时 0~1；非行动者快照无此字段。

### 12. 牌局历史面板

- **现状**：`lastResults` 每手覆盖、`busted` 只有破产流水，无法回看「第 7 手谁赢了多少」。
- **方案**：`Room` 加 `handLog`（append-only，每手结束 push `{handId, results, board, ts}`，保留最近 50 条）；`GameSnapshot` 带最近 ~10 条（或独立消息按需拉取）；客户端聊天区加「牌局」tab 展示。
- **协议改动**：是。
- **落点**：`src/shared/protocol.ts`、`src/server/room/room.ts`、`src/server/room/gameHost.ts`（hand-end 挂钩）、`src/server/room/serializer.ts`、`src/client/components/ChatDock.vue`。
- **验收**：e2e——两手后 log 长度 2；达到上限后不再增长。

### 13. 快捷表情

- **方案**：`PlayerCard` 点击弹预设表情条（👍😂🤡😰🔥），选择后走 chat 通道（约定前缀如 `[表情]👍`，协议零改动），3s 自动消失的气泡。
- **落点**：`src/client/components/PlayerCard.vue`（或 ChatDock 出口）、`stores/chat.ts`。
- **验收**：手动验证。

---

## 小瑕疵（顺手修）

- `src/server/room/room.ts:96`：bot 显示名按 `botPlayers.length` 取 `BOT_NAMES`，「移除一个再加」会名字复用，与注释 "never reused within a room" 矛盾。改用已有的 `botSeq` 取名（id 已用 `bot_${botSeq}` 保证唯一）。
- `AGENTS.md` 的「无操作超时」措辞：第 1 项落地后自然吻合；若第 1 项延后，先改文档避免误导。
- 性能无需担心：`equity.ts` 500 迭代 ×(对手+1) 次 evaluate7，十人桌毫秒级。
