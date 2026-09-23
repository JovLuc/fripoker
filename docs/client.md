# docs/client.md

前端 L2：`index.html` + `js/app.js` + `css/style.css`（Vue 3 global，无构建）。总览见 `../AGENTS.md`。

## 屏幕流

1. 无昵称 → 覆盖层设昵称（`fripoker_nick` / `fripoker_pid`）
2. 大厅 `screen=lobby`：列表、创建、加入/观战
3. 房间 `screen=game`：等待 `waiting` 或对局 `room.game`

WS：`wsUrl()` 按 `location.pathname` 推前缀，**末尾补 `/`** 以匹配 nginx `location /fpk/`。断线 1.5s 重连；有 `fripoker_room` 则自动 `joinRoom`。

## 文件

| 路径 | 内容 |
|------|------|
| `index.html` | 三屏结构、操作栏、聊天 dock（`chat-dock`）、河牌左侧破产记录 |
| `js/app.js` | 状态、WS、动作、加注滑杆、聊天拖拽/象限、`isBusted`/`bustedList`、禁右键框选 |
| `css/style.css` | 黑白极简；**条件块预留 min-height** 防跳动；`.board-row` 三列 |

## 交互要点

- **操作**：三按钮 + 滑杆；`stepRaise(±10)`；预设 1/2·2/3·满池·全下；无倒计时
- **牌型**：`handLabel` 常驻槽位；翻前 `describeHand` 两牌，翻后完整名
- **结算**：有 `lastResults` 时 message 行可隐藏，只留横线下列表
- **破产**：河牌左侧 `.busted-log`（`game.busted`，append-only 不清史）显示「xxx已破产」；座位角标用 `players[].busted`（仅 `chips<=0 && !allIn`）；`allIn` 写在 `.turn-slot`（`allin`）
- **复活**：本手中途借钱（曾破产）保持 `sittingOut`，文案「已复活 · 本手观战，下一手参战」；系统仍提示「重回战局」
- **借贷**：筹码同一行 `.chips-row`「余额 -债务 [还钱]」；按钮发 `type: repay`（或聊天「还钱」）；系统消息 `+200` / `-金额`
- **聊天滚动条**：`.chat-log` 细滚动条（`scrollbar-width: thin` + webkit 6px），色用 `--line-strong` / `--dim`
- **准备开局**：`handOver` 时操作区「准备」（`type: ready`）；0 币不可准备；`requiredReady` 显示进度；全员 ready 自动发牌。破产房主不再被观战分支挡住
- **布局**：`.board-row` 三列（破产记录 / 公共牌 / 右垫）；`.player` / `.action-slot` / `.message-slot` / `.results` / `.hand-label` 等固定高度
- **聊天**：默认 `top:40px` 右上；按钮可拖（存 `fripoker_chat_pos`）；按四象限绝对定位面板（TR→左下，TL→右下，BL→右上，BR→左上）；按钮常显 `chatTotal`（全量计数，不受 80 条历史上限影响，定宽 `.chat-count`）
- **禁选**：`user-select:none` + `contextmenu`/`selectstart`；`input/textarea` 例外

## 协议字段（room 快照子集）

`status` `hostId` `humanPlayers` `chat[]` `game.{handId,phase,board,pot,message,handOver,gameOver,busted[],players[],myLegal,lastResults}`

`players[]`：`isMe` `holeCards` `handLabel` `isDealer/isSB/isBB` `roundBet` `lastAction` `chips` `debt` `busted` `allIn` …

`busted[]`（game 级）：`{id,name}` **append-only** 破产史；再破产再追加，借钱不清史。

新增 UI 状态优先放 `app.js` setup 返回值，并同步本文件「交互要点」。

## 改 UI 检查清单

- [ ] 条件出现/消失是否预留高度  
- [ ] 操作区 / 等待文案切换是否共用 `action-slot`  
- [ ] 聊天展开是否仍不挤占主布局  
- [ ] 破产记录出现/消失时公共牌是否居中  
- [ ] `node --check js/app.js`  
