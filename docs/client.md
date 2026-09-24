# docs/client.md

前端 L2：`src/client/`（Vue 3 SFC + Vite 构建，TS）。总览见 `../AGENTS.md`；wire 类型在 `../src/shared/protocol.ts`。

## 屏幕流

1. 无昵称 → `NicknameOverlay` 覆盖层（`fripoker_nick` / `fripoker_pid`）
2. 大厅 `screen=lobby`：`LobbyView` 列表 / 创建 / 加入·观战
3. 房间 `screen=game`：`GameView` → waiting 子视图（`WaitingRoom`）或对局布局（`GameLayout`）+ 浮动 `ChatDock`

连接：`api/ws.ts` 按 `location.pathname` 推导 WS 前缀，**末尾补 `/`** 匹配 nginx `location /fpk/`（dev 模式连 `ws://<host>:3000/`）。断线 1.5s 重连；onopen 重发 `setNickname`，有 `fripoker_room` 自动 `joinRoom`，否则 `listRooms`。

## 文件

| 路径 | 内容 |
|------|------|
| `main.ts` | 入口：挂载 App + 引入 4 个 css |
| `App.vue` | 根：三屏切换、全局禁右键/框选（成对 add/remove）、`initSession()`（返回 disposer） |
| `api/ws.ts` | `WsClient`：重连、`onMessage/onOpen`、`awaitType(type)` promise 化请求（替代旧 ensureProfileThen 竞态） |
| `stores/session.ts` | **编排中枢**：连接生命周期、ServerMessage 分发、全部动作（submitNickname/createRoom/joinRoomById/leaveRoom/addRoomBot/removeRoomBot/startGame/toggleReady/toggleRepay/sendAction/sendChatText/…）、2s 轮询（listRooms / sync，可清理） |
| `stores/room.ts` | 房间快照状态 + 全部 computed（`mySeat` `role` `readyStatusText` `isBusted` `watchLabel` `myActionState` `waitingLabel` `phaseLabel` `bustedList`）；`applyRoomSnapshot` 唯一入口，role 推导仅此一处 |
| `stores/profile.ts` `lobby.ts` `chat.ts` `error.ts` | 身份持久化 / 房间列表 / 聊天与 dock 开合 / 4s 自动清除的错误 toast |
| `composables/useRaiseSlider.ts` | raise-to 滑杆：`syncRaise`（handId/actionPlayerId/myLegal 三 watch）、预设、±10、发送（达上限自动转 allin） |
| `composables/useChatDock.ts` | 拖拽（<4px 视为点击）、四象限、`fripoker_chat_pos` 持久化 |
| `components/NicknameOverlay.vue` `LobbyView.vue` `GameView.vue` `WaitingRoom.vue` `GameLayout.vue` `BoardArea.vue` `PlayerCard.vue` `ActionBar.vue` `ChatDock.vue` | 与旧版 index.html 区块一一对应 |
| `styles/{base,lobby,game,chat}.css` | 旧 `style.css` 原样平移；**类名未改**，视觉零回归 |

## 交互要点（保持不变）

- **操作**：`ActionBar` 单槽四态互斥（轮到我 / handOver 准备 / 破产观战 / 等待文案）；三按钮 + 滑杆；预设 1/2·2/3·满池·全下；无倒计时
- **牌型**：`handLabel` 常驻槽位（服务端 `describeHand` 算好下发）
- **结算**：有 `lastResults` 时 message 置空，只留横线下列表
- **破产**：河牌左 `.busted-log`（append-only 史）；座位角标 `players[].busted`；`allIn` 写 `.turn-slot`
- **复活**：中途回归 `sittingOut` → 「已复活 · 本手观战，下一手参战」
- **借贷**：`.chips-row`「余额 -债务 [还钱]」；按钮发 `repay`（等价聊天「还钱」）
- **作弊开关（UI 显示为「借钱」）**：`GameView` 状态栏——房主见「借钱:开/关」按钮（发 `setCheat`，协议名不变），非房主仅见「借钱」tag（开时）；默认开
- **长短牌开关（UI 显示为「牌型」）**：`GameView` 状态栏「借钱」旁——房主见「牌型:长牌/短牌」按钮（发 `setShortDeck`；本手进行中置灰，手结束后可切、下一手生效），非房主仅短牌时见「短牌」tag；默认长牌
- **机器人增减**：`WaitingRoom` 房主见「+/- 机器人」按钮（发 `addBot`/`removeBot`，仅 waiting 有效、满 10 席禁用加）；座位网格真人/机器人/空位三类，大厅列表按 真人+机器人 席位判断可否加入
- **聊天**：默认右上可拖（`top:80px` 让开双行页头）；**仅房间页渲染**（GameView 内），离开房间 `resetChat()` 清空——聊天按房间隔离，快照整包覆盖；常显 `chatTotal`（定宽防跳动）
- **role**：spectator 粘性（仅重新 join 改变）；joined 载荷设初值，快照在非观战时校正

## localStorage key

`fripoker_pid`（重连座位）`fripoker_nick` `fripoker_room` `fripoker_chat_pos` —— **与旧版完全一致**，老用户无缝迁移。

## 协议

双向 `{ type, payload? }`，完整类型见 `src/shared/protocol.ts`（`ClientMessage` / `ServerMessage` 可辨识联合）。此处不重复字段表。

- **对战页布局（六行比例带）**：`.table-screen.playing` 锁定 `100dvh` + `overflow:hidden` **整页不滚动**；固定六行 top / status / **board / msg / players / 操作栏**，后四带高度由 flex 比例分配（`game.css`：board 1.6 / msg 0.5 / players 5 / action 2.4），**与游戏状态无关**——任意状态只换盒子里的内容（v-show），绝不推挤兄弟带；窄屏（≤560px）公共牌区纵排、矮屏（≤720px）字号紧凑
- **玩家卡**：固定 **17% 宽 / 所在行 88% 高**，`justify-content/align-content: center` 紧凑居中 + 10px 固定 gap；列数（每行 3–5）由 `GameLayout` inline 下发；卡内文字行固定高、手牌区 flex:1 自适应（mini 牌 `height:100%` + `aspect-ratio`）
- **操作区**：`.action-slot` 单一比例带、**内容顶对齐**，四态（我的回合 / 等待 / 准备 / 破产观战）全部 `v-show` 切换显隐，DOM 常驻不重挂
- **座位徽标**：单 span `posText(p)`——`离开`（left）/ `破产`（busted）/ D·SB·BB 三态互斥，**空文本整体隐藏**（无空白框）
- **结算与破产记录**：`.message-slot` 比例带、水平垂直双居中（多余结算行裁剪）；`.busted-log` 与公共牌同带高、`justify-content: flex-end` 滚动隐藏（最新在最下）——位置在公共牌左侧（右对齐），移动端纵排时置顶
- **聊天 dock**：fixed 默认 `top:80px / right:16px`（让开顶栏+状态栏两行）；拖拽位置存 `fripoker_chat_pos`，**加载时钳回视口**（换视口不会丢到屏幕外）
- **v-show 约定**：对战页条件展示一律 `v-show`（ActionBar 四态 / PlayerCard 全部条件 / BoardArea 标题与结果 / GameView 双子视图）；常驻渲染要求所有绑定**可空安全**（`room.game?.`，勿用 `!.`），waiting 态 `room.game` 为 null
- **玩家卡固定槽位**：`.chips-row` 三固定区（余额 / 欠款 46px / 还钱 46px），欠款、还钱不显示也占位；卡背只画外框（`.card.back` 无内芯）

## 改 UI 检查清单

- [ ] 条件出现/消失是否预留高度（各区块高度一律走 `.table-screen` 变量并三档分档；`.chips-row` 三固定区、`.hand-label`、`.chat-count` 定宽）
- [ ] 操作区 / 等待文案切换是否共用 `action-slot`
- [ ] 聊天展开是否仍不挤占主布局（fixed dock）
- [ ] 破产记录出现/消失时公共牌是否居中（`.board-row` 三列 + 右垫）
- [ ] `npm run typecheck`（vue-tsc）通过
