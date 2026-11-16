// Test-only loader: open the app with ?dev while serving the whole "24 Scene Blocker" folder.
// It reads the PRIVATE data folder (../data/imvana), which is never published with the app.
window.DevSeed = async () => {
  try {
    const base = "../data/imvana/";
    const r = await fetch(base + "scenes.json"); if (!r.ok) return;
    const d = await r.json();
    const names = { "A-01": "Waiting room", "A-02": "Bathroom", "A-03": "Kitchen", "A-04": "Lounge", "A-05": "Bedroom A (pink room)", "A-06": "Bedroom B (blue room)", "A-07": "Site - yard front and back" };
    const plans = {}, locPlans = {};
    for (const [id, name] of Object.entries(names)) {
      const blob = await (await fetch(base + "plans/" + id + ".jpg")).blob();
      const src = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      plans[id] = { name, src, w: im.width, h: im.height };
    }
    d.scenes.forEach(s => { if (s.planId) locPlans[s.location] = s.planId; });
    const prod = { id: "imvana-dev", title: d.title, characters: d.characters, scenes: d.scenes.map(({ planId, ...s }) => s), plans, locPlans };
    App.load(prod, {});
  } catch (e) { console.warn("dev seed failed", e); }
};
