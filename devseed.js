// Test-only loader: open the app with ?dev while serving the whole "24 Scene Blocker" folder on this PC.
// It reads the PRIVATE production file from ../data/imvana, which is never published with the app.
window.DevSeed = async () => {
  try {
    const r = await fetch("../data/imvana/Imvana%20Ekhethiweyo%20-%20Scene%20Blocker%20production%20file.json");
    if (!r.ok) return;
    const d = await r.json();
    App.load({ id: "imvana-dev", title: d.title, characters: d.characters, scenes: d.scenes, plans: d.plans, locPlans: d.locPlans }, d.blocks || {});
  } catch (e) { console.warn("dev seed failed", e); }
};
