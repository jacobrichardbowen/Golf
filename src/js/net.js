// ---------------------------------------------------------------------------
// Online play for up to three golfers, peer to peer over WebRTC (PeerJS).
// One player hosts and gets a four-letter code; friends join with it. Every
// message goes through the host, who stamps the sender and passes it on.
//
// Matchmaking (introducing the browsers to each other) uses the free public
// PeerJS server; after that the game talks browser to browser. For tests,
// ?peer=host:port points it at a local PeerJS server instead.
// ---------------------------------------------------------------------------

const Net = (() => {
  const MAX = 3;
  const PREFIX = 'pinehaven-golf-';
  const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
  // Without a word for this long, a link counts as dropped. Generous, so a
  // phone that nips out to another app for a moment isn't thrown out (a link
  // that's really gone closes by itself sooner).
  const QUIET = 45000;

  let peer = null, isHost = false, slot = -1, code = null, started = false;
  let players = []; // [{ slot, char, name }]
  const links = new Map(); // host: slot -> connection; guest: 0 -> connection to the host
  const heard = new Map();
  const handlers = new Map();
  let pinger = null;

  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  }
  function emit(type, msg) { for (const fn of handlers.get(type) || []) fn(msg); }

  function options() {
    const m = /[?&]peer=([^&]+)/.exec(location.search);
    if (!m) return { debug: 0 };
    const [host, port] = decodeURIComponent(m[1]).split(':');
    return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0, config: { iceServers: [] } };
  }
  function makePeer(id) {
    if (typeof Peer === 'undefined') throw new Error('Online play is not available here.');
    return id ? new Peer(id, options()) : new Peer(options());
  }
  function explain(e) {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'No game with that code. Check it and try again.';
    if (t === 'browser-incompatible') return 'This browser can’t play online.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed')
      return 'Couldn’t reach the matchmaking server. Check your internet connection.';
    return (e && e.message) || 'Something went wrong with the connection.';
  }

  const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  function lobbyMsg() { return { t: 'lobby', players: players.map((p) => ({ ...p })), started }; }
  // Host: send to every guest but one.
  function relay(msg, except) {
    for (const [s, c] of links) if (s !== except && c.open) { try { c.send(msg); } catch (e) { /* closing */ } }
  }

  // ---------- hosting ----------
  function host(me) {
    leave();
    isHost = true; slot = 0; started = false;
    players = [{ slot: 0, char: me.char | 0, name: cleanName(me.name) }];
    return new Promise((resolve, reject) => {
      let tries = 0, opened = false;
      const attempt = () => {
        code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
        try { peer = makePeer(PREFIX + code); } catch (e) { reject(e.message); return; }
        peer.on('open', () => { opened = true; startPinger(); resolve(code); });
        peer.on('connection', accept);
        peer.on('error', (e) => {
          if (!opened && e.type === 'unavailable-id' && tries++ < 6) { peer.destroy(); attempt(); return; }
          if (!opened) reject(explain(e)); else emit('error', { text: explain(e) });
        });
        // Losing the matchmaking server doesn't break links already made.
        peer.on('disconnected', () => { if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* later */ } } });
      };
      attempt();
    });
  }

  function accept(conn) {
    conn.on('open', () => {
      const free = [1, 2].find((k) => !players.some((p) => p.slot === k));
      if (started || free === undefined) {
        try { conn.send({ t: 'full', started }); } catch (e) { /* gone */ }
        // Close once the message is through (and for certain a bit later).
        try { conn.close({ flush: true }); } catch (e) { /* gone */ }
        setTimeout(() => { try { conn.close(); } catch (e) { /* gone */ } }, 5000);
        return;
      }
      links.set(free, conn);
      heard.set(free, performance.now());
      conn.on('data', (msg) => fromGuest(free, msg));
      conn.on('close', () => drop(free));
      conn.on('error', () => drop(free));
    });
  }

  function fromGuest(s, msg) {
    heard.set(s, performance.now());
    if (!msg || typeof msg !== 'object') return;
    msg.s = s; // the host says who sent it
    if (msg.t === 'ping') return;
    // Only the host speaks for the room.
    if (msg.t === 'welcome' || msg.t === 'lobby' || msg.t === 'start' || msg.t === 'full' || msg.t === 'left') return;
    if (msg.t === 'hello') {
      if (!players.some((p) => p.slot === s)) players.push({ slot: s, char: msg.char | 0, name: cleanName(msg.name) });
      links.get(s).send({ t: 'welcome', slot: s, code });
      const m = lobbyMsg();
      relay(m, -1); emit('lobby', m);
      return;
    }
    if (msg.t === 'me') {
      const p = players.find((q) => q.slot === s);
      if (p) { p.char = msg.char | 0; p.name = cleanName(msg.name); }
      const m = lobbyMsg();
      relay(m, -1); emit('lobby', m);
      return;
    }
    relay(msg, s);
    emit(msg.t, msg);
  }

  function drop(s) {
    if (!links.has(s)) return;
    const c = links.get(s);
    links.delete(s);
    heard.delete(s);
    try { c.close(); } catch (e) { /* already */ }
    players = players.filter((p) => p.slot !== s);
    const m = { t: 'left', s };
    relay(m, -1); emit('left', m);
    const l = lobbyMsg();
    relay(l, -1); emit('lobby', l);
  }

  // ---------- joining ----------
  function join(theCode, me) {
    leave();
    isHost = false; started = false;
    code = String(theCode || '').trim().toUpperCase();
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (text) => {
        if (!done) { done = true; reject(text); leave(); } else emit('error', { text });
      };
      try { peer = makePeer(); } catch (e) { fail(e.message); return; }
      peer.on('error', (e) => fail(explain(e)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          links.set(0, conn);
          heard.set(0, performance.now());
          conn.send({ t: 'hello', char: me.char | 0, name: cleanName(me.name) });
        });
        conn.on('data', (msg) => {
          heard.set(0, performance.now());
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'welcome') { slot = msg.slot; done = true; startPinger(); resolve(slot); return; }
          if (msg.t === 'full') { fail(msg.started ? 'That round has already started.' : 'That game already has three players.'); return; }
          if (msg.t === 'lobby') { players = msg.players; started = msg.started; }
          if (msg.t === 'start') started = true;
          emit(msg.t, msg);
        });
        conn.on('close', () => { if (done) hostGone(); else fail('Couldn’t join that game.'); });
      });
      setTimeout(() => { if (!done) fail('No answer from that code. Check it and try again.'); }, 20000);
    });
  }

  function hostGone() {
    if (!links.has(0)) return;
    links.delete(0);
    emit('hostgone', {});
    leave();
  }

  // Keep links warm, and notice when someone has silently gone.
  function startPinger() {
    clearInterval(pinger);
    let last = performance.now();
    pinger = setInterval(() => {
      const now = performance.now();
      // If this page was frozen (busy, or in the background), messages may be
      // waiting to be read: don't judge anyone silent until they have been.
      const woke = now - last > 5000;
      last = now;
      if (isHost) {
        relay({ t: 'ping', s: 0 }, -1);
        if (!woke) for (const [s, at] of heard) if (now - at > QUIET) drop(s);
      } else if (links.has(0)) {
        try { links.get(0).send({ t: 'ping' }); } catch (e) { /* closing */ }
        if (!woke && now - (heard.get(0) || now) > QUIET) hostGone();
      }
    }, 2000);
  }

  // ---------- in play ----------
  function send(msg) {
    msg.s = slot;
    if (isHost) relay(msg, -1);
    else if (links.has(0) && links.get(0).open) { try { links.get(0).send(msg); } catch (e) { /* closing */ } }
  }
  // Change your name or golfer while waiting to tee off.
  function setMe(me) {
    const p = players.find((q) => q.slot === slot);
    if (p) { p.char = me.char | 0; p.name = cleanName(me.name); }
    if (isHost) { const m = lobbyMsg(); relay(m, -1); emit('lobby', m); }
    else send({ t: 'me', char: me.char | 0, name: cleanName(me.name) });
  }
  // Host only: everyone tees off, with a shared seed for the wind.
  function start(seed) {
    if (!isHost) return;
    started = true;
    const m = { t: 'start', seed, s: 0 };
    relay(m, -1);
    emit('start', m);
    const l = lobbyMsg();
    relay(l, -1);
  }

  function leave() {
    clearInterval(pinger);
    pinger = null;
    for (const c of links.values()) { try { c.close(); } catch (e) { /* already */ } }
    links.clear();
    heard.clear();
    if (peer) { try { peer.destroy(); } catch (e) { /* already */ } }
    peer = null;
    slot = -1; code = null; players = []; isHost = false; started = false;
  }

  return {
    host, join, send, setMe, start, leave, on, cleanName,
    get active() { return slot >= 0; },
    get isHost() { return isHost; },
    get slot() { return slot; },
    get code() { return code; },
    get players() { return players; },
    get started() { return started; },
  };
})();
