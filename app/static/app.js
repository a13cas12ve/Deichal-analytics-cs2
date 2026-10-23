/* Deichal Analytics — frontend (vanilla JS, sin dependencias externas) */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 2) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
const pct = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : `${Number(v).toFixed(d)}%`);
const teamName = (m, t) => (m.labels && m.labels[t] && m.labels[t] !== t ? `${t} (${m.labels[t]})` : t);
const mapName = (m) => (m || "").replace("de_", "").replace(/^./, (c) => c.toUpperCase());
const AXES = ["Firepower", "Entrying", "Trading", "Opening", "Clutching", "Sniping", "Utility"];
const ROLE_COLORS = { Entry: "#ff6b6b", AWPer: "#b779ff", Lurker: "#38d39f", Support: "#ffd24d", IGL: "#4dd7ff", Rifler: "#9aa7d6" };
const ROLE_OPTIONS = ["Entry", "AWPer", "Lurker", "Support", "IGL", "Rifler"];

const state = Object.assign(
  { tab: "players", team: null, maps: [], side: "all", matches: [], player: null, compare: true },
  (() => { try { return JSON.parse(localStorage.getItem("deichal") || "{}"); } catch { return {}; } })()
);
const save = () => { try { localStorage.setItem("deichal", JSON.stringify(state)); } catch {} };
let catalog = null;
let pollTimer = null;

const api = async (path) => {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};
const qs = (extra = {}) => {
  const p = new URLSearchParams({ maps: state.maps.join(","), matches: state.matches.join(","), side: state.side, ...extra });
  return p.toString();
};

/* ---------------- tooltip ---------------- */
const tip = $("#tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.dataset.tip;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + "px";
  tip.style.top = e.clientY + 16 + "px";
});

/* ---------------- gráficos ---------------- */
function radarSVG(series, { size = 400 } = {}) {
  const c = size / 2, R = size / 2 - 62, n = AXES.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const r = (R * v) / 100; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
  let g = "";
  for (const ring of [25, 50, 75, 100]) {
    g += `<polygon points="${AXES.map((_, i) => pt(i, ring).join(",")).join(" ")}" fill="none" stroke="#2b3a72" stroke-width="${ring === 100 ? 1.4 : 1}" />`;
  }
  AXES.forEach((a, i) => {
    const [x, y] = pt(i, 100), [lx, ly] = pt(i, 118);
    g += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#2b3a72"/>`;
    const anchor = Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end";
    g += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" fill="#cfd8f7" font-size="16" font-weight="700">${a}</text>`;
    if (series[0]) {
      const v = series[0].values[i];
      const [vx, vy] = pt(i, 118);
      g += `<text x="${vx}" y="${vy + 19}" text-anchor="${anchor}" fill="${series[0].color}" font-size="15" font-weight="700">${Math.round(v)}</text>`;
    }
  });
  series.slice().reverse().forEach((s) => {
    const pts = s.values.map((v, i) => pt(i, v).join(",")).join(" ");
    g += `<polygon points="${pts}" fill="${s.color}" fill-opacity="${s.fill ?? 0.22}" stroke="${s.color}" stroke-width="2.2" ${s.dash ? 'stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`;
    if (!s.dash) s.values.forEach((v, i) => { const [x, y] = pt(i, v); g += `<circle cx="${x}" cy="${y}" r="3.6" fill="${s.color}"/>`; });
  });
  return `<svg viewBox="-45 0 ${size + 90} ${size}" width="${size + 90}" role="img" aria-label="Gráfico de araña">${g}</svg>`;
}
const legend = (series) => `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;

function impactSVG(rows) {
  const W = 640, H = 280, padL = 44, padB = 44, padT = 16, plotW = W - padL - 10, plotH = H - padB - padT;
  const vals = rows.flatMap((r) => [r.gain / (r.rounds || 1), -r.loss / (r.rounds || 1)]);
  const max = Math.max(0.01, ...vals.map(Math.abs)) * 100 * 1.15;
  const y0 = padT + plotH / 2, scale = plotH / 2 / max;
  const bw = plotW / rows.length;
  let g = `<line x1="${padL}" x2="${W - 10}" y1="${y0}" y2="${y0}" stroke="#3b4a86"/>`;
  [-1, -0.5, 0.5, 1].forEach((f) => {
    const y = y0 - f * max * scale;
    g += `<line x1="${padL}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#1e2a55"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#8f9bc0" font-size="11">${(f * max).toFixed(1)}</text>`;
  });
  rows.forEach((r, i) => {
    const n = r.rounds || 1;
    const gain = (r.gain / n) * 100, loss = (r.loss / n) * 100, net = (r.net / n) * 100;
    const x = padL + i * bw + bw * 0.18, w = bw * 0.64;
    const tipTxt = `<b>${esc(r.phase)}</b><br>Kills: ${r.kills} (+${r.gain.toFixed(2)} WPA)<br>Muertes: ${r.deaths} (−${r.loss.toFixed(2)} WPA)<br>Neto: ${r.net.toFixed(2)} → ${net.toFixed(2)} pp/ronda`;
    g += `<g data-tip="${esc(tipTxt)}">
      <rect x="${x}" y="${y0 - gain * scale}" width="${w}" height="${Math.max(gain * scale, 0.5)}" rx="3" fill="#4c8dff"/>
      <rect x="${x}" y="${y0}" width="${w}" height="${Math.max(loss * scale, 0.5)}" rx="3" fill="#ff8a1f"/>
      <rect x="${x - 6}" y="${padT}" width="${w + 12}" height="${plotH}" fill="transparent"/>
      <path d="M${x + w / 2} ${y0 - net * scale - 7} l7 7 l-7 7 l-7 -7 z" fill="#fff" stroke="#0a0f1f" stroke-width="1.5"/></g>`;
    g += `<text x="${x + w / 2}" y="${H - 24}" text-anchor="middle" fill="#cfd8f7" font-size="12">${esc(r.phase)}</text>`;
    g += `<text x="${x + w / 2}" y="${H - 9}" text-anchor="middle" fill="#8f9bc0" font-size="11">${r.kills}K · ${r.deaths}D</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Impacto por momento de la ronda">${g}</svg>
  <div class="legend"><span><i style="background:#4c8dff"></i>Prob. de ronda ganada aportada por kills</span><span><i style="background:#ff8a1f"></i>Prob. perdida por muertes</span><span><i style="background:#fff"></i>Neto (puntos porcentuales por ronda)</span></div>`;
}

function swingRoundsSVG(rows) {
  if (!rows.length) return '<span class="muted">—</span>';
  const bw = 11, gap = 14, H = 250, padT = 14, padB = 40, padL = 40;
  const max = Math.max(5, ...rows.map((r) => Math.abs(r.swing))) * 1.1, y0 = padT + (H - padT - padB) / 2, sc = (H - padT - padB) / 2 / max;
  let x = padL, g = "", lastMatch = null, startX = x;
  const label = (m, x0, x1) => `<text x="${(x0 + x1) / 2}" y="${H - 8}" text-anchor="middle" fill="#cfd8f7" font-size="12" font-weight="600">${esc(mapName(m))}</text>`;
  rows.forEach((r) => {
    if (lastMatch && r.match !== lastMatch.match) { g += label(lastMatch.map, startX, x); x += gap; startX = x; g += `<line x1="${x - gap / 2}" x2="${x - gap / 2}" y1="${padT}" y2="${H - padB}" stroke="#24305e" stroke-dasharray="3 4"/>`; }
    const h = Math.abs(r.swing) * sc, y = r.swing >= 0 ? y0 - h : y0;
    const t = `<b>${esc(mapName(r.map))} · ronda ${r.round}</b> (${r.side})<br>${r.won ? "Ronda ganada" : "Ronda perdida"}<br>${r.kills} kills${r.died ? " · murió" : ""}<br>Swing: ${signed(r.swing)} pp`;
    g += `<g data-tip="${esc(t)}"><rect x="${x - 2}" y="${padT}" width="${bw + 4}" height="${H - padT - padB}" fill="transparent"/><rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 1)}" rx="2" fill="${r.won ? "#4c8dff" : "#ff8a1f"}"/>
      <rect x="${x}" y="${H - padB + 4}" width="${bw}" height="4" rx="2" fill="${r.side === "T" ? "#f0b24a" : "#5b95ff"}"/></g>`;
    x += bw + 3; lastMatch = r;
  });
  g += label(lastMatch.map, startX, x);
  [-1, 0, 1].forEach((f) => { const yy = y0 - f * max * sc * 0.8; g += `<line x1="${padL - 6}" x2="${x}" y1="${yy}" y2="${yy}" stroke="${f === 0 ? "#3b4a86" : "#1e2a55"}"/><text x="${padL - 10}" y="${yy + 4}" text-anchor="end" fill="#8f9bc0" font-size="11">${signed(f * max * 0.8, 0)}</text>`; });
  return `<svg viewBox="0 0 ${x + 10} ${H}" width="${Math.max(x + 10, 640)}" height="${H}" role="img" aria-label="Swing por ronda">${g}</svg>
  <div class="legend"><span><i style="background:#4c8dff"></i>Ronda ganada</span><span><i style="background:#ff8a1f"></i>Ronda perdida</span><span><i style="background:#f0b24a"></i>Lado T</span><span><i style="background:#5b95ff"></i>Lado CT</span></div>`;
}

const gauss = (src, size, sigma) => {
  const rad = Math.ceil(sigma * 3), k = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  const kk = k.map((v) => v / sum), tmp = new Float32Array(size * size), out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let a = 0; for (let i = -rad; i <= rad; i++) { const xx = x + i; if (xx >= 0 && xx < size) a += src[y * size + xx] * kk[i + rad]; } tmp[y * size + x] = a; }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let a = 0; for (let i = -rad; i <= rad; i++) { const yy = y + i; if (yy >= 0 && yy < size) a += tmp[yy * size + x] * kk[i + rad]; } out[y * size + x] = a; }
  return out;
};
const RAMP = [[0, [27, 63, 168]], [0.3, [47, 208, 200]], [0.55, [255, 225, 77]], [0.8, [255, 122, 26]], [1, [255, 42, 42]]];
const rampColor = (t) => { for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i], f = (t - t0) / (t1 - t0); return c0.map((v, j) => Math.round(v + (c1[j] - v) * f)); } return RAMP[RAMP.length - 1][1]; };

async function drawHeat(canvas, data, { labels, kind }) {
  const W = (canvas.width = 900), H = (canvas.height = 900), ctx = canvas.getContext("2d"), N = data.size, v = data.view;
  ctx.fillStyle = "#080c1a"; ctx.fillRect(0, 0, W, H);
  const off = (draw) => { const c = document.createElement("canvas"); c.width = c.height = N; const x = c.getContext("2d"); const id = x.createImageData(N, N); draw(id.data); x.putImageData(id, 0, 0); return c; };
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  if (v.radar) {
    await new Promise((res) => { const im = new Image(); im.onload = () => { ctx.globalAlpha = 0.9; ctx.drawImage(im, 0, 0, W, H); ctx.globalAlpha = 1; res(); }; im.onerror = res; im.src = v.radar; });
  } else {
    const fp = gauss(Float32Array.from(data.footprint.flat()), N, 0.8);
    const mx = Math.max(...fp, 1e-6);
    ctx.drawImage(off((d) => fp.forEach((val, i) => { const a = Math.min(1, Math.sqrt(val / mx) * 3.2); d[i * 4] = 70; d[i * 4 + 1] = 92; d[i * 4 + 2] = 160; d[i * 4 + 3] = a > 0.06 ? 60 + a * 120 : 0; })), 0, 0, W, H);
  }
  const sigma = kind === "pos" ? 1.7 : 1.9;
  const heat = gauss(Float32Array.from(data.heat.flat()), N, sigma);
  const sorted = Float32Array.from(heat).filter((x) => x > 1e-9).sort();
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.985)] : 1;
  ctx.drawImage(off((d) => heat.forEach((val, i) => { const t = Math.min(1, val / ref); if (t < 0.04) return; const c = rampColor(t); d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = Math.min(235, 40 + t * 215); })), 0, 0, W, H);
  if (labels) {
    ctx.font = "700 19px Rajdhani, Segoe UI, sans-serif"; ctx.textAlign = "center";
    data.places.forEach((p) => {
      const x = ((p.x - v.minx) / (v.maxx - v.minx)) * W, y = ((v.maxy - p.y) / (v.maxy - v.miny)) * H;
      ctx.lineWidth = 4; ctx.strokeStyle = "#050813"; ctx.strokeText(p.name, x, y); ctx.fillStyle = "#e6ebff"; ctx.fillText(p.name, x, y);
    });
  }
}

/* ---------------- piezas de UI ---------------- */
const signed = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(d)}`);
const kpi = (label, value, sub = "", hl = false, tipTxt = "") =>
  `<div class="kpi ${hl ? "hl" : ""}" ${tipTxt ? `data-tip="${esc(tipTxt)}"` : ""}><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub || "&nbsp;"}</div></div>`;
const ratingCls = (r) => (r >= 1.1 ? "rt-hi" : r < 0.9 ? "rt-lo" : "");
const barRow = (label, value, max, text, cls = "") => `<div class="bar-row"><span class="lab">${label}</span><div class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, (value / max) * 100))}%"></i></div><span class="val">${text}</span></div>`;
const sideLabel = () => ({ all: "Global", T: "Lado T", CT: "Lado CT" }[state.side]);
const empty = (title, body) => `<div class="empty"><h3>${title}</h3><p>${body}</p></div>`;

/* ---------------- filtros ---------------- */
function renderFilters() {
  const teams = Object.entries(catalog.teams).sort((a, b) => b[1] - a[1]);
  const selT = $("#f-team");
  selT.innerHTML = teams.map(([t, n]) => `<option value="${esc(t)}">${esc(t)} (${n})</option>`).join("");
  if (!state.team || !catalog.teams[state.team]) state.team = defaultTeam();
  selT.value = state.team;
  $("#f-maps").innerHTML = [`<button class="chip ${!state.maps.length ? "active" : ""}" data-map="">Todos</button>`]
    .concat(catalog.maps.map((m) => `<button class="chip ${state.maps.includes(m) ? "active" : ""}" data-map="${m}">${mapName(m)}</button>`)).join("");
  $$("#f-side button").forEach((b) => b.classList.toggle("active", b.dataset.v === state.side));
  const visible = catalog.matches.filter((m) => !state.maps.length || state.maps.includes(m.map));
  $("#f-matches-body").innerHTML = visible.map((m) =>
    `<label><input type="checkbox" value="${m.id}" ${state.matches.includes(m.id) ? "checked" : ""}> ${mapName(m.map)} · ${m.teams.map((t) => `${esc(teamName(m, t))} ${m.score[t]}`).join(" – ")}</label>`).join("") || '<span class="muted">Sin partidas</span>';
  $("#f-matches summary").textContent = state.matches.length ? `${state.matches.length} seleccionadas` : "Todas";
  $("#filters").style.display = ["demos", "replay", "matches"].includes(state.tab) ? "none" : "";
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function defaultTeam() {
  // el equipo con más rondas acumuladas por sus jugadores habituales
  const rounds = {};
  Object.values(catalog.players).forEach((p) => { rounds[p.team] = (rounds[p.team] || 0) + p.rounds; });
  return Object.entries(rounds).sort((a, b) => b[1] - a[1])[0]?.[0] || Object.keys(catalog.teams)[0];
}

/* ---------------- pestaña Jugadores ---------------- */
async function renderPlayers() {
  const view = $("#view");
  if (!catalog.matches.length) { view.innerHTML = noData(); return; }
  const roster = await api(`/api/roster?name=${encodeURIComponent(state.team)}&${qs()}`);
  if (state.tab !== "players") return;
  if (!roster.length) { view.innerHTML = empty("Sin datos con este filtro", "Prueba con otro mapa, bando o equipo."); return; }
  if (!roster.some((p) => p.steamid === state.player)) state.player = roster[0].steamid;
  view.innerHTML = `<div class="layout">
    <aside class="roster"><h4>${esc(state.team)} · ${sideLabel()}</h4>
      ${roster.map((p) => `<button class="pcard ${p.steamid === state.player ? "active" : ""}" data-sid="${p.steamid}">
        <span><span class="n">${esc(p.name)}</span><br><span class="r">${p.role || "—"} · ${p.rounds} rondas</span></span>
        <span class="badge ${ratingCls(p.rating)}">${num(p.rating)}</span></button>`).join("")}
    </aside><div id="pdetail"><div class="empty">Cargando…</div></div></div>`;
  $$(".pcard").forEach((b) => b.addEventListener("click", () => { state.player = b.dataset.sid; save(); renderPlayers(); }));
  await renderPlayerDetail();
}

async function renderPlayerDetail() {
  const box = $("#pdetail");
  let d;
  try { d = await api(`/api/player/${state.player}?${qs()}`); } catch (e) { if (document.body.contains(box)) box.innerHTML = empty("Sin datos", esc(e.message)); return; }
  if (!document.body.contains(box)) return; // llegó tarde: la vista ya cambió
  const o = d.overall, s = (v, dd = 2) => num(v, dd);
  const roleSel = `<select id="role-sel"><option value="">Rol: auto</option>${ROLE_OPTIONS.map((r) => `<option ${d.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>`;
  const series = [{ name: d.name, color: "#ff8a1f", values: AXES.map((a) => o[a]), fill: 0.3 }];
  if (state.compare) series.push({ name: `Media ${d.team}`, color: "#5b95ff", values: AXES.map((a) => d.team_avg[a]), dash: true, fill: 0.06 });
  const kd = o.kills - o.deaths;
  const kpis = [
    kpi("Rating 2.0*", s(o.rating), `${o.rounds} rondas`, true, "Rating 2.0 aproximado con la fórmula pública de HLTV (KAST, KPR, DPR, Impact, ADR)."),
    kpi("KAST", pct(o.kast_pct), "Kill / Assist / Survive / Trade"), kpi("ADR", s(o.adr, 1), `${Math.round(o.damage)} daño`),
    kpi("K/D", s(o.kd), `${o.kills}-${o.deaths} (${kd >= 0 ? "+" : ""}${kd})`), kpi("KPR", s(o.kpr), "kills / ronda"), kpi("DPR", s(o.dpr), "muertes / ronda"),
    kpi("Impact", s(o.impact), "fórmula HLTV"), kpi("HS%", pct(o.hs_pct), `${o.hs} headshots`), kpi("Supervivencia", pct(o.survival), "rondas vivo"),
    kpi("Opening", pct(o.opening_succ), `${o.ok}-${o.od} · ${s(o.opening_att)}/ronda`, false, "Duelos de apertura: % ganados y nº de intentos por ronda."),
    kpi("Trade kills/ronda", s(o.tk_pr), `${o.tk} trade kills`), kpi("Muertes tradeadas", pct(o.traded_pct), `${o.traded} de ${o.deaths}`),
    kpi("Clutches ganados", `${o.cl_won}/${o.cl_n}`, pct(o.cl_win_pct), false, "Situaciones 1vX en las que el jugador quedó último vivo."),
    kpi("% Clutch guardado", pct(o.cl_save_pct), `${o.cl_saved} guardados`, true, "De los clutches PERDIDOS, % en los que el jugador sobrevivió a la ronda (guardó arma)."),
    kpi("Util dmg/ronda", s(o.util_pr, 1), "HE + molotov"), kpi("Cegados/ronda", s(o.flash_pr), "enemigos"),
    kpi("Rondas con kill", pct(o.rwk_pct * 100), `${o.multi} multi-kills`), kpi("Multi-kills", `${o.k2}·${o.k3}·${o.k4}·${o.k5}`, "2K · 3K · 4K · 5K"),
    kpi("Round swing", signed(o.swing), "pp / ronda", true, "Estilo HLTV: prob. de ganar la ronda aportada por tus kills (solo en rondas ganadas) menos la perdida por tus muertes, promedio por ronda. Modelo de probabilidad heurístico."),
    kpi("Swing kills", signed(o.swing_k), "pp / ronda", false, "Prob. de ronda ganada aportada por tus kills en rondas que el equipo ganó."),
    kpi("Swing muertes", signed(o.swing_d), "pp / ronda", false, "Prob. de ronda perdida por tus muertes (siempre penalizan)."),
    kpi("Swing rondas ganadas", signed(o.swing_won), "pp en rondas ganadas"), kpi("Swing rondas perdidas", signed(o.swing_lost), "pp en rondas perdidas"),
    kpi("Swing bruto", signed(o.swing_raw), "pp / ronda, sin filtro de victoria", false, "Como Round swing pero contando también las kills hechas en rondas perdidas."),
    kpi("Score potencia", Math.round(o.power), "0–100", true),
    kpi("Vida perdida", s(o.hp_lost_pr, 0), "HP por ronda", false, "Vida media que pierdes por ronda (100 si mueres)."),
    kpi("Tiempo de vida", `${s(o.life_t, 0)} s`, "media por ronda", false, "Segundos que sigues vivo en cada ronda (hasta tu muerte o el final)."),
    kpi("Kills a cegados", o.kf, `${s(o.kf_pr)} / ronda`, false, "Kills sobre rivales que estaban cegados por una flash en ese instante."),
    kpi("Muertes cegado", o.dfl, "morir estando flasheado"),
    kpi("Granadas / ronda", s(o.nades_pr), `${o.n_smoke} 💨 ${o.n_flash} ✦ ${o.n_he} 💥 ${o.n_molo} 🔥`),
    kpi("Eficiencia flash", s(o.flash_eff), "cegados por flash lanzada"),
  ].join("");

  const maxP = Math.max(60, ...d.by_map.map((m) => m.power));
  const powerBars = d.by_map.map((m) => barRow(mapName(m.map), m.power, 100, `${Math.round(m.power)} <small>· ${m.rounds}r</small>`)).join("") || '<span class="muted">—</span>';
  const cmpRows = [["Rating 2.0*", "rating", 2], ["KAST %", "kast_pct", 1], ["ADR", "adr", 1], ["KPR", "kpr", 2], ["DPR", "dpr", 2], ["Impact", "impact", 2], ["Opening %", "opening_succ", 0],
    ["Trade kills/ronda", "tk_pr", 2], ["Clutch ganado %", "cl_win_pct", 0], ["Clutch guardado %", "cl_save_pct", 0], ["Util dmg/ronda", "util_pr", 1], ["Round swing", "swing", 1], ["Swing kills", "swing_k", 1], ["Swing muertes", "swing_d", 1], ["Score potencia", "power", 0]];
  const sideTable = `<table><tr><th>Métrica</th><th>Selección</th><th style="color:var(--t)">T</th><th style="color:var(--ct)">CT</th></tr>${cmpRows.map(([l, k, dd]) =>
    `<tr><td>${l}</td><td>${num(o[k], dd)}</td><td>${num(d.by_side.T?.[k], dd)}</td><td>${num(d.by_side.CT?.[k], dd)}</td></tr>`).join("")}
    <tr><td>Rondas</td><td>${o.rounds}</td><td>${d.by_side.T?.rounds ?? 0}</td><td>${d.by_side.CT?.rounds ?? 0}</td></tr></table>`;
  const mapTable = `<table><tr><th>Mapa</th><th>Rondas</th><th>Rating</th><th>K/D</th><th>ADR</th><th>KAST</th><th>Opening</th><th>Swing</th><th>Potencia</th></tr>${d.by_map.map((m) =>
    `<tr><td>${mapName(m.map)}</td><td>${m.rounds}</td><td class="${ratingCls(m.rating)}">${num(m.rating)}</td><td>${num(m.kd)}</td><td>${num(m.adr, 1)}</td><td>${pct(m.kast_pct)}</td><td>${pct(m.opening_succ)}</td><td>${signed(m.swing)}</td><td>${Math.round(m.power)}</td></tr>`).join("")}</table>`;
  const clutchTable = d.clutches.length ? `<table><tr><th>Situación</th><th>Veces</th><th>Ganados</th><th>Guardados</th></tr>${d.clutches.map((c) => `<tr><td>1v${c.vs}</td><td>${c.n}</td><td>${c.won}</td><td>${c.saved}</td></tr>`).join("")}</table>` : '<span class="muted">Sin situaciones de clutch.</span>';
  const maxW = Math.max(1, ...d.weapons.map((w) => w.kills));
  const weapons = d.weapons.map((w) => barRow(esc(w.weapon), w.kills, maxW, w.kills)).join("") || '<span class="muted">—</span>';
  const impactRows = d.impact.map((r) => ({ ...r, rounds: o.rounds }));
  const buyTable = d.by_buy.length ? `<table><tr><th>Economía</th><th>Equip.</th><th>Rondas</th><th>K–D</th><th>ADR</th><th>KAST</th><th>Win%</th><th>Swing</th></tr>${d.by_buy.map((b) =>
    `<tr><td>${b.buy}</td><td>$${Math.round(b.equip)}</td><td>${b.rounds}</td><td>${b.kills}–${b.deaths}</td><td>${num(b.adr, 0)}</td><td>${pct(b.kast_pct)}</td><td>${pct(b.win_pct)}</td><td>${signed(b.swing)}</td></tr>`).join("")}</table>` : '<span class="muted">—</span>';
  const utilBars = [["Humos", o.smoke_pr], ["Flashes", o.flash_th_pr], ["HE", o.he_pr], ["Molotov", o.molo_pr]].map(([l, v]) => barRow(l, v, 1.2, `${num(v, 2)} <small>/ronda</small>`)).join("");
  const zoneList = (rows, key, fmt) => { const mx = Math.max(1, ...rows.map((z) => z[key])); return rows.map((z) => barRow(esc(z.zone), z[key], mx, fmt(z[key]))).join("") || '<span class="muted">—</span>'; };
  const myMaps = [...new Set(d.by_map.map((m) => m.map))];

  box.innerHTML = `
    <div class="pheader"><div class="nameplate"><div class="eyebrow">Perfil de jugador</div><h2>${esc(d.name)}</h2><div class="sub">${esc(d.team)} · ${sideLabel()} · ${state.maps.length ? state.maps.map(mapName).join(", ") : "Todos los mapas"}</div></div>
      ${roleSel}<div class="rating"><b class="${ratingCls(o.rating)}">${s(o.rating)}</b><span>Rating 2.0*</span></div></div>
    <div class="grid g-radar">
      <div class="card"><h3>Perfil <small>estilo HLTV</small></h3><div class="radar-wrap">${radarSVG(series)}</div>${legend(series)}
        <div class="toggles"><button class="toggle ${state.compare ? "on" : ""}" id="cmp">Comparar con media del equipo</button></div></div>
      <div class="card"><h3>Métricas clave <small>${sideLabel()}</small></h3><div class="kpis">${kpis}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Score de potencia por mapa <small>0–100</small></h3>${powerBars}<p class="note">Combina rating (45%), KAST (20%), ADR (20%) e impact (15%) normalizados.</p></div>
      <div class="card"><h3>Impacto según momento de la ronda</h3>${impactSVG(impactRows)}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Swing ronda a ronda <small>pp de probabilidad de ronda · ${signed(o.swing)} de media</small></h3><div class="tscroll">${swingRoundsSVG(d.rounds)}</div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Rendimiento por economía <small>según la compra de tu equipo</small></h3><div class="tscroll">${buyTable}</div>
        <h3 style="margin-top:20px">Utilidad lanzada</h3>${utilBars}<p class="note">Eco &lt; $1.500 de media de equipo, force &lt; $3.500, full buy el resto.</p></div>
      <div class="card"><h3>Zonas del mapa <small>nombres del propio juego</small></h3>
        <div class="subh">Más tiempo en</div>${zoneList(d.zones, "share", (v) => pct(v, 1))}
        <div class="subh">Kills en (zona del rival)</div>${zoneList(d.zone_kills, "n", (v) => v)}
        <div class="subh">Muertes en</div>${zoneList(d.zone_deaths, "n", (v) => v)}</div>
    </div>
    <div id="util-slot" style="margin-top:16px"></div>
    <div class="card" style="margin-top:16px"><h3>Mapa de calor <small id="heat-n"></small></h3>
      <div class="heat-wrap"><canvas class="heat" id="heat"></canvas><div class="hcontrols">
        <div class="row"><span>Mapa</span><div class="chips" id="h-map">${myMaps.map((m) => `<button class="chip" data-v="${m}">${mapName(m)}</button>`).join("")}</div></div>
        <div class="row"><span>Bando</span><div class="seg" id="h-side"><button data-v="all">Ambos</button><button data-v="T" class="t">T</button><button data-v="CT" class="ct">CT</button></div></div>
        <div class="row"><span>Capa</span><div class="seg" id="h-kind"><button data-v="pos">Posición</button><button data-v="kills">Kills</button><button data-v="deaths">Muertes</button></div></div>
        <div class="row"><span>Zonas</span><button class="toggle" id="h-labels">Mostrar nombres</button></div>
        <div><div class="ramp"></div><div class="legend" style="justify-content:space-between"><span>menos</span><span>más</span></div></div>
        <p class="note">El mapa de calor depende del mapa, no se agrega entre mapas. Se usa el radar de <code>app/static/maps/&lt;mapa&gt;.png</code> (1024×1024); si falta, se dibuja la silueta con las posiciones de los jugadores.</p>
      </div></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Comparativa por bando</h3><div class="tscroll">${sideTable}</div></div>
      <div class="card"><h3>Clutches</h3>${clutchTable}<h3 style="margin-top:18px">Armas (kills)</h3>${weapons}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Rendimiento por mapa</h3><div class="tscroll">${mapTable}</div></div>`;

  $("#role-sel").addEventListener("change", async (e) => { await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steamid: state.player, role: e.target.value }) }); catalog = await api("/api/catalog"); renderPlayers(); });
  $("#cmp").addEventListener("click", () => { state.compare = !state.compare; save(); renderPlayerDetail(); });
  mountUtilityMap($("#util-slot"), { steamid: state.player, maps: myMaps });

  const hs = { map: myMaps.includes(state.heatMap) ? state.heatMap : myMaps[0], side: state.side, kind: "pos", labels: false };
  const paint = async () => {
    $$("#h-map .chip").forEach((b) => b.classList.toggle("active", b.dataset.v === hs.map));
    $$("#h-side button").forEach((b) => b.classList.toggle("active", b.dataset.v === hs.side));
    $$("#h-kind button").forEach((b) => b.classList.toggle("active", b.dataset.v === hs.kind));
    $("#h-labels").classList.toggle("on", hs.labels);
    if (!hs.map) return;
    const data = await api(`/api/heatmap?map=${hs.map}&steamid=${state.player}&side=${hs.side}&kind=${hs.kind}&matches=${state.matches.join(",")}`);
    if (!$("#heat")) return;
    $("#heat-n").textContent = `${mapName(hs.map)} · ${data.n} ${hs.kind === "pos" ? "muestras" : hs.kind === "kills" ? "kills" : "muertes"}`;
    await drawHeat($("#heat"), data, { labels: hs.labels, kind: hs.kind });
  };
  $$("#h-map .chip").forEach((b) => b.addEventListener("click", () => { hs.map = b.dataset.v; state.heatMap = hs.map; save(); paint(); }));
  $$("#h-side button").forEach((b) => b.addEventListener("click", () => { hs.side = b.dataset.v; paint(); }));
  $$("#h-kind button").forEach((b) => b.addEventListener("click", () => { hs.kind = b.dataset.v; paint(); }));
  $("#h-labels").addEventListener("click", () => { hs.labels = !hs.labels; paint(); });
  paint();
}

/* ---------------- pestaña Equipo ---------------- */
const roleOn = new Set();
let teamSort = { key: "rating", dir: -1 };
async function renderTeam() {
  const view = $("#view");
  if (!catalog.matches.length) { view.innerHTML = noData(); return; }
  let d;
  const tabAtStart = state.tab;
  try { d = await api(`/api/team?name=${encodeURIComponent(state.team)}&${qs()}`); } catch (e) { if (state.tab === tabAtStart) view.innerHTML = empty("Sin datos con este filtro", esc(e.message)); return; }
  if (state.tab !== tabAtStart) return;
  const a = d.team_avg;
  const series = [{ name: `Media ${d.team}`, color: "#ff8a1f", values: AXES.map((x) => a[x]), fill: 0.28 }];
  d.by_role.filter((r) => roleOn.has(r.role)).forEach((r) => series.push({ name: r.role, color: ROLE_COLORS[r.role] || "#999", values: AXES.map((x) => r[x]), dash: true, fill: 0.05 }));
  const tiles = [
    kpi("Mapas", d.matches, `${d.wins}V – ${d.losses}D`, true), kpi("Rondas", d.rounds, sideLabel()), kpi("Rating medio*", num(a.rating), "media jugadores", true), kpi("KAST medio", pct(a.kast_pct)),
    kpi("ADR medio", num(a.adr, 1)), kpi("K/D equipo", num(d.totals.kills / Math.max(1, d.totals.deaths)), `${d.totals.kills}-${d.totals.deaths}`),
    kpi("Opening medio", pct(a.opening_succ)), kpi("Trade kills/ronda", num(a.tk_pr)), kpi("Util dmg/ronda", num(d.totals.util_pr, 1)), kpi("Multi-kills", d.totals.multi, `${d.totals.k5} aces`),
    kpi("Score potencia", Math.round(a.power), "media 0–100", true), kpi("Round swing", signed(a.swing), "pp / ronda · media", true), kpi("Swing kills", signed(a.swing_k), "pp / ronda"), kpi("Swing muertes", signed(a.swing_d), "pp / ronda"),
  ].join("");
  const cols = [["rating", "Rating*", 2], ["kast_pct", "KAST%", 1], ["adr", "ADR", 1], ["kpr", "KPR", 2], ["dpr", "DPR", 2], ["impact", "Impact", 2], ["opening_succ", "Open%", 0], ["opening_att", "Open/r", 2],
    ["tk_pr", "Trade/r", 2], ["traded_pct", "Tradeada%", 0], ["cl_win_pct", "Clutch%", 0], ["cl_save_pct", "Guard.%", 0], ["util_pr", "Util/r", 1], ["flash_pr", "Flash/r", 2], ["hs_pct", "HS%", 0], ["swing", "Swing", 1], ["power", "Potencia", 0]];
  const roleTable = `<table class="dense"><tr><th>Rol</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr>${d.by_role.map((r) =>
    `<tr><td><span class="tag" style="color:${ROLE_COLORS[r.role]}">${r.role}</span> <span class="muted">${r.players.map(esc).join(", ")}</span></td>${cols.map(([k, , dd]) => `<td>${num(r[k], dd)}</td>`).join("")}</tr>`).join("")}
    <tr class="avg"><td>Media del equipo</td>${cols.map(([k, , dd]) => `<td>${num(a[k], dd)}</td>`).join("")}</tr></table>`;
  const players = d.players.slice().sort((x, y) => (teamSort.dir * ((x[teamSort.key] ?? -1e9) - (y[teamSort.key] ?? -1e9))));
  const pTable = `<table class="dense"><tr><th>Jugador</th><th>Rol</th><th>Rondas</th>${cols.map(([k, l]) => `<th class="sortable" data-k="${k}">${l}${teamSort.key === k ? (teamSort.dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("")}</tr>${players.map((p) =>
    `<tr><td><a href="#" data-sid="${p.steamid}" class="plink" style="color:var(--text)">${esc(p.name)}</a></td><td>${p.role}</td><td>${p.rounds}</td>${cols.map(([k, , dd]) => `<td class="${k === "rating" ? ratingCls(p[k]) : ""}">${num(p[k], dd)}</td>`).join("")}</tr>`).join("")}</table>`;
  const sit = [
    ["Lado T", d.sides.T, "t"], ["Lado CT", d.sides.CT, "ct"], ["Pistol rounds", d.pistol], ["Eco", d.buys.eco], ["Force", d.buys.force], ["Full buy", d.buys.full],
    ["Post-plant (T)", d.post_plant, "t"], ["Retake (CT)", d.retake, "ct"], ["Gana 1ª kill", d.first_kill.got], ["Cede 1ª kill", d.first_kill.conceded],
  ].map(([l, v, c]) => barRow(l, v.win || 0, 100, `${v.n ? pct(v.win) : "–"} <small>· ${v.n}r</small>`, c || "")).join("");
  const mapTable = `<table><tr><th>Mapa</th><th>Partidas</th><th>V</th><th>Rondas</th><th>Win%</th><th style="color:var(--t)">T win%</th><th style="color:var(--ct)">CT win%</th><th>Rating</th><th>Potencia</th></tr>${d.by_map.map((m) =>
    `<tr><td>${mapName(m.map)}</td><td>${m.matches}</td><td>${m.wins}</td><td>${m.rounds}</td><td>${pct(m.win_pct)}</td><td>${pct(m.t.win)}</td><td>${pct(m.ct.win)}</td><td>${num(m.rating)}</td><td>${Math.round(m.power ?? 0)}</td></tr>`).join("")}</table>`;
  // --- datos ampliados de equipo
  const sw = (v) => (v.n ? `${pct(v.win)}` : "–");
  const siteTable = `<table><tr><th rowspan="2">Sitio</th><th colspan="2" style="color:var(--t);text-align:center">Plantamos (T)</th><th colspan="2" style="color:var(--ct);text-align:center">Defendemos (CT)</th></tr><tr><th>Rondas</th><th>Win%</th><th>Rondas</th><th>Win%</th></tr>${[["A", "Sitio A"], ["B", "Sitio B"], ["none", "Sin plant"]].map(([k, l]) =>
    `<tr><td>${l}</td><td>${d.sites[k].t.n}</td><td>${sw(d.sites[k].t)}</td><td>${d.sites[k].ct.n}</td><td>${sw(d.sites[k].ct)}</td></tr>`).join("")}</table>
    <p class="note">En T cuenta dónde plantamos; en CT, dónde plantó el rival (win% = retake o defensa exitosa). El sitio se deduce de dónde estaban los T al plantar.</p>`;
  const poolList = d.pool.map((m) => barRow(mapName(m.map), m.win_pct || 0, 100, `${pct(m.win_pct)} <small>· ${m.rounds}r</small>`)).join("");
  const poolNote = d.pick ? `<p class="note">Por % de rondas ganadas: <b style="color:var(--orange2)">pick ${mapName(d.pick)}</b>${d.ban && d.ban !== d.pick ? ` · <b style="color:var(--bad)">ban ${mapName(d.ban)}</b>` : ""}. Confianza ${d.pool.every((m) => m.confidence === "baja") ? "baja: muestra muy pequeña" : "según rondas por mapa"} (${d.pool.map((m) => `${mapName(m.map)} ${m.rounds}r`).join(", ")}).</p>` : "";
  const ec = d.economy, ecRow = (l, v) => barRow(l, v.win || 0, 100, `${v.n ? pct(v.win) : "–"} <small>· ${v.n}r</small>`);
  const econBlock = `${ecRow("Anti-eco", ec.anti_eco)}${ecRow("Full vs full", ec.full_vs_full)}${ecRow("Force vs full", ec.force_vs_full)}${ecRow("Eco vs full", ec.upset)}
    <p class="note">Equipo medio en T: <b>$${Math.round(ec.avg_t || 0)}</b> · en CT: <b>$${Math.round(ec.avg_ct || 0)}</b> · compras: ${Object.entries(ec.counts).map(([k, v]) => `${k} ${v}`).join(", ")}.</p>`;
  const endList = (o) => { const mx = Math.max(1, ...Object.values(o)); return Object.entries(o).map(([k, v]) => barRow(esc(k).slice(0, 18), v, mx, v)).join("") || '<span class="muted">—</span>'; };
  const trendTable = `<table><tr><th>Mapa</th><th>Rival</th><th>Resultado</th><th>Rating</th><th>Swing</th><th>ADR</th><th style="color:var(--t)">T win%</th><th style="color:var(--ct)">CT win%</th></tr>${d.trend.map((m) =>
    `<tr><td>${mapName(m.map)}</td><td>${esc(m.opponent)}</td><td><span class="st ${m.won ? "done" : "error"}">${m.won ? "V" : "D"}</span> ${m.score_us}–${m.score_them}</td><td class="${ratingCls(m.rating)}">${num(m.rating)}</td><td>${signed(m.swing)}</td><td>${num(m.adr, 1)}</td><td>${pct(m.t_win)}</td><td>${pct(m.ct_win)}</td></tr>`).join("")}</table>`;
  const utilCols = [["smoke_pr", "Humos/r", 2], ["flash_th_pr", "Flash/r", 2], ["he_pr", "HE/r", 2], ["molo_pr", "Molo/r", 2], ["flash_eff", "Efic. flash", 2], ["util_pr", "Dmg util/r", 1], ["flash_pr", "Cegados/r", 2], ["kf", "Kills a cegados", 0], ["dfl", "Muertes cegado", 0], ["hp_lost_pr", "Vida perdida", 0], ["life_t", "Vida (s)", 0]];
  const utilTable = `<table class="dense"><tr><th>Jugador</th>${utilCols.map(([, l]) => `<th>${l}</th>`).join("")}</tr>${d.players.map((p) => `<tr><td>${esc(p.name)}</td>${utilCols.map(([k, , dd]) => `<td>${num(p[k], dd)}</td>`).join("")}</tr>`).join("")}
    <tr class="avg"><td>Media del equipo</td>${utilCols.map(([k, , dd]) => `<td>${num(["kf", "dfl"].includes(k) ? d.players.reduce((a, p) => a + p[k], 0) / d.players.length : d.team_avg[k] ?? d.players.reduce((a, p) => a + (p[k] || 0), 0) / d.players.length, dd)}</td>`).join("")}</tr></table>`;
  view.innerHTML = `
    <div class="pheader"><div class="nameplate"><div class="eyebrow">Vista de equipo</div><h2>${esc(d.team)}</h2><div class="sub">${sideLabel()} · ${state.maps.length ? state.maps.map(mapName).join(", ") : "Todos los mapas"} · ${d.matches} partidas${(() => { const raw = [...new Set(catalog.matches.filter((m) => (!state.maps.length || state.maps.includes(m.map)) && (!state.matches.length || state.matches.includes(m.id)) && m.labels && m.labels[d.team] && m.labels[d.team] !== d.team).map((m) => m.labels[d.team]))]; return raw.length ? ` · en demos como ${raw.map(esc).join(", ")}` : ""; })()}</div></div></div>
    <div class="grid g-radar">
      <div class="card"><h3>Perfil medio del equipo</h3><div class="radar-wrap">${radarSVG(series)}</div>${legend(series)}
        <div class="toggles"><span class="note" style="width:100%">Superponer media por rol:</span>${d.by_role.map((r) => `<button class="toggle ${roleOn.has(r.role) ? "on" : ""}" data-role="${r.role}">${r.role}</button>`).join("")}</div></div>
      <div class="card"><h3>Resumen <small>estilo HLTV</small></h3><div class="kpis">${tiles}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Medias transversales por rol <small>los roles son editables desde la pestaña Jugadores</small></h3><div class="tscroll">${roleTable}</div></div>
    <div class="card" style="margin-top:16px"><h3>Jugadores</h3><div class="tscroll">${pTable}</div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Win% de ronda por situación</h3>${sit}<p class="note">Tasa de plant en T: ${pct(d.plant_rate)}. Eco/force/full según el valor medio de equipo al empezar la ronda.</p></div>
      <div class="card"><h3>Rendimiento por mapa</h3><div class="tscroll">${mapTable}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Sitios de plant <small>A / B</small></h3><div class="tscroll">${siteTable}</div></div>
      <div class="card"><h3>Pool de mapas <small>win% de ronda</small></h3>${poolList}${poolNote}</div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Economía <small>win% según la compra de ambos equipos</small></h3>${econBlock}</div>
      <div class="card"><h3>Cómo se ganan y se pierden las rondas</h3><div class="subh">Rondas ganadas</div>${endList(d.endings_win)}<div class="subh">Rondas perdidas</div>${endList(d.endings_loss)}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Evolución por partida <small>orden de archivo de demo</small></h3><div class="tscroll">${trendTable}</div></div>
    <div class="card" style="margin-top:16px"><h3>Utilidad y supervivencia</h3><div class="tscroll">${utilTable}</div></div>
    <div id="util-slot" style="margin-top:16px"></div>`;
  mountUtilityMap($("#util-slot"), { team: d.team, maps: d.by_map.map((m) => m.map) });
  $$("[data-role]").forEach((b) => b.addEventListener("click", () => { roleOn.has(b.dataset.role) ? roleOn.delete(b.dataset.role) : roleOn.add(b.dataset.role); renderTeam(); }));
  $$("th.sortable").forEach((th) => th.addEventListener("click", () => { teamSort = { key: th.dataset.k, dir: teamSort.key === th.dataset.k ? -teamSort.dir : -1 }; renderTeam(); }));
  $$(".plink").forEach((l) => l.addEventListener("click", (e) => { e.preventDefault(); state.player = l.dataset.sid; setTab("players"); }));
}

/* ---------------- pestaña Demos ---------------- */
const noData = () => empty("Todavía no hay demos procesadas", 'Ve a la pestaña <b>Demos</b>, sube tus archivos .dem / .dem.zst o procesa la carpeta <code>demos/raw</code>.');
async function renderDemos() {
  const view = $("#view");
  const d = await api("/api/demos");
  const active = d.jobs.some((j) => j.status === "queued" || j.status === "processing");
  view.innerHTML = `
    <div class="pheader"><div class="nameplate"><div class="eyebrow">Biblioteca</div><h2>Demos</h2><div class="sub">Importa, procesa y gestiona tus partidas</div></div></div>
    <div class="grid g2">
      <div class="card"><h3>Importar demos</h3>
        <div class="dropzone" id="drop"><p><b>Arrastra aquí tus demos</b> (.dem o .dem.zst)</p><p>o</p><button class="primary" id="pick">Seleccionar archivos</button><input type="file" id="file" accept=".dem,.zst" multiple hidden></div>
        <p class="note">Los archivos se guardan en <code>demos/raw</code> y se parsean en local; los datos quedan en <code>data/matches</code>. Cada demo tarda ~20 s.</p>
        <p><button class="btn" id="proc">Procesar demos nuevas de la carpeta</button> <button class="btn" id="reall">Reprocesar todas</button></p></div>
      <div class="card"><h3>Procesado</h3>${d.jobs.length ? d.jobs.map((j) => `<div class="bar-row" style="grid-template-columns:1fr 120px 130px"><span class="lab" title="${esc(j.file)}">${esc(j.file.slice(0, 34))}</span><div class="progress"><i style="width:${j.pct}%"></i></div><span class="st ${j.status}">${esc(j.msg)}</span></div>`).join("") : '<span class="muted">Sin trabajos recientes.</span>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Partidas cargadas <small>${catalog.matches.length}</small></h3>
      <div class="tscroll"><table><tr><th>Mapa</th><th>Marcador</th><th>Rondas</th><th>Archivo</th><th></th></tr>${catalog.matches.map((m) =>
        `<tr><td>${mapName(m.map)}</td><td>${m.teams.map((t) => `${esc(teamName(m, t))} <b>${m.score[t]}</b>`).join(" – ")}</td><td>${m.rounds}</td><td class="muted">${esc(m.source.slice(0, 40))}</td>
        <td><button class="btn" data-re="${m.id}">Reprocesar</button> <button class="btn danger" data-del="${m.id}">Eliminar</button></td></tr>`).join("") || '<tr><td colspan="5" class="muted">Ninguna</td></tr>'}</table></div></div>
    <div class="card" style="margin-top:16px"><h3>Archivos en demos/raw</h3><div class="tscroll"><table><tr><th>Archivo</th><th>Tamaño</th><th>Estado</th></tr>${d.files.map((f) => `<tr><td>${esc(f.file)}</td><td>${f.mb} MB</td><td><span class="st ${f.processed ? "done" : ""}">${f.processed ? "Procesada" : "Pendiente"}</span></td></tr>`).join("")}</table></div></div>`;
  const send = async (files) => {
    for (const f of files) { await fetch(`/api/demos/upload?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f }); await renderDemos(); }
  };
  const drop = $("#drop"), input = $("#file");
  $("#pick").onclick = () => input.click(); input.onchange = () => send(input.files);
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => send(e.dataTransfer.files));
  $("#proc").onclick = async () => { await fetch("/api/demos/process", { method: "POST" }); renderDemos(); };
  $("#reall").onclick = async () => { if (confirm("¿Reprocesar todas las demos? Tarda ~20 s por demo.")) { await fetch("/api/demos/reprocess_all", { method: "POST" }); renderDemos(); } };
  $$("[data-del]").forEach((b) => b.onclick = async () => { if (confirm("¿Eliminar esta partida procesada? (la demo original se conserva)")) { await fetch(`/api/match/${b.dataset.del}`, { method: "DELETE" }); await refreshCatalog(); renderDemos(); } });
  $$("[data-re]").forEach((b) => b.onclick = async () => { await fetch(`/api/match/${b.dataset.re}/reprocess`, { method: "POST" }); renderDemos(); });
  clearTimeout(pollTimer);
  if (active) pollTimer = setTimeout(async () => { await refreshCatalog(); if (state.tab === "demos") renderDemos(); }, 1500);
}

/* ---------------- navegación ---------------- */
async function refreshCatalog() { catalog = await api("/api/catalog"); const v = $("#foot-ver"); if (v) v.textContent = `v${catalog.version}`; renderFilters(); }
const TAB_NAMES = { players: "Jugadores", team: "Equipo", matches: "Partidas", replay: "Reproductor", demos: "Demos" };
function updateHud() {
  const keys = Object.keys(TAB_NAMES), i = keys.indexOf(state.tab);
  $("#hud-segs").innerHTML = keys.map((k) => `<i class="${k === state.tab ? "on" : ""}"></i>`).join("");
  $("#hud-label").textContent = `0${i + 1} / 0${keys.length} · ${tr(TAB_NAMES[state.tab])}`;
}
function setTab(t) {
  state.tab = t; save(); clearTimeout(pollTimer); updateHud();
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  renderFilters(); render();
}
async function render() {
  const view = $("#view");
  if (state.tab !== "replay" && typeof stopReplay === "function") stopReplay();
  try { await (state.tab === "players" ? renderPlayers() : state.tab === "team" ? renderTeam() : state.tab === "replay" ? renderReplay() : state.tab === "matches" ? renderMatches() : renderDemos()); }
  catch (e) { console.error(e); view.innerHTML = empty("Algo salió mal", esc(e.message)); }
}

$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });
$("#f-team").addEventListener("change", (e) => { state.team = e.target.value; state.player = null; save(); render(); });
$("#f-maps").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const m = b.dataset.map;
  state.maps = !m ? [] : state.maps.includes(m) ? state.maps.filter((x) => x !== m) : [...state.maps, m];
  state.matches = []; save(); renderFilters(); render();
});
$("#f-side").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.side = b.dataset.v; save(); renderFilters(); render(); });
$("#f-matches-body").addEventListener("change", () => {
  state.matches = $$("#f-matches-body input:checked").map((i) => i.value); save();
  $("#f-matches summary").textContent = state.matches.length ? `${state.matches.length} seleccionadas` : "Todas"; render();
});
document.addEventListener("click", (e) => { const dd = $("#f-matches"); if (dd.open && !dd.contains(e.target)) dd.open = false; });

/* ---------------- modales ---------------- */
const ICON_SVG = {
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
};
const logoImg = (n) => `<img src="/static/img/social/${n}.png" alt="">`;
const SOCIALS = [
  { key: "kofi", name: "Ko-fi", handle: "ko-fi.com/deichalcs2", url: "https://ko-fi.com/deichalcs2", tile: "#fff", icon: logoImg("kofi"), featured: true, cta: "Invítame a un café" },
  { key: "x", name: "X", handle: "@_deichal_", url: "https://x.com/_deichal_", tile: "#000", icon: ICON_SVG.x },
  { key: "instagram", name: "Instagram", handle: "@deichalcs", url: "https://instagram.com/deichalcs", tile: "transparent", icon: logoImg("instagram") },
  { key: "twitch", name: "Twitch", handle: "deichal", url: "https://twitch.tv/deichal", tile: "transparent", icon: logoImg("twitch") },
  { key: "tiktok", name: "TikTok", handle: "@_deichal_", url: "https://www.tiktok.com/@_deichal_", tile: "#000", icon: ICON_SVG.tiktok },
];
$("#socials").innerHTML = SOCIALS.map((s) => `<a class="social${s.featured ? " featured" : ""}" href="${s.url}" target="_blank" rel="noopener noreferrer"><span class="ic" style="background:${s.tile}">${s.icon}</span><span><b>${s.name}</b><small>${s.featured ? s.cta : s.handle}</small></span><em>${s.featured ? "Apoyar ↗" : "Seguir ↗"}</em></a>`).join("");
$("#foot-socials").innerHTML = SOCIALS.map((s) => `<a href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="${s.name}" data-tip="${s.name} · ${s.handle}" style="background:${s.tile === "#fff" ? "#fff" : "transparent"}">${s.icon}</a>`).join("");
const openSupport = () => { $("#support-modal").hidden = false; };
const closeSupport = () => { $("#support-modal").hidden = true; try { sessionStorage.setItem("deichal-support", "1"); } catch {} };
$("#btn-support").onclick = openSupport; $("#support-close").onclick = closeSupport;
$("#support-modal").addEventListener("click", (e) => { if (e.target.id === "support-modal") closeSupport(); });
$("#btn-method").onclick = () => { $("#method-modal").hidden = false; };
$("#foot-method").onclick = (e) => { e.preventDefault(); $("#method-modal").hidden = false; };
$("#foot-support").onclick = (e) => { e.preventDefault(); openSupport(); };
$$("[data-close]").forEach((b) => b.onclick = () => { $("#method-modal").hidden = true; });
$("#method-modal").addEventListener("click", (e) => { if (e.target.id === "method-modal") e.target.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#method-modal").hidden = true; closeSupport(); } });
$("#method-body").innerHTML = `
  <p>Todas las métricas se calculan a partir de los datos por tick de la demo (posiciones, vida y contadores del jugador). Son aproximaciones de las de HLTV, no valores oficiales.</p>
  <h4>Rating 2.0*</h4><p>0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587, con Impact = 2.13·KPR + 0.42·APR − 0.41.</p>
  <h4>Gráfico de araña (0–100)</h4><ul>
    <li><b>Firepower</b>: KPR, ADR y % de rondas con kill.</li><li><b>Entrying</b>: intentos de duelo de apertura por ronda y kills en los primeros 30 s.</li>
    <li><b>Trading</b>: trade kills por ronda (venganza en ≤5 s) y % de tus muertes tradeadas.</li><li><b>Opening</b>: % de aperturas ganadas y aperturas ganadas por ronda.</li>
    <li><b>Clutching</b>: puntos de clutch (suma de rivales batidos en 1vX ganados) por ronda.</li><li><b>Sniping</b>: kills con AWP/SSG por ronda y % de tus kills con sniper.</li>
    <li><b>Utility</b>: daño de granadas por ronda y enemigos cegados por ronda.</li></ul>
  <p>Cada eje se normaliza con rangos fijos tipo jugador profesional, así que no depende de cuántos jugadores haya cargados.</p>
  <h4>Impacto por momento de la ronda</h4><p>Modelo heurístico de probabilidad de ganar la ronda según jugadores vivos y bomba plantada. Cada kill suma el cambio de probabilidad a su autor y cada muerte lo resta a su víctima. Las fases son 0–15 s, 15–30 s, 30–60 s, 60–90 s, 90 s+ y post-plant.</p>
  <h4>Round swing (estilo HLTV)</h4><p>Cambio en la probabilidad de ganar la ronda provocado por cada jugador, en puntos porcentuales por ronda. Cada kill suma la probabilidad que mueve (más si tu equipo iba en desventaja numérica) y cada muerte la resta. Como en HLTV, las kills solo cuentan si tu equipo gana esa ronda; las muertes siempre penalizan. <i>Swing bruto</i> cuenta las kills también en rondas perdidas. No se incluyen daño, plant/defuse, economía ni mapa, y la probabilidad es un modelo heurístico propio (HLTV no publica el suyo), así que no es comparable en valor absoluto con el de HLTV.</p>
  <h4>% Clutch guardado</h4><p>De los clutches 1vX perdidos, porcentaje en los que el jugador seguía vivo al terminar la ronda.</p>
  <h4>Score de potencia</h4><p>0.45·rating + 0.20·KAST + 0.20·ADR + 0.15·impact, cada uno normalizado a 0–100. Cuanto menos rondas en un mapa, menos fiable.</p>
  <h4>Equipos unificados</h4><p>Si dos nombres de clan comparten 3 o más jugadores en partidas distintas (por ejemplo el mismo equipo jugando con otro nombre o con suplentes), se agrupan bajo el nombre con más rondas. El nombre original de cada partida se muestra entre paréntesis.</p>
  <h4>Métricas de supervivencia y utilidad</h4><ul>
    <li><b>Vida perdida</b>: HP que pierdes por ronda (100 si mueres), medido en tu última muestra de vida.</li>
    <li><b>Tiempo de vida</b>: segundos vivo hasta tu muerte o el final de la ronda.</li>
    <li><b>Kills a cegados / muertes cegado</b>: el rival o tú estabais cegados por una flash en la muestra de posición previa a la muerte (hasta 0,6 s antes).</li>
    <li><b>Eficiencia flash</b>: enemigos cegados por flash lanzada. Las granadas lanzadas se cuentan desde las trayectorias de la demo.</li></ul>
  <h4>Economía, sitios y pool de mapas</h4><p>Economía: eco &lt; $1.500 de media de equipo, force &lt; $3.500, full el resto. El sitio de plant se deduce de en qué zona «Bombsite» estaban los T al plantar, y la posición de la bomba es la media de esos jugadores (aproximada). La recomendación de pick/ban se basa solo en el % de rondas ganadas y es poco fiable con pocas rondas por mapa.</p>
  <h4>Limitaciones</h4><p>Las kills se reconstruyen de los contadores por tick. Las asistencias por flash no se distinguen de las normales y el arma de una kill es el arma activa del jugador en ese tick.</p>`;

/* ---------------- arranque ---------------- */
(async function init() {
  try { if (!sessionStorage.getItem("deichal-support")) openSupport(); } catch { openSupport(); }
  try { await refreshCatalog(); } catch (e) { $("#view").innerHTML = empty("No se pudo conectar con el servidor", esc(e.message)); return; }
  if (!catalog.matches.length) state.tab = "demos";
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  updateHud(); renderFilters(); render();
})();
