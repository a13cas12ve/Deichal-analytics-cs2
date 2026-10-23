/* Deichal Analytics — pestaña Reproductor (replay 2D de rondas). Depende de las utilidades de app.js. */
const RP_W = 900;
const rp = { raf: 0, playing: false, speed: 1, t: 0, dur: 1, data: null, info: null, matchId: null, round: null, last: 0, sbAt: 0,
  opts: { names: true, cones: true, util: true, zones: false }, bgCache: {}, deathAt: {}, players: {}, feed: [] };
const RP_COL = { 2: "#f0b24a", 3: "#5b95ff" };
const GCOL = { smoke: "#c9d2e6", molotov: "#ff7a1a", flash: "#ffffff", he: "#ff4d4d" };
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function stopReplay() { rp.playing = false; if (rp.raf) cancelAnimationFrame(rp.raf); rp.raf = 0; if (rp.timer) clearInterval(rp.timer); rp.timer = 0; }

async function renderReplay() {
  const view = $("#view");
  if (!catalog.matches.length) { view.innerHTML = noData(); return; }
  if (!catalog.matches.some((m) => m.id === rp.matchId)) rp.matchId = catalog.matches.some((m) => m.id === state.rpMatch) ? state.rpMatch : catalog.matches[0].id;
  const info = await api(`/api/replay/${rp.matchId}`);
  if (state.tab !== "replay") return;
  rp.info = info;
  const matchSel = `<label>Partida <select id="rp-match">${catalog.matches.map((m) => `<option value="${m.id}" ${m.id === rp.matchId ? "selected" : ""}>${mapName(m.map)} · ${m.teams.map((t) => `${esc(teamName(m, t))} ${m.score[t]}`).join(" – ")}</option>`).join("")}</select></label>`;
  if (!info.has_replay) {
    view.innerHTML = `<div class="rp-bar">${matchSel}</div>${empty("Esta partida necesita reprocesarse", 'Se procesó antes de existir el reproductor y no tiene ángulos de visión ni granadas.<br><br><button class="primary" id="rp-re">Reprocesar esta demo</button>')}`;
    $("#rp-match").onchange = (e) => { rp.matchId = e.target.value; state.rpMatch = rp.matchId; save(); renderReplay(); };
    $("#rp-re").onclick = async () => { await fetch(`/api/match/${rp.matchId}/reprocess`, { method: "POST" }); setTab("demos"); };
    return;
  }
  if (!info.rounds.some((r) => r.round === rp.round)) rp.round = info.rounds[0].round;
  view.innerHTML = `
    <div class="rp-bar">${matchSel}<div class="rp-score" id="rp-score"></div></div>
    <div class="rp-rounds" id="rp-rounds">${info.rounds.map((r) => {
      const half = r.pistol && r.round > 1 ? " half" : "";
      return `<button class="rchip ${r.winner_side === 2 ? "t" : "ct"}${half}" data-r="${r.round}" data-tip="<b>Ronda ${r.round}</b> · ${esc(r.winner_team)}<br>${esc(r.reason)} · ${r.kills} kills">${r.round}</button>`;
    }).join("")}</div>
    <div class="rp-layout">
      <div>
        <div class="rp-stage"><canvas id="rp-canvas" class="rp-canvas" width="${RP_W}" height="${RP_W}"></canvas><div class="rp-clock" id="rp-clock">0:00</div></div>
        <div class="rp-controls">
          <button class="btn" id="rp-prevr" data-tip="Ronda anterior (P)">⏮</button>
          <button class="btn" id="rp-back" data-tip="−5 s (←)">⏪ 5s</button>
          <button class="primary" id="rp-play" data-tip="Reproducir / pausa (espacio)">▶</button>
          <button class="btn" id="rp-fwd" data-tip="+5 s (→)">5s ⏩</button>
          <button class="btn" id="rp-nextr" data-tip="Ronda siguiente (N)">⏭</button>
          <select id="rp-speed">${[0.25, 0.5, 1, 2, 4, 8].map((v) => `<option value="${v}" ${v === rp.speed ? "selected" : ""}>${v}×</option>`).join("")}</select>
          <span class="muted" id="rp-time" style="font-variant-numeric:tabular-nums"></span>
          <span class="rp-toggles" style="margin-left:auto">${[["names", "Nombres"], ["cones", "Visión"], ["util", "Utilidad"], ["zones", "Zonas"]].map(([k, l]) => `<button class="toggle ${rp.opts[k] ? "on" : ""}" data-opt="${k}">${l}</button>`).join("")}</span>
        </div>
        <div class="rp-timeline"><input type="range" id="rp-seek" min="0" max="100" step="0.05" value="0"><div class="rp-marks" id="rp-marks"></div></div>
      </div>
      <aside class="rp-side"><div class="card" id="rp-sb"></div><div class="card"><h4>Eventos <span>clic para saltar</span></h4><div class="feed" id="rp-feed"></div></div></aside>
    </div>`;
  $("#rp-match").onchange = (e) => { rp.matchId = e.target.value; state.rpMatch = rp.matchId; rp.round = null; save(); stopReplay(); renderReplay(); };
  $$("#rp-rounds .rchip").forEach((b) => (b.onclick = () => loadRound(+b.dataset.r)));
  $("#rp-play").onclick = togglePlay;
  $("#rp-back").onclick = () => seek(rp.t - 5);
  $("#rp-fwd").onclick = () => seek(rp.t + 5);
  $("#rp-prevr").onclick = () => stepRound(-1);
  $("#rp-nextr").onclick = () => stepRound(1);
  $("#rp-speed").onchange = (e) => { rp.speed = +e.target.value; };
  $("#rp-seek").oninput = (e) => seek(+e.target.value);
  $$("[data-opt]").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.opt; rp.opts[k] = !rp.opts[k]; b.classList.toggle("on", rp.opts[k]);
    if (k === "zones") await buildBg();
    draw(rp.t);
  }));
  rp.ctx = $("#rp-canvas").getContext("2d");
  await loadRound(rp.round);
}

function stepRound(d) {
  const list = rp.info.rounds, i = list.findIndex((r) => r.round === rp.round), n = list[i + d];
  if (n) loadRound(n.round);
}

async function buildBg() {
  const d = rp.data, key = d.map + (rp.opts.zones ? "z" : "");
  if (!rp.bgCache[key]) {
    const hm = await api(`/api/heatmap?map=${d.map}&kind=pos&side=all`);
    const c = document.createElement("canvas");
    await drawHeat(c, { ...hm, heat: hm.heat.map((r) => r.map(() => 0)) }, { labels: rp.opts.zones, kind: "pos" });
    rp.bgCache[key] = c;
  }
  rp.bg = rp.bgCache[key];
}

async function loadRound(rn) {
  stopReplay();
  rp.round = rn; state.rpRound = rn; save();
  const d = await api(`/api/replay/${rp.matchId}/${rn}`);
  if (state.tab !== "replay") return;
  rp.data = d; rp.dur = d.duration; rp.t = 0;
  rp.players = Object.fromEntries(d.players.map((p) => [p.sid, p]));
  rp.deathAt = {};
  d.kills.forEach((k) => { rp.deathAt[k.victim] = { t: k.t, x: k.vx, y: k.vy }; });
  const v = d.view; rp.sc = RP_W / (v.maxx - v.minx);
  await buildBg();
  const meta = rp.info.rounds.find((r) => r.round === rn);
  $$("#rp-rounds .rchip").forEach((b) => b.classList.toggle("active", +b.dataset.r === rn));
  $("#rp-score").innerHTML = `<span class="t">${esc(meta.t_team)} <small>(T)</small> ${meta.score_before[meta.t_team] ?? 0}</span><span class="muted">–</span><span class="ct">${meta.score_before[meta.ct_team] ?? 0} ${esc(meta.ct_team)} <small>(CT)</small></span><small>Ronda ${rn} · gana ${esc(meta.winner_team)} (${esc(meta.reason)})</small>`;
  const seekEl = $("#rp-seek"); seekEl.max = rp.dur; seekEl.value = 0;
  const side = (sid) => (rp.players[sid]?.side === 2 ? "t" : "ct");
  rp.feed = d.kills.map((k) => ({ t: k.t, kind: "k", html:
    `<span class="${k.killer ? side(k.killer) : ""}">${esc(rp.players[k.killer]?.name ?? "Mundo")}</span> <span class="w">${esc(k.weapon || "")}</span>${k.hs ? ' <span class="tag">HS</span>' : ""} <span class="${side(k.victim)}">${esc(rp.players[k.victim]?.name ?? "?")}</span>${k.opening ? ' <span class="tag">1ª</span>' : ""}${k.trade ? ' <span class="tag">trade</span>' : ""}${k.assist ? ` <span class="w">+${esc(rp.players[k.assist]?.name ?? "")}</span>` : ""}` }));
  if (d.plant_t != null) rp.feed.push({ t: d.plant_t, kind: "b", html: `💣 <b>Bomba plantada</b>${d.plant?.site ? ` · sitio ${d.plant.site}` : ""}` });
  rp.feed.push({ t: d.duration, kind: "e", html: `🏁 ${esc(d.reason)}` });
  rp.feed.sort((a, b) => a.t - b.t);
  $("#rp-feed").innerHTML = rp.feed.map((e, i) => `<div class="ev" data-i="${i}"><span class="tm">${mmss(e.t)}</span><span>${e.html}</span></div>`).join("");
  $$("#rp-feed .ev").forEach((el) => (el.onclick = () => seek(Math.max(0, rp.feed[+el.dataset.i].t - 3))));
  $("#rp-marks").innerHTML = rp.feed.map((e) => `<i class="${e.kind}" style="left:${(e.t / rp.dur) * 100}%" data-tip="${mmss(e.t)}"></i>`).join("");
  $$("#rp-marks i").forEach((el, i) => (el.onclick = () => seek(Math.max(0, rp.feed[i].t - 3))));
  $("#rp-play").textContent = "▶";
  renderFrame(true);
}

function togglePlay() {
  if (!rp.data) return;
  if (rp.playing) { stopReplay(); $("#rp-play").textContent = "▶"; return; }
  if (rp.t >= rp.dur - 0.05) rp.t = 0;
  rp.playing = true; rp.last = performance.now(); $("#rp-play").textContent = "⏸";
  // rAF para fluidez + temporizador de respaldo por si el navegador pausa rAF (pestaña/panel en segundo plano)
  const step = () => {
    if (!rp.playing) return;
    const now = performance.now();
    rp.t = Math.min(rp.dur, rp.t + ((now - rp.last) / 1000) * rp.speed); rp.last = now;
    if (rp.t >= rp.dur) { stopReplay(); $("#rp-play").textContent = "▶"; }
    renderFrame();
  };
  const loop = () => { if (!rp.playing) return; step(); if (rp.playing) rp.raf = requestAnimationFrame(loop); };
  rp.raf = requestAnimationFrame(loop);
  rp.timer = setInterval(step, 80);
}
function seek(t) { rp.t = Math.max(0, Math.min(rp.dur, t)); renderFrame(true); }

function sampleFrame(fr, t) {
  if (!fr || !fr.length) return null;
  const n = fr.length - 1;
  if (t <= fr[0][0]) return fr[0].slice(1);
  if (t >= fr[n][0]) return fr[n].slice(1);
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m][0] <= t) lo = m; else hi = m; }
  const a = fr[lo], b = fr[hi], f = (t - a[0]) / (b[0] - a[0] || 1), dy = ((b[3] - a[3] + 540) % 360) - 180;
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + dy * f, a[4], a[5], a[6], a[7], a[8]];
}

function renderFrame(force) {
  if (!rp.data || !rp.ctx) return;
  draw(rp.t);
  const seekEl = $("#rp-seek"); if (seekEl && document.activeElement !== seekEl) seekEl.value = rp.t;
  const d = rp.data;
  let clock, bomb = false;
  if (d.plant_t != null && rp.t >= d.plant_t) { clock = `💣 ${d.plant?.site || ""} ${mmss(Math.max(0, 40 - (rp.t - d.plant_t)))}`.replace("  ", " "); bomb = true; }
  else clock = mmss(Math.max(0, 115 - rp.t));
  const ck = $("#rp-clock"); if (ck && ck.textContent !== clock) { ck.textContent = clock; ck.classList.toggle("bomb", bomb); }
  const tm = $("#rp-time"); if (tm) tm.textContent = `${mmss(rp.t)} / ${mmss(rp.dur)}`;
  const now = performance.now();
  if (force || now - rp.sbAt > 120) { rp.sbAt = now; updateSide(); }
}

function updateSide() {
  const d = rp.data, t = rp.t;
  const kills = {}; d.kills.forEach((k) => { if (k.killer && k.t <= t) kills[k.killer] = (kills[k.killer] || 0) + 1; });
  const rows = { 2: [], 3: [] };
  d.players.forEach((p) => {
    const dead = rp.deathAt[p.sid] && rp.deathAt[p.sid].t <= t;
    const s = sampleFrame(d.frames[p.sid], t);
    const hp = dead ? 0 : s ? s[3] : 0;
    rows[p.side]?.push(`<div class="sb-row ${dead ? "dead" : ""}"><div class="sb-name">${esc(p.name)}<small>${dead ? "muerto" : s ? esc(d.weapons[s[5]] ?? "") + ` · $${Math.round(p.equip)}` + (s[6] ? " · flasheado" : "") : ""}</small></div><div class="hp"><i class="${hp < 35 ? "low" : ""}" style="width:${hp}%"></i></div><div class="sb-k">${kills[p.sid] || 0}</div></div>`);
  });
  const alive = (side) => d.players.filter((p) => p.side === side && !(rp.deathAt[p.sid] && rp.deathAt[p.sid].t <= t)).length;
  $("#rp-sb").innerHTML = [2, 3].map((sd) => `<h4><span style="color:${RP_COL[sd]}">${sd === 2 ? esc(d.t_team) + " · T" : esc(d.ct_team) + " · CT"}</span><span>${alive(sd)} vivos</span></h4>${rows[sd].join("")}`).join('<div style="height:10px"></div>');
  $$("#rp-feed .ev").forEach((el, i) => el.classList.toggle("past", rp.feed[i].t <= t));
}

function draw(t) {
  const c = rp.ctx, d = rp.data, v = d.view, sc = rp.sc;
  const X = (x) => (x - v.minx) * sc, Y = (y) => (v.maxy - y) * sc;
  c.clearRect(0, 0, RP_W, RP_W);
  c.drawImage(rp.bg, 0, 0, RP_W, RP_W);
  c.lineCap = "round"; c.lineJoin = "round";
  // --- utilidad
  if (rp.opts.util) {
    const pops = [];
    d.grenades.forEach((g) => {
      const col = GCOL[g.kind], p0 = g.path[0];
      if (t < p0[0]) return;
      if (t < g.t_det) { // en vuelo
        const pts = g.path.filter((p) => p[0] <= t), last = pts[pts.length - 1], nxt = g.path[pts.length] || last;
        const f = (t - last[0]) / (nxt[0] - last[0] || 1), cx = last[1] + (nxt[1] - last[1]) * f, cy = last[2] + (nxt[2] - last[2]) * f;
        c.strokeStyle = col; c.globalAlpha = 0.5; c.lineWidth = 2; c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(X(p[1]), Y(p[2])) : c.moveTo(X(p[1]), Y(p[2]))));
        c.lineTo(X(cx), Y(cy)); c.stroke();
        c.globalAlpha = 1; c.fillStyle = col; c.beginPath(); c.arc(X(cx), Y(cy), 4.5, 0, 7); c.fill();
        return;
      }
      if (t > g.t_end) return;
      const age = t - g.t_det, x = X(g.x), y = Y(g.y), left = g.t_end - t;
      if (g.kind === "smoke") {
        const r = 144 * sc * Math.min(1, 0.3 + age / 0.9), a = 0.62 * Math.min(1, left / 2);
        const gr = c.createRadialGradient(x, y, r * 0.2, x, y, r);
        gr.addColorStop(0, `rgba(205,214,232,${a})`); gr.addColorStop(1, `rgba(170,182,210,${a * 0.75})`);
        c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
        c.strokeStyle = `rgba(230,236,250,${a})`; c.lineWidth = 1.5; c.stroke();
      } else if (g.kind === "molotov") {
        const r = 115 * sc * Math.min(1, 0.4 + age / 0.6), a = 0.42 * Math.min(1, left / 1.5) * (0.85 + 0.15 * Math.sin(t * 14));
        c.fillStyle = `rgba(255,110,20,${a})`; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
        c.strokeStyle = `rgba(255,170,60,${Math.min(1, a + 0.2)})`; c.lineWidth = 2; c.stroke();
      } else pops.push({ g, age, x, y });
    });
    pops.forEach(({ g, age, x, y }) => {
      const f = age / 0.6, a = 1 - f;
      if (g.kind === "flash") { c.fillStyle = `rgba(255,255,255,${0.7 * a})`; c.beginPath(); c.arc(x, y, 10 + 55 * f, 0, 7); c.fill(); }
      else {
        c.strokeStyle = `rgba(255,80,80,${a})`; c.lineWidth = 4 * a + 1; c.beginPath(); c.arc(x, y, 10 + 150 * sc * f, 0, 7); c.stroke();
        c.fillStyle = `rgba(255,120,60,${0.35 * a})`; c.fill();
      }
    });
  }
  // --- bomba (posición aproximada: dónde estaban los T al plantar)
  if (d.plant && d.plant.x != null && d.plant_t != null && t >= d.plant_t) {
    const bx = X(d.plant.x), by = Y(d.plant.y), age = t - d.plant_t, pulse = 0.5 + 0.5 * Math.sin(age * 6);
    const exploded = d.reason_code === 1 && t >= d.plant_t + 40, defused = d.reason_code === 7 && t >= d.duration - 0.4;
    if (exploded) {
      const f = Math.min(1, (t - d.plant_t - 40) / 0.9);
      c.strokeStyle = `rgba(255,120,40,${1 - f * 0.6})`; c.lineWidth = 5; c.beginPath(); c.arc(bx, by, 20 + 130 * f, 0, 7); c.stroke();
      c.fillStyle = `rgba(255,150,60,${0.35 * (1 - f)})`; c.fill();
    } else {
      c.strokeStyle = defused ? "rgba(56,211,159,.9)" : `rgba(255,138,31,${0.35 + 0.5 * pulse})`; c.lineWidth = 3;
      c.beginPath(); c.arc(bx, by, 14 + 8 * pulse, 0, 7); c.stroke();
    }
    c.fillStyle = defused ? "#38d39f" : "#ff8a1f"; c.strokeStyle = "#05091f"; c.lineWidth = 2.5; c.fillRect(bx - 8, by - 6, 16, 12); c.strokeRect(bx - 8, by - 6, 16, 12);
    c.fillStyle = "#05091f"; c.font = "700 12px Rajdhani, Segoe UI, sans-serif"; c.textAlign = "center"; c.fillText(d.plant.site || "C4", bx, by + 4);
    c.font = "700 15px Rajdhani, Segoe UI, sans-serif";
  }
  // --- muertes (marca permanente) y líneas de kill
  d.kills.forEach((k) => {
    if (k.t > t) return;
    const vs = rp.players[k.victim]?.side, x = X(k.vx), y = Y(k.vy);
    if (k.killer && k.kx != null && t - k.t < 1.4) {
      c.strokeStyle = RP_COL[rp.players[k.killer]?.side] || "#fff"; c.globalAlpha = 1 - (t - k.t) / 1.4; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(X(k.kx), Y(k.ky)); c.lineTo(x, y); c.stroke(); c.globalAlpha = 1;
    }
    c.strokeStyle = RP_COL[vs] || "#fff"; c.globalAlpha = 0.7; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - 6, y - 6); c.lineTo(x + 6, y + 6); c.moveTo(x + 6, y - 6); c.lineTo(x - 6, y + 6); c.stroke(); c.globalAlpha = 1;
  });
  // --- jugadores vivos
  c.font = "700 15px Rajdhani, Segoe UI, sans-serif"; c.textAlign = "center";
  d.players.forEach((p) => {
    if (rp.deathAt[p.sid] && rp.deathAt[p.sid].t <= t) return;
    const s = sampleFrame(d.frames[p.sid], t);
    if (!s) return;
    const x = X(s[0]), y = Y(s[1]), col = RP_COL[p.side], ang = (-s[2] * Math.PI) / 180;
    if (rp.opts.cones) { c.fillStyle = col; c.globalAlpha = 0.2; c.beginPath(); c.moveTo(x, y); c.arc(x, y, 46, ang - 0.52, ang + 0.52); c.closePath(); c.fill(); c.globalAlpha = 1; }
    if (s[6]) { c.fillStyle = "rgba(255,255,255,.85)"; c.beginPath(); c.arc(x, y, 15, 0, 7); c.fill(); }
    if (s[7]) { c.strokeStyle = "#38d39f"; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 15, 0, 7); c.stroke(); }
    c.fillStyle = col; c.strokeStyle = "#05091f"; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill(); c.stroke();
    c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14); c.stroke();
    if (d.weapons[s[5]] === "C4 Explosive") { c.fillStyle = "#ff6a00"; c.fillRect(x - 4, y + 11, 8, 6); }
    c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(x - 11, y + 18, 22, 3);
    c.fillStyle = s[3] < 35 ? "#ff6b6b" : "#38d39f"; c.fillRect(x - 11, y + 18, 22 * (s[3] / 100), 3);
    if (rp.opts.names) { c.lineWidth = 3.5; c.strokeStyle = "#050813"; c.strokeText(p.name, x, y - 15); c.fillStyle = "#eef2ff"; c.fillText(p.name, x, y - 15); }
  });
}

document.addEventListener("keydown", (e) => {
  if (state.tab !== "replay" || !rp.data) return;
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "range") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); seek(rp.t - (e.shiftKey ? 1 : 5)); }
  else if (e.key === "ArrowRight") { e.preventDefault(); seek(rp.t + (e.shiftKey ? 1 : 5)); }
  else if (e.key === "n" || e.key === "N") stepRound(1);
  else if (e.key === "p" || e.key === "P") stepRound(-1);
});
