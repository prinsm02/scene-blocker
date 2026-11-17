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
  let drag = null, pending = null, multi = new Set(), clip = null, spaceDown = false;
  const undoStack = [], redoStack = [];
  // Per-device display settings (sizes of marks, move dots, cable look).
  const SET = Object.assign({ mark: 1, dot: 1, cable: .55 }, (() => { try { return JSON.parse(localStorage.getItem("sb-settings") || "{}"); } catch (e) { return {}; } })());
  const saveSet = () => { try { localStorage.setItem("sb-settings", JSON.stringify(SET)); } catch (e) {} };
  const isSel = id => sel === id || multi.has(id);
  const LINES = ["line180", "track", "cable"];
  const logAct = (a, d) => { if (window.Sync && Sync.log) Sync.log(a, d); };

  // ---------- persistence (device) + live sync ----------
  const saveDevice = debounce(async () => { if (!prod) return; await Store.set("prod", prod); await Store.set("blocks", blocks); const t = document.getElementById("savedTag"); if (t) { t.hidden = false; t.textContent = "Saved " + new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }); } }, 500);
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
    const loc = sceneObj()?.location, st = setupObj();
    if (st) st.plan = id;
    if (loc && !prod.locPlans[loc]) prod.locPlans[loc] = id;
    if (live()) { Sync.pushPlan(id, prod.plans[id]); Sync.pushProduction(prod); }
    save(); renderAll(); fit();
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
  // A setup can have its own floor plan; otherwise it uses the location's plan.
  const planId = () => { const s = sceneObj(), st = setupObj(); return (st && st.plan && prod.plans[st.plan]) ? st.plan : (s && prod.locPlans[s.location]); };
  const planObj = () => { const id = prod && planId(); return id ? prod.plans[id] : null; };
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
  function go(scene, setup) { cur.scene = scene; cur.setup = setup; sel = null; multi.clear(); logAct("scene", scene); $("left").classList.remove("open"); renderAll(); fit(); announce(); }
  $("search").oninput = renderScenes;
  function renderPlanPick() {
    const s = sceneObj(), sel_ = $("planPick");
    $("locName").textContent = s ? s.location : "this location";
    sel_.innerHTML = `<option value="">Choose a floor plan...</option>` + (prod ? Object.entries(prod.plans).map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join("") : "");
    sel_.value = s && planId() || "";
    sel_.disabled = !s;
  }
  // Changing the plan changes THIS setup only. The location default is set only if it has none yet.
  $("planPick").onchange = e => {
    const s = sceneObj(), st = setupObj(); if (!s || !st) return;
    const v = e.target.value;
    if (v) { st.plan = v; if (!prod.locPlans[s.location]) { prod.locPlans[s.location] = v; if (live()) Sync.pushProduction(prod); } }
    else delete st.plan;
    save(); draw(); fit(); renderScenes(); logAct("plan", s.number + " " + st.name);
  };
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
    add.onclick = () => { const src = setupObj(); const st = newSetup(setups().length + 1); if (src.plan) st.plan = src.plan; st.items = JSON.parse(JSON.stringify(src.items)).map(i => Object.assign(i, { id: uid() })); setups().push(st); cur.setup = setups().length - 1; save(); renderAll(); toast(st.name + " added (marks copied)"); };
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
    const box = $("pick"); box.innerHTML = ""; box.classList.toggle("show", ["char", "cam", "gear", "props", "line180", "track", "cable", "shape"].includes(tool));
    const opts = [];
    if (tool === "char" && prod) {
      const cast = sceneObj()?.characters.length ? sceneObj().characters : prod.characters.map(c => c.name);
      cast.forEach(n => { const c = charOf(n); opts.push({ v: n, html: `<span class="dot" style="background:${c.colour}">${esc(c.letter)}</span>${esc(n)}` }); });
      opts.push({ v: "__add", html: `<span class="dot add">+</span>Add character` });
    }
    if (tool === "cam") ["A", "B", "C", "D"].forEach(l => opts.push({ v: l, html: `<span class="dot cam">${l}</span>${l} cam` }));
    if (tool === "gear" || tool === "props") Object.entries(Assets.GEAR).filter(([k, g]) => (g.cat === "Props") === (tool === "props")).forEach(([k, g]) => opts.push({ v: k, html: Assets.icon(k) + g.name }));
    if (tool === "shape") [["rect", "Box"], ["circle", "Circle"], ["label", "Text label"]].forEach(([v, n]) => opts.push({ v, html: Assets.shapeIcon(v) + n }));
    if (!pickVal && opts.length) pickVal = opts[0].v;
    opts.forEach(o => { const b = document.createElement("button"); b.innerHTML = o.html; if (o.v === pickVal) b.className = "on"; b.onclick = () => { if (o.v === "__add") return addCharacter(); pickVal = o.v; renderPick(); }; box.appendChild(b); });
    const hint = { char: "Tap the plan to place their next position. A1 → A2 joins with a dotted line; select a mark and drag the small diamond to bend the move.", cam: "Tap the plan to place the camera. Tap again for its move (A1 → A2). Drag the diamond to bend it.", gear: "Tap the plan to place it.", props: "Tap the plan to place it.", line180: "Drag across the plan to draw the 180 line.", track: "Drag to lay track. Select it: drag the ends, drag the middle diamond to curve it, drag the rails to move it.", cable: "Drag from the power to the light. The cable runs at right angles.", shape: "Tap the plan to place a shape, then type its label on the right." }[tool];
    if (hint) box.insertAdjacentHTML("beforeend", `<span class="hint">${hint}</span>`);
  }

  // ---------- drawing ----------
  function markSvg(it) {
    const base = S * scale();
    const s = (it.kind === "char" || it.kind === "cam") ? base * SET.mark * (it.size || 1) : base;
    let body;
    if (it.kind === "cam") body = Assets.camera(it, s);
    else if (it.kind === "char") body = Assets.character(it, s, charOf(it.ref).colour);
    else if (it.kind === "shape") body = Assets.shape(it, s);
    else body = (Assets.GEAR[it.ref] || Assets.GEAR.practical).draw(s * (it.size || 1));
    const unplaced = it.unplaced ? `<circle r="${s * .95}" fill="none" stroke="#FFC857" stroke-width="${s * .05}" stroke-dasharray="${s * .14} ${s * .1}" class="unplaced"/>` : "";
    const ring = isSel(it.id) ? `<circle r="${s * .95}" fill="none" stroke="#fff" stroke-width="${s * .04}" stroke-dasharray="${s * .12} ${s * .1}"/><line x1="${s * .95}" y1="0" x2="${s * 1.15}" y2="0" stroke="#fff" stroke-width="${s * .04}"/><circle class="rot" cx="${s * 1.35}" cy="0" r="${s * .22}" fill="#fff" stroke="${Assets.RED}" stroke-width="${s * .05}"/>` : "";
    return `<g class="mark${it.unplaced ? " ghost" : ""}" data-id="${it.id}" transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">${unplaced}${ring}${body}</g>`;
  }
  // Curve helpers: control point (cx, cy) on the later mark / line; handle sits on the curve midpoint.
  const bendCtl = (a, b) => b.cx != null ? { x: (a.x + 2 * b.cx + b.x) / 4, y: (a.y + 2 * b.cy + b.y) / 4 } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const bendPath = (a, b) => b.cx != null ? `M${a.x} ${a.y} Q${b.cx} ${b.cy} ${b.x} ${b.y}` : `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const setBend = (a, b, p) => { b.cx = 2 * p.x - (a.x + b.x) / 2; b.cy = 2 * p.y - (a.y + b.y) / 2; };
  function lineSvg(l, s) {
    const on = isSel(l.id), A = { x: l.x, y: l.y }, B = { x: l.x2, y: l.y2, cx: l.cx, cy: l.cy };
    let d = l.kind === "cable" ? (l.flip ? `M${l.x} ${l.y} V${l.y2} H${l.x2}` : `M${l.x} ${l.y} H${l.x2} V${l.y2}`) : bendPath(A, B);
    let body;
    if (l.kind === "line180") body = `<path d="${d}" fill="none" stroke="${Assets.RED}" stroke-width="${s * .08}" stroke-dasharray="${s * .22} ${s * .18}"/>`;
    else if (l.kind === "track") body = `<path d="${d}" fill="none" stroke="#A9AFBD" stroke-width="${s * .84}" stroke-dasharray="${s * .07} ${s * .5}"/><path d="${d}" fill="none" stroke="#A9AFBD" stroke-width="${s * .62}"/><path d="${d}" fill="none" stroke="#1A1D24" stroke-opacity=".9" stroke-width="${s * .46}"/>`;
    else body = `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${SET.cable}" stroke-width="${s * .07}" stroke-linejoin="round"/>`;
    let h = "";
    if (on) {
      h = `<circle class="end1" cx="${l.x}" cy="${l.y}" r="${s * .18}" fill="#fff"/><circle class="end2" cx="${l.x2}" cy="${l.y2}" r="${s * .18}" fill="#fff"/>`;
      if (l.kind !== "cable") { const c = bendCtl(A, B); h += `<rect class="bendl" x="${c.x - s * .16}" y="${c.y - s * .16}" width="${s * .32}" height="${s * .32}" fill="#fff" stroke="${Assets.RED}" stroke-width="${s * .05}" transform="rotate(45 ${c.x} ${c.y})"/>`; }
      else h += `<path d="${d}" fill="none" stroke="#fff" stroke-width="${s * .03}" stroke-dasharray="${s * .1} ${s * .1}"/>`;
    }
    return `<g class="mark" data-id="${l.id}"><path d="${d}" fill="none" stroke="transparent" stroke-width="${s * (l.kind === "track" ? 1.1 : .6)}"/>${body}${h}</g>`;
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
      // Move lines: straight, or bent through the control point stored on the later mark (cx, cy).
      const ds = s * SET.dot;
      for (let k = 1; k < g.length; k++) {
        const a = g[k - 1], b = g[k], d = bendPath(a, b);
        out += `<path d="${d}" fill="none" stroke="#14161B" stroke-opacity=".55" stroke-width="${ds * .18}" stroke-linecap="round" stroke-dasharray="${ds * .02} ${ds * .2}"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${ds * .11}" stroke-dasharray="${ds * .02} ${ds * .2}" stroke-linecap="round"/>`;
        if (sel === b.id) { const c = bendCtl(a, b); out += `<rect class="bend" data-id="${b.id}" x="${c.x - s * .16}" y="${c.y - s * .16}" width="${s * .32}" height="${s * .32}" fill="#fff" stroke="${col}" stroke-width="${s * .05}" transform="rotate(45 ${c.x} ${c.y})"/>`; }
      }
    });
    st.items.filter(i => LINES.includes(i.kind)).forEach(l => out += lineSvg(l, s));
    st.items.filter(i => i.kind === "gear" || i.kind === "shape").forEach(i => out += markSvg(i));
    st.items.filter(i => i.kind === "cam" || i.kind === "char").forEach(i => out += markSvg(i));
    const sc = sceneObj(), d = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    const tbw = s * 5.4;
    out += `<g class="tb" transform="translate(${p.w - tbw - s * .3} ${s * .3})"><rect width="${tbw}" height="${s * 1.95}" rx="${s * .12}" fill="#F4F2EC" opacity=".94"/><rect width="${s * .12}" height="${s * 1.95}" fill="${Assets.RED}"/><text x="${s * .35}" y="${s * .58}" font-size="${s * .36}" font-weight="700" fill="#1A1D24">SC ${esc(sc.number)} · ${esc(st.name)}</text><text x="${s * .35}" y="${s * 1.04}" font-size="${s * .29}" fill="#1A1D24">${esc(sc.location.replace(/^.* - /, "").slice(0, 30))}</text><text x="${s * .35}" y="${s * 1.48}" font-size="${s * .27}" fill="#5A6070">${esc((sc.time || "").slice(0, 22))}  ·  ${d}</text></g>`;
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

  // ---------- pointer: place, drag, rotate, bend, pan, pinch, marquee ----------
  // Mouse: left = select / drag (empty space = box select), right = options menu, middle or Space+drag = pan, wheel = zoom.
  const pointers = new Map();
  const touchy = e => e.pointerType === "touch" || e.pointerType === "pen";
  svg.addEventListener("contextmenu", e => e.preventDefault());
  svg.addEventListener("pointerdown", e => {
    if (!setupObj() || !planObj()) return;
    closeMenus();
    try { svg.setPointerCapture(e.pointerId); } catch (er) {} pointers.set(e.pointerId, e);
    if (pointers.size === 2) { drag = { pinch: true, d0: dist(), v0: { ...view } }; return; }
    const p = pt(e), st = setupObj(), m = e.target.closest(".mark");
    if (e.button === 1 || spaceDown) { e.preventDefault(); drag = { pan: true, sx: e.clientX, sy: e.clientY, v0: { ...view } }; return; }
    if (e.button === 2) {
      if (m) { const id = m.dataset.id; if (!isSel(id)) { sel = id; multi.clear(); } draw(); renderProps(); }
      return ctxMenu(e, m ? st.items.find(i => i.id === m.dataset.id) : null);
    }
    if (e.target.classList.contains("bend")) {
      const b = st.items.find(i => i.id === e.target.dataset.id), a = st.items.filter(i => i.kind === b.kind && i.ref === b.ref && i.n < b.n).sort((x, y) => y.n - x.n)[0];
      if (a) { snapshot(); drag = { bend: [a, b] }; } return;
    }
    if (LINES.includes(tool) && !m) {
      snapshot(); const l = { id: uid(), kind: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }; st.items.push(l); sel = l.id; multi.clear(); drag = { line: l, end: 2, fresh: true }; draw(); return;
    }
    if (["char", "cam", "gear", "props", "shape"].includes(tool) && !m) {
      if (!pickVal) return toast("Pick who or what to place first");
      if (pickVal === "__add") return addCharacter();
      snapshot();
      let it;
      if (tool === "gear" || tool === "props") it = { id: uid(), kind: "gear", ref: pickVal, x: p.x, y: p.y, rot: 0, size: 1 };
      else if (tool === "shape") it = { id: uid(), kind: "shape", shape: pickVal, x: p.x, y: p.y, rot: 0, size: 1, colour: "#ECEEF3", note: pickVal === "label" ? "Label" : "" };
      else {
        const n = nextNumber(tool, pickVal);
        const letter = tool === "cam" ? pickVal : charOf(pickVal).letter;
        const prev = st.items.filter(i => i.kind === tool && i.ref === pickVal).sort((a, b) => b.n - a.n)[0];
        it = { id: uid(), kind: tool, ref: pickVal, n, label: letter + n, x: p.x, y: p.y, rot: prev ? prev.rot : (tool === "cam" ? -90 : 0), lens: prev?.lens || (tool === "cam" ? "35mm" : ""), shot: prev?.shot || "", height: prev?.height || "", move: prev?.move || "", note: "", size: prev?.size || 1 };
      }
      st.items.push(it); sel = it.id; multi.clear(); save(); draw(); renderProps(); logAct("add", it.kind + " " + (it.ref || it.shape)); return;
    }
    if (m) {
      const it = st.items.find(i => i.id === m.dataset.id); snapshot();
      if (e.shiftKey || e.ctrlKey) { if (isSel(it.id)) { multi.delete(it.id); if (sel === it.id) sel = null; } else { if (sel) multi.add(sel); multi.add(it.id); sel = it.id; } undoStack.pop(); draw(); renderProps(); return; }
      if (!isSel(it.id)) multi.clear(); else if (sel && sel !== it.id) multi.add(sel);
      sel = it.id;
      if (e.target.classList.contains("rot")) drag = { rot: it };
      else if (e.target.classList.contains("end1")) drag = { line: it, end: 1 };
      else if (e.target.classList.contains("end2")) drag = { line: it, end: 2 };
      else if (e.target.classList.contains("bendl")) drag = { bendLine: it };
      else {
        const group = multi.size ? st.items.filter(i => isSel(i.id)) : [it];
        drag = { group: group.map(i => ({ i, x: i.x, y: i.y, x2: i.x2, y2: i.y2, cx: i.cx, cy: i.cy })), p0: p, moved: false };
      }
      draw(); renderProps(); return;
    }
    sel = null; multi.clear();
    if (touchy(e) || tool !== "select") drag = { pan: true, sx: e.clientX, sy: e.clientY, v0: { ...view } };
    else drag = { box: true, sx: e.clientX, sy: e.clientY, p0: p };
    draw(); renderProps();
  });
  svg.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
    const p = pt(e);
    if (live()) Sync.cursor(cur.scene, cur.setup, p.x, p.y);
    if (!drag) return;
    if (drag.pinch && pointers.size === 2) { const k = drag.d0 / dist(); const c = drag.v0; view = { w: c.w * k, h: c.h * k, x: c.x + (c.w - c.w * k) / 2, y: c.y + (c.h - c.h * k) / 2 }; setView(); return; }
    if (drag.pan) { const r = svg.getBoundingClientRect(); view.x = drag.v0.x - (e.clientX - drag.sx) / r.width * view.w; view.y = drag.v0.y - (e.clientY - drag.sy) / r.height * view.h; setView(); return; }
    if (drag.box) { const b = $("marquee"); b.hidden = false; Object.assign(b.style, { left: Math.min(e.clientX, drag.sx) + "px", top: Math.min(e.clientY, drag.sy) + "px", width: Math.abs(e.clientX - drag.sx) + "px", height: Math.abs(e.clientY - drag.sy) + "px" }); drag.p1 = p; return; }
    if (drag.bend) { setBend(drag.bend[0], drag.bend[1], p); draw(); return; }
    if (drag.bendLine) { const l = drag.bendLine; l.cx = 2 * p.x - (l.x + l.x2) / 2; l.cy = 2 * p.y - (l.y + l.y2) / 2; draw(); return; }
    if (drag.line) { if (drag.end === 1) { drag.line.x = p.x; drag.line.y = p.y; } else { drag.line.x2 = p.x; drag.line.y2 = p.y; } draw(); return; }
    if (drag.rot) { drag.rot.rot = Math.round(Math.atan2(p.y - drag.rot.y, p.x - drag.rot.x) * 180 / Math.PI / 5) * 5; draw(); return; }
    if (drag.group) {
      const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y; if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
      drag.group.forEach(g => {
        g.i.x = g.x + dx; g.i.y = g.y + dy;
        if (g.x2 != null) { g.i.x2 = g.x2 + dx; g.i.y2 = g.y2 + dy; }
        if (g.cx != null && LINES.includes(g.i.kind)) { g.i.cx = g.cx + dx; g.i.cy = g.cy + dy; }
      });
      draw();
    }
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (drag && drag.box) {
      $("marquee").hidden = true;
      if (drag.p1) {
        const x1 = Math.min(drag.p0.x, drag.p1.x), x2 = Math.max(drag.p0.x, drag.p1.x), y1 = Math.min(drag.p0.y, drag.p1.y), y2 = Math.max(drag.p0.y, drag.p1.y), pad = S * scale() * .5;
        const hit = (x, y) => x >= x1 - pad && x <= x2 + pad && y >= y1 - pad && y <= y2 + pad;
        setupObj().items.forEach(i => { if (hit(i.x, i.y) || (i.x2 != null && (hit(i.x2, i.y2) || hit((i.x + i.x2) / 2, (i.y + i.y2) / 2)))) multi.add(i.id); });
        sel = [...multi][0] || null; const n = multi.size; if (n === 1) multi.clear();
        if (sel) toast(n + " selected · Ctrl+C copy · right-click for options");
      }
      drag = null; draw(); renderProps(); return;
    }
    if (drag && !drag.pan && !drag.pinch) {
      if (drag.group && drag.moved) drag.group.forEach(g => delete g.i.unplaced);
      if (drag.group && !drag.moved) undoStack.pop();
      if (drag.line && drag.fresh && Math.hypot(drag.line.x2 - drag.line.x, drag.line.y2 - drag.line.y) < 10) { const st = setupObj(); st.items = st.items.filter(i => i !== drag.line); sel = null; }
      save(); renderProps(); draw();
    }
    drag = null;
    if (pending) { const p_ = pending; pending = null; App.applyRemote(p_.prod, p_.blocks, p_.plans); }
  };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  function dist() { const [a, b] = [...pointers.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; }
  const resize = (l, d) => l.forEach(i => i.size = Math.min(3, Math.max(.4, +((i.size || 1) + d).toFixed(2))));
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    // Shift+wheel with something selected = resize it.
    if (e.shiftKey && selItems().length) { resize(selItems(), e.deltaY > 0 ? -.1 : .1); save(); draw(); renderProps(); return; }
    const p = pt(e), k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    view = { w: view.w * k, h: view.h * k, x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k }; setView();
  }, { passive: false });

  // ---------- selection actions: copy / paste / duplicate / delete ----------
  const selItems = () => { const st = setupObj(); return st ? st.items.filter(i => isSel(i.id)) : []; };
  const shift = (n, dx, dy) => { n.x += dx; n.y += dy; if (n.x2 != null) { n.x2 += dx; n.y2 += dy; } if (n.cx != null && LINES.includes(n.kind)) { n.cx += dx; n.cy += dy; } return n; };
  function copySel() { const l = selItems(); if (!l.length) { toast("Select something first (drag a box round it)"); return false; } clip = JSON.parse(JSON.stringify(l)); toast(l.length + " copied · go to the next setup and Ctrl+V"); return true; }
  function paste(dx = 0, dy = 0) {
    const st = setupObj(); if (!clip || !st) return toast("Nothing copied yet");
    snapshot(); multi.clear();
    clip.forEach(c => { const n = shift(Object.assign(JSON.parse(JSON.stringify(c)), { id: uid() }), dx, dy); st.items.push(n); multi.add(n.id); });
    sel = [...multi][0]; if (multi.size === 1) multi.clear();
    save(); draw(); renderProps(); toast(clip.length + " pasted into " + st.name); logAct("paste", clip.length + " items");
  }
  function copyToNextSetup() {
    if (!copySel()) return;
    if (cur.setup >= setups().length - 1) { const src = setupObj(), st = newSetup(setups().length + 1); if (src.plan) st.plan = src.plan; setups().push(st); }
    cur.setup++; sel = null; multi.clear(); renderAll(); paste(); announce();
  }
  function removeSel() { if (!selItems().length) return; snapshot(); const st = setupObj(); st.items = st.items.filter(i => !isSel(i.id)); sel = null; multi.clear(); save(); draw(); renderProps(); }
  function ctxMenu(e, it) {
    closeMenus();
    const m = document.createElement("div"); m.className = "menu"; m.style.left = e.clientX + "px"; m.style.top = e.clientY + "px";
    const n = selItems().length, sized = it && ["char", "cam", "gear", "shape"].includes(it.kind);
    m.innerHTML = it ? `<button data-a="dup">Duplicate</button><button data-a="copy">Copy${n > 1 ? " " + n + " items" : ""}</button><button data-a="next">Copy to next setup</button>${sized ? `<button data-a="big">Bigger ( ] )</button><button data-a="small">Smaller ( [ )</button>` : ""}${it.cx != null ? `<button data-a="straight">Straighten</button>` : ""}${it.kind === "cable" ? `<button data-a="flip">Flip corner</button>` : ""}<button data-a="front">Bring to front</button><button data-a="back">Send to back</button><button data-a="del" class="danger">Delete</button>`
      : `<button data-a="paste">Paste here</button><button data-a="fit">Fit plan (F)</button><button data-a="keys">Shortcuts (?)</button>`;
    const p = pt(e);
    m.onclick = ev => {
      const a = ev.target.dataset.a; if (!a) return; closeMenus(); const st = setupObj();
      if (a === "dup") { if (copySel()) paste(S * scale() * .6, S * scale() * .6); }
      if (a === "copy") copySel();
      if (a === "next") copyToNextSetup();
      if (a === "big" || a === "small") { snapshot(); resize(selItems(), a === "big" ? .2 : -.2); save(); draw(); renderProps(); }
      if (a === "straight") { snapshot(); delete it.cx; delete it.cy; save(); draw(); }
      if (a === "flip") { snapshot(); it.flip = !it.flip; save(); draw(); }
      if (a === "front" || a === "back") { snapshot(); const l = selItems(); st.items = st.items.filter(i => !isSel(i.id)); st.items = a === "front" ? st.items.concat(l) : l.concat(st.items); save(); draw(); }
      if (a === "del") removeSel();
      if (a === "paste") { if (!clip) return toast("Nothing copied yet"); paste(p.x - clip[0].x, p.y - clip[0].y); }
      if (a === "fit") fit();
      if (a === "keys") openSettings();
    };
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(); if (r.bottom > innerHeight) m.style.top = (innerHeight - r.height - 8) + "px"; if (r.right > innerWidth) m.style.left = (innerWidth - r.width - 8) + "px";
    setTimeout(() => document.addEventListener("pointerdown", closeOnOutside), 0);
  }

  // ---------- keyboard ----------
  function saveNow() { saveDevice(); if (cur.scene && live()) Sync.pushScene(cur.scene, blocks[cur.scene]); flashSaved(); }
  function flashSaved() { const t = $("savedTag"); t.hidden = false; t.textContent = "Saved " + new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }); }
  document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === "s") { e.preventDefault(); return saveNow(); }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === " ") { spaceDown = true; e.preventDefault(); return; }
    if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? undoRedo(redoStack, undoStack) : undoRedo(undoStack, redoStack); }
    if (mod && k === "y") { e.preventDefault(); return undoRedo(redoStack, undoStack); }
    if (mod && k === "c") { e.preventDefault(); return copySel(); }
    if (mod && k === "v") { e.preventDefault(); return paste(); }
    if (mod && k === "d") { e.preventDefault(); if (copySel()) paste(S * scale() * .6, S * scale() * .6); return; }
    if (mod && k === "a") { e.preventDefault(); const st = setupObj(); if (!st) return; multi = new Set(st.items.map(i => i.id)); sel = [...multi][0] || null; draw(); renderProps(); return; }
    if (mod) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selItems().length) removeSel();
    if (e.key === "Escape") { sel = null; multi.clear(); closeLightbox(); closeMenus(); draw(); renderProps(); }
    if (k === "f") fit();
    if (e.key === "?") openSettings();
    if (e.key === "[" || e.key === "]") { if (!selItems().length) return; snapshot(); resize(selItems(), e.key === "]" ? .1 : -.1); save(); draw(); renderProps(); }
    const toolKeys = { v: "select", c: "char", a: "cam", l: "line180", g: "gear", p: "props", t: "track", e: "cable", s: "shape" };
    if (toolKeys[k]) { const b = $("tools").querySelector(`[data-tool="${toolKeys[k]}"]`); if (b) b.click(); }
  });
  document.addEventListener("keyup", e => { if (e.key === " ") spaceDown = false; });

  // ---------- right panel: selected mark, or the setup's shot list ----------
  const SHOTS = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "EWS", "OTS", "2S", "3S", "Insert", "POV", "High angle", "Low angle", "Top down"];
  function shotListHtml(st) {
    const sl = st.shotlist; if (!sl) return "";
    const one = (c, l) => c && (c.desc || c.shot) ? `<div class="sl"><span class="tag">${l} cam</span><b>${esc(c.desc || "-")}</b><span>${[c.lens, c.rig, c.shot].filter(Boolean).map(esc).join(" · ")}</span>${c.cover ? `<small>${esc(c.cover)}</small>` : ""}</div>` : "";
    return `<div class="shotlist"><div class="cap">Shot list · ${esc(st.name)}</div>${sl.note ? `<p class="hint">${esc(sl.note)}</p>` : ""}${one(sl.A, "A")}${one(sl.B, "B")}${(st.extra || []).map(x => one(x.A, "A") + one(x.B, "B")).join("")}</div>`;
  }
  function renderProps() {
    const st = setupObj(), box = $("props"), it = st && !multi.size && st.items.find(i => i.id === sel);
    $("right").classList.toggle("open", !!it);
    if (!it) {
      $("propHead").textContent = st ? st.name : "Nothing selected";
      const unplaced = st ? st.items.filter(i => i.unplaced).length : 0;
      box.innerHTML = (st ? shotListHtml(st) : "") + (unplaced ? `<p class="note-y">${unplaced} camera${unplaced > 1 ? "s" : ""} from the shot list ${unplaced > 1 ? "are" : "is"} waiting at the bottom of the plan (yellow ring): drag ${unplaced > 1 ? "them" : "it"} into place.</p>` : "") +
        `<p class="hint">Pick a tool on the plan and tap to place. Tap the same character or camera again for the next position (A1 → A2). Drag to move, drag the white dot to turn. Drag a box to select many; right-click for options. Pinch or scroll to zoom. Press ? for all shortcuts.</p>`;
      return;
    }
    const f = (lab, html) => `<div class="f"><label>${lab}</label>${html}</div>`;
    const inp = (k, v, ph = "", list = "") => `<input type="text" data-k="${k}" value="${esc(v || "")}" placeholder="${ph}" ${list ? `list="${list}"` : ""}>`;
    let h = "";
    if (it.kind === "cam") {
      $("propHead").textContent = it.ref + " cam · " + it.label;
      h += f("Lens", inp("lens", it.lens, "35mm", "lensList")) + f("Shot size", inp("shot", it.shot, "MCU", "shotList")) + f("Rig / movement", inp("move", it.move, "Sticks, slider, track, gimbal...", "rigList")) + f("Height", inp("height", it.height, "1.4 m")) + f("Size", `<input type="range" min=".4" max="3" step=".1" data-k="size" value="${it.size || 1}">`) + f("Notes", `<textarea data-k="note">${esc(it.note || "")}</textarea>`);
    } else if (it.kind === "char") {
      $("propHead").textContent = it.ref + " · position " + it.n;
      h += f("Action at this mark", `<textarea data-k="note" placeholder="What happens here">${esc(it.note || "")}</textarea>`) + f("Size", `<input type="range" min=".4" max="3" step=".1" data-k="size" value="${it.size || 1}">`);
    } else if (it.kind === "gear") {
      $("propHead").textContent = Assets.GEAR[it.ref]?.name || "Gear";
      h += f("Label / notes", inp("note", it.note, "e.g. 2K through window")) + f("Size", `<input type="range" min=".5" max="3" step=".1" data-k="size" value="${it.size || 1}">`);
    } else if (it.kind === "shape") {
      $("propHead").textContent = "Shape";
      h += f("Label", inp("note", it.note, "e.g. Bench, Water tank")) + f("Colour", `<input type="color" data-k="colour" value="${it.colour || "#ECEEF3"}">`) + f("Size", `<input type="range" min=".3" max="6" step=".1" data-k="size" value="${it.size || 1}">`);
    } else {
      $("propHead").textContent = { line180: "180 line", track: "Track", cable: "Extension cable" }[it.kind];
      h += `<p class="hint">${it.kind === "cable" ? "Drag the white ends. Right-click: flip the corner." : "Drag the white ends. Drag the diamond to curve it. Right-click: straighten."}</p>` + (it.kind !== "line180" ? f("Label / notes", inp("note", it.note, it.kind === "track" ? "e.g. 6 m track" : "e.g. 25 m to genny")) : "");
    }
    if (!LINES.includes(it.kind)) h += f("Turn", `<div class="row"><button class="btn small" data-turn="-15">⟲ 15°</button><button class="btn small" data-turn="15">⟳ 15°</button><button class="btn small" data-turn="180">180°</button></div>`);
    h += `<div class="row"><button class="btn red" id="delMark">Delete</button><button class="btn" id="doneMark">Done</button></div>`;
    h += `<datalist id="lensList">${["16-35mm", "24-70mm", "70-200mm", "24mm", "35mm", "50mm", "85mm"].map(o => `<option value="${o}">`).join("")}</datalist><datalist id="shotList">${SHOTS.map(o => `<option value="${o}">`).join("")}</datalist><datalist id="rigList">${["Sticks", "Slider", "Track", "Dolly track", "Gimbal", "Handheld", "Lowball", "Combo"].map(o => `<option value="${o}">`).join("")}</datalist>`;
    box.innerHTML = h;
    box.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { it[el.dataset.k] = el.type === "range" ? +el.value : el.value; save(); draw(); });
    if (it.kind === "gear" && Assets.GEAR[it.ref]) $("propHead").textContent = Assets.GEAR[it.ref].name;
    box.querySelectorAll("[data-turn]").forEach(el => el.onclick = () => { snapshot(); it.rot = ((it.rot || 0) + +el.dataset.turn) % 360; save(); draw(); });
    $("delMark").onclick = removeSel;
    $("doneMark").onclick = () => { sel = null; draw(); renderProps(); };
  }

  // ---------- add a character (name, 1-2 letters, colour) ----------
  const PALETTE = ["#5FC9F3", "#FFC857", "#7FE3A0", "#FF8FA3", "#C3A6FF", "#FFB070", "#8FD3FF", "#F5F5F5", "#E5484D", "#3DD6C6", "#B5E853", "#D98CFF"];
  function addCharacter() {
    if (!prod) return toast("Import a script first");
    const sc = sceneObj();
    const box = document.createElement("div"); box.className = "modal";
    const used = new Set(prod.characters.map(c => c.colour));
    const col0 = PALETTE.find(c => !used.has(c)) || PALETTE[0];
    box.innerHTML = `<form class="card wide"><h2>Add a character${sc ? " to Sc " + esc(sc.number) : ""}</h2>
      <label>Name<input name="n" list="castList" placeholder="e.g. Zola" required></label>
      <datalist id="castList">${prod.characters.map(c => `<option value="${esc(c.name)}">`).join("")}</datalist>
      <label>Letters on the circle <small>(1 or 2, e.g. ZO and ZA when two names start with Z)</small><input name="l" maxlength="2" autocapitalize="characters"></label>
      <label>Colour<div class="row" id="cols">${PALETTE.map(c => `<button type="button" class="dot" data-c="${c}" style="background:${c};width:26px;height:26px;${c === col0 ? "outline:2px solid #fff" : ""}"></button>`).join("")}<input type="color" name="c" value="${col0}" style="width:40px;height:28px;padding:0;border:0;background:none"></div></label>
      <p class="err" hidden></p>
      <div class="row"><button class="btn red big">Add</button><button type="button" class="btn" data-a="x">Cancel</button></div></form>`;
    const f = box.querySelector("form"), err = box.querySelector(".err");
    const suggest = () => { const n = f.n.value.trim().toUpperCase(); if (!n || f.l.dataset.touched) return; const one = n[0], clash = prod.characters.some(c => c.name.toUpperCase() !== n && c.letter === one); f.l.value = clash ? n.slice(0, 2) : one; const ex = prod.characters.find(c => c.name.toUpperCase() === n); if (ex) { f.l.value = ex.letter; f.c.value = ex.colour; } };
    f.n.oninput = suggest; f.l.oninput = () => f.l.dataset.touched = 1;
    box.querySelector("#cols").onclick = e => { const c = e.target.dataset.c; if (!c) return; f.c.value = c; box.querySelectorAll("#cols .dot").forEach(d => d.style.outline = d.dataset.c === c ? "2px solid #fff" : ""); };
    box.querySelector('[data-a="x"]').onclick = () => box.remove();
    f.onsubmit = e => {
      e.preventDefault();
      const name = f.n.value.trim(), letter = f.l.value.trim().toUpperCase().slice(0, 2) || name[0].toUpperCase(), colour = f.c.value;
      const ex = prod.characters.find(c => c.name.toUpperCase() === name.toUpperCase());
      const clash = prod.characters.find(c => c !== ex && c.letter === letter);
      if (clash) { err.textContent = `${clash.name} already uses ${letter}. Try two letters (e.g. ${name.slice(0, 2).toUpperCase()}).`; err.hidden = false; return; }
      let ch = ex;
      if (ex) { ex.letter = letter; ex.colour = colour; } else { ch = { name: name.toUpperCase(), letter, colour }; prod.characters.push(ch); }
      if (sc && !sc.characters.includes(ch.name)) sc.characters.push(ch.name);
      if (live()) Sync.pushProduction(prod);
      saveDevice(); box.remove(); pickVal = ch.name; tool = "char"; renderPick(); draw(); toast(ch.name + " added · tap the plan to place " + letter + "1"); logAct("character", ch.name);
    };
    document.body.appendChild(box); setTimeout(() => f.n.focus(), 50);
  }

  // ---------- settings + shortcuts ----------
  const KEYS = [["Left click", "Select / drag. Drag on empty plan = box select"], ["Right click", "Options: duplicate, copy, copy to next setup, size, delete"], ["Middle drag / Space+drag", "Move the whole plan"], ["Wheel", "Zoom"], ["Shift+wheel, [ and ]", "Smaller / bigger (selected)"], ["Shift+click", "Add to selection"], ["Ctrl+A", "Select all in this setup"], ["Ctrl+C / Ctrl+V", "Copy / paste (paste into another setup)"], ["Ctrl+D", "Duplicate"], ["Delete", "Delete selected"], ["Ctrl+Z / Ctrl+Y", "Undo / redo"], ["Ctrl+S", "Save now (it also saves by itself)"], ["F", "Fit plan"], ["V C A L G P T E S", "Select, Character, Camera, 180 line, Gear, Props, Track, Cable, Shape"], ["Esc", "Clear selection"], ["?", "This panel"]];
  function openSettings() {
    closeMenus();
    const dev = new URLSearchParams(location.search).has("dev");
    const box = document.createElement("div"); box.className = "modal";
    box.innerHTML = `<div class="card wide"><h2>Settings</h2>
      <div class="setrow">Character + camera size<input type="range" min=".5" max="2" step=".05" data-s="mark" value="${SET.mark}"></div>
      <div class="setrow">Move dots<input type="range" min=".4" max="2" step=".05" data-s="dot" value="${SET.dot}"></div>
      <div class="setrow">Cable darkness<input type="range" min=".15" max="1" step=".05" data-s="cable" value="${SET.cable}"></div>
      <p class="hint">Sizes here are for your screen. To size one mark for everyone, select it and use [ ] or the Size slider.</p>
      <h3>Shortcuts</h3><div class="keys">${KEYS.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join("")}</div>
      ${dev ? `<h3>Developer</h3><button class="btn" data-a="log">Activity log</button>` : ""}
      <div class="row"><button class="btn red" data-a="x">Close</button></div></div>`;
    box.querySelectorAll("[data-s]").forEach(r => r.oninput = () => { SET[r.dataset.s] = +r.value; saveSet(); draw(); });
    box.onclick = e => { const a = e.target.dataset.a; if (a === "x" || e.target === box) box.remove(); if (a === "log") { box.remove(); Sync.showLog && Sync.showLog(); } };
    document.body.appendChild(box);
  }
  $("btnSettings").onclick = openSettings;

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
