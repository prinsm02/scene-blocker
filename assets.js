// Approved asset library (Matthew 2026-11-16). Each draws centred on 0,0, facing right (+x). Size unit = s.
const Assets = (() => {
  const RED = "#E5484D", RED2 = "#B3262B", PANEL = "#323848", TXT = "#ECEEF3";
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const GEAR = {
    led: { name: "LED panel", draw: s => `<path d="M${.6*s} ${-.4*s} L${3*s} ${-1.3*s} L${3*s} ${1.3*s} L${.6*s} ${.4*s}Z" fill="#FFE9A8" opacity=".18"/><path d="M${.35*s} ${-.62*s} L${.75*s} ${-.85*s} M${.35*s} ${.62*s} L${.75*s} ${.85*s}" stroke="#6B7280" stroke-width="${.12*s}" stroke-linecap="round"/><rect x="${-.35*s}" y="${-.65*s}" width="${.7*s}" height="${1.3*s}" rx="${.06*s}" fill="#2B2F3A" stroke="#A9AFBD" stroke-width="${.04*s}"/>${[-.4,-.13,.13,.4].map(y=>`<circle cx="${-.12*s}" cy="${y*s}" r="${.06*s}" fill="#FFE9A8"/><circle cx="${.12*s}" cy="${y*s}" r="${.06*s}" fill="#FFE9A8"/>`).join("")}` },
    fresnel: { name: "Fresnel", draw: s => `<path d="M${.7*s} 0 L${3*s} ${-1*s} L${3*s} ${1*s}Z" fill="#FFE9A8" opacity=".18"/><rect x="${-.5*s}" y="${-.45*s}" width="${.8*s}" height="${.9*s}" rx="${.12*s}" fill="#2B2F3A" stroke="#A9AFBD" stroke-width="${.04*s}"/><circle cx="${.35*s}" cy="0" r="${.3*s}" fill="#3A3F4C" stroke="#A9AFBD" stroke-width="${.04*s}"/><circle cx="${.35*s}" cy="0" r="${.17*s}" fill="#FFE9A8"/><path d="M${.45*s} ${-.42*s} L${.8*s} ${-.62*s} M${.45*s} ${.42*s} L${.8*s} ${.62*s}" stroke="#6B7280" stroke-width="${.12*s}" stroke-linecap="round"/>` },
    practical: { name: "Practical lamp", draw: s => `<circle r="${.95*s}" fill="#FFE9A8" opacity=".14"/><circle r="${.5*s}" fill="#E8DCC2" stroke="#B8A780" stroke-width="${.05*s}"/><circle r="${.15*s}" fill="#FFC857"/>` },
    sun: { name: "Sun / moon", draw: s => `${[0,45,90,135,180,225,270,315].map(a=>`<line x1="0" y1="${-.5*s}" x2="0" y2="${-.7*s}" stroke="#FFC857" stroke-width="${.07*s}" stroke-linecap="round" transform="rotate(${a})"/>`).join("")}<circle r="${.36*s}" fill="#FFC857"/><line x1="${.85*s}" y1="0" x2="${2.8*s}" y2="0" stroke="#FFC857" stroke-width="${.06*s}" stroke-dasharray="${.05*s} ${.18*s}" stroke-linecap="round"/>` },
    reflector: { name: "Reflector", draw: s => `<ellipse rx="${.9*s}" ry="${.36*s}" fill="#D9DDE4" stroke="#8A919E" stroke-width="${.05*s}" transform="rotate(90)"/>` },
    dolly: { name: "Dolly track", draw: s => `<path d="M${-2*s} ${-.28*s} H${2*s} M${-2*s} ${.28*s} H${2*s}" stroke="#A9AFBD" stroke-width="${.08*s}"/>${[-1.8,-1.2,-.6,0,.6,1.2,1.8].map(x=>`<line x1="${x*s}" y1="${-.42*s}" x2="${x*s}" y2="${.42*s}" stroke="#A9AFBD" stroke-width="${.06*s}"/>`).join("")}` },
    slider: { name: "Slider", draw: s => `<rect x="${-1.6*s}" y="${-.12*s}" width="${3.2*s}" height="${.24*s}" rx="${.06*s}" fill="#6B7280"/><path d="M${-1.6*s} ${-.35*s} V${.35*s} M${1.6*s} ${-.35*s} V${.35*s}" stroke="#A9AFBD" stroke-width="${.1*s}" stroke-linecap="round"/><rect x="${-.38*s}" y="${-.3*s}" width="${.76*s}" height="${.6*s}" rx="${.08*s}" fill="#A9AFBD"/><rect x="${-.22*s}" y="${-.2*s}" width="${.44*s}" height="${.4*s}" rx="${.06*s}" fill="${RED}"/>` },
    boom: { name: "Boom mic", draw: s => `<line x1="${-1.4*s}" y1="0" x2="${1.1*s}" y2="0" stroke="#A9AFBD" stroke-width="${.08*s}"/><circle cx="${-1.4*s}" r="${.13*s}" fill="#6B7280"/><rect x="${1*s}" y="${-.18*s}" width="${.8*s}" height="${.36*s}" rx="${.18*s}" fill="#3A3F4C" stroke="#A9AFBD" stroke-width="${.04*s}"/>` },
    vt: { name: "VT Station", draw: s => `<rect x="${-1.1*s}" y="${-.6*s}" width="${2.2*s}" height="${1.1*s}" rx="${.08*s}" fill="${PANEL}" stroke="#A9AFBD" stroke-width="${.05*s}"/><text y="${.12*s}" text-anchor="middle" font-size="${.42*s}" font-weight="600" fill="${TXT}">VT</text><path d="M0 ${.5*s} V${.75*s} M${-.4*s} ${.78*s} H${.4*s}" stroke="#A9AFBD" stroke-width="${.08*s}" stroke-linecap="round"/>` },
    car: { name: "Car", draw: s => `<g transform="scale(${s/40})"><rect x="-38" y="-24" width="10" height="8" rx="2" fill="#111"/><rect x="-38" y="16" width="10" height="8" rx="2" fill="#111"/><rect x="26" y="-24" width="10" height="8" rx="2" fill="#111"/><rect x="26" y="16" width="10" height="8" rx="2" fill="#111"/><path d="M-46 -12 Q-46 -20 -36 -20 L36 -20 Q58 -20 64 -6 L64 6 Q58 20 36 20 L-36 20 Q-46 20 -46 12Z" fill="#D7DCE3" stroke="#7A8290" stroke-width="1.5"/><path d="M28 -14 L44 -10 Q50 0 44 10 L28 14 Q33 0 28 -14Z" fill="#5E7894"/><rect x="-14" y="-12" width="40" height="24" rx="5" fill="#C3C9D2"/><path d="M-30 -12 L-18 -12 Q-21 0 -18 12 L-30 12 Q-33 0 -30 -12Z" fill="#5E7894"/></g>` },
    taxi: { name: "Quantum taxi", draw: s => `<g transform="scale(${s/40})"><path d="M-74 -24 Q-74 -30 -68 -30 L60 -30 Q74 -30 76 -16 L76 16 Q74 30 60 30 L-68 30 Q-74 30 -74 24Z" fill="#F4F4F2" stroke="#7A8290" stroke-width="1.5"/><path d="M50 -26 L64 -22 Q70 0 64 22 L50 26 Q54 0 50 -26Z" fill="#5E7894"/><rect x="-64" y="-22" width="108" height="44" rx="4" fill="#E8E9E6"/><path d="M-64 -6 H44 M-64 6 H44" stroke="#2E9E5B" stroke-width="3"/><rect x="-16" y="-10" width="26" height="20" rx="3" fill="#FFC857"/><text x="-3" y="4" text-anchor="middle" font-size="8" font-weight="600" fill="#3A2A00">TAXI</text></g>` },
  };

  function camera(it, s) {
    const tw = Math.max(1.5, String(it.lens || "").length * .2 + .35) * s;
    const lens = it.lens ? `<g transform="rotate(${-(it.rot || 0)})"><rect x="${-tw / 2}" y="${.75*s}" width="${tw}" height="${.5*s}" rx="${.1*s}" fill="${PANEL}" stroke="#4A5166" stroke-width="${.02*s}"/><text y="${1.12*s}" text-anchor="middle" font-size="${.32*s}" fill="${TXT}">${esc(it.lens)}</text></g>` : "";
    return `<rect x="${-.6*s}" y="${-.45*s}" width="${1*s}" height="${.9*s}" rx="${.14*s}" fill="${RED}"/><path d="M${.4*s} ${-.25*s} L${.75*s} ${-.48*s} L${.75*s} ${.48*s} L${.4*s} ${.25*s}Z" fill="${RED2}"/><g transform="rotate(${-(it.rot || 0)} ${-.1*s} 0)"><text x="${-.1*s}" y="${.13*s}" text-anchor="middle" font-size="${.36*s}" font-weight="700" fill="#fff">${esc(it.label)}</text></g>${lens}`;
  }
  function character(it, s, colour) {
    return `<circle r="${.55*s}" fill="${colour}" stroke="#1A1D24" stroke-width="${.05*s}"/><text y="${.17*s}" text-anchor="middle" font-size="${.44*s}" font-weight="700" fill="#14161B">${esc(it.label)}</text>`;
  }
  // Small swatch for the picker buttons.
  function icon(kind) {
    const s = 14;
    const body = GEAR[kind] ? GEAR[kind].draw(s) : "";
    return `<svg width="34" height="22" viewBox="-30 -20 70 40">${body}</svg>`;
  }
  return { GEAR, camera, character, icon, RED, esc };
})();
