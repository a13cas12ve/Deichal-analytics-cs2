/* Deichal Analytics — mapa de utilidad: dónde caen humos, flashes, molotovs y HEs. Depende de app.js y replay.js. */
const UTIL_KINDS = [["smoke", "Humos"], ["flash", "Flashes"], ["molotov", "Molotovs"], ["he", "HEs"]];
const utilBg = {};

async function utilBackground(map) {
  if (!utilBg[map]) {
    const hm = await api(`/api/heatmap?map=${map}&kind=pos&side=all`);
    const c = document.createElement("canvas");
    await drawHeat(c, { ...hm, heat: hm.heat.map((r) => r.map(() => 0)) }, { labels: false, kind: "pos" });
    utilBg[map] = c;
  }
  return utilBg[map];
}

function drawUtility(canvas, bg, data, st) {
  const W = 900, c = canvas.getContext("2d"), v = data.view, sc = W / (v.maxx - v.minx);
  canvas.width = canvas.height = W;
  const X = (x) => (x - v.minx) * sc, Y = (y) => (v.maxy - y) * sc;
  c.drawImage(bg, 0, 0, W, W);
  c.lineCap = "round";
  const pts = data.points.filter((p) => st.kinds[p.k]);
  if (st.lines) {
    pts.forEach((p) => { c.strokeStyle = GCOL[p.k]; c.globalAlpha = 0.2; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(p.x0), Y(p.y0)); c.lineTo(X(p.x), Y(p.y)); c.stroke(); });
    c.globalAlpha = 1;
  }
  const circle = (p, r, fill, stroke) => { c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = 1.6; c.beginPath(); c.arc(X(p.x), Y(p.y), r, 0, 7); c.fill(); c.stroke(); };
  pts.filter((p) => p.k === "smoke").forEach((p) => circle(p, 144 * sc, "rgba(200,210,235,.13)", "rgba(220,228,248,.45)"));
  pts.filter((p) => p.k === "molotov").forEach((p) => circle(p, 115 * sc, "rgba(255,110,20,.16)", "rgba(255,150,50,.6)"));
  pts.filter((p) => p.k === "he").forEach((p) => circle(p, 6, "rgba(255,77,77,.9)", "#fff"));
  pts.filter((p) => p.k === "flash").forEach((p) => circle(p, 5, "rgba(255,255,255,.95)", "#7aa5ff"));
}

async function mountUtilityMap(slot, opts) {
  if (!slot || !opts.maps.length) return;
  const st = { map: opts.maps.includes(state.utilMap) ? state.utilMap : opts.maps[0], side: state.side, kinds: { smoke: true, flash: true, molotov: true, he: true }, lines: true };
  slot.innerHTML = `<div class="card"><h3>Mapa de utilidad <small id="u-n"></small></h3>
    <div class="heat-wrap"><canvas class="heat" id="u-canvas"></canvas><div class="hcontrols">
      <div class="row"><span>Mapa</span><div class="chips" id="u-map">${opts.maps.map((m) => `<button class="chip" data-v="${m}">${mapName(m)}</button>`).join("")}</div></div>
      <div class="row"><span>Bando</span><div class="seg" id="u-side"><button data-v="all">Ambos</button><button data-v="T" class="t">T</button><button data-v="CT" class="ct">CT</button></div></div>
      <div class="row"><span>Tipo</span><div class="toggles" id="u-kinds" style="margin:0">${UTIL_KINDS.map(([k, l]) => `<button class="toggle" data-k="${k}" style="border-color:${GCOL[k]}55">${l}</button>`).join("")}</div></div>
      <div class="row"><span>Líneas</span><button class="toggle" id="u-lines">Origen → impacto</button></div>
      <div id="u-counts" class="legend"></div>
      <p class="note">Cada marca es una granada lanzada en el mapa (el círculo del humo y del molotov tiene su radio real aproximado). Útil para ver lineups repetidos y huecos de utilidad.</p>
    </div></div></div>`;
  const paint = async () => {
    $$("#u-map .chip", slot).forEach((b) => b.classList.toggle("active", b.dataset.v === st.map));
    $$("#u-side button", slot).forEach((b) => b.classList.toggle("active", b.dataset.v === st.side));
    $$("#u-kinds .toggle", slot).forEach((b) => b.classList.toggle("on", st.kinds[b.dataset.k]));
    $("#u-lines", slot).classList.toggle("on", st.lines);
    const q = new URLSearchParams({ map: st.map, side: st.side, matches: state.matches.join(",") });
    if (opts.steamid) q.set("steamid", opts.steamid);
    if (opts.team) q.set("team", opts.team);
    const [data, bg] = await Promise.all([api(`/api/utility?${q}`), utilBackground(st.map)]);
    if (!document.body.contains(slot)) return;
    drawUtility($("#u-canvas", slot), bg, data, st);
    $("#u-n", slot).textContent = `${mapName(st.map)} · ${data.n || 0} granadas`;
    $("#u-counts", slot).innerHTML = UTIL_KINDS.map(([k, l]) => `<span><i style="background:${GCOL[k]}"></i>${l} ${data.counts?.[k] || 0}</span>`).join("");
  };
  $$("#u-map .chip", slot).forEach((b) => (b.onclick = () => { st.map = b.dataset.v; state.utilMap = st.map; save(); paint(); }));
  $$("#u-side button", slot).forEach((b) => (b.onclick = () => { st.side = b.dataset.v; paint(); }));
  $$("#u-kinds .toggle", slot).forEach((b) => (b.onclick = () => { st.kinds[b.dataset.k] = !st.kinds[b.dataset.k]; paint(); }));
  $("#u-lines", slot).onclick = () => { st.lines = !st.lines; paint(); };
  paint();
}
