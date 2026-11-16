// Script import: PDF, Final Draft (.fdx), Fountain or plain text -> scenes. Runs on the user's own device.
const Parse = (() => {
  const HEAD = /^(INT\.?\/EXT\.?|I\/E\.?|INT\.|EXT\.)\s*(.+)$/i;
  const NUM = /^\d+[A-Z]?$/;
  const SD = /\(SD\s*(\d+)\)/i;
  const CAST = /^\((?!SD\b)([A-Z][A-Z0-9' ,.\-’]+)\)$/;
  const CUE = /^([A-Z][A-Z0-9' .\-’]{1,30})(\s*\((V\.O\.|O\.S\.|CONT'D|O\.C\.)\))?$/;
  const PALETTE = ["#5FC9F3", "#FFC857", "#7FE3A0", "#FF8FA3", "#C3A6FF", "#FFB070", "#8FD3FF", "#F2E86D", "#A0E7E5", "#FFD1DC", "#B5E48C", "#F4A7FF"];
  const NOT_CUE = new Set(["CUT TO:", "FADE IN:", "FADE OUT.", "BACK TO SCENE", "CONTINUOUS", "THE END", "INSERT", "LATER", "INTERCUT"]);

  const clean = s => s.replace(/[–—]/g, "-").replace(/’/g, "'").replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  const tc = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/'S\b/g, "'s");

  function splitHeading(prefix, rest) {
    let sd = null; const m = rest.match(SD); if (m) sd = +m[1];
    rest = rest.replace(SD, "").replace(/\s*\d+[A-Z]?\s*$/, "").replace(/^\s*\d+[A-Z]?\s+/, "").trim().replace(/[\s-]+$/, "");
    const parts = rest.split(/\s+-\s+/).filter(Boolean);
    const location = parts.length > 1 ? parts.slice(0, -1).join(" - ") : rest;
    const time = parts.length > 1 ? parts[parts.length - 1] : "";
    return { intExt: prefix.toUpperCase().replace(/\.$/, ""), location: tc(location), time: tc(time), storyDay: sd };
  }

  function fromLines(raw) {
    const lines = raw.map(clean).filter(Boolean);
    const scenes = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const l0 = lines[i];
      const numPre = (l0.match(/^(\d+[A-Z]?)\s+(?=(INT|EXT|I\/E))/i) || [])[1];
      const l = numPre ? l0.slice(l0.indexOf(" ") + 1) : l0;
      const h = l.match(HEAD);
      if (h) {
        cur = Object.assign({ number: numPre || null, heading: l, characters: [] }, splitHeading(h[1], h[2]));
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          let n = lines[j];
          // a cast list in brackets can wrap onto the next line(s)
          if (/^\((?!SD\b)[A-Z]/.test(n) && !n.includes(")")) { let k = j; while (k + 1 < lines.length && k < j + 3 && !n.includes(")")) n += " " + lines[++k]; }
          if (NUM.test(n)) { if (!cur.number) cur.number = n; continue; }
          if (SD.test(n) && n.replace(SD, "").trim() === "") { cur.storyDay = +n.match(SD)[1]; continue; }
          const c = n.match(CAST);
          if (c) { cur.characters = c[1].split(",").map(x => tc(x.trim().replace(/\s*V\.O\.?$/i, " (V.O.)"))).filter(Boolean); cur.castLine = true; }
          break;
        }
        scenes.push(cur);
        continue;
      }
      if (cur && !cur.castLine) {
        const c = l.match(CUE);
        if (c && !NOT_CUE.has(l) && !/^(INT|EXT)/.test(l) && l === l.toUpperCase() && /[A-Z]{2}/.test(c[1])) {
          const name = tc(c[1].trim());
          if (!cur.characters.includes(name)) cur.characters.push(name);
        }
      }
    }
    scenes.forEach((s, k) => { if (!s.number) s.number = String(k + 1); delete s.castLine; });
    return scenes;
  }

  async function pdfLines(buf) {
    if (!window.pdfjsLib) throw new Error("PDF reader did not load (check the internet connection once).");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc_ = await (await doc.getPage(p)).getTextContent();
      const rows = new Map();
      for (const it of tc_.items) {
        if (!it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(it);
      }
      [...rows.keys()].sort((a, b) => b - a).forEach(y => {
        const items = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
        // A scene heading often shares its row with the scene number at the far right: keep them as separate lines.
        let line = "", lastX = null;
        for (const it of items) {
          if (!it.str.trim()) continue;
          const x = it.transform[4];
          if (lastX !== null && x - lastX > 120) { out.push(line); line = ""; }
          line += (line && !line.endsWith(" ") ? " " : "") + it.str;
          lastX = x + (it.width || 0);
        }
        out.push(line);
      });
    }
    return out;
  }

  function fdx(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const lines = [];
    xml.querySelectorAll("Paragraph").forEach(p => {
      const t = [...p.querySelectorAll("Text")].map(x => x.textContent).join("");
      const type = p.getAttribute("Type");
      const num = p.getAttribute("Number");
      if (type === "Scene Heading") lines.push((num ? num + " " : "") + t.toUpperCase());
      else if (type === "Character") lines.push(t.toUpperCase());
      else lines.push(t);
    });
    return lines;
  }

  function characters(scenes) {
    const names = [];
    scenes.forEach(s => s.characters.forEach(c => { if (!names.includes(c)) names.push(c); }));
    const used = new Set();
    return names.map((n, k) => {
      const base = n.replace(/^(Mam'?|Malume|Mr|Mrs|Ms)\s*/i, "").toUpperCase();
      let letter = [...base].find(ch => /[A-Z]/.test(ch) && !used.has(ch)) || String.fromCharCode(65 + (k % 26));
      used.add(letter);
      return { name: n, letter, colour: PALETTE[k % PALETTE.length] };
    });
  }

  async function file(f) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".json")) {
      // A Scene Blocker production file: scenes, characters, floor plans (and optional blocking)
      const d = JSON.parse(await f.text());
      if (!d.scenes || !d.characters) throw new Error("This is not a Scene Blocker production file.");
      return { title: d.title, scenes: d.scenes, characters: d.characters, plans: d.plans || {}, locPlans: d.locPlans || {}, blocks: d.blocks || null, pack: true };
    }
    let lines;
    if (name.endsWith(".pdf")) lines = await pdfLines(await f.arrayBuffer());
    else if (name.endsWith(".fdx")) lines = fdx(await f.text());
    else lines = (await f.text()).split(/\r?\n/);
    const scenes = fromLines(lines);
    if (!scenes.length) throw new Error("No scene headings found (lines starting INT. or EXT.).");
    return { title: tc(f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ")), scenes, characters: characters(scenes) };
  }

  return { file, characters };
})();
