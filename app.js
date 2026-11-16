// Scene Blocker app. Data: one production = scenes + characters + floor plans; blocking per scene = setups.
(() => {
  const $ = id => document.getElementById(id);
  const svg = $("svg");
  const S = 90; // base mark size in plan pixels (scaled per plan)
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = t => Assets.esc(t == null ? "" : t);
  const toast = (t, ms = 2800) => { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); };
  const live = () => window.Sync && Sync.live;

  let prod = null;          // {id,title,characters[],scenes[],plans{id:{name,src,w,h}},locPlans{location:planId}}
  let blocks = {};          // sceneNumber -> [{id,name,items[],frames[],shotlist?}]
  let cur = { scene: null, setup: 0 }, tool = "select", pickVal = null, sel = null;
  let view = { x: 0, y: 0, w: 1000, h: 700 };
  let drag = null, pending = null;
  const undoStack = [], redoStack = [];

  // ---------- persistence (device) + live sync ----------
  const saveDevice = debounce(async () => { if (!prod) return; await Store.set("prod", prod); await Store.set("blocks", blocks); }, 500);
  const pushScene = debounce(num => { if (live()) Sync.pushScene(num, blocks[num]); }, 350);
  function save() { saveDevice(); if (cur.scene) pushScene(cur.scene); }
  function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

  // ---------- undo ----------
  function snapshot() { const st = setupObj(); if (!st) return; undoStack.push({ scene: cur.scene, setup: cur.setup, items: JSON.stringify(st.items) }); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
  function undoRedo(from, to) {
    const s = from.pop(); if (!s) return toast("Nothing to undo");
    const st = (blocks[s.scene] || [])[s.setup]; if (!st) return;
    to.push({ scene: s.scene, setup: s.setup, items: JSON.stringify(st.items) });
    st.items = JSON.parse(s.items); cur.scene = s.scene; cur.setup = s.setup; sel = null; save(); renderAll();
  }

  // ---------- import ----------
  $("inScript").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (live() && prod && !confirm("You're connected to crew " + Sync.code + ". Importing replaces the crew's production for everyone. Continue?")) return;
    try {
      toast("Reading " + f.name + "...", 8000);
      const r = await Parse.file(f);
      const keepPlans = r.pack ? r.plans : Object.assign({}, prod ? prod.plans : {});
      const keepLoc = r.pack ? r.locPlans : (prod?.locPlans || {});
      if (r.pack) blocks = r.blocks || {};
      prod = { id: prod?.id || uid(), title: r.title, characters: r.characters, scenes: r.scenes, plans: keepPlans, locPlans: keepLoc };
      r.scenes.forEach(s => { if (!blocks[s.number]) blocks[s.number] = [newSetup(1)]; });
      cur.scene = r.scenes[0].number; cur.setup = 0; sel = null;
      saveDevice(); renderAll(); setTimeout(fit, 30);
      if (live()) { toast("Sending to your crew..."); await Sync.pushAll(); }
      toast(r.scenes.length + " scenes and " + r.characters.length + " characters ready");
    } catch (err) { toast("Import failed: " + err.message, 6000); console.error(err); }
  };
  $("inPlan").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !prod) return toast("Import a script first");
    const name = prompt("Name this floor plan (e.g. Kitchen)", f.name.replace(/\.[^.]+$/, ""));
    if (!name) return;
    const img = await shrink(f, 1800, .82, 900000);
    const id = uid();
    prod.plans[id] = Object.assign({ name }, img);
    const loc = sceneObj()?.location; if (loc) prod.locPlans[loc] = id;
    if (live()) { Sync.pushPlan(id, prod.plans[id]); Sync.pushProduction(prod); }
    saveDevice(); renderAll(); fit();
  };
  $("inFrames").onchange = async e => {
    const files = [...e.target.files]; e.target.value = "";
    const st = setupObj(); if (!st) return toast("Pick a scene first");
    for (const f of files) {
      const img = await shrink(f, 1280, .8, 700000);
      st.frames.push({ id: uid(), src: img.src, label: nextFrameLabel(st), note: "" });
    }
    save(); renderFrames(); renderScenes();
  };
  // Resize + compress an image file; keeps the result under maxBytes (crew database limit is 1 MB per item).
  function shrink(file, max, q, maxBytes) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const im = new Image();
        im.onload = () => {
          let k = Math.min(1, max / Math.max(im.width, im.height)), out;
          for (let i = 0; i < 6; i++) {
            const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
            c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            out = { src: c.toDataURL("image/jpeg", q), w: c.width, h: c.height };
            if (!maxBytes || out.src.length < maxBytes) break;
            k *= .85; q = Math.max(.6, q - .05);
          }
          res(out);
        };
        im.onerror = rej; im.src = r.result;
      };
      r.onerror = rej; r.readAsDataURL(file);
    });
  }

  // ---------- model helpers ----------
  const newSetup = n => ({ id: uid(), name: "Setup " + n, items: [], frames: [] });
  const sceneObj = () => prod?.scenes.find(s => s.number === cur.scene);
  const setups = () => blocks[cur.scene] || (blocks[cur.scene] = [newSetup(1)]);
  const setupObj = () => cur.scene ? setups()[Math.min(cur.setup, setups().length - 1)] : null;
  const planObj = () => { const s = sceneObj(); const id = s && prod.locPlans[s.location]; return id ? prod.plans[id] : null; };
  const charOf = name => prod.characters.find(c => c.name === name) || { name, letter: "?", colour: "#ccc" };
  const scale = () => { const p = planObj(); return p ? Math.max(p.w, p.h) / 1400 : 1; };
  function nextNumber(kind, ref) { return setupObj().items.filter(i => i.kind === kind && i.ref === ref).reduce((m, i) => Math.max(m, i.n), 0) + 1; }
  function nextFrameLabel(st) { return String(st.frames.length + 1); }

  // ---------- render: lists ----------
  function renderAll() { renderHeader(); renderScenes(); renderPlanPick(); renderTabs(); renderPick(); draw(); renderProps(); renderFrames(); }
  function renderHeader() {
    $("prodName").textContent = prod ? prod.title : "No production yet";
    const s = sceneObj();
    $("sceneTitle").textContent = s ? `SC ${s.number} · ${s.intExt}. ${s.location}${s.time ? " · " + s.time : ""}` : "Import a script to start";
  }
  function renderScenes() {
    const q = $("search").value.toLowerCase();
    const ol = $("sceneList"); ol.innerHTML = "";
    if (!prod) { ol.innerHTML = `<li class="empty-list">Tap <b>Import script</b> to load a screenplay (PDF, Final Draft, Fountain) or a Scene Blocker production file.</li>`; return; }
    prod.scenes.filter(s => !q || (s.number + " " + s.location + " " + s.characters.join(" ")).toLowerCase().includes(q)).forEach(s => {
      const li = document.createElement("li");
      if (s.number === cur.scene) li.className = "on";
      const here = window.Sync ? Sync.peopleOn(s.number) : [];
      const b = blocks[s.number] || [];
      const nSet = b.length, nFr = b.reduce((a, st) => a + (st.frames || []).length, 0), hasPlan = !!prod.locPlans[s.location];
      li.innerHTML = `<span class="n">${esc(s.number)}</span><span class="h">${esc(s.intExt)}. ${esc(s.location)}<small>${esc(s.time)}${s.storyDay ? " · SD " + s.storyDay : ""}</small><small class="meta">${nSet} setup${nSet === 1 ? "" : "s"}${nFr ? " · " + nFr + " frames" : ""}${hasPlan ? "" : " · no plan"}${here.length ? " · " + here.map(p => `<b style="color:${p.colour}" title="${esc(p.name)}">●</b>`).join("") : ""}</small></span>`;
      li.onclick = () => go(s.number, 0);
      ol.appendChild(li);
    });
  }
  function go(scene, setup) { cur.scene = scene; cur.setup = setup; sel = null; $("left").classList.remove("open"); renderAll(); fit(); announce(); }
  $("search").oninput = renderScenes;
  function renderPlanPick() {
    const s = sceneObj(), sel_ = $("planPick");
    $("locName").textContent = s ? s.location : "this location";
    sel_.innerHTML = `<option value="">Choose a floor plan...</option>` + (prod ? Object.entries(prod.plans).map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join("") : "");
    sel_.value = s && prod.locPlans[s.location] || "";
    sel_.disabled = !s;
  }
  $("planPick").onchange = e => { const s = sceneObj(); if (!s) return; if (e.target.value) prod.locPlans[s.location] = e.target.value; else delete prod.locPlans[s.location]; if (live()) Sync.pushProduction(prod); saveDevice(); draw(); fit(); renderScenes(); };
  function renderTabs() {
    const box = $("setupTabs"); box.innerHTML = "";
    if (!cur.scene) return;
    setups().forEach((st, k) => {
      const b = document.createElement("button"); b.textContent = st.name; if (k === cur.setup) b.className = "on";
      b.onclick = () => { if (k === cur.setup) return setupMenu(b); cur.setup = k; sel = null; renderAll(); announce(); };
      b.title = k === cur.setup ? "Tap again for rename, duplicate or delete" : "";
      box.appendChild(b);
    });
    const add = document.createElement("button"); add.textContent = "+"; add.title = "New setup (copies this setup's marks)";
    add.onclick = () => { const src = setupObj(); const st = newSetup(setups().length + 1); st.items = JSON.parse(JSON.stringify(src.items)).map(i => Object.assign(i, { id: uid() })); setups().push(st); cur.setup = setups().length - 1; save(); renderAll(); toast(st.name + " added (marks copied)"); };
    box.appendChild(add);
    $("boardSetup").textContent = setupObj() ? "· " + setupObj().name : "";
  }
  function setupMenu(anchor) {
    closeMenus();
    const st = setupObj(), r = anchor.getBoundingClientRect();
    const m = document.createElement("div"); m.className = "menu"; m.style.left = r.left + "px"; m.style.top = (r.bottom + 6) + "px";
    m.innerHTML = `<button data-a="rename">Rename</button><button data-a="dup">Duplicate</button><button data-a="del" class="danger">Delete</button>`;
    m.onclick = e => {
      const a = e.target.dataset.a; closeMenus();
      if (a === "rename") { const n = prompt("Rename setup", st.name); if (n) { st.name = n.trim(); save(); renderTabs(); } }
      if (a === "dup") { const c = JSON.parse(JSON.stringify(st)); c.id = uid(); c.name = st.name + " copy"; c.items.forEach(i => i.id = uid()); c.frames.forEach(f => f.id = uid()); setups().splice(cur.setup + 1, 0, c); cur.setup++; save(); renderAll(); }
      if (a === "del") { if (setups().length === 1) return toast("A scene needs at least one setup"); if (!confirm(`Delete ${st.name}? Its marks and frames go too.`)) return; setups().splice(cur.setup, 1); cur.setup = Math.max(0, cur.setup - 1); sel = null; save(); renderAll(); }
    };
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("pointerdown", closeOnOutside), 0);
  }
  function closeOnOutside(e) { if (!e.target.closest(".menu")) closeMenus(); }
  function closeMenus() { document.querySelectorAll(".menu").forEach(m => m.remove()); document.removeEventListener("pointerdown", closeOnOutside); }

  // ---------- tools ----------
  $("tools").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.act === "undo") return undoRedo(undoStack, redoStack);
    if (b.dataset.act === "redo") return undoRedo(redoStack, undoStack);
    tool = b.dataset.tool; pickVal = null;
    [...$("tools").querySelectorAll("[data-tool]")].forEach(x => x.classList.toggle("on", x === b));
    renderPick();
  };
  function renderPick() {
    const box = $("pick"); box.innerHTML = ""; box.classList.toggle("show", ["char", "cam", "gear", "line180"].includes(tool));
    const opts = [];
    if (tool === "char" && prod) {
      const cast = sceneObj()?.characters.length ? sceneObj().characters : prod.characters.map(c => c.name);
      cast.forEach(n => { const c = charOf(n); opts.push({ v: n, html: `<span class="dot" style="background:${c.colour}">${esc(c.letter)}</span>${esc(n)}` }); });
    }
    if (tool === "cam") ["A", "B", "C", "D"].forEach(l => opts.push({ v: l, html: `<span class="dot cam">${l}</span>${l} cam` }));
    if (tool === "gear") Object.entries(Assets.GEAR).forEach(([k, g]) => opts.push({ v: k, html: Assets.icon(k) + g.name }));
    if (!pickVal && opts.length) pickVal = opts[0].v;
    opts.forEach(o => { const b = document.createElement("button"); b.innerHTML = o.html; if (o.v === pickVal) b.className = "on"; b.onclick = () => { pickVal = o.v; renderPick(); }; box.appendChild(b); });
    const hint = { char: "Tap the plan to place their next position. A1 → A2 joins with a dotted line.", cam: "Tap the plan to place the camera. Tap again for its move (A1 → A2).", gear: "Tap the plan to place it.", line180: "Drag across the plan to draw the 180 line." }[tool];
    if (hint) box.insertAdjacentHTML("beforeend", `<span class="hint">${hint}</span>`);
  }

  // ---------- drawing ----------
  function markSvg(it) {
    const s = S * scale();
    let body;
    if (it.kind === "cam") body = Assets.camera(it, s);
    else if (it.kind === "char") body = Assets.character(it, s, charOf(it.ref).colour);
    else body = (Assets.GEAR[it.ref] || Assets.GEAR.practical).draw(s * (it.size || 1));
    const unplaced = it.unplaced ? `<circle r="${s * .95}" fill="none" stroke="#FFC857" stroke-width="${s * .05}" stroke-dasharray="${s * .14} ${s * .1}" class="unplaced"/>` : "";
    const ring = sel === it.id ? `<circle r="${s * .95}" fill="none" stroke="#fff" stroke-width="${s * .04}" stroke-dasharray="${s * .12} ${s * .1}"/><line x1="${s * .95}" y1="0" x2="${s * 1.15}" y2="0" stroke="#fff" stroke-width="${s * .04}"/><circle class="rot" cx="${s * 1.35}" cy="0" r="${s * .22}" fill="#fff" stroke="${Assets.RED}" stroke-width="${s * .05}"/>` : "";
    return `<g class="mark${it.unplaced ? " ghost" : ""}" data-id="${it.id}" transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">${unplaced}${ring}${body}</g>`;
  }
  function draw() {
    const p = planObj(), st = setupObj();
    $("empty").style.display = p && st ? "none" : "flex";
    $("empty").innerHTML = !prod ? `<div><b>Start here</b><br>Tap <b>Import script</b> on the left.</div>` : !cur.scene ? "Pick a scene." : `<div><b>No floor plan for this location yet</b><br>Choose one at the top, or tap <b>Add floor plan</b> on the left.</div>`;
    if (!p || !st) { svg.innerHTML = ""; return; }
    const s = S * scale();
    let out = `<image href="${p.src}" x="0" y="0" width="${p.w}" height="${p.h}"/>`;
    const groups = {};
    st.items.filter(i => i.kind === "char" || i.kind === "cam").forEach(i => (groups[i.kind + "|" + i.ref] ||= []).push(i));
    Object.values(groups).forEach(g => {
      g.sort((a, b) => a.n - b.n);
      const col = g[0].kind === "cam" ? Assets.RED : charOf(g[0].ref).colour;
      for (let k = 1; k < g.length; k++) out += `<line x1="${g[k - 1].x}" y1="${g[k - 1].y}" x2="${g[k].x}" y2="${g[k].y}" stroke="#14161B" stroke-opacity=".55" stroke-width="${s * .18}" stroke-linecap="round" stroke-dasharray="${s * .02} ${s * .2}"/><line x1="${g[k - 1].x}" y1="${g[k - 1].y}" x2="${g[k].x}" y2="${g[k].y}" stroke="${col}" stroke-width="${s * .11}" stroke-dasharray="${s * .02} ${s * .2}" stroke-linecap="round"/>`;
    });
    st.items.filter(i => i.kind === "line180").forEach(l => {
      out += `<g class="mark" data-id="${l.id}"><line x1="${l.x}" y1="${l.y}" x2="${l.x2}" y2="${l.y2}" stroke="transparent" stroke-width="${s * .6}"/><line x1="${l.x}" y1="${l.y}" x2="${l.x2}" y2="${l.y2}" stroke="${Assets.RED}" stroke-width="${s * .08}" stroke-dasharray="${s * .22} ${s * .18}"/>${sel === l.id ? `<circle class="end1" cx="${l.x}" cy="${l.y}" r="${s * .18}" fill="#fff"/><circle class="end2" cx="${l.x2}" cy="${l.y2}" r="${s * .18}" fill="#fff"/>` : ""}</g>`;
    });
    st.items.filter(i => i.kind === "gear").forEach(i => out += markSvg(i));
    st.items.filter(i => i.kind === "cam" || i.kind === "char").forEach(i => out += markSvg(i));
    const sc = sceneObj(), d = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    const tbw = s * 5.4;
    out += `<g class="tb" transform="translate(${p.w - tbw - s * .3} ${s * .3})"><rect width="${tbw}" height="${s * 1.95}" rx="${s * .12}" fill="#F4F2EC" opacity=".94"/><rect width="${s * .12}" height="${s * 1.95}" fill="${Assets.RED}"/><text x="${s * .35}" y="${s * .58}" font-size="${s * .36}" font-weight="700" fill="#1A1D24">SC ${esc(sc.number)} · ${esc(st.name)}</text><text x="${s * .35}" y="${s * 1.04}" font-size="${s * .29}" fill="#1A1D24">${esc(sc.location.replace(/^Mabuya Household - /, "").slice(0, 30))}</text><text x="${s * .35}" y="${s * 1.48}" font-size="${s * .27}" fill="#5A6070">${esc((sc.time || "").slice(0, 22))}  ·  ${d}</text></g>`;
    out += `<g id="cursors"></g>`;
    svg.innerHTML = out;
    setView();
    drawCursors();
  }
  function setView() { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function fit() {
    const p = planObj(); if (!p) return;
    const r = svg.getBoundingClientRect(); if (!r.width || !r.height) return;
    // keep the plan clear of the floating tool bar (left on desktop, bottom on phones/tablets)
    const mobile = innerWidth <= 900, padL = mobile ? 0 : 92, padB = mobile ? 78 : 0;
    const aw = r.width - padL, ah = r.height - padB;
    const k = Math.max(p.w / aw, p.h / ah) * 1.04;
    view = { w: r.width * k, h: r.height * k, x: (p.w - aw * k) / 2 - padL * k, y: (p.h - ah * k) / 2 };
    setView();
  }
  window.addEventListener("resize", debounce(fit, 150));
  function pt(e) { const r = svg.getBoundingClientRect(); return { x: view.x + (e.clientX - r.left) / r.width * view.w, y: view.y + (e.clientY - r.top) / r.height * view.h }; }

  // ---------- pointer: place, drag, rotate, pan, pinch ----------
  const pointers = new Map();
  svg.addEventListener("pointerdown", e => {
    if (!setupObj() || !planObj()) return;
    try { svg.setPointerCapture(e.pointerId); } catch (er) {} pointers.set(e.pointerId, e);
    if (pointers.size === 2) { drag = { pinch: true, d0: dist(), v0: { ...view } }; return; }
    const p = pt(e), st = setupObj(), m = e.target.closest(".mark");
    if (tool === "line180") { snapshot(); const l = { id: uid(), kind: "line180", x: p.x, y: p.y, x2: p.x, y2: p.y }; st.items.push(l); sel = l.id; drag = { line: l, end: 2 }; draw(); return; }
    if ((tool === "char" || tool === "cam" || tool === "gear") && !m) {
      if (!pickVal) return toast("Pick who or what to place first");
      snapshot();
      let it;
      if (tool === "gear") it = { id: uid(), kind: "gear", ref: pickVal, x: p.x, y: p.y, rot: 0, size: 1 };
      else {
        const n = nextNumber(tool, pickVal);
        const letter = tool === "cam" ? pickVal : charOf(pickVal).letter;
        const prev = st.items.filter(i => i.kind === tool && i.ref === pickVal).sort((a, b) => b.n - a.n)[0];
        it = { id: uid(), kind: tool, ref: pickVal, n, label: letter + n, x: p.x, y: p.y, rot: prev ? prev.rot : (tool === "cam" ? -90 : 0), lens: prev?.lens || (tool === "cam" ? "35mm" : ""), shot: prev?.shot || "", height: prev?.height || "", move: prev?.move || "", note: "" };
      }
      st.items.push(it); sel = it.id; save(); draw(); renderProps(); return;
    }
    if (m) {
      const it = st.items.find(i => i.id === m.dataset.id); sel = it.id; snapshot();
      if (e.target.classList.contains("rot")) drag = { rot: it };
      else if (e.target.classList.contains("end1")) drag = { line: it, end: 1 };
      else if (e.target.classList.contains("end2")) drag = { line: it, end: 2 };
      else drag = { move: it, dx: p.x - it.x, dy: p.y - it.y, dx2: it.x2 != null ? p.x - it.x2 : 0, dy2: it.y2 != null ? p.y - it.y2 : 0, moved: false };
      draw(); renderProps(); return;
    }
    sel = null; drag = { pan: true, sx: e.clientX, sy: e.clientY, v0: { ...view } }; draw(); renderProps();
  });
  svg.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
    const p = pt(e);
    if (live()) Sync.cursor(cur.scene, cur.setup, p.x, p.y);
    if (!drag) return;
    if (drag.pinch && pointers.size === 2) { const k = drag.d0 / dist(); const c = drag.v0; view = { w: c.w * k, h: c.h * k, x: c.x + (c.w - c.w * k) / 2, y: c.y + (c.h - c.h * k) / 2 }; setView(); return; }
    if (drag.pan) { const r = svg.getBoundingClientRect(); view.x = drag.v0.x - (e.clientX - drag.sx) / r.width * view.w; view.y = drag.v0.y - (e.clientY - drag.sy) / r.height * view.h; setView(); return; }
    if (drag.line) { if (drag.end === 1) { drag.line.x = p.x; drag.line.y = p.y; } else { drag.line.x2 = p.x; drag.line.y2 = p.y; } draw(); return; }
    if (drag.rot) { drag.rot.rot = Math.round(Math.atan2(p.y - drag.rot.y, p.x - drag.rot.x) * 180 / Math.PI / 5) * 5; draw(); return; }
    if (drag.move) {
      const it = drag.move; it.x = p.x - drag.dx; it.y = p.y - drag.dy; drag.moved = true;
      if (it.x2 != null) { it.x2 = p.x - drag.dx2; it.y2 = p.y - drag.dy2; }
      draw();
    }
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (drag && !drag.pan && !drag.pinch) {
      if (drag.move && drag.moved) delete drag.move.unplaced;
      if (drag.move && !drag.moved) undoStack.pop();
      if (drag.line && Math.hypot(drag.line.x2 - drag.line.x, drag.line.y2 - drag.line.y) < 10) { const st = setupObj(); st.items = st.items.filter(i => i !== drag.line); sel = null; }
      save(); renderProps(); draw();
    }
    drag = null;
    if (pending) { const p_ = pending; pending = null; App.applyRemote(p_.prod, p_.blocks, p_.plans); }
  };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  function dist() { const [a, b] = [...pointers.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; }
  svg.addEventListener("wheel", e => {
    e.preventDefault(); const p = pt(e), k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    view = { w: view.w * k, h: view.h * k, x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k }; setView();
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? undoRedo(redoStack, undoStack) : undoRedo(undoStack, redoStack); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); return undoRedo(redoStack, undoStack); }
    if ((e.key === "Delete" || e.key === "Backspace") && sel) removeSel();
    if (e.key === "Escape") { sel = null; closeLightbox(); draw(); renderProps(); }
    if (e.key === "f" || e.key === "F") fit();
  });
  function removeSel() { snapshot(); const st = setupObj(); st.items = st.items.filter(i => i.id !== sel); sel = null; save(); draw(); renderProps(); }

  // ---------- right panel: selected mark, or the setup's shot list ----------
  const SHOTS = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "EWS", "OTS", "2S", "3S", "Insert", "POV", "High angle", "Low angle", "Top down"];
  function shotListHtml(st) {
    const sl = st.shotlist; if (!sl) return "";
    const one = (c, l) => c && (c.desc || c.shot) ? `<div class="sl"><span class="tag">${l} cam</span><b>${esc(c.desc || "-")}</b><span>${[c.lens, c.rig, c.shot].filter(Boolean).map(esc).join(" · ")}</span>${c.cover ? `<small>${esc(c.cover)}</small>` : ""}</div>` : "";
    return `<div class="shotlist"><div class="cap">Shot list · ${esc(st.name)}</div>${sl.note ? `<p class="hint">${esc(sl.note)}</p>` : ""}${one(sl.A, "A")}${one(sl.B, "B")}${(st.extra || []).map(x => one(x.A, "A") + one(x.B, "B")).join("")}</div>`;
  }
  function renderProps() {
    const st = setupObj(), it = st && st.items.find(i => i.id === sel), box = $("props");
    $("right").classList.toggle("open", !!it);
    if (!it) {
      $("propHead").textContent = st ? st.name : "Nothing selected";
      const unplaced = st ? st.items.filter(i => i.unplaced).length : 0;
      box.innerHTML = (st ? shotListHtml(st) : "") + (unplaced ? `<p class="note-y">${unplaced} camera${unplaced > 1 ? "s" : ""} from the shot list ${unplaced > 1 ? "are" : "is"} waiting at the bottom of the plan (yellow ring): drag ${unplaced > 1 ? "them" : "it"} into place.</p>` : "") +
        `<p class="hint">Pick a tool on the plan and tap to place. Tap the same character or camera again for the next position (A1 → A2). Drag to move, drag the white dot to turn. Pinch or scroll to zoom. Ctrl+Z undoes.</p>`;
      return;
    }
    const f = (lab, html) => `<div class="f"><label>${lab}</label>${html}</div>`;
    const inp = (k, v, ph = "", list = "") => `<input type="text" data-k="${k}" value="${esc(v || "")}" placeholder="${ph}" ${list ? `list="${list}"` : ""}>`;
    let h = "";
    if (it.kind === "cam") {
      $("propHead").textContent = it.ref + " cam · " + it.label;
      h += f("Lens", inp("lens", it.lens, "35mm", "lensList")) + f("Shot size", inp("shot", it.shot, "MCU", "shotList")) + f("Rig / movement", inp("move", it.move, "Sticks, slider, track, gimbal...", "rigList")) + f("Height", inp("height", it.height, "1.4 m")) + f("Notes", `<textarea data-k="note">${esc(it.note || "")}</textarea>`);
    } else if (it.kind === "char") {
      $("propHead").textContent = it.ref + " · position " + it.n;
      h += f("Action at this mark", `<textarea data-k="note" placeholder="What happens here">${esc(it.note || "")}</textarea>`);
    } else if (it.kind === "gear") {
      $("propHead").textContent = Assets.GEAR[it.ref]?.name || "Gear";
      h += f("Label / notes", inp("note", it.note, "e.g. 2K through window")) + f("Size", `<input type="range" min=".5" max="3" step=".1" data-k="size" value="${it.size || 1}">`);
    } else { $("propHead").textContent = "180 line"; h += `<p class="hint">Drag the white ends to adjust.</p>`; }
    if (it.kind !== "line180") h += f("Turn", `<div class="row"><button class="btn small" data-turn="-15">⟲ 15°</button><button class="btn small" data-turn="15">⟳ 15°</button><button class="btn small" data-turn="180">180°</button></div>`);
    h += `<div class="row"><button class="btn red" id="delMark">Delete</button><button class="btn" id="doneMark">Done</button></div>`;
    h += `<datalist id="lensList">${["16-35mm", "24-70mm", "70-200mm", "24mm", "35mm", "50mm", "85mm"].map(o => `<option value="${o}">`).join("")}</datalist><datalist id="shotList">${SHOTS.map(o => `<option value="${o}">`).join("")}</datalist><datalist id="rigList">${["Sticks", "Slider", "Track", "Dolly track", "Gimbal", "Handheld", "Lowball", "Combo"].map(o => `<option value="${o}">`).join("")}</datalist>`;
    box.innerHTML = h;
    box.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { it[el.dataset.k] = el.type === "range" ? +el.value : el.value; save(); draw(); });
    box.querySelectorAll("[data-turn]").forEach(el => el.onclick = () => { snapshot(); it.rot = ((it.rot || 0) + +el.dataset.turn) % 360; save(); draw(); });
    $("delMark").onclick = removeSel;
    $("doneMark").onclick = () => { sel = null; draw(); renderProps(); };
  }

  // ---------- storyboard ----------
  function renderFrames() {
    const box = $("frames"), st = setupObj(); box.innerHTML = "";
    if (!st) return;
    if (!st.frames.length) { box.innerHTML = `<p class="hint">No frames yet. Tap <b>Upload frames</b> to add stills, sketches or AI frames for ${esc(st.name)}.</p>`; return; }
    st.frames.forEach((fr, k) => {
      const d = document.createElement("div"); d.className = "frame";
      d.innerHTML = `<button class="x" title="Remove frame">✕</button><img src="${fr.src || ""}" alt="" loading="lazy"><input value="${esc(fr.label)}" placeholder="A1 WS"><input value="${esc(fr.note)}" placeholder="What happens">`;
      const [lab, note] = d.querySelectorAll("input");
      lab.oninput = () => { fr.label = lab.value; save(); };
      note.oninput = () => { fr.note = note.value; save(); };
      d.querySelector("img").onclick = () => lightbox(st.frames, k);
      d.querySelector(".x").onclick = () => { if (!confirm("Remove this frame?")) return; st.frames.splice(k, 1); save(); renderFrames(); renderScenes(); };
      box.appendChild(d);
    });
  }
  function lightbox(list, k) {
    closeLightbox();
    const lb = document.createElement("div"); lb.className = "lightbox";
    const show = () => { const fr = list[k]; lb.innerHTML = `<img src="${fr.src}" alt=""><div class="cap"><b>${esc(fr.label)}</b> ${esc(fr.note)} <span>${k + 1} / ${list.length}</span></div><button class="nav prev">‹</button><button class="nav next">›</button><button class="close">✕</button>`; };
    show();
    lb.onclick = e => {
      if (e.target.classList.contains("prev")) { k = (k - 1 + list.length) % list.length; show(); }
      else if (e.target.classList.contains("next")) { k = (k + 1) % list.length; show(); }
      else if (e.target.tagName !== "IMG") closeLightbox();
    };
    document.body.appendChild(lb);
  }
  function closeLightbox() { document.querySelectorAll(".lightbox").forEach(x => x.remove()); }

  // ---------- export / save file ----------
  $("btnExport").onclick = async () => {
    const p = planObj(); if (!p) return toast("Nothing to export yet");
    const prevSel = sel; sel = null; draw();
    const clone = svg.cloneNode(true); clone.setAttribute("viewBox", `0 0 ${p.w} ${p.h}`); clone.setAttribute("width", p.w); clone.setAttribute("height", p.h);
    clone.querySelector("#cursors")?.remove(); clone.querySelectorAll(".unplaced").forEach(x => x.remove());
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = p.w; c.height = p.h;
      const g = c.getContext("2d"); g.fillStyle = "#1A1D24"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0);
      const a = document.createElement("a"); const sc = sceneObj();
      a.download = `SC ${sc.number} ${setupObj().name} - ${sc.location}.png`.replace(/[\\/:*?"<>|]/g, "");
      a.href = c.toDataURL("image/png"); a.click(); URL.revokeObjectURL(url);
      sel = prevSel; draw(); toast("Picture saved");
    };
    im.src = url;
  };
  $("btnSaveFile").onclick = () => {
    if (!prod) return toast("Nothing to save yet");
    const data = { app: "Scene Blocker", version: 2, title: prod.title, characters: prod.characters, scenes: prod.scenes, plans: prod.plans, locPlans: prod.locPlans, blocks, saved: new Date().toISOString() };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `${prod.title} - Scene Blocker ${new Date().toISOString().slice(0, 10)}.json`.replace(/[\\/:*?"<>|]/g, "");
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Saved. Open it on another device with Import script.");
  };

  // ---------- mobile ----------
  $("btnScenes").onclick = () => $("left").classList.toggle("open");

  // ---------- live presence ----------
  function announce() { if (live()) Sync.where(cur.scene, cur.setup); }
  function drawCursors() {
    const g = document.getElementById("cursors"); if (!g || !live()) return;
    const s = S * scale();
    g.innerHTML = Sync.cursorsOn(cur.scene, cur.setup).map(c => `<g transform="translate(${c.x} ${c.y})"><path d="M0 0 L${s * .55} ${s * .22} L${s * .22} ${s * .24} L${s * .13} ${s * .55}Z" fill="${c.colour}" stroke="#fff" stroke-width="${s * .03}"/><text x="${s * .5}" y="${s * .66}" font-size="${s * .3}" fill="#fff" stroke="#000" stroke-width="${s * .07}" paint-order="stroke">${esc(c.name)}</text></g>`).join("");
  }
  window.App = {
    get prod() { return prod; }, get blocks() { return blocks; }, get cur() { return cur; },
    applyRemote(newProd, newBlocks, newPlans) {
      if (drag) { pending = { prod: newProd || pending?.prod, blocks: Object.assign({}, pending?.blocks, newBlocks || {}), plans: Object.assign({}, pending?.plans, newPlans || {}) }; return; }
      const first = !prod;
      if (newProd) { const plans = prod ? prod.plans : {}; prod = Object.assign({}, newProd, { plans: Object.assign({}, plans, newProd.plans || {}) }); }
      if (newPlans && prod) Object.assign(prod.plans, newPlans);
      if (newBlocks) Object.assign(blocks, newBlocks);
      if (!prod) return;
      if (!cur.scene || !prod.scenes.find(s => s.number === cur.scene)) { cur.scene = prod.scenes[0]?.number; cur.setup = 0; }
      if (sel && !(setupObj()?.items || []).find(i => i.id === sel)) sel = null;
      saveDevice(); renderAll(); if (first || newPlans) setTimeout(fit, 30);
    },
    redrawPresence() { renderScenes(); drawCursors(); },
    load(p, b) { prod = p; blocks = b || {}; cur.scene = prod.scenes[0]?.number; cur.setup = 0; saveDevice(); renderAll(); setTimeout(fit, 50); },
  };

  // ---------- start ----------
  const SPLASH_MS = new URLSearchParams(location.search).has("nosplash") ? 0 : 3500;
  setTimeout(() => { const s = $("splash"); if (!s) return; s.classList.add("out"); setTimeout(() => { s.remove(); fit(); }, 500); }, SPLASH_MS);
  (async () => {
    prod = (await Store.get("prod")) || null;
    blocks = (await Store.get("blocks")) || {};
    if (prod) cur.scene = prod.scenes[0]?.number;
    renderAll(); setTimeout(fit, 50);
    if (new URLSearchParams(location.search).has("dev") && window.DevSeed) DevSeed();
    if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") navigator.serviceWorker.register("sw.js");
  })();
})();
