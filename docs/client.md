# docs/client.md

前端 L2：`src/client/`（Vue 3 SFC + Vite 构建，TS）。总览见 `../AGENTS.md`；wire 类型在 `../src/shared/protocol.ts`。

## 屏幕流

1. 无昵称 → `NicknameOverlay` 覆盖层（`fripoker_nick` / `fripoker_pid`）
2. 大厅 `screen=lobby`：`LobbyView` 列表 / 创建 / 加入·观战（房间卡带玩法 tag）——点「创建房间」弹 **`ChoiceDialog`** 选玩法（德州扑克 / 三张牌）后再创建
3. 房间 `screen=game`：`GameView` → waiting 子视图（`WaitingRoom`）或对局布局（`GameLayout`）+ 浮动 `ChatDock`；状态栏与操作区按 `room.kind` 分支（`GameSnapshot` 是 `kind` 可辨识联合，先窄化再读 `board`/`round` 等专属字段）

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
| `components/NicknameOverlay.vue` `ChoiceDialog.vue` `LobbyView.vue` `GameView.vue` `WaitingRoom.vue` `GameLayout.vue` `BoardArea.vue` `PlayerCard.vue` `ActionBar.vue` `ChatDock.vue` | 与旧版 index.html 区块一一对应 + **通用选择弹窗**（`ChoiceDialog`：`.dialog-mask`/`.panel.narrow` 壳在 base.css，大厅选玩法与开牌选对手共用） |
| `styles/{base,lobby,game,chat}.css` | 旧 `style.css` 原样平移；**类名未改**，视觉零回归 |

## 交互要点（保持不变）

- **操作**：`ActionBar` 单槽四态互斥（轮到我 / handOver 准备 / 破产观战 / 等待文案）；0 筹码玩家需借款后才能准备，所有未离开真人准备且至少两席有筹码才自动发牌；三按钮 + 滑杆；预设 1/2·2/3·满池·全下；无倒计时
- **三张牌（kind=tp）**：同一 `action-slot` 骨架——回合行四列（`.action-row.four`：弃牌 / 看牌（已看则 disabled **占位防跳列**）/ 下注 X（滑杆实付，**唯一下注入口**）/ 开牌 N（**按钮带费，= 下注成本**：暗 N / 明 2N）），滑杆与预设**实付语义**；**无过牌、无轮次**——`phaseLabel` 恒「下注」、**注基数 N 在状态栏**（`注 N · 底池`）、`.board` **留空**（tp 不渲染任何面板，占位保六带高度）；点开牌弹 **`ChoiceDialog`**（通用 `.dialog-mask` 壳，发 `compare+targetId`）——**重置必须用多源 `watch([src1, src2])`**，单 getter 数组 `watch(() => [a, b])` 会随 2s 快照轮询误关弹窗；看牌 `look` 仅自己回合 `advance:false`；座位徽标 `posText(p, kind)`——tp 庄显「**庄**」、hold'em 显 D；**看牌状态由 `.turn-dot` 显「看」（allin 优先），轮到靠 `.player.active` 边框高亮**，cards 恒并排（未看=牌背，自己看后=牌面）；状态栏挂「三张牌」tag
- **牌型**：`handLabel` 常驻槽位（服务端按玩法算好下发：德州 `describeHand` / 三张牌 `evaluate3`；未看牌且未摊牌时为空）
- **结算**：有 `lastResults` 时 message 置空，只留横线下列表
- **破产**：河牌左 `.busted-log`（append-only 史）；座位角标 `players[].busted`；`allIn` 写 `.player-top` 内 `.turn-dot` 角标（与「看」共用一个元素，allin 优先；轮到不再有文字，靠 `.player.active` 边框）
- **复活**：中途回归 `sittingOut` → 「已复活 · 本手观战，下一手参战」
- **借贷**：筹码为 0 的玩家在手牌结束后，可从筹码排行前两名玩家卡片点「向我借」并填写金额（默认出借人当前筹码的一半）；出借人同意后转账，牌桌左侧记录借贷双方与金额；还钱按钮发 `repay`（等价聊天「还钱」）
- **作弊开关（UI 显示为「借钱」）**：`GameView` 状态栏——房主见「借钱:开/关」按钮（发 `setCheat`，协议名不变），非房主仅见「借钱」tag（开时）；默认开
- **长短牌开关（UI 显示为「牌型」）**：**仅 `kind==='holdem'` 房间渲染**（`GameView` `v-if` 包裹；tp 房间服务端也会拒绝 `setShortDeck`）——房主见「牌型:长牌/短牌」按钮（发 `setShortDeck`；本手进行中置灰，手结束后可切、下一手生效），非房主仅短牌时见「短牌」tag；短牌牌型为**顺子>三条、同花>葫芦**，默认长牌
- **机器人增减**：`WaitingRoom` 房主见「+/- 机器人」按钮（发 `addBot`/`removeBot`，仅 waiting 有效、满 10 席禁用加）；座位网格真人/机器人/空位三类，大厅列表按 真人+机器人 席位判断可否加入
- **聊天**：默认右上可拖（`top:80px` 让开双行页头）；**仅房间页渲染**（GameView 内），离开房间 `resetChat()` 清空——聊天按房间隔离，快照整包覆盖；常显 `chatTotal`（定宽防跳动）
- **role**：spectator 粘性（仅重新 join 改变）；joined 载荷设初值，快照在非观战时校正

## localStorage key

`fripoker_pid`（重连座位）`fripoker_nick` `fripoker_room` `fripoker_chat_pos` —— **与旧版完全一致**，老用户无缝迁移。

## 协议

双向 `{ type, payload? }`，完整类型见 `src/shared/protocol.ts`（`ClientMessage` / `ServerMessage` 可辨识联合）。此处不重复字段表。

- **对战页布局（六行比例带）**：常规视口下 `.table-screen.playing` 锁定 `100dvh` + `overflow:hidden`，固定六行 top / status / **board / msg / players / 操作栏**，后四带按 flex 比例分配；矮横屏（≤520px）切为纵向滚动并给牌区/玩家区保留可读高度，避免压扁卡片与操作区。五张公共牌按中间列可用宽度等比收缩，始终保持一行
- **横屏优先响应式**：仍是一套六带 DOM；横屏座位列 17% 宽、每行 3–5；竖屏（`orientation: portrait` 或 ≤480px）`GameLayout` 把 `--seat-cols` 降到 1–3、CSS 改 `1fr` 等宽，chips 三区收窄、操作按钮 ≥44px 触控，status 可换行，safe-area 用 `env(safe-area-inset-*)`；**不要**再拆第二套竖屏组件
- **玩家卡**：横屏固定 **17% 宽**；**行高恒为半高** `grid-auto-rows: calc((100% - 10px)/2)`——1 行占半、2 行+gap 刚好占满、**3 行及以上出 y-scroller**（`overflow-y:auto` 常开 + `align-content: safe center`，**无 JS `.multi` 类**）；10px 固定 gap；列数由 `GameLayout` 下发 CSS 变量 `--seat-cols`（勿 inline 整串 `grid-template-columns`，否则竖屏媒体查询盖不掉）；卡内文字行固定高、手牌区 flex:1 自适应（mini 牌 `height:100%` + `aspect-ratio`）
- **操作区**：`.action-slot` 单一比例带、**内容顶对齐**，四态（我的回合 / 等待 / 准备 / 破产观战）全部 `v-show` 切换显隐，DOM 常驻不重挂
- **座位徽标**：单 span `posText(p, kind)`——`离开`（left）/ `破产`（busted）/ `庄`（tp 的 isDealer，hold'em 显 D）/ D·SB·BB 互斥，**空文本整体隐藏**（无空白框）；**看牌状态在 `.turn-dot`（「看」）**，不在 pos 里
- **结算与破产记录**：`.message-slot` 比例带、水平垂直双居中（多余结算行裁剪）；`.busted-log` 与公共牌同带高、`justify-content: flex-end` 滚动隐藏（最新在最下）——位置在公共牌左侧（右对齐），移动端纵排时置顶
- **聊天 dock**：未拖动时参与状态栏流式布局，不遮挡牌桌内容；拖动后按视口固定定位并存 `fripoker_chat_pos`，**加载时钳回视口**（换视口不会丢到屏幕外）
- **v-show 约定**：对战页条件展示一律 `v-show`（ActionBar 四态 / PlayerCard 全部条件 / BoardArea 标题与结果 / GameView 双子视图）；常驻渲染要求所有绑定**可空安全**（`room.game?.`，勿用 `!.`），waiting 态 `room.game` 为 null
- **玩家卡固定槽位**：`.chips-row` 三固定区（余额 / 欠款 46px / 还钱 46px），欠款、还钱不显示也占位；卡背只画外框（`.card.back` 无内芯）

## 改 UI 检查清单

- [ ] 条件出现/消失是否预留高度（各区块高度一律走 `.table-screen` 变量并三档分档；`.chips-row` 三固定区、`.hand-label`、`.chat-count` 定宽）
- [ ] 操作区 / 等待文案切换是否共用 `action-slot`
- [ ] 聊天展开是否仍不挤占主布局（fixed dock）
- [ ] 破产记录出现/消失时公共牌是否居中（`.board-row` 三列 + 右垫）
- [ ] 横竖屏各看一眼：座位列数、chips 不溢出、操作按钮可点（`--seat-cols` + portrait 媒体查询）
- [ ] `npm run typecheck`（vue-tsc）通过
