// Live crew mode (Firebase Firestore). Everything for one production lives under prods/{crewCode}.
// The security rules refuse listing, so a crew code works like a private key: only people who have it get in.
window.Sync = (() => {
  const me = { id: Math.random().toString(36).slice(2, 10), name: "", colour: "" };
  const COLOURS = ["#5FC9F3", "#FFC857", "#7FE3A0", "#FF8FA3", "#C3A6FF", "#FFB070", "#8FD3FF"];
  let db = null, code = null, people = {}, live = false, lastCursor = 0, beatTimer = null, unsubs = [];
  const frameCache = {};
  const el = html => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
  const esc = t => String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const P = () => db.collection("prods").doc(code);
  const newCode = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s.slice(0, 4) + "-" + s.slice(4); };
  const inviteLink = () => location.origin + location.pathname + "?crew=" + encodeURIComponent(code);

  async function start() {
    if (!window.SB_FIREBASE || !window.firebase) { badge("On this device"); return; }
    try {
      firebase.initializeApp(window.SB_FIREBASE);
      db = firebase.firestore();
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
      await firebase.auth().signInAnonymously();
    } catch (e) { console.warn("live mode unavailable", e); badge("Offline · on this device"); return; }
    const linkCode = new URLSearchParams(location.search).get("crew");
    me.name = localStorage.getItem("sb-name") || "";
    code = (linkCode || localStorage.getItem("sb-code") || "").toUpperCase();
    const solo = localStorage.getItem("sb-solo") === "1" && !linkCode;
    if (solo) { badge("On this device", true); return; }
    if (!me.name || !code) { const ok = await askJoin(code); if (!ok) { badge("On this device", true); return; } }
    if (linkCode) history.replaceState(null, "", location.pathname);
    connect();
  }

  function askJoin(prefill) {
    return new Promise(res => {
      const box = el(`<div class="modal"><form class="card">
        <img src="assets/icon.svg" width="44" height="44" alt="">
        <h2>Welcome to Scene Blocker</h2>
        <label>Your name<input name="n" type="text" placeholder="e.g. Matthew - 1st AD" value="${esc(me.name)}" required autocomplete="name"></label>
        <label>Crew code <small>(in your invite link)</small><input name="c" type="text" placeholder="ABCD-1234" value="${esc(prefill)}" autocapitalize="characters"></label>
        <button class="btn red big" name="join">Join my crew</button>
        <div class="or"><button type="button" class="link" data-a="new">Start a new crew with what's on this device</button>
        <button type="button" class="link" data-a="solo">Just me, on this device</button></div>
        <p class="err" hidden></p></form></div>`);
      const f = box.querySelector("form"), err = box.querySelector(".err");
      const done = ok => { box.remove(); res(ok); };
      const name = () => { const n = f.n.value.trim(); if (!n) { err.textContent = "Type your name first."; err.hidden = false; f.n.focus(); } return n; };
      f.onsubmit = async e => {
        e.preventDefault(); const n = name(); if (!n) return;
        const c = f.c.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
        if (c.length < 6) { err.textContent = "Type the crew code from your invite (e.g. ABCD-1234)."; err.hidden = false; return; }
        err.hidden = true; f.join.textContent = "Checking..."; f.join.disabled = true;
        let exists = false;
        try { exists = (await db.collection("prods").doc(c).get()).exists; } catch (e) {}
        f.join.textContent = "Join my crew"; f.join.disabled = false;
        if (!exists) { err.textContent = "No crew with that code. Check the invite link."; err.hidden = false; return; }
        save(n, c); done(true);
      };
      box.querySelector('[data-a="new"]').onclick = async () => {
        const n = name(); if (!n) return;
        if (!App.prod) { err.textContent = "Import a script first, then start a crew."; err.hidden = false; return; }
        save(n, newCode()); localStorage.setItem("sb-new", "1"); done(true);
      };
      box.querySelector('[data-a="solo"]').onclick = () => { localStorage.setItem("sb-solo", "1"); if (f.n.value.trim()) localStorage.setItem("sb-name", f.n.value.trim()); done(false); };
      document.body.appendChild(box); setTimeout(() => (me.name ? f.c : f.n).focus(), 50);
    });
  }
  function save(n, c) { me.name = n; code = c; localStorage.setItem("sb-name", n); localStorage.setItem("sb-code", c); localStorage.removeItem("sb-solo"); }

  async function connect() {
    me.colour = COLOURS[[...me.name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLOURS.length];
    const root = await P().get().catch(() => null);
    if (localStorage.getItem("sb-new") === "1" || (root && !root.exists && App.prod)) {
      localStorage.removeItem("sb-new");
      await pushAll(); toast("Crew started. Share your invite link from the crew button.");
    }
    live = true; badge("Live · " + code, true);
    unsubs.push(P().onSnapshot(s => { if (s.exists && !s.metadata.hasPendingWrites) App.applyRemote(s.data().prod, null); }));
    unsubs.push(P().collection("plans").onSnapshot(q => {
      const add = {}; q.docChanges().forEach(ch => { if (ch.type !== "removed") add[ch.doc.id] = ch.doc.data(); });
      if (Object.keys(add).length) App.applyRemote(null, null, add);
    }));
    unsubs.push(P().collection("scenes").onSnapshot(q => {
      const upd = {};
      q.docChanges().forEach(ch => { if (!ch.doc.metadata.hasPendingWrites && ch.type !== "removed") upd[ch.doc.id] = ch.doc.data().setups; });
      if (Object.keys(upd).length) hydrate(upd).then(u => App.applyRemote(null, u));
    }));
    const meRef = P().collection("people").doc(me.id);
    const beat = () => meRef.set({ name: me.name, colour: me.colour, scene: App.cur.scene, setup: App.cur.setup, t: Date.now() }, { merge: true }).catch(() => {});
    beat(); beatTimer = setInterval(beat, 30000);
    window.addEventListener("pagehide", () => meRef.delete());
    unsubs.push(P().collection("people").onSnapshot(q => {
      people = {};
      const byName = {};
      q.forEach(d => { const v = d.data(); if (d.id === me.id || Date.now() - (v.t || 0) > 90000 || v.name === me.name) return; if (!byName[v.name] || byName[v.name].t < v.t) byName[v.name] = Object.assign({ id: d.id }, v); });
      Object.values(byName).forEach(v => people[v.id] = v);
      roster(); App.redrawPresence();
    }));
  }

  async function hydrate(upd) {
    const need = [];
    for (const setups of Object.values(upd)) for (const st of setups || []) for (const fr of st.frames || []) if (!fr.src) need.push(fr);
    await Promise.all(need.map(async fr => {
      if (!(fr.id in frameCache)) { try { const d = await P().collection("frames").doc(fr.id).get(); frameCache[fr.id] = d.exists ? d.data().src : ""; } catch (e) { frameCache[fr.id] = ""; } }
      fr.src = frameCache[fr.id];
    }));
    return upd;
  }

  async function pushAll() {
    const prod = App.prod; if (!prod) return;
    await P().set({ prod: Object.assign({}, prod, { plans: {} }), updated: Date.now(), by: me.name });
    for (const [id, p] of Object.entries(prod.plans)) await P().collection("plans").doc(id).set(p);
    for (const [num, setups] of Object.entries(App.blocks)) await pushScene(num, setups, true);
  }
  function pushProduction(prod) { if (!live) return; P().set({ prod: Object.assign({}, prod, { plans: {} }), updated: Date.now(), by: me.name }, { merge: true }); }
  function pushPlan(id, plan) { if (live) P().collection("plans").doc(id).set(plan); }
  function pushScene(num, setups, force) {
    if ((!live && !force) || !num || !setups) return;
    const writes = [];
    const lean = setups.map(st => Object.assign({}, st, {
      frames: (st.frames || []).map(fr => {
        if (fr.src && frameCache[fr.id] !== fr.src) { frameCache[fr.id] = fr.src; writes.push(P().collection("frames").doc(fr.id).set({ src: fr.src })); }
        return { id: fr.id, label: fr.label, note: fr.note };
      }),
    }));
    writes.push(P().collection("scenes").doc(String(num)).set({ setups: lean, by: me.name, t: Date.now() }));
    return Promise.all(writes);
  }
  function where(scene, setup) { if (live) P().collection("people").doc(me.id).set({ scene, setup, t: Date.now() }, { merge: true }).catch(() => {}); }
  function cursor(scene, setup, x, y) {
    const now = Date.now(); if (!live || now - lastCursor < 1000) return; lastCursor = now;
    P().collection("people").doc(me.id).set({ scene, setup, x, y, t: now }, { merge: true }).catch(() => {});
  }
  const peopleOn = scene => Object.values(people).filter(p => p.scene === scene);
  const cursorsOn = (scene, setup) => Object.values(people).filter(p => p.scene === scene && p.setup === setup && p.x != null && Date.now() - p.t < 15000);

  function roster() {
    let r = document.getElementById("roster");
    if (!r) { r = el(`<div id="roster" class="roster"></div>`); document.querySelector(".top .spacer").after(r); }
    const list = [me, ...Object.values(people)];
    r.innerHTML = list.slice(0, 6).map(p => `<span class="av" style="background:${p.colour}" title="${esc(p.name)}${p.scene ? " · on Sc " + esc(p.scene) : ""}">${esc((p.name || "?").trim().slice(0, 2).toUpperCase())}</span>`).join("") + (list.length > 6 ? `<span class="av more">+${list.length - 6}</span>` : "");
  }
  function badge(t, clickable) {
    let b = document.getElementById("liveBadge");
    if (!b) { b = el(`<button id="liveBadge" class="badge"></button>`); document.querySelector(".top .spacer").after(b); }
    b.innerHTML = (live ? '<i class="pulse"></i>' : "") + esc(t);
    b.onclick = clickable ? crewMenu : null;
  }
  function crewMenu() {
    const box = el(`<div class="modal"><div class="card">
      <h2>${live ? "Your crew" : "Work with your crew"}</h2>
      ${live ? `<p>Crew code <b class="code">${esc(code)}</b></p>
        <p class="hint">Send this link to your crew. They tap it, type their name and they're in, on phone, tablet or laptop.</p>
        <input type="text" readonly value="${esc(inviteLink())}">
        <button class="btn red big" data-a="copy">Copy invite link</button>
        <button class="btn" data-a="share">Share...</button>
        <p class="hint">${Object.keys(people).length} other${Object.keys(people).length === 1 ? "" : "s"} online now.</p>
        <button class="link" data-a="leave">Leave this crew</button>`
      : `<p class="hint">Join a crew to block together live and see who's on which scene.</p>
        <button class="btn red big" data-a="join">Join or start a crew</button>`}
      <button class="link" data-a="close">Close</button></div></div>`);
    box.onclick = async e => {
      const a = e.target.dataset.a; if (!a && e.target !== box) return;
      if (a === "copy") { try { await navigator.clipboard.writeText(inviteLink()); toast("Invite link copied"); } catch (er) { box.querySelector("input").select(); } return; }
      if (a === "share") { try { await navigator.share({ title: "Scene Blocker crew", text: "Join our blocking on Scene Blocker", url: inviteLink() }); } catch (er) {} return; }
      if (a === "leave") { if (!confirm("Leave this crew? Your device keeps a copy.")) return; localStorage.removeItem("sb-code"); localStorage.setItem("sb-solo", "1"); location.reload(); return; }
      if (a === "join") { localStorage.removeItem("sb-solo"); box.remove(); const ok = await askJoin(""); if (ok) connect(); return; }
      box.remove();
    };
    document.body.appendChild(box);
  }
  function toast(t) { const e = document.getElementById("toast"); if (!e) return; e.textContent = t; e.hidden = false; setTimeout(() => e.hidden = true, 3500); }

  window.addEventListener("load", () => setTimeout(start, 100));
  return { get live() { return live; }, get code() { return code; }, pushAll, pushProduction, pushPlan, pushScene, where, cursor, peopleOn, cursorsOn, crewMenu };
})();
