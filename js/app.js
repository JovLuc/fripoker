/* fripoker Vue client — L2: docs/client.md | L1: AGENTS.md
   Screens: nickname → lobby → room. WS URL adds trailing slash for /fpk proxy. */
const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted } = Vue;

createApp({
  setup() {
    const profile = reactive({
      playerId: localStorage.getItem("fripoker_pid") || "",
      nickname: localStorage.getItem("fripoker_nick") || "",
    });
    const nickInput = ref("");
    const screen = ref("lobby");
    const rooms = ref([]);
    const roomName = ref("");
    const room = reactive({
      id: "",
      name: "",
      status: "waiting",
      hostId: "",
      hostName: "",
      humanPlayers: [],
      spectators: [],
      maxPlayers: 6,
      game: null,
    });
    const role = ref("player");
    const error = ref("");
    const raiseTo = ref(0);
    const countdown = ref(0);
    const chat = ref([]);
    const chatTotal = ref(0);
    const chatOpen = ref(false);
    const chatInput = ref("");
    const chatPos = ref(null); // {x,y} after drag; null = default top-right
    const chatDragging = ref(false);
    const chatQuadrant = ref("tr"); // tr tl br bl
    let chatDragMoved = false;
    let chatDragStart = null;
    let lastHandId = 0;
    let ws = null;
    let reconnectTimer = null;
    let countTimer = null;
    let handEndAt = 0;

    function updateChatQuadrant() {
      const dock = document.querySelector(".chat-dock");
      if (!dock) return;
      const r = dock.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const right = cx >= window.innerWidth / 2;
      const bottom = cy >= window.innerHeight / 2;
      chatQuadrant.value = (bottom ? "b" : "t") + (right ? "r" : "l");
    }

    function loadChatPos() {
      try {
        const raw = localStorage.getItem("fripoker_chat_pos");
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
      } catch (_) { /* ignore */ }
      return null;
    }

    function saveChatPos(p) {
      try {
        if (p) localStorage.setItem("fripoker_chat_pos", JSON.stringify(p));
        else localStorage.removeItem("fripoker_chat_pos");
      } catch (_) { /* ignore */ }
    }

    chatPos.value = loadChatPos();

    function onChatToggleClick() {
      if (chatDragMoved) {
        chatDragMoved = false;
        return;
      }
      updateChatQuadrant();
      toggleChat();
    }

    function onChatDragStart(e) {
      if (e.button != null && e.button !== 0) return;
      const dock = e.currentTarget.closest(".chat-dock") || e.currentTarget.parentElement;
      const rect = e.currentTarget.getBoundingClientRect();
      chatDragMoved = false;
      chatDragStart = {
        mx: e.clientX,
        my: e.clientY,
        x: dock.getBoundingClientRect().left,
        y: dock.getBoundingClientRect().top,
        // dock is button-sized when panel is absolute
        w: rect.width,
        h: rect.height,
      };

      const onMove = (ev) => {
        if (!chatDragStart) return;
        const dx = ev.clientX - chatDragStart.mx;
        const dy = ev.clientY - chatDragStart.my;
        if (!chatDragMoved && Math.hypot(dx, dy) < 4) return;
        chatDragMoved = true;
        chatDragging.value = true;
        const maxX = Math.max(0, window.innerWidth - chatDragStart.w);
        const maxY = Math.max(0, window.innerHeight - chatDragStart.h);
        const x = Math.min(maxX, Math.max(0, chatDragStart.x + dx));
        const y = Math.min(maxY, Math.max(0, chatDragStart.y + dy));
        chatPos.value = { x: Math.round(x), y: Math.round(y) };
        updateChatQuadrant();
      };

      const onUp = () => {
        if (chatDragMoved && chatPos.value) saveChatPos(chatPos.value);
        chatDragging.value = false;
        chatDragStart = null;
        updateChatQuadrant();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      e.preventDefault();
    }

    function isEditable(el) {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onContextMenu(e) {
      e.preventDefault();
    }
    function onSelectStart(e) {
      if (isEditable(e.target)) return;
      e.preventDefault();
    }
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectstart", onSelectStart);

    function clearError() {
      error.value = "";
    }

    function showError(msg) {
      error.value = msg;
      setTimeout(() => {
        if (error.value === msg) error.value = "";
      }, 4000);
    }

    function wsUrl() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // directory prefix for reverse proxy (e.g. /fpk) — nginx location /fpk/ needs trailing slash
      let base = location.pathname.replace(/\/index\.html?$/i, "");
      base = base.replace(/\/+$/, "");
      if (!base || base === ".") {
        return `${proto}://${location.host}/`;
      }
      return `${proto}://${location.host}${base}/`;
    }

    function connect() {
      ws = new WebSocket(wsUrl());

      ws.onopen = () => {
        if (profile.nickname) {
          send({ type: "setNickname", nickname: profile.nickname, playerId: profile.playerId });
        }
        const savedRoom = localStorage.getItem("fripoker_room");
        if (profile.nickname && savedRoom) {
          send({ type: "joinRoom", roomId: savedRoom });
        } else {
          send({ type: "listRooms" });
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 1500);
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "rooms") {
          rooms.value = msg.payload || [];
        } else if (msg.type === "profile") {
          profile.playerId = msg.payload.playerId;
          profile.nickname = msg.payload.nickname;
          localStorage.setItem("fripoker_nick", profile.nickname);
          localStorage.setItem("fripoker_pid", profile.playerId);
        } else if (msg.type === "error") {
          showError(msg.payload.message);
          if (String(msg.payload.message).includes("房间不存在")) {
            localStorage.removeItem("fripoker_room");
            screen.value = "lobby";
            send({ type: "listRooms" });
          }
        } else if (msg.type === "joined") {
          role.value = msg.payload.role === "spectator" ? "spectator" : (msg.payload.isHost || msg.payload.role === "host" ? "host" : "player");
          room.id = msg.payload.roomId;
          profile.playerId = msg.payload.playerId;
          localStorage.setItem("fripoker_room", msg.payload.roomId);
          screen.value = "game";
        } else if (msg.type === "room") {
          applyRoom(msg.payload);
        } else if (msg.type === "left") {
          screen.value = "lobby";
          room.game = null;
          room.id = "";
          localStorage.removeItem("fripoker_room");
          send({ type: "listRooms" });
        }
      };
    }

    function applyRoom(payload) {
      if (!payload) return;
      room.id = payload.roomId;
      room.name = payload.name;
      room.status = payload.status;
      room.hostId = payload.hostId;
      room.hostName = payload.hostName;
      room.humanPlayers = payload.humanPlayers || [];
      room.spectators = payload.spectators || [];
      room.maxPlayers = payload.maxPlayers || 6;
      room.game = payload.game;
      chat.value = payload.chat || [];
      chatTotal.value = payload.chatTotal != null ? payload.chatTotal : chat.value.length;
      if (chatOpen.value) {
        requestAnimationFrame(() => {
          const el = document.getElementById("chat-log");
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
      if (room.game && room.game.handOver) {
        if (!handEndAt) handEndAt = Date.now() + 3500;
      } else {
        handEndAt = 0;
      }
      if (role.value !== "spectator") {
        if (room.hostId === profile.playerId) role.value = "host";
        else if (room.humanPlayers.some((p) => p.id === profile.playerId)) role.value = "player";
      }
      syncRaise();
    }

    function send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    }

    function submitNickname() {
      const n = (nickInput.value || "").trim();
      if (!n) {
        showError("请输入昵称");
        return;
      }
      send({ type: "setNickname", nickname: n, playerId: profile.playerId });
      profile.nickname = n;
      localStorage.setItem("fripoker_nick", n);
      screen.value = "lobby";
      send({ type: "listRooms" });
    }

    function changeNickname() {
      profile.nickname = "";
      nickInput.value = "";
      localStorage.removeItem("fripoker_nick");
    }

    function ensureProfileThen(fn) {
      if (!profile.nickname) {
        showError("请先设置昵称");
        return;
      }
      if (profile.playerId) {
        send({ type: "setNickname", nickname: profile.nickname, playerId: profile.playerId });
        fn();
        return;
      }
      send({ type: "setNickname", nickname: profile.nickname });
      const prev = ws.onmessage;
      const t = setTimeout(() => {
        showError("连接超时，请重试");
      }, 3000);
      ws.addEventListener("message", function onTemp(ev) {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "profile") {
            clearTimeout(t);
            ws.removeEventListener("message", onTemp);
            profile.playerId = m.payload.playerId;
            fn();
          }
        } catch (_) { /* ignore */ }
      }, { once: false });
    }

    function createRoom() {
      clearError();
      ensureProfileThen(() => {
        send({ type: "createRoom", name: roomName.value.trim() });
        roomName.value = "";
      });
    }

    function joinRoom(id) {
      clearError();
      ensureProfileThen(() => {
        localStorage.setItem("fripoker_room", id);
        send({ type: "joinRoom", roomId: id });
      });
    }

    function leaveRoom() {
      send({ type: "leaveRoom" });
      screen.value = "lobby";
      room.game = null;
      room.id = "";
      role.value = "player";
      localStorage.removeItem("fripoker_room");
      send({ type: "listRooms" });
    }

    function startGame() {
      send({ type: "startGame" });
    }

    function nextHand() {
      send({ type: "ready" });
    }

    function toggleReady() {
      send({ type: "ready" });
    }

    function toggleRepay() {
      send({ type: "repay" });
    }

    const mySeat = computed(() => {
      if (!room.game || !profile.playerId) return null;
      return room.game.players.find((p) => p.id === profile.playerId) || null;
    });

    const readyStatusText = computed(() => {
      if (!room.game) return "";
      if (room.game.gameOver) return room.game.message || "对局结束";
      const req = room.game.requiredReady || [];
      const waiting = req.filter((r) => !r.ready).map((r) => r.name);
      const done = req.length - waiting.length;
      if (!room.game.handOver) return "本手进行中";
      if (!waiting.length) return "全员已准备 · 开局中…";
      return `本手结束 · 准备 ${done}/${req.length} · 等待 ${waiting.join("、")}`;
    });

    function toggleChat() {
      chatOpen.value = !chatOpen.value;
      if (chatOpen.value) {
        requestAnimationFrame(() => {
          const el = document.getElementById("chat-log");
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    }

    function sendChat() {
      const text = (chatInput.value || "").trim();
      if (!text) return;
      send({ type: "chat", text });
      chatInput.value = "";
    }

    const bustedList = computed(() => (room.game && room.game.busted) || []);

    const isBusted = computed(() => {
      if (!room.game || room.status !== "playing") return false;
      if (!profile.playerId) return false;
      const me = room.game.players.find((p) => p.id === profile.playerId);
      if (!me) return false;
      // true bust, or rebought mid-hand (still sitting out until next deal)
      if (me.chips <= 0) return true;
      if (me.sittingOut && !room.game.handOver) return true;
      return false;
    });

    const watchLabel = computed(() => {
      const me = room.game && room.game.players.find((p) => p.id === profile.playerId);
      if (me && me.chips > 0 && me.sittingOut && !room.game.handOver) {
        return "已复活 · 本手观战，下一手参战";
      }
      return "你已破产 · 只能观战";
    });

    const myActionState = computed(() => {
      if (!room.game) return null;
      if (role.value === "spectator") return null;
      if (isBusted.value) return null;
      return room.game.myLegal || null;
    });

    const raiseMin = computed(() => {
      if (!myActionState.value) return 0;
      return Math.min(myActionState.value.minRaiseTo, myActionState.value.maxRaiseTo);
    });

    const raiseMax = computed(() => {
      if (!myActionState.value) return 0;
      return myActionState.value.maxRaiseTo;
    });

    const raiseLabel = computed(() => {
      if (!myActionState.value) return "加注";
      if (raiseTo.value >= raiseMax.value) return `全下 ${raiseMax.value}`;
      if (!myActionState.value.canCheck && raiseTo.value === myActionState.value.needToCall + myActionState.value.roundBet) {
        // raise to equal call only if can raise above - actually raise-to includes current bet
      }
      if (myActionState.value.currentBet === 0) return `下注 ${raiseTo.value}`;
      if (raiseTo.value === myActionState.value.minRaiseTo) return `加注到 ${raiseTo.value}`;
      return `加注到 ${raiseTo.value}`;
    });

    const raiseHint = computed(() => {
      if (!myActionState.value) return "";
      if (raiseTo.value > raiseMax.value) return "超出可加注上限";
      if (raiseTo.value < myActionState.value.minRaiseTo && raiseTo.value < raiseMax.value) {
        return `最小加注到 ${myActionState.value.minRaiseTo}`;
      }
      return "";
    });

    const waitingLabel = computed(() => {
      if (!room.game) return "";
      if (isBusted.value) return watchLabel.value;
      if (role.value === "spectator") return "观战中 · 等待选手行动";
      if (room.game.actionPlayerName) return `等待 ${room.game.actionPlayerName} 行动…`;
      return "等待…";
    });

    const phaseLabel = computed(() => {
      if (!room.game) return "";
      if (room.game.gameOver) return "结束";
      const m = { preflop: "翻前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌", idle: "等待" };
      return m[room.game.phase] || room.game.phase;
    });

    function syncRaise() {
      if (!myActionState.value) return;
      const st = myActionState.value;
      const min = Math.min(st.minRaiseTo, st.maxRaiseTo);
      const handId = room.game ? room.game.handId : 0;
      if (handId !== lastHandId) {
        lastHandId = handId;
        raiseTo.value = min;
        return;
      }
      if (raiseTo.value < min || raiseTo.value > st.maxRaiseTo) {
        raiseTo.value = st.canCheck
          ? Math.min(st.maxRaiseTo, Math.max(min, st.roundBet + Math.max(st.bigBlind || 20, Math.floor(st.pot * 0.5))))
          : min;
        if (raiseTo.value < min) raiseTo.value = min;
        if (raiseTo.value > st.maxRaiseTo) raiseTo.value = st.maxRaiseTo;
      }
    }

    watch(() => room.game && room.game.handId, () => {
      const handId = room.game ? room.game.handId : 0;
      lastHandId = handId;
      raiseTo.value = 0;
      syncRaise();
    });

    watch(() => room.game && room.game.actionPlayerId, () => {
      syncRaise();
    });

    watch(() => room.game && room.game.myLegal, () => {
      syncRaise();
    }, { deep: true });

    function setRaisePreset(frac) {
      if (!myActionState.value) return;
      const st = myActionState.value;
      const potPart = Math.floor(st.pot * frac);
      let to;
      if (st.currentBet === 0) {
        to = st.roundBet + Math.max(st.minRaiseTo - st.roundBet, potPart);
      } else {
        to = st.currentBet + Math.max(st.minRaiseTo - st.currentBet, potPart);
      }
      raiseTo.value = Math.max(st.minRaiseTo, Math.min(st.maxRaiseTo, to));
    }

    function stepRaise(delta) {
      if (!myActionState.value) return;
      const st = myActionState.value;
      const min = Math.min(st.minRaiseTo, st.maxRaiseTo);
      const max = st.maxRaiseTo;
      raiseTo.value = Math.max(min, Math.min(max, Number(raiseTo.value) + delta));
    }

    function sendAction(action) {
      send({ type: "action", action });
      clearError();
    }

    function sendRaise() {
      if (!myActionState.value) return;
      const to = Number(raiseTo.value);
      if (to > raiseMax.value || (to < myActionState.value.minRaiseTo && to < raiseMax.value)) {
        showError(raiseHint.value || "非法加注");
        return;
      }
      if (to >= myActionState.value.maxRaiseTo) {
        send({ type: "action", action: "allin" });
      } else {
        send({ type: "action", action: "raise", amount: to });
      }
      clearError();
    }

    function rankOf(code) {
      if (!code || code === "back") return "";
      return code[0] === "T" ? "10" : code[0];
    }

    function posLabel(p) {
      if (!p) return "";
      if (p.isDealer) return "D";
      if (p.isSB) return "SB";
      if (p.isBB) return "BB";
      return "";
    }

    function suitOf(code) {
      if (!code || code === "back") return "";
      const s = code[1];
      if (s === "H") return "♥";
      if (s === "D") return "♦";
      if (s === "C") return "♣";
      return "♠";
    }

    function suitClass(code) {
      if (!code || code === "back") return "";
      const s = code[1];
      // monochrome: still mark red suits for slight weight difference via class only
      return s === "H" || s === "D" ? "red" : "black";
    }

    onMounted(() => {
      if (profile.nickname) {
        nickInput.value = "";
        connect();
      } else {
        connect();
      }
      countTimer = setInterval(() => {
        if (handEndAt) {
          countdown.value = Math.max(0, Math.ceil((handEndAt - Date.now()) / 1000));
          if (countdown.value === 0) handEndAt = 0;
        }
      }, 200);
      // periodic room list refresh while lobby
      setInterval(() => {
        if (screen.value === "lobby") send({ type: "listRooms" });
        if (screen.value === "game") send({ type: "sync" });
      }, 2000);
    });

    onUnmounted(() => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (countTimer) clearInterval(countTimer);
    });

    return {
      profile,
      nickInput,
      screen,
      rooms,
      roomName,
      room,
      role,
      error,
      raiseTo,
      countdown,
      myActionState,
      raiseMin,
      raiseMax,
      raiseLabel,
      raiseHint,
      waitingLabel,
      phaseLabel,
      bustedList,
      isBusted,
      watchLabel,
      mySeat,
      readyStatusText,
      toggleReady,
      toggleRepay,
      submitNickname,
      changeNickname,
      createRoom,
      joinRoom,
      leaveRoom,
      startGame,
      nextHand,
      sendAction,
      sendRaise,
      setRaisePreset,
      stepRaise,
      rankOf,
      posLabel,
      suitOf,
      suitClass,
      chat,
      chatTotal,
      chatOpen,
      chatInput,
      chatPos,
      chatDragging,
      chatQuadrant,
      toggleChat,
      sendChat,
      onChatDragStart,
      onChatToggleClick,
    };
  },
}).mount("#app");
