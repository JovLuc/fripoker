# docs/client.md

前端 L2：`src/client/`（Vue 3 SFC + Vite 构建，TS）。总览见 `../AGENTS.md`；wire 类型在 `../src/shared/protocol.ts`。

## 屏幕流

1. 无昵称 → `NicknameOverlay` 覆盖层（`fripoker_nick` / `fripoker_pid`）
2. 大厅 `screen=lobby`：`LobbyView` 列表 / 创建 / 加入·观战
3. 房间 `screen=game`：`GameView` → waiting 子视图（`WaitingRoom`）或对局布局（`GameLayout`）+ 浮动 `ChatDock`

连接：`api/ws.ts` 按 `location.pathname` 推导 WS 前缀，**末尾补 `/`** 匹配 nginx `location /frp/`（dev 模式连 `ws://<host>:3000/`）。断线 1.5s 重连；onopen 重发 `setNickname`，有 `fripoker_room` 自动 `joinRoom`，否则 `listRooms`。

## 文件

| 路径 | 内容 |
|------|------|
| `main.ts` | 入口：挂载 App + 引入 4 个 css |
| `App.vue` | 根：三屏切换、全局禁右键/框选（成对 add/remove）、`initSession()`（返回 disposer） |
| `api/ws.ts` | `WsClient`：重连、`onMessage/onOpen`、`awaitType(type)` promise 化请求（替代旧 ensureProfileThen 竞态） |
| `stores/session.ts` | **编排中枢**：连接生命周期、ServerMessage 分发、全部动作（submitNickname/createRoom/joinRoomById/leaveRoom/toggleReady/toggleRepay/sendAction/sendChatText/…）、2s 轮询（listRooms / sync，可清理） |
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
- **作弊开关**：`GameView` 状态栏——房主见「作弊:开/关」按钮（发 `setCheat`），非房主仅见「作弊」tag（开时）；默认开
- **聊天**：默认右上可拖；四象限朝视口中心展开；常显 `chatTotal`（全量计数，定宽防跳动）
- **role**：spectator 粘性（仅重新 join 改变）；joined 载荷设初值，快照在非观战时校正

## localStorage key

`fripoker_pid`（重连座位）`fripoker_nick` `fripoker_room` `fripoker_chat_pos` —— **与旧版完全一致**，老用户无缝迁移。

## 协议

双向 `{ type, payload? }`，完整类型见 `src/shared/protocol.ts`（`ClientMessage` / `ServerMessage` 可辨识联合）。此处不重复字段表。

## 改 UI 检查清单

- [ ] 条件出现/消失是否预留高度（`.player` 168px、`.action-slot` 168px、`.message-slot`、`.results`、`.hand-label`、`.chat-count` 定宽）
- [ ] 操作区 / 等待文案切换是否共用 `action-slot`
- [ ] 聊天展开是否仍不挤占主布局（fixed dock）
- [ ] 破产记录出现/消失时公共牌是否居中（`.board-row` 三列 + 右垫）
- [ ] `npm run typecheck`（vue-tsc）通过
