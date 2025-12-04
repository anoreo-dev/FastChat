if (window.__fastchat_loaded) {
  console.warn('fastchat already loaded — skipping second load')
} else {
  window.__fastchat_loaded = true;

  (function(){

  let ws
  const meEl = document.getElementById("me")
const loginEl = document.getElementById("login")
const appEl = document.getElementById("app")
const nickInput = document.getElementById("nick")
const btnConnect = document.getElementById("btnConnect")
const endBtn = document.getElementById("end")
const usersPanel = document.getElementById("users")
const inboxPanel = document.getElementById("inbox")
const groupPanel = document.getElementById("group")
const tabUsers = document.getElementById("tabUsers")
const tabInbox = document.getElementById("tabInbox")
const tabGroup = document.getElementById("tabGroup")
const groupMessages = document.getElementById("groupMessages")
const groupText = document.getElementById("groupText")
const sendGroup = document.getElementById("sendGroup")
const groupFile = document.getElementById("groupFile")
let myNick = null

function showPanel(name) {
  // hide all panels and deactivate nav buttons
  document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); })
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))

  // show the requested panel and mark nav button active
  if (name === 'users') {
    usersPanel.classList.remove('hidden')
    usersPanel.classList.add('active')
    tabUsers.classList.add('active')
  }
  if (name === 'inbox') {
    inboxPanel.classList.remove('hidden')
    inboxPanel.classList.add('active')
    tabInbox.classList.add('active')
  }
  if (name === 'group') {
    groupPanel.classList.remove('hidden')
    groupPanel.classList.add('active')
    tabGroup.classList.add('active')
  }
}

tabUsers.onclick = () => showPanel("users")
tabInbox.onclick = () => showPanel("inbox")
tabGroup.onclick = () => showPanel("group")

btnConnect.onclick = () => {
  const nick = nickInput.value.trim()
  if (!nick) return alert("Nhập nickname")
  myNick = nick
  // build websocket URL robustly (use same origin -> ws:// or wss://)
  try {
    const wsUrl = location.origin.replace(/^http/, 'ws');
    console.log('[ui] Connecting websocket to', wsUrl);
    ws = new WebSocket(wsUrl);
  } catch (e) {
    console.log('[ui] fallback ws to localhost:3000');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + 'localhost:3000');
  }
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "connect", nick }))
    loginEl.classList.add("hidden")
    appEl.classList.remove("hidden")
    meEl.textContent = nick
    showPanel("users")
    // group history persistence disabled by user preference — do not fetch persisted history
    // wire up Play X/O button after login (button exists in DOM)
    try {
      const btn = document.getElementById('convPlayXo')
      if (btn) btn.onclick = () => {
        const partner = document.getElementById('convHeader') && document.getElementById('convHeader').dataset && document.getElementById('convHeader').dataset.partner
        if (!partner) return alert('Open a 1-1 conversation to play')
        // send challenge
        sendGameMessage(partner, 'CHALLENGE')
        storePrivateMessage(myNick, partner, `(game) challenged ${partner} to X/O`)
      }
    } catch(e) {}
  }
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data)
      console.log('[ui] ws message', m)
      handleMessage(m)
    } catch (e) {
      console.warn(e)
    }
  }
  ws.onerror = (e) => { console.error('[ui] ws error', e); }
  ws.onclose = (e) => { console.warn('[ui] ws closed', e); alert('Disconnected (ws closed)'); location.reload(); }
}

endBtn.onclick = () => {
  if (!ws) return
  // clear private (session) conversations involving this user
  try {
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('chat_'));
    for (const k of keys) {
      if (k.includes(myNick)) sessionStorage.removeItem(k);
    }
  } catch(e) { console.warn('failed clearing sessionStorage', e) }
  ws.send(JSON.stringify({ type: "end", nick: myNick }))
  ws.close()
}

// when the window is unloaded (closed/tab closed), notify server and clear session private chats
window.addEventListener('beforeunload', (ev) => {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // clear private sessionStorage
      const keys = Object.keys(sessionStorage).filter(k => k.startsWith('chat_'));
      for (const k of keys) {
        if (k.includes(myNick)) sessionStorage.removeItem(k);
      }
      ws.send(JSON.stringify({ type: 'end', nick: myNick }));
      ws.close();
    }
  } catch(e) { /* ignore */ }
});

function handleMessage(m) {
  if (m.source === "broker") {
    const line = m.line
    if (line.startsWith("USERS|")) {
      const list = line.split("|")[1] || ""
      renderUsers(list.split(",").filter((x) => x))
    } else if (line.startsWith("MSG|")) {
      // MSG|from|TO_TYPE|target|payload
      const parts = line.split("|")
      const from = parts[1]
      const toType = parts[2]
      const target = parts[3]
      const payload = parts.slice(4).join('|')
      if (toType === 'USER') {
        // private message to a user
        if (payload && payload.startsWith('GAME::XO::')) {
          // game control message for X/O
          handleXoMessage(from, target, payload)
        } else {
          // normal private message
          storePrivateMessage(from, target, payload)
        }
      } else {
        // group message
        appendGroupMessage(`[${from} -> ${target}] ${payload}`)
      }
    } else if (line.startsWith("FILE|")) {
      // FILE|from|TO_TYPE|target|payload (payload = filename::base64)
      const parts = line.split("|")
      const from = parts[1]
      const toType = parts[2]
      const target = parts[3]
      const payload = parts.slice(4).join('|') || ""
      const idx = payload.indexOf('::')
      const fname = idx >= 0 ? payload.slice(0, idx) : 'file'
      const b64 = idx >= 0 ? payload.slice(idx+2) : ''
      if (toType === 'USER') {
        // private file: render immediately and store minimal metadata (no b64) in session
  // if conversation open -> render inline; otherwise show a notification thumbnail + store metadata
  const current = document.getElementById('convHeader') && document.getElementById('convHeader').dataset.partner
  if (current && (current === from || current === to)) {
    renderPrivateFile(from, target, fname, b64)
  } else {
    // store metadata then show notification so recipient can preview and open chat
    renderPrivateFile(from, target, fname, b64)
    try { showNotificationImage(from, fname, b64) } catch(e) {}
  }
      } else {
        // group file: render inline image if image, else show filename with download
        appendGroupFile(from, target, fname, b64)
      }
    } else if (line.startsWith("CONNECTED|")) {
      // ignore or show
    }
  }
}

function renderPrivateFile(from, to, fname, b64) {
  // render in conversation if open
  const current = document.getElementById('convHeader') && document.getElementById('convHeader').dataset.partner
  if (current && (current === from || current === to)) {
    // append to convMessages
    const el = document.getElementById('convMessages')
    const p = document.createElement('div')
    p.className = 'bubble ' + (from === myNick ? 'me' : 'other')
    if (b64 && isImageFilename(fname)) {
      const img = document.createElement('img')
      img.src = 'data:' + guessMime(fname) + ';base64,' + b64
      img.style.maxWidth = '60%'
      img.style.display = 'block'
      img.style.borderRadius = '8px'
      p.appendChild(img)
      const a = document.createElement('a')
      a.href = createDownloadUrlFromB64(b64, fname)
      a.download = fname
      a.textContent = 'Download'
      a.style.display = 'block'
      a.style.marginTop = '6px'
      p.appendChild(a)
    } else {
      p.textContent = `(file) ${fname}`
    }
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = new Date().toLocaleTimeString()
    p.appendChild(meta)
    el.appendChild(p)
    el.scrollTop = el.scrollHeight
  }
  // store minimal metadata in sessionStorage (without b64 to avoid large storage)
  const key = getConvKey(from, to)
  const arr = JSON.parse(sessionStorage.getItem(key) || '[]')
  arr.push({ from, to, text: `(file) ${fname}`, file: { name: fname }, t: new Date().toISOString() })
  sessionStorage.setItem(key, JSON.stringify(arr))
  renderInboxList()
}

function appendGroupFile(from, target, fname, b64) {
  if (b64 && isImageFilename(fname)) {
    // render image inline
    const m = document.createElement('div')
    m.className = 'bubble other'
    if (from === myNick) m.className = 'bubble me'
    const img = document.createElement('img')
    img.src = 'data:' + guessMime(fname) + ';base64,' + b64
    img.style.maxWidth = '60%'
    img.style.display = 'block'
    img.style.borderRadius = '8px'
    m.appendChild(img)
    const a = document.createElement('a')
    a.href = createDownloadUrlFromB64(b64, fname)
    a.download = fname
    a.textContent = 'Download'
    a.style.display = 'block'
    a.style.marginTop = '6px'
    m.appendChild(a)
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = new Date().toLocaleTimeString()
    m.appendChild(meta)
    groupMessages.appendChild(m)
    groupMessages.scrollTop = groupMessages.scrollHeight
  } else {
    appendGroupMessage(`[${from} -> ${target}] (file) ${fname}`)
  }
}

function isImageFilename(name) {
  if (!name) return false
  name = name.toLowerCase()
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.gif')
}

function guessMime(name) {
  const n = name.toLowerCase()
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
}

function createDownloadUrlFromB64(b64, filename) {
  const byteChars = atob(b64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], { type: guessMime(filename) })
  return URL.createObjectURL(blob)
}

function renderUsers(arr) {
  const usersList = document.querySelector(".users-list")
  usersList.innerHTML = ""
  arr.forEach((u) => {
    // do not show current user in the All Users list
    if (u === myNick) return
    const div = document.createElement("div")
    div.style.display = "flex"
    div.style.justifyContent = "space-between"
    div.style.alignItems = "center"
    div.style.padding = "12px 16px"
    div.style.borderBottom = "1px solid #e5e5ea"
    const nameSpan = document.createElement('span')
    nameSpan.textContent = u
    const btn = document.createElement("button")
    btn.textContent = "Chat"
    btn.onclick = () => openChatWith(u)
    div.appendChild(nameSpan)
    div.appendChild(btn)
    usersList.appendChild(div)
  })
}

// -----------------------
// Private chat / inbox
// -----------------------
function getConvKey(p1, p2) {
  // deterministic key per pair
  return "chat_" + [p1, p2].sort().join("__");
}

function loadConversations() {
  const keys = Object.keys(sessionStorage).filter((k) => k.startsWith("chat_"));
  const convs = keys.map((k) => ({ key: k, data: JSON.parse(sessionStorage.getItem(k) || "[]") }));
  return convs;
}

function renderInboxList() {
  const listEl = document.getElementById("convList");
  listEl.innerHTML = "";
  const convs = loadConversations();
  convs.forEach((c) => {
    // derive partner name
    const parts = c.key.replace("chat_", "").split("__");
    const partner = parts[0] === myNick ? parts[1] : parts[0];
    const latest = c.data.length ? c.data[c.data.length - 1] : null;
    const div = document.createElement("div");
    div.style.padding = "6px";
    div.style.borderBottom = "1px solid #eee";
    const name = document.createElement("div");
    name.textContent = partner;
    const snippet = document.createElement("div");
    snippet.style.fontSize = "12px";
    snippet.style.color = "#666";
    snippet.textContent = latest ? latest.from + ": " + latest.text : "(no messages)";
    div.appendChild(name);
    div.appendChild(snippet);
    div.onclick = () => openConversation(partner);
    // show unread badge if last message from partner and partner != me and partner not currently open
    const current = document.getElementById('convHeader') && document.getElementById('convHeader').dataset.partner;
    if (latest && latest.from !== myNick && current !== partner) {
      const badge = document.createElement('span');
      badge.textContent = ' • new';
      badge.style.color = 'red';
      badge.style.marginLeft = '8px';
      div.appendChild(badge);
    }
    listEl.appendChild(div);
  });
}

function storePrivateMessage(from, to, text) {
  const key = getConvKey(from, to);
  const arr = JSON.parse(sessionStorage.getItem(key) || "[]");
  const msg = { from, to, text, t: new Date().toISOString() };
  arr.push(msg);
  sessionStorage.setItem(key, JSON.stringify(arr));
  // if chat with this partner is open, render
  const hdr = document.getElementById("convHeader");
  const current = hdr && hdr.dataset ? hdr.dataset.partner : null;
  if (current && (current === from || current === to)) {
    renderConversation(current);
  }
  renderInboxList();
}

// --- X/O (Tic-Tac-Toe) game handling ---
function handleXoMessage(from, to, payload) {
  console.log('[game] handleXoMessage from=', from, 'to=', to, 'payload=', payload)
  // payload format: GAME::XO::ACTION::DATA...
  const parts = payload.split('::')
  const action = parts[2]
  const rest = parts.slice(3).join('::') || ''
  const partner = (from === myNick) ? to : from
  const key = getConvKey(myNick, partner)
  if (!games[key]) games[key] = { board: [['','',''],['','',''],['','','']], mySymbol: null, theirSymbol: null, turn: null, started: false }
  const g = games[key]
  if (action === 'CHALLENGE') {
    // legacy: direct challenge without gameId
    console.log('[game] CHALLENGE legacy for partner=', partner, 'from=', from)
    showChallengeUI(partner, from, '')
  } else if (action === 'INVITE') {
    // server invite includes gid::inviter
    const inviteParts = rest.split('::')
    const gid = inviteParts[0] || ''
    const inviter = inviteParts[1] || from
    console.log('[game] INVITE gid=', gid, 'from=', inviter)
    g.id = gid
    showChallengeUI(partner, inviter, gid)
  } else if (action === 'STATE') {
    // server authoritative state: rest is JSON
    try {
      const state = JSON.parse(rest)
      if (!games[key]) games[key] = { board: [['','',''],['','',''],['','','']], mySymbol: null, theirSymbol: null, turn: null, started: false }
      const gg = games[key]
      gg.id = state.gameId
      gg.turn = state.turn
      gg.started = true
      gg.mySymbol = state.you
      gg.theirSymbol = (state.you === 'X') ? 'O' : 'X'
      if (Array.isArray(state.board)) {
        for (let i=0;i<3;i++) for (let j=0;j<3;j++) gg.board[i][j] = state.board[i*3 + j] || ''
      }
      try { openConversation(partner) } catch(e) {}
      showXoBoard(partner)
      renderXoBoard(key)
      // defensive check: sometimes the DOM may be in a transient state (race) and the board
      // might get cleared by another render step. If convGameArea is empty shortly after
      // STATE processing, retry rendering once more and log diagnostics to help debug.
      try {
        const area = document.getElementById('convGameArea')
        console.log('[game] STATE processed — convGameArea children=', area ? area.children.length : 'MISSING')
        setTimeout(() => {
          try {
            const a2 = document.getElementById('convGameArea')
            if (gg.started && a2 && a2.children.length === 0) {
              console.warn('[game] convGameArea empty after STATE render — retrying showXoBoard/renderXoBoard')
              showXoBoard(partner)
              renderXoBoard(key)
            }
          } catch(e) { console.warn('[game] retry render failed', e) }
        }, 120)
      } catch(e) { console.warn('[game] post-STATE diagnostic failed', e) }
    } catch(e) { console.warn('failed parsing STATE', e) }
  } else if (action === 'ACCEPT') {
    // fallback compatibility: start locally (server should send STATE)
    console.log('[game] ACCEPT received for partner=', partner, 'from=', from)
    g.started = true
    g.mySymbol = 'X'
    g.theirSymbol = 'O'
    g.turn = myNick
    try { openConversation(partner) } catch(e) {}
    showXoBoard(partner)
    storePrivateMessage(from, to, `(game) ${from} accepted X/O`)
  } else if (action === 'DECLINE') {
    storePrivateMessage(from, to, `(game) ${from} declined X/O`)
  } else if (action === 'MOVE') {
    // moves are handled by server-authoritative broker; ignore client-side MOVE payloads
    console.log('[game] MOVE received (client-side) ignored; awaiting STATE from server')
  } else if (action === 'END') {
    console.log('[game] END received data=', rest)
    const reststr = rest || ''
    if (reststr.startsWith('WIN::')) {
      const restParts = reststr.split('::')
      const winnerNick = restParts[1]
      const winLineJson = restParts.slice(2).join('::') || ''
      storePrivateMessage(myNick, partner, `(game) ${winnerNick} wins`)
      try {
        if (winLineJson) {
          const ln = JSON.parse(winLineJson)
          games[key].winLine = ln
        }
      } catch(e) { /* ignore */ }
    } else if (reststr === 'DRAW') {
      storePrivateMessage(myNick, partner, `(game) draw`)
    } else if (reststr.startsWith('QUIT::')) {
      const quitter = reststr.split('::')[1]
      storePrivateMessage(myNick, partner, `(game) ${quitter} quit the game`)
    }
    games[key].started = false
    const area = document.getElementById('convGameArea')
    if (area) area.innerHTML = ''
  }
}

function showXoBoard(partner) {
  console.log('[game] showXoBoard for partner=', partner, 'myNick=', myNick)
  const key = getConvKey(myNick, partner)
  const g = games[key]
  if (!g) return
  const area = document.getElementById('convGameArea')
  area.innerHTML = ''
  const info = document.createElement('div')
  info.id = 'convGameInfo'
  info.className = 'conv-game-info'
  info.textContent = `Game: you=${g.mySymbol} opponent=${g.theirSymbol} | turn: ${g.turn}`
  area.appendChild(info)
  const board = document.createElement('div')
  board.className = 'xo-board'
  for (let r=0;r<3;r++){
    for (let c=0;c<3;c++){
      const cell = document.createElement('button')
      cell.className = 'xo-cell'
      cell.dataset.r = r
      cell.dataset.c = c
      cell.textContent = g.board[r][c] || ''
      cell.onclick = () => {
        console.log('[game] cell click', r, c, 'g.turn=', g.turn, 'myNick=', myNick, 'cellVal=', g.board[r][c])
        if (!g.started) return
        if (g.turn !== myNick) return alert('Not your turn')
        if (g.board[r][c] !== '') return
        if (!g.id) return alert('Game id missing')
        sendGameMessage(partner, 'MOVE', `${g.id}::${r},${c}`)
        try { const btns = area.querySelectorAll('.xo-cell'); btns.forEach(b=>{ b.disabled = true; b.style.cursor = 'not-allowed' }) } catch(e) {}
      }
      board.appendChild(cell)
    }
  }
  area.appendChild(board)
  // initial enable/disable based on turn
  try {
    const buttons = area.querySelectorAll('.xo-cell')
    buttons.forEach(b => { b.disabled = (g.turn !== myNick); b.style.cursor = (g.turn === myNick ? 'pointer' : 'not-allowed') })
  } catch(e) {}
  const btnQuit = document.createElement('button')
  btnQuit.textContent = 'Quit Game'
  btnQuit.style.marginTop = '8px'
  btnQuit.onclick = () => {
    sendGameMessage(partner, 'END', `QUIT::${myNick}`)
    storePrivateMessage(myNick, partner, `(game) you quit the game`)
    g.started = false
    area.innerHTML = ''
  }
  area.appendChild(btnQuit)
}

function renderXoBoard(key) {
  console.log('[game] renderXoBoard key=', key)
  // re-render the board UI for conversation key
  const partner = key.replace('chat_','').split('__').filter(Boolean).find(x => x !== myNick)
  const area = document.getElementById('convGameArea')
  if (!area) return
  const g = games[key]
  if (!g) return
  // update existing cells if present
  const buttons = area.querySelectorAll('button')
  buttons.forEach(b => {
    const r = parseInt(b.dataset.r,10)
    const c = parseInt(b.dataset.c,10)
    b.textContent = g.board[r][c] || ''
    b.classList.remove('x','o','win')
    if (g.board[r][c] === 'X') b.classList.add('x')
    if (g.board[r][c] === 'O') b.classList.add('o')
    // highlight winning line
    if (g.winLine && Array.isArray(g.winLine)) {
      for (const p of g.winLine) {
        if (p[0] === r && p[1] === c) b.classList.add('win')
      }
    }
  })
  // update game info (turn) if present
  try {
    const info = document.getElementById('convGameInfo')
    if (info) info.textContent = `Game: you=${g.mySymbol} opponent=${g.theirSymbol} | turn: ${g.turn}`
    // enable/disable cells depending on current turn
    const buttons2 = document.querySelectorAll('.xo-cell')
    buttons2.forEach(b => { b.disabled = (g.turn !== myNick); b.style.cursor = (g.turn === myNick ? 'pointer' : 'not-allowed') })
  } catch(e) {}
}

function checkWin(b) {
  const lines = [
    [[0,0],[0,1],[0,2]],[[1,0],[1,1],[1,2]],[[2,0],[2,1],[2,2]],
    [[0,0],[1,0],[2,0]],[[0,1],[1,1],[2,1]],[[0,2],[1,2],[2,2]],
    [[0,0],[1,1],[2,2]],[[0,2],[1,1],[2,0]]
  ]
  for (const ln of lines) {
    const a = b[ln[0][0]][ln[0][1]]
    const c = b[ln[1][0]][ln[1][1]]
    const d = b[ln[2][0]][ln[2][1]]
    if (a && a === c && a === d) return { symbol: a, line: ln }
  }
  return null
}

// simple toast helper to show transient messages in notifications area (or body fallback)
function showToast(text, timeout=4000) {
  try {
    const id = 'toast_' + Date.now() + '_' + Math.floor(Math.random()*1000)
    const t = document.createElement('div')
    t.id = id
    t.className = 'toast'
    t.textContent = text
    // prefer notificationsEl if present
    if (notificationsEl) notificationsEl.appendChild(t)
    else document.body.appendChild(t)
    setTimeout(() => { const el = document.getElementById(id); if (el) el.remove() }, timeout)
  } catch(e) { console.warn('toast failed', e) }
}

function isBoardFull(b) {
  for (let r=0;r<3;r++) for (let c=0;c<3;c++) if (!b[r][c]) return false
  return true
}

function openConversation(partner) {
  document.getElementById("convHeader").textContent = "Chat with " + partner;
  document.getElementById("convHeader").dataset.partner = partner;
  renderConversation(partner);
}

function renderConversation(partner) {
  const key = getConvKey(myNick, partner);
  const msgs = JSON.parse(sessionStorage.getItem(key) || "[]");
  const el = document.getElementById("convMessages");
  el.innerHTML = "";
  msgs.forEach((m) => {
    const p = document.createElement("div");
    p.className = "bubble " + (m.from === myNick ? "me" : "other");
    p.textContent = m.text;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = new Date(m.t).toLocaleTimeString();
    p.appendChild(meta);
    el.appendChild(p);
  });
  el.scrollTop = el.scrollHeight;
  // enable Play X/O only if there is at least one message in this private conversation
  try {
    const btn = document.getElementById('convPlayXo');
    if (btn) {
      if (msgs && msgs.length > 0) {
        btn.disabled = false;
        btn.title = 'Play X/O';
      } else {
        btn.disabled = true;
        btn.title = 'Play X/O (locked: send a message first)';
      }
    }
  } catch(e) { /* ignore */ }
  // if there is an ongoing game for this conversation, show the board; otherwise clear game UI
  const area = document.getElementById('convGameArea')
  try {
    const g = games[key]
    if (g && g.started) {
      // ensure the board UI is present and up-to-date
      showXoBoard(partner)
      renderXoBoard(key)
    } else {
      if (area) area.innerHTML = ''
    }
  } catch(e) { if (area) area.innerHTML = '' }
}

document.getElementById("sendConv").onclick = () => {
  const partner = document.getElementById("convHeader").dataset.partner;
  if (!partner) return alert("Chọn người để chat");
  const txt = document.getElementById("convText").value.trim();
  if (!txt && !document.getElementById("convFile").files.length) return;
  if (document.getElementById("convFile").files.length) {
    const f = document.getElementById("convFile").files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1];
      const payload = f.name + "::" + b64;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "publish", toType: "USER", target: partner, kind: "FILE", payload }));
      } else {
        alert('Not connected to server');
      }
  // show the sent image immediately for the sender (renderPrivateFile also stores metadata)
  try { renderPrivateFile(myNick, partner, f.name, b64) } catch(e) {}
      document.getElementById("convFile").value = "";
    };
    reader.readAsDataURL(f);
  }
  if (txt) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "publish", toType: "USER", target: partner, kind: "TEXT", payload: txt }));
    } else {
      alert('Not connected to server');
    }
  // if this is a GAME control (starts with GAME::XO::...) we handle specially, otherwise store
    if (!txt.startsWith('GAME::')) storePrivateMessage(myNick, partner, txt);
    document.getElementById("convText").value = "";
  }
};

// initialize inbox list periodically
setInterval(() => { if (myNick) renderInboxList(); }, 1000);

function openChatWith(target) {
  console.log('[ui] openChatWith', target)
  // switch to inbox panel and open the private conversation UI for this user
  showPanel('inbox')
  openConversation(target)
}

// notifications area for incoming private images when conversation is not open
const notificationsEl = document.getElementById('notifications')

// games state per conversation
const games = {} // key -> { state: 'challenged'|'playing', myMove, theirMove }

function sendGameMessage(partner, action, data) {
  // use TEXT so broker will forward as MSG; encode as GAME::XO::ACTION::DATA
  // Prevent initiating a CHALLENGE if there are no prior messages in the private conversation
  if (action === 'CHALLENGE') {
    try {
      const key = getConvKey(myNick, partner)
      const msgs = JSON.parse(sessionStorage.getItem(key) || '[]')
      if (!msgs || msgs.length === 0) {
        return alert('Tính năng chơi X/O chỉ mở khi bạn đã nhắn ít nhất 1 tin với người này.')
      }
    } catch(e) { /* ignore and allow */ }
  }
  const payload = `GAME::XO::${action}${data ? '::'+data : ''}`
  console.log('[game] sendGameMessage to=', partner, 'payload=', payload)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'publish', toType: 'USER', target: partner, kind: 'TEXT', payload }))
  }
}

function showNotificationImage(from, fname, b64) {
  try {
    const id = 'n_' + Date.now() + '_' + Math.floor(Math.random()*1000)
    const wrap = document.createElement('div')
    wrap.id = id
    wrap.style.background = '#fff'
    wrap.style.border = '1px solid #ddd'
    wrap.style.padding = '8px'
    wrap.style.marginBottom = '8px'
    wrap.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)'
    wrap.style.width = '200px'
    const img = document.createElement('img')
    img.src = 'data:' + guessMime(fname) + ';base64,' + b64
    img.style.maxWidth = '100%'
    img.style.display = 'block'
    img.style.borderRadius = '6px'
    wrap.appendChild(img)
    const info = document.createElement('div')
    info.style.marginTop = '6px'
    info.textContent = `Image from ${from}`
    wrap.appendChild(info)
    const btnOpen = document.createElement('button')
    btnOpen.textContent = 'Open Chat'
    btnOpen.style.marginRight = '6px'
    btnOpen.onclick = () => { openConversation(from); const el = document.getElementById(id); if (el) el.remove(); }
    const btnClose = document.createElement('button')
    btnClose.textContent = 'Dismiss'
    btnClose.onclick = () => { const el = document.getElementById(id); if (el) el.remove(); }
    const ctl = document.createElement('div')
    ctl.style.marginTop = '6px'
    ctl.appendChild(btnOpen)
    ctl.appendChild(btnClose)
    wrap.appendChild(ctl)
    notificationsEl.appendChild(wrap)
    // auto-remove after 30s
    setTimeout(() => { const el = document.getElementById(id); if (el) el.remove(); }, 30000)
  } catch(e) { console.warn('failed creating notification', e) }
}

function showChallengeUI(partner, from, gid) {
  try {
    const id = 'chal_' + Date.now() + '_' + Math.floor(Math.random()*1000)
    const wrap = document.createElement('div')
    wrap.id = id
    wrap.style.background = '#fff'
    wrap.style.border = '1px solid #cfc'
    wrap.style.padding = '8px'
    wrap.style.marginBottom = '8px'
    wrap.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)'
    wrap.style.width = '240px'
    const txt = document.createElement('div')
    txt.textContent = `${from} invites you to play X/O` 
    wrap.appendChild(txt)
    const btnAccept = document.createElement('button')
    btnAccept.textContent = 'Accept'
    btnAccept.style.marginRight = '6px'
    // if gid is empty, disable Accept and show a helpful hint to the user
    if (!gid) {
      btnAccept.disabled = true
      btnAccept.textContent = 'Chờ server...'
      const hint = document.createElement('div')
      hint.style.fontSize = '12px'
      hint.style.color = '#666'
      hint.style.marginTop = '6px'
      hint.textContent = 'Đang chờ server tạo trò chơi — chờ lời mời chính thức.'
      wrap.appendChild(hint)
    }

    btnAccept.onclick = () => {
      // send accept to challenger (include game id if provided)
      sendGameMessage(from, 'ACCEPT', gid || '')
      // initialize game state locally (will be overwritten when server sends STATE)
      const key = getConvKey(myNick, from)
      games[key] = { board: [['','',''],['','',''],['','','']], mySymbol: 'O', theirSymbol: 'X', turn: from, started: true, id: gid || '' }
      // open conversation and show board
      openConversation(from)
      showXoBoard(from)
      // store acceptance message (from: me -> to: challenger)
      storePrivateMessage(myNick, from, `(game) accepted X/O with ${from}`)
      const el = document.getElementById(id); if (el) el.remove()
    }
    const btnDecline = document.createElement('button')
    btnDecline.textContent = 'Decline'
    btnDecline.onclick = () => {
      sendGameMessage(from, 'DECLINE', gid || '')
      storePrivateMessage(from, myNick, `(game) declined X/O from ${from}`)
      const el = document.getElementById(id); if (el) el.remove()
    }
    const ctl = document.createElement('div')
    ctl.style.marginTop = '8px'
    ctl.appendChild(btnAccept)
    ctl.appendChild(btnDecline)
    wrap.appendChild(ctl)

    // if conversation with 'from' is open, show inline in convGameArea
    const current = document.getElementById('convHeader') && document.getElementById('convHeader').dataset.partner
    if (current === from) {
      const area = document.getElementById('convGameArea')
      if (area) area.appendChild(wrap)
    } else {
      // show in notifications so user can interact even if tab not focused
      notificationsEl.appendChild(wrap)
      // auto-remove after 60s
      setTimeout(() => { const el = document.getElementById(id); if (el) el.remove() }, 60000)
    }
  } catch(e) { console.warn('failed showing challenge UI', e) }
}

function appendGroupMessage(text) {
  // text format: [from -> target] payload  or [FILE from from] name
  const m = document.createElement('div')
  m.className = 'bubble other'
  const meta = document.createElement('div')
  meta.className = 'meta'
  // try to parse name and message
  let from = ''
  let payload = text
  const m1 = text.match(/^\[(.*?)\]\s*(.*)$/)
  if (m1) {
    const hdr = m1[1]
    payload = m1[2]
    from = hdr.split('->')[0].replace('[','').trim()
  }
  // if message from me, show as .me
  if (from && myNick && from.includes(myNick)) {
    m.className = 'bubble me'
  }
  m.textContent = payload
  const metaTime = document.createElement('div')
  metaTime.className = 'meta'
  metaTime.textContent = new Date().toLocaleTimeString()
  m.appendChild(metaTime)
  groupMessages.appendChild(m)
  groupMessages.scrollTop = groupMessages.scrollHeight
}

sendGroup.onclick = () => {
  const txt = groupText.value.trim()
  if (!txt && !groupFile.files.length) return
  if (groupFile.files.length) {
    const f = groupFile.files[0]
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = reader.result.split(",")[1]
      const payload = f.name + "::" + b64
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "publish", toType: "GROUP", target: "main", kind: "FILE", payload }))
        // do not append locally: broker will forward group messages to all clients
        // including the sender. Avoid double-display by waiting for the broker echo.
      } else {
        alert('Not connected to server');
      }
      groupFile.value = ""
    }

    reader.readAsDataURL(f)
  }
  if (txt) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "publish", toType: "GROUP", target: "main", kind: "TEXT", payload: txt }))
      // do not append locally; wait for broker to echo the group message back to all clients
    } else {
      alert('Not connected to server');
    }
    groupText.value = ""
  }
}

// camera-sharing removed (feature deprecated)

  })()
  
}

