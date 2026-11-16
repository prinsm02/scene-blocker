// Live crew sync (Firebase Firestore). Off until config.js has the project keys.
// Everything for one production lives under prods/{crewCode}: only people who know the code can reach it
// (the security rules refuse listing, so codes cannot be discovered).
window.Sync = (() => {
  const me = { id: Math.random().toString(36).slice(2, 10), name: "", colour: "" };
  const COLOURS = ["#5FC9F3", "#FFC857", "#7FE3A0", "#FF8FA3", "#C3A6FF", "#FFB070", "#8FD3FF"];
  let db = null, code = null, people = {}, live = false, lastCursor = 0;

  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

  async function start() {
    if (!window.SB_FIREBASE || !window.firebase) { badge("This device only"); return; }
    firebase.initializeApp(window.SB_FIREBASE);
    await firebase.auth().signInAnonymously();
    db = firebase.firestore();
    try { db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
    me.name = localStorage.getItem("sb-name") || "";
    code = localStorage.getItem("sb-code") || "";
    if (!me.name || !code) await askJoin();
    me.colour = COLOURS[[...me.name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLOURS.length];
    connect();
  }

  function askJoin() {
    return new Promise(res => {
      const box = el(`<div style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:20">
        <form style="background:#232733;padding:20px;border-radius:12px;width:min(340px,90vw);display:flex;flex-direction:column;gap:10px">
          <b style="font-size:17px">Join your crew</b>
          <input name="n" type="text" placeholder="Your name (e.g. Matthew - 1st AD)" required>
          <input name="c" type="text" placeholder="Crew code" required autocapitalize="characters">
          <button class="btn red">Join</button>
          <small style="color:#A9AFBD">Ask your producer or 1st AD for the crew code.</small></form></div>`);
      box.querySelector("form").onsubmit = e => {
        e.preventDefault();
        me.name = e.target.n.value.trim(); code = e.target.c.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
        localStorage.setItem("sb-name", me.name); localStorage.setItem("sb-code", code);
        box.remove(); res();
      };
      document.body.appendChild(box);
    });
  }

  const P = () => db.collection("prods").doc(code);

  function connect() {
    live = true; badge("Live · " + code);
    // production meta (scenes, characters, which plan each location uses)
    P().onSnapshot(s => { if (s.exists && !s.metadata.hasPendingWrites) App.applyRemote(s.data().prod, null); });
    // floor plans
    P().collection("plans").onSnapshot(q => {
      const prod = App.prod; if (!prod) return;
      q.docChanges().forEach(ch => { prod.plans[ch.doc.id] = ch.doc.data(); });
      App.applyRemote(prod, null);
    });
    // blocking per scene
    P().collection("scenes").onSnapshot(q => {
      const upd = {};
      q.docChanges().forEach(ch => { if (!ch.doc.metadata.hasPendingWrites) upd[ch.doc.id] = ch.doc.data().setups; });
      if (Object.keys(upd).length) hydrateFrames(upd).then(u => App.applyRemote(null, u));
    });
    // who is online and where
    const meRef = P().collection("people").doc(me.id);
    const beat = () => meRef.set({ name: me.name, colour: me.colour, scene: App.cur.scene, setup: App.cur.setup, t: Date.now() }, { merge: true });
    beat(); setInterval(beat, 20000);
    window.addEventListener("pagehide", () => meRef.delete());
    P().collection("people").onSnapshot(q => {
      people = {}; q.forEach(d => { if (d.id !== me.id && Date.now() - d.data().t < 60000) people[d.id] = d.data(); });
      roster(); App.redrawPresence();
    });
  }

  const frameCache = {};
  async function hydrateFrames(upd) {
    for (const setups of Object.values(upd)) for (const st of setups || []) for (const fr of st.frames || []) {
      if (fr.src) continue;
      if (!frameCache[fr.id]) { const d = await P().collection("frames").doc(fr.id).get(); frameCache[fr.id] = d.exists ? d.data().src : ""; }
      fr.src = frameCache[fr.id];
    }
    return upd;
  }

  function pushProduction(prod) {
    const lean = Object.assign({}, prod, { plans: {} });
    P().set({ prod: lean, updated: Date.now() }, { merge: true });
    Object.entries(prod.plans).forEach(([id, p]) => pushPlan(id, p));
  }
  function pushPlan(id, plan) { P().collection("plans").doc(id).set(plan); }
  function pushScene(num, setups) {
    if (!num || !setups) return;
    const lean = setups.map(st => Object.assign({}, st, {
      frames: st.frames.map(fr => {
        if (fr.src && !frameCache[fr.id]) { frameCache[fr.id] = fr.src; P().collection("frames").doc(fr.id).set({ src: fr.src }); }
        return { id: fr.id, label: fr.label, note: fr.note };
      }),
    }));
    P().collection("scenes").doc(String(num)).set({ setups: lean, by: me.name, t: Date.now() });
  }
  function where(scene, setup) { if (live) P().collection("people").doc(me.id).set({ scene, setup, t: Date.now() }, { merge: true }); }
  function cursor(scene, setup, x, y) {
    const now = Date.now(); if (now - lastCursor < 120) return; lastCursor = now;
    P().collection("people").doc(me.id).set({ scene, setup, x, y, t: now, name: me.name, colour: me.colour }, { merge: true });
  }
  const peopleOn = scene => Object.values(people).filter(p => p.scene === scene);
  const cursorsOn = (scene, setup) => Object.values(people).filter(p => p.scene === scene && p.setup === setup && p.x != null);

  function roster() {
    let r = document.getElementById("roster");
    if (!r) { r = el(`<div id="roster" style="display:flex;gap:4px;align-items:center"></div>`); document.querySelector(".top .spacer").after(r); }
    const list = [me, ...Object.values(people)];
    r.innerHTML = list.map(p => `<span title="${p.name}${p.scene ? " · Sc " + p.scene : ""}" style="width:28px;height:28px;border-radius:50%;background:${p.colour};color:#14161B;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${(p.name || "?").slice(0, 2).toUpperCase()}</span>`).join("");
  }
  function badge(t) {
    let b = document.getElementById("liveBadge");
    if (!b) { b = el(`<span id="liveBadge" style="font-size:12px;color:#A9AFBD;padding:0 6px"></span>`); document.querySelector(".top .spacer").after(b); }
    b.textContent = t;
  }
  window.addEventListener("load", start);
  return { get live() { return live; }, pushProduction, pushPlan, pushScene, where, cursor, peopleOn, cursorsOn };
})();
