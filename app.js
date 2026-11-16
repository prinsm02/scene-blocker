// Scene Blocker app. Data: one production = scenes + characters + floor plans; blocking per scene = setups.
(() => {
  const $ = id => document.getElementById(id);
  const svg = $("svg");
  const S = 90; // base mark size in plan pixels (scaled per plan)
  const uid = () => Math.random().toString(36).slice(2, 10);
  const toast = (t, ms = 2600) => { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); };

  let prod = null;          // {id,title,characters[],scenes[],plans{id:{name,src,w,h}},locPlans{location:planId}}
  let blocks = {};          // sceneNumber -> [{id,name,items[],frames[]}]
  let cur = { scene: null, setup: 0 }, tool = "select", pickVal = null, sel = null;
  let view = { x: 0, y: 0, w: 1000, h: 700 };

  // ---------- persistence (device) + live sync hook ----------
  const save = debounce(async () => {
    if (!prod) return;
    await Store.set("prod", prod);
    await Store.set("blocks", blocks);
    if (window.Sync && Sync.live) Sync.pushScene(cur.scene, blocks[cur.scene]);
  }, 400);
  function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

  // ---------- import ----------
  $("inScript").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      toast("Reading " + f.name + "...");
      const r = await Parse.file(f);
      const keepPlans = r.pack ? r.plans : Object.assign({}, prod ? prod.plans : {});
      const keepLoc = r.pack ? r.locPlans : (prod?.locPlans || {});
      if (r.pack) blocks = r.blocks || {};
      prod = { id: prod?.id || uid(), title: r.title, characters: r.characters, scenes: r.scenes, plans: keepPlans, locPlans: keepLoc };
      r.scenes.forEach(s => { if (!blocks[s.number]) blocks[s.number] = [newSetup(1)]; });
      if (window.Sync && Sync.live) Sync.pushProduction(prod);
      cur.scene = r.scenes[0].number; cur.setup = 0;
      save(); renderAll();
      toast(r.scenes.length + " scenes and " + r.characters.length + " characters imported");
    } catch (err) { toast("Import failed: " + err.message, 5000); console.error(err); }
  };
  $("inPlan").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !prod) return toast("Import a script first");
    const name = prompt("Name this floor plan (e.g. Kitchen)", f.name.replace(/\.[^.]+$/, ""));
    if (!name) return;
    const img = await shrink(f, 2000, .86);
    const id = uid();
    prod.plans[id] = Object.assign({ name }, img);
    const loc = sceneObj()?.location; if (loc) prod.locPlans[loc] = id;
    if (window.Sync && Sync.live) Sync.pushPlan(id, prod.plans[id], prod.locPlans);
    save(); renderAll(); fit();
  };
  $("inFrames").onchange = async e => {
    const files = [...e.target.files]; e.target.value = "";
    const st = setupObj(); if (!st) return toast("Pick a scene first");
    for (const f of files) {
      const img = await shrink(f, 1280, .8);
      st.frames.push({ id: uid(), src: img.src, label: nextFrameLabel(st), note: "" });
    }
    save(); renderFrames();
  };
  function shrink(file, max, q) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const im = new Image();
        im.onload = () => {
          const k = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          res({ src: c.toDataURL("image/jpeg", q), w: c.width, h: c.height });
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
  const setupObj = () => cur.scene ? setups()[cur.setup] : null;
  const planObj = () => { const s = sceneObj(); const id = s && prod.locPlans[s.location]; return id ? prod.plans[id] : null; };
  const charOf = name => prod.characters.find(c => c.name === name) || { name, letter: "?", colour: "#ccc" };
  const scale = () => { const p = planObj(); return p ? Math.max(p.w, p.h) / 1400 : 1; };
  function nextNumber(kind, ref) {
    const st = setupObj();
    return st.items.filter(i => i.kind === kind && i.ref === ref).reduce((m, i) => Math.max(m, i.n), 0) + 1;
  }
  function nextFrameLabel(st) { return String(st.frames.length + 1); }

  // ---------- render: lists ----------
  function renderAll() { renderHeader(); renderScenes(); renderPlanPick(); renderTabs(); renderPick(); draw(); renderProps(); renderFrames(); }
  function renderHeader() {
    $("prodName").textContent = prod ? prod.title : "No production yet";
    const s = sceneObj();
    $("sceneTitle").textContent = s ? `SC ${s.number} - ${s.intExt}. ${s.location}${s.time ? " - " + s.time : ""}` : "Import a script to start";
  }
  function renderScenes() {
    const q = $("search").value.toLowerCase();
    const ol = $("sceneList"); ol.innerHTML = "";
    if (!prod) return;
    prod.scenes.filter(s => !q || (s.number + " " + s.location + " " + s.characters.join(" ")).toLowerCase().includes(q)).forEach(s => {
      const li = document.createElement("li");
      if (s.number === cur.scene) li.className = "on";
      const here = window.Sync ? Sync.peopleOn(s.number) : [];
      li.innerHTML = `<span class="n">${s.number}</span><span class="h">${Assets.esc(s.intExt)}. ${Assets.esc(s.location)}<small>${Assets.esc(s.time)}${s.storyDay ? " · SD " + s.storyDay : ""}${here.length ? " · " + here.map(p => `<b style="color:${p.colour}">●</b>`).join("") : ""}</small></span>`;
      li.onclick = () => { cur.scene = s.number; cur.setup = 0; sel = null; $("left").classList.remove("open"); renderAll(); fit(); announce(); };
      ol.appendChild(li);
    });
  }
  $("search").oninput = renderScenes;
  function renderPlanPick() {
    const s = sceneObj(), sel_ = $("planPick");
    $("locName").textContent = s ? s.location : "this location";
    sel_.innerHTML = `<option value="">Choose a floor plan...</option>` + (prod ? Object.entries(prod.plans).map(([id, p]) => `<option value="${id}">${Assets.esc(p.name)}</option>`).join("") : "");
    sel_.value = s && prod.locPlans[s.location] || "";
    sel_.disabled = !s;
  }
  $("planPick").onchange = e => { const s = sceneObj(); if (!s) return; prod.locPlans[s.location] = e.target.value || undefined; if (window.Sync && Sync.live) Sync.pushProduction(prod); save(); draw(); fit(); };
  function renderTabs() {
    const box = $("setupTabs"); box.innerHTML = "";
    if (!cur.scene) return;
    setups().forEach((st, k) => {
      const b = document.createElement("button"); b.textContent = st.name; if (k === cur.setup) b.className = "on";
      b.onclick = () => { cur.setup = k; sel = null; renderAll(); announce(); };
      b.ondblclick = () => { const n = prompt("Rename setup", st.name); if (n) { st.name = n; save(); renderTabs(); } };
      box.appendChild(b);
    });
    const add = document.createElement("button"); add.textContent = "+"; add.title = "New setup (copies the marks of this one)";
    add.onclick = () => { const src = setupObj(); const st = newSetup(setups().length + 1); st.items = JSON.parse(JSON.stringify(src.items)).map(i => Object.assign(i, { id: uid() })); setups().push(st); cur.setup = setups().length - 1; save(); renderAll(); };
    box.appendChild(add);
    $("boardSetup").textContent = setupObj() ? "· " + setupObj().name : "";
  }

  // ---------- tools ----------
  $("tools").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    tool = b.dataset.tool; pickVal = null;
    [...$("tools").children].forEach(x => x.classList.toggle("on", x === b));
    renderPick();
  };
  function renderPick() {
    const box = $("pick"); box.innerHTML = ""; box.classList.toggle("show", ["char", "cam", "gear"].includes(tool));
    const opts = [];
    if (tool === "char" && prod) {
      const cast = sceneObj()?.characters.length ? sceneObj().characters : prod.characters.map(c => c.name);
      cast.forEach(n => { const c = charOf(n); opts.push({ v: n, html: `<span class="dot" style="background:${c.colour}"></span>${Assets.esc(c.letter)} ${Assets.esc(n)}` }); });
    }
    if (tool === "cam") ["A", "B", "C", "D"].forEach(l => opts.push({ v: l, html: `<span class="dot" style="background:${Assets.RED}"></span>${l} cam` }));
    if (tool === "gear") Object.entries(Assets.GEAR).forEach(([k, g]) => opts.push({ v: k, html: Assets.icon(k) + g.name }));
    if (!pickVal && opts.length) pickVal = opts[0].v;
    opts.forEach(o => { const b = document.createElement("button"); b.innerHTML = o.html; if (o.v === pickVal) b.className = "on"; b.onclick = () => { pickVal = o.v; renderPick(); }; box.appendChild(b); });
    if (tool === "char" || tool === "cam") box.insertAdjacentHTML("beforeend", `<span class="hint" style="align-self:center">Tap the plan to place the next position</span>`);
    if (tool === "line180") { box.classList.add("show"); box.innerHTML = `<span class="hint">Drag across the plan to draw the 180 line</span>`; }
  }

  // ---------- drawing ----------
  function markSvg(it) {
    const s = S * scale();
    let body;
    if (it.kind === "cam") body = Assets.camera(it, s);
    else if (it.kind === "char") body = Assets.character(it, s, charOf(it.ref).colour);
    else body = (Assets.GEAR[it.ref] || Assets.GEAR.practical).draw(s * (it.size || 1));
    const ring = sel === it.id ? `<circle r="${s * .95}" fill="none" stroke="#fff" stroke-width="${s * .04}" stroke-dasharray="${s * .12} ${s * .1}"/><circle class="rot" cx="${s * 1.3}" cy="0" r="${s * .2}" fill="#fff" stroke="${Assets.RED}" stroke-width="${s * .05}"/>` : "";
    return `<g class="mark" data-id="${it.id}" transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">${ring}${body}</g>`;
  }
  function draw() {
    const p = planObj(), st = setupObj();
    $("empty").style.display = p && st ? "none" : "flex";
    $("empty").textContent = !prod ? "Import a script to start." : !cur.scene ? "Pick a scene." : "Choose or add the floor plan for this location (top bar).";
    if (!p || !st) { svg.innerHTML = ""; return; }
    const s = S * scale();
    let out = `<image href="${p.src}" x="0" y="0" width="${p.w}" height="${p.h}"/>`;
    // move lines: same kind + ref, ordered by number
    const groups = {};
    st.items.filter(i => i.kind === "char" || i.kind === "cam").forEach(i => (groups[i.kind + "|" + i.ref] ||= []).push(i));
    Object.values(groups).forEach(g => {
      g.sort((a, b) => a.n - b.n);
      const col = g[0].kind === "cam" ? Assets.RED : charOf(g[0].ref).colour;
      for (let k = 1; k < g.length; k++) out += `<line x1="${g[k - 1].x}" y1="${g[k - 1].y}" x2="${g[k].x}" y2="${g[k].y}" stroke="${col}" stroke-width="${s * .11}" stroke-dasharray="${s * .02} ${s * .2}" stroke-linecap="round"/>`;
    });
    st.items.filter(i => i.kind === "line180").forEach(l => {
      out += `<g class="mark" data-id="${l.id}"><line x1="${l.x}" y1="${l.y}" x2="${l.x2}" y2="${l.y2}" stroke="transparent" stroke-width="${s * .6}"/><line x1="${l.x}" y1="${l.y}" x2="${l.x2}" y2="${l.y2}" stroke="${Assets.RED}" stroke-width="${s * .08}" stroke-dasharray="${s * .22} ${s * .18}"/>${sel === l.id ? `<circle cx="${l.x}" cy="${l.y}" r="${s * .15}" fill="#fff"/><circle cx="${l.x2}" cy="${l.y2}" r="${s * .15}" fill="#fff"/>` : ""}</g>`;
    });
    st.items.filter(i => i.kind === "gear").forEach(i => out += markSvg(i));
    st.items.filter(i => i.kind === "cam" || i.kind === "char").forEach(i => out += markSvg(i));
    const sc = sceneObj(), d = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    out += `<g class="tb" transform="translate(${p.w - s * 5.2} ${s * .3})"><rect width="${s * 4.9}" height="${s * 1.9}" rx="${s * .1}" fill="#F4F2EC" opacity=".93"/><text x="${s * .2}" y="${s * .55}" font-size="${s * .34}" font-weight="700" fill="#1A1D24">SC ${Assets.esc(sc.number)} · ${Assets.esc(st.name)}</text><text x="${s * .2}" y="${s * 1}" font-size="${s * .3}" fill="#1A1D24">${Assets.esc(sc.location)}</text><text x="${s * .2}" y="${s * 1.42}" font-size="${s * .3}" fill="#1A1D24">${Assets.esc(sc.time || "")}  ·  ${d}</text></g>`;
    out += `<g id="cursors"></g>`;
    svg.innerHTML = out;
    setView();
    if (window.Sync) drawCursors();
  }
  function setView() { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function fit() {
    const p = planObj(); if (!p) return;
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const k = Math.max(p.w / r.width, p.h / r.height) * 1.04;
    view = { w: r.width * k, h: r.height * k, x: (p.w - r.width * k) / 2, y: (p.h - r.height * k) / 2 };
    setView();
  }
  window.addEventListener("resize", debounce(fit, 150));
  function pt(e) { const r = svg.getBoundingClientRect(); return { x: view.x + (e.clientX - r.left) / r.width * view.w, y: view.y + (e.clientY - r.top) / r.height * view.h }; }

  // ---------- pointer: place, drag, rotate, pan, pinch ----------
  let drag = null; const pointers = new Map();
  svg.addEventListener("pointerdown", e => {
    if (!setupObj() || !planObj()) return;
    svg.setPointerCapture(e.pointerId); pointers.set(e.pointerId, e);
    if (pointers.size === 2) { drag = { pinch: true, d0: dist(), v0: { ...view } }; return; }
    const p = pt(e), st = setupObj(), m = e.target.closest(".mark");
    if (tool === "line180") { const l = { id: uid(), kind: "line180", x: p.x, y: p.y, x2: p.x, y2: p.y }; st.items.push(l); sel = l.id; drag = { line: l }; draw(); return; }
    if (tool === "char" || tool === "cam" || tool === "gear") {
      if (!pickVal) return toast("Pick who or what to place first");
      let it;
      if (tool === "gear") it = { id: uid(), kind: "gear", ref: pickVal, x: p.x, y: p.y, rot: 0, size: 1 };
      else {
        const n = nextNumber(tool, pickVal);
        const letter = tool === "cam" ? pickVal : charOf(pickVal).letter;
        const prev = st.items.filter(i => i.kind === tool && i.ref === pickVal).sort((a, b) => b.n - a.n)[0];
        it = { id: uid(), kind: tool, ref: pickVal, n, label: letter + n, x: p.x, y: p.y, rot: prev ? prev.rot : 0, lens: prev?.lens || (tool === "cam" ? "35mm" : ""), shot: prev?.shot || "", height: prev?.height || "", note: "" };
      }
      st.items.push(it); sel = it.id; save(); draw(); renderProps(); return;
    }
    if (m) {
      const it = st.items.find(i => i.id === m.dataset.id); sel = it.id;
      if (e.target.classList.contains("rot")) drag = { rot: it };
      else drag = { move: it, dx: p.x - it.x, dy: p.y - it.y, dx2: it.x2 != null ? p.x - it.x2 : 0, dy2: it.y2 != null ? p.y - it.y2 : 0 };
      draw(); renderProps(); return;
    }
    sel = null; drag = { pan: true, sx: e.clientX, sy: e.clientY, v0: { ...view } }; draw(); renderProps();
  });
  svg.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
    const p = pt(e);
    if (window.Sync && Sync.live) Sync.cursor(cur.scene, cur.setup, p.x, p.y);
    if (!drag) return;
    if (drag.pinch && pointers.size === 2) { const k = drag.d0 / dist(); const c = drag.v0; view = { w: c.w * k, h: c.h * k, x: c.x + (c.w - c.w * k) / 2, y: c.y + (c.h - c.h * k) / 2 }; setView(); return; }
    if (drag.pan) { const r = svg.getBoundingClientRect(); view.x = drag.v0.x - (e.clientX - drag.sx) / r.width * view.w; view.y = drag.v0.y - (e.clientY - drag.sy) / r.height * view.h; setView(); return; }
    if (drag.line) { drag.line.x2 = p.x; drag.line.y2 = p.y; draw(); return; }
    if (drag.rot) { drag.rot.rot = Math.round(Math.atan2(p.y - drag.rot.y, p.x - drag.rot.x) * 180 / Math.PI / 5) * 5; draw(); return; }
    if (drag.move) {
      const it = drag.move; it.x = p.x - drag.dx; it.y = p.y - drag.dy;
      if (it.x2 != null) { it.x2 = p.x - drag.dx2; it.y2 = p.y - drag.dy2; }
      draw();
    }
  });
  const end = e => { pointers.delete(e.pointerId); if (drag && !drag.pan && !drag.pinch) { save(); renderProps(); } drag = null; };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  function dist() { const [a, b] = [...pointers.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; }
  svg.addEventListener("wheel", e => {
    e.preventDefault(); const p = pt(e), k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    view = { w: view.w * k, h: view.h * k, x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k }; setView();
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && sel) { removeSel(); }
    if (e.key === "Escape") { sel = null; draw(); renderProps(); }
  });
  function removeSel() { const st = setupObj(); st.items = st.items.filter(i => i.id !== sel); sel = null; save(); draw(); renderProps(); }

  // ---------- properties panel ----------
  function renderProps() {
    const st = setupObj(), it = st && st.items.find(i => i.id === sel), box = $("props");
    $("right").classList.toggle("open", !!it);
    if (!it) { $("propHead").textContent = "Nothing selected"; box.innerHTML = `<p class="hint">Pick a tool on the left of the plan and tap to place. Tap the same character or camera again to add their next position (A1, A2...): a dotted line joins them. Drag a mark to move it, drag the white dot to turn it. Two fingers or the mouse wheel zoom.</p>`; return; }
    const f = (lab, html) => `<div class="f"><label>${lab}</label>${html}</div>`;
    const inp = (k, v, ph = "") => `<input type="text" data-k="${k}" value="${Assets.esc(v || "")}" placeholder="${ph}">`;
    let h = "";
    if (it.kind === "cam") {
      $("propHead").textContent = "Camera " + it.label;
      h += f("Lens", inp("lens", it.lens, "35mm")) + f("Shot size", `<select data-k="shot">${["", "ECU", "CU", "MCU", "MS", "MLS", "LS", "WS", "EWS", "OTS", "2 shot", "3 shot", "Insert", "POV"].map(o => `<option ${o === it.shot ? "selected" : ""}>${o}</option>`).join("")}</select>`) + f("Height", inp("height", it.height, "1.4 m")) + f("Movement", inp("move", it.move, "Static, slider, dolly, handheld...")) + f("Notes", `<textarea data-k="note">${Assets.esc(it.note || "")}</textarea>`);
    } else if (it.kind === "char") {
      $("propHead").textContent = it.ref + " · position " + it.n;
      h += f("Action at this mark", `<textarea data-k="note">${Assets.esc(it.note || "")}</textarea>`);
    } else if (it.kind === "gear") {
      $("propHead").textContent = Assets.GEAR[it.ref]?.name || "Gear";
      h += f("Label / notes", inp("note", it.note, "e.g. 2K through window")) + f("Size", `<input type="range" min=".5" max="3" step=".1" data-k="size" value="${it.size || 1}">`);
    } else { $("propHead").textContent = "180 line"; }
    if (it.kind !== "line180") h += f("Turn", `<div class="row"><button class="btn small" data-turn="-15">⟲ 15°</button><button class="btn small" data-turn="15">⟳ 15°</button></div>`);
    h += `<button class="btn red" id="delMark" style="margin-top:8px">Delete</button>`;
    box.innerHTML = h;
    box.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { it[el.dataset.k] = el.type === "range" ? +el.value : el.value; save(); draw(); });
    box.querySelectorAll("[data-turn]").forEach(el => el.onclick = () => { it.rot = ((it.rot || 0) + +el.dataset.turn) % 360; save(); draw(); });
    $("delMark").onclick = removeSel;
  }

  // ---------- storyboard ----------
  function renderFrames() {
    const box = $("frames"), st = setupObj(); box.innerHTML = "";
    if (!st) return;
    if (!st.frames.length) { box.innerHTML = `<p class="hint">Upload frames for this setup: stills, sketches or AI frames that show the shot size.</p>`; return; }
    st.frames.forEach((fr, k) => {
      const d = document.createElement("div"); d.className = "frame";
      d.innerHTML = `<button class="x" title="Remove">✕</button><img src="${fr.src}" alt=""><input value="${Assets.esc(fr.label)}" placeholder="A1 WS"><input value="${Assets.esc(fr.note)}" placeholder="What happens">`;
      const [lab, note] = d.querySelectorAll("input");
      lab.oninput = () => { fr.label = lab.value; save(); };
      note.oninput = () => { fr.note = note.value; save(); };
      d.querySelector(".x").onclick = () => { st.frames.splice(k, 1); save(); renderFrames(); };
      box.appendChild(d);
    });
  }

  // ---------- export ----------
  $("btnExport").onclick = async () => {
    const p = planObj(); if (!p) return toast("Nothing to export yet");
    const prevSel = sel; sel = null; draw();
    const clone = svg.cloneNode(true); clone.setAttribute("viewBox", `0 0 ${p.w} ${p.h}`); clone.setAttribute("width", p.w); clone.setAttribute("height", p.h);
    clone.querySelector("#cursors")?.remove();
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = p.w; c.height = p.h;
      const g = c.getContext("2d"); g.fillStyle = "#1A1D24"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0);
      const a = document.createElement("a"); const sc = sceneObj();
      a.download = `SC ${sc.number} ${setupObj().name} - ${sc.location}.png`.replace(/[\\/:*?"<>|]/g, "");
      a.href = c.toDataURL("image/png"); a.click(); URL.revokeObjectURL(url);
      sel = prevSel; draw();
    };
    im.src = url;
  };

  $("btnSaveFile").onclick = () => {
    if (!prod) return toast("Nothing to save yet");
    const data = { app: "Scene Blocker", version: 1, title: prod.title, characters: prod.characters, scenes: prod.scenes, plans: prod.plans, locPlans: prod.locPlans, blocks, saved: new Date().toISOString() };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `${prod.title} - Scene Blocker ${new Date().toISOString().slice(0, 10)}.json`.replace(/[\\/:*?"<>|]/g, "");
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Saved. Open it on another device with Import script.");
  };

  // ---------- mobile ----------
  $("btnScenes").onclick = () => $("left").classList.toggle("open");

  // ---------- live presence (filled in by sync.js when the crew database is connected) ----------
  function announce() { if (window.Sync && Sync.live) Sync.where(cur.scene, cur.setup); }
  function drawCursors() {
    const g = document.getElementById("cursors"); if (!g || !Sync.live) return;
    const s = S * scale();
    g.innerHTML = Sync.cursorsOn(cur.scene, cur.setup).map(c => `<g transform="translate(${c.x} ${c.y})"><path d="M0 0 L${s * .5} ${s * .2} L${s * .2} ${s * .22} L${s * .12} ${s * .5}Z" fill="${c.colour}" stroke="#fff" stroke-width="${s * .03}"/><text x="${s * .45}" y="${s * .6}" font-size="${s * .3}" fill="#fff" stroke="#000" stroke-width="${s * .06}" paint-order="stroke">${Assets.esc(c.name)}</text></g>`).join("");
  }
  window.App = {
    get prod() { return prod; }, get blocks() { return blocks; }, get cur() { return cur; },
    applyRemote(newProd, newBlocks) { if (newProd) prod = newProd; if (newBlocks) Object.assign(blocks, newBlocks); if (prod && !cur.scene) cur.scene = prod.scenes[0]?.number; renderAll(); if (newProd) fit(); },
    redrawPresence() { renderScenes(); drawCursors(); },
    load(p, b) { prod = p; blocks = b || {}; cur.scene = prod.scenes[0]?.number; cur.setup = 0; save(); renderAll(); setTimeout(fit, 50); },
  };

  // ---------- start ----------
  const SPLASH_MS = new URLSearchParams(location.search).has("nosplash") ? 0 : 3500;
  setTimeout(() => { const s = $("splash"); s.classList.add("out"); setTimeout(() => { s.remove(); fit(); }, 500); }, SPLASH_MS);
  (async () => {
    prod = (await Store.get("prod")) || null;
    blocks = (await Store.get("blocks")) || {};
    if (prod) cur.scene = prod.scenes[0]?.number;
    renderAll(); setTimeout(fit, 50);
    if (new URLSearchParams(location.search).has("dev") && window.DevSeed) DevSeed();
    if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") navigator.serviceWorker.register("sw.js");
  })();
})();
