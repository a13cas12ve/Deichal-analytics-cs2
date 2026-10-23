/* Deichal Analytics — pestaña Partidas: resumen completo de una demo. Depende de app.js. */
const TEAM_COL = ["#ffb04d", "#7aa5ff"];
const REASON_ICON = { 1: "💣", 7: "✂️", 8: "☠", 9: "☠", 12: "⏱" };

function openInReplay(mid, rn) {
  rp.matchId = mid; state.rpMatch = mid; rp.round = rn; state.rpRound = rn; save();
  setTab("replay");
}

async function renderMatches() {
  const view = $("#view");
  if (!catalog.matches.length) { view.innerHTML = noData(); return; }
  if (!catalog.matches.some((m) => m.id === state.mMatch)) state.mMatch = catalog.matches[0].id;
  const d = await api(`/api/match/${state.mMatch}/summary`);
  if (state.tab !== "matches") return;
  const m = d.match, [A, B] = m.teams, col = { [A]: TEAM_COL[0], [B]: TEAM_COL[1] };
  const sel = `<label>Partida <select id="m-sel">${catalog.matches.map((x) => `<option value="${x.id}" ${x.id === state.mMatch ? "selected" : ""}>${mapName(x.map)} · ${x.teams.map((t) => `${esc(teamName(x, t))} ${x.score[t]}`).join(" – ")}</option>`).join("")}</select></label>`;
  const nm = (t) => esc(teamName(m, t));
  const half = (h, t) => { const v = h.teams[t]; return `<span style="color:var(--t)">${v.t_wins}</span><span class="muted">T</span> · <span style="color:var(--ct)">${v.ct_wins}</span><span class="muted">CT</span>`; };
  const ts = d.team_stats;
  const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const vs = (a, b) => `<span style="color:${TEAM_COL[0]}">${a}</span> <span class="muted">–</span> <span style="color:${TEAM_COL[1]}">${b}</span>`;

  const tiles = [
    kpi("MVP", esc(d.mvp.name), `${num(d.mvp.rating)} rating · ${d.mvp.kills}-${d.mvp.deaths}`, true),
    kpi("Rondas", d.timeline.length, `${dur(d.avg_duration)} de media`),
    kpi("Primeras kills", vs(ts[A].first_kills, ts[B].first_kills), "duelos de apertura"),
    kpi("Pistol rounds", vs(ts[A].pistol_wins, ts[B].pistol_wins), "ganadas"),
    kpi("Plants", vs(ts[A].plants, ts[B].plants), "bombas plantadas"),
    kpi("Daño de utilidad", vs(ts[A].util_dmg, ts[B].util_dmg), "HE + molotov"),
    kpi("Flashes", vs(ts[A].flashes, ts[B].flashes), "lanzadas"),
    kpi("Ronda más larga", dur(d.extremes.longest.duration), `ronda ${d.extremes.longest.round}`),
  ].join("");

  const cols = [["kills", "K"], ["deaths", "D"], ["assists", "A"], ["diff", "+/−"], ["adr", "ADR"], ["kast", "KAST"], ["rating", "Rating*"], ["swing", "Swing"], ["fk", "1ªK–D"], ["hs", "HS%"], ["cl", "Clutch"], ["util", "Util/r"], ["flashed", "Cegados"], ["k3", "3K+"]];
  const cell = (p, k) => k === "fk" ? `${p.ok}–${p.od}` : k === "cl" ? `${p.cl_won}/${p.cl_n}` : k === "adr" ? num(p.adr, 1) : k === "kast" || k === "hs" ? pct(p[k]) : k === "rating" ? `<b class="${ratingCls(p.rating)}">${num(p.rating)}</b>` : k === "swing" ? signed(p.swing) : k === "diff" ? signed(p.diff, 0) : k === "util" ? num(p.util, 1) : k === "flashed" ? Math.round(p.flashed) : p[k];
  const board = (t) => `<div class="card"><h3><span style="color:${col[t]}">${nm(t)}</span> <small>${ts[t].score} rondas · ${ts[t].kills}-${ts[t].deaths}</small></h3><div class="tscroll"><table><tr><th>Jugador</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr>${d.board[t].map((p) =>
    `<tr><td><a href="#" class="plink" data-sid="${p.steamid}" style="color:var(--text)">${esc(p.name)}</a>${p.name === d.mvp.name ? ' <span class="tag">MVP</span>' : ""}</td>${cols.map(([k]) => `<td>${cell(p, k)}</td>`).join("")}</tr>`).join("")}</table></div></div>`;

  // economía
  const n = d.timeline.length, step = 34, padL = 54, W = Math.max(660, n * step + padL + 20), H = 270, padT = 14, padB = 44;
  const maxE = Math.max(...Object.values(d.economy).flat().map((e) => e.equip), 1000) * 1.08, yy = (v) => padT + (H - padT - padB) * (1 - v / maxE);
  let eg = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${padL}" x2="${W - 10}" y1="${yy(maxE * f)}" y2="${yy(maxE * f)}" stroke="#1b2133"/><text x="${padL - 8}" y="${yy(maxE * f) + 4}" text-anchor="end" fill="#9aa4bd" font-size="12">$${Math.round((maxE * f) / 100) / 10}k</text>`).join("");
  if (d.swap_round) { const x = padL + (d.swap_round - 1) * step - step / 2 + step / 2; eg += `<line x1="${x - step / 2}" x2="${x - step / 2}" y1="${padT}" y2="${H - padB}" stroke="#ff8a1f" stroke-dasharray="4 4" opacity=".6"/><text x="${x - step / 2 + 6}" y="${padT + 10}" fill="#ffb04d" font-size="12">cambio de lado</text>`; }
  [A, B].forEach((t, ti) => {
    const pts = d.economy[t].map((e, i) => [padL + i * step, yy(e.equip)]);
    eg += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${TEAM_COL[ti]}" stroke-width="2.4" opacity=".9"/>`;
    d.economy[t].forEach((e, i) => { eg += `<g data-tip="<b>${nm(t)}</b> · ronda ${e.round}<br>Equipo: $${Math.round(e.equip)} (${esc(e.buy)})<br>${e.won ? "Ronda ganada" : "Ronda perdida"}"><circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5.5" fill="${e.won ? TEAM_COL[ti] : "#090b11"}" stroke="${TEAM_COL[ti]}" stroke-width="2"/></g>`; });
  });
  d.timeline.forEach((r, i) => { eg += `<text x="${padL + i * step}" y="${H - 22}" text-anchor="middle" fill="#cfd8f7" font-size="13" font-weight="700">${r.round}</text><rect x="${padL + i * step - 4}" y="${H - 14}" width="8" height="5" fill="${col[r.winner_team] || "#888"}"/>`; });
  const econ = `<div class="tscroll"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Economía por ronda">${eg}</svg></div>
    <div class="legend"><span><i style="background:${TEAM_COL[0]}"></i>${nm(A)}</span><span><i style="background:${TEAM_COL[1]}"></i>${nm(B)}</span><span>● relleno = ronda ganada · ○ hueco = perdida · la barra inferior marca el ganador</span></div>`;

  // línea de rondas
  const cells = d.timeline.map((r) => `<button class="rcell ${r.winner_side === 2 ? "t" : "ct"}" data-r="${r.round}" data-tip="<b>Ronda ${r.round}</b> · ${esc(r.winner_team)}<br>${esc(r.reason)}${r.site ? ` · plant ${r.site}` : ""}<br>${r.kills} kills · ${dur(r.duration)}${r.opening ? `<br>1ª kill: ${esc(r.opening.killer ?? "?")} → ${esc(r.opening.victim ?? "?")}` : ""}<br>Marcador: ${Object.entries(r.score).map(([t, v]) => `${esc(t)} ${v}`).join(" – ")}">
      <b>${r.round}</b><span class="ri">${REASON_ICON[r.reason_code] || "•"}</span><i style="background:${col[r.winner_team] || "#888"}"></i><small>${r.site || (r.planted ? "" : "")}</small></button>`).join("");

  const endNames = [...new Set([A, B].flatMap((t) => Object.keys(ts[t].endings)))];
  const endMax = Math.max(1, ...[A, B].flatMap((t) => Object.values(ts[t].endings)));
  const endings = endNames.map((e) => `<div class="subh">${esc(e)}</div>${[A, B].map((t, ti) => barRow(nm(t).slice(0, 12), ts[t].endings[e] || 0, endMax, ts[t].endings[e] || 0, "")).join("")}`).join("");
  const hl = (rows, fmt) => rows.length ? rows.map((r) => `<div class="ev past" data-r="${r.round}" style="opacity:1;cursor:pointer"><span class="tm">R${r.round}</span><span><span style="color:${col[r.team]}">${esc(r.name)}</span> ${fmt(r)}</span></div>`).join("") : '<span class="muted">—</span>';

  view.innerHTML = `
    <div class="pheader"><div class="nameplate match"><div class="eyebrow">Resumen de partida · ${mapName(m.map)}</div>
      <h2><span style="color:${TEAM_COL[0]}">${esc(A)}</span> ${m.score[A]} <span class="muted">–</span> ${m.score[B]} <span style="color:${TEAM_COL[1]}">${esc(B)}</span></h2>
      <div class="sub">Gana ${esc(m.winner)} · ${m.rounds} rondas${[A, B].some((t) => m.labels[t] !== t) ? ` · en la demo: ${[A, B].map((t) => esc(m.labels[t])).join(" vs ")}` : ""}</div></div>
      <div class="rp-bar" style="margin:0">${sel}</div></div>
    <div class="card"><h3>Marcador por partes</h3><div class="tscroll"><table><tr><th>Equipo</th>${d.halves.map((h) => `<th>${h.label}</th>`).join("")}<th>Final</th></tr>${[A, B].map((t, ti) =>
      `<tr><td style="color:${TEAM_COL[ti]};font-weight:700">${nm(t)}</td>${d.halves.map((h) => `<td>${half(h, t)}</td>`).join("")}<td><b>${m.score[t]}</b></td></tr>`).join("")}</table></div></div>
    <div class="kpis" style="margin-top:16px">${tiles}</div>
    <div style="margin-top:16px">${board(A)}</div><div style="margin-top:16px">${board(B)}</div>
    <div class="card" style="margin-top:16px"><h3>Economía por ronda <small>valor medio de equipo al empezar</small></h3>${econ}</div>
    <div class="card" style="margin-top:16px"><h3>Rondas <small>clic para verla en el reproductor</small></h3><div class="rcells">${cells}</div>
      <div class="legend"><span><i style="background:var(--t)"></i>gana T</span><span><i style="background:var(--ct)"></i>gana CT</span><span>💣 explota · ✂️ defuse · ☠ eliminación · ⏱ tiempo · A/B sitio del plant · punto = equipo ganador</span></div></div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card"><h3>Multikills</h3><div class="feed">${hl(d.multikills, (r) => `<b>${r.kills}K</b>`)}</div></div>
      <div class="card"><h3>Clutches ganados</h3><div class="feed">${hl(d.clutches, (r) => `<b>1v${r.vs}</b>`)}</div></div>
      <div class="card"><h3>Cómo se ganaron las rondas</h3>${endings}</div>
    </div>`;
  $("#m-sel").onchange = (e) => { state.mMatch = e.target.value; save(); renderMatches(); };
  $$(".plink").forEach((l) => (l.onclick = (e) => { e.preventDefault(); state.player = l.dataset.sid; state.team = catalog.players[l.dataset.sid]?.team || state.team; setTab("players"); }));
  $$(".rcell, #view .ev[data-r]").forEach((c) => (c.onclick = () => openInReplay(state.mMatch, +c.dataset.r)));
}
