"""Parser de demos CS2 -> tablas por partida (parquet) en data/matches/<id>/.

Se reconstruye todo a partir de los datos por tick (contadores de kills/muertes,
posiciones, estado de ronda) porque la lectura de eventos de algunas demos
(p. ej. FACEIT) falla con demoparser2.

Uso:  python -m parser.demo_parser demos/raw            (procesa carpeta)
      python -m parser.demo_parser demos/raw/x.dem.zst  (procesa un archivo)
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import zstandard
from demoparser2 import DemoParser

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.paths import DEMOS_DIR, MATCHES_DIR as DATA_DIR, RAW_DIR  # noqa: E402

PROPS = [
    "health", "team_num", "team_clan_name", "X", "Y", "active_weapon_name", "last_place_name",
    "kills_total", "deaths_total", "assists_total", "headshot_kills_total", "damage_total",
    "utility_damage_total", "enemies_flashed_total", "current_equip_value",
    "total_rounds_played", "round_win_status", "round_win_reason",
    "is_freeze_period", "is_warmup_period", "is_bomb_planted", "game_time",
    "yaw", "armor_value", "flash_duration", "is_defusing",
]
COUNTERS = {
    "kills_total": "d_kills", "deaths_total": "d_deaths", "assists_total": "d_assists",
    "headshot_kills_total": "d_hs", "damage_total": "d_dmg",
    "utility_damage_total": "d_util", "enemies_flashed_total": "d_flash",
}
SNIPERS = {"AWP", "SSG 08"}
SAMPLE_TICKS = 16          # una muestra de posición cada 0.25 s (64 tick)
PAIR_WINDOW = 3            # ticks de tolerancia para emparejar muerte <-> kill
REASONS = {1: "Bomba explotó", 7: "Bomba desactivada", 8: "CT eliminó a T",
           9: "T eliminó a CT", 12: "Tiempo agotado", 10: "Rescate", 11: "Rescate"}


def p_t(nt: int, nct: int, planted: bool) -> float:
    """Probabilidad heurística de que gane T según vivos y bomba (modelo de impacto)."""
    if nt <= 0 and nct <= 0:
        return 0.5
    if nct <= 0:
        return 1.0
    if nt <= 0:
        return 0.08 if planted else 0.0
    d = nt - nct
    x = 1.45 + 0.55 * d if planted else -0.25 + 0.7 * d
    return 1 / (1 + math.exp(-x))


def phase_of(t: float, planted: bool) -> str:
    if planted:
        return "Post-plant"
    if t < 15:
        return "0-15s"
    if t < 30:
        return "15-30s"
    if t < 60:
        return "30-60s"
    if t < 90:
        return "60-90s"
    return "90s+"


def decompress(src: Path, dst_dir: Path) -> Path:
    dst = dst_dir / src.name[:-4]
    with open(src, "rb") as f, open(dst, "wb") as o:
        shutil.copyfileobj(zstandard.ZstdDecompressor().stream_reader(f, read_across_frames=True), o, 1 << 24)
    return dst


def match_id_for(path: Path) -> str:
    return hashlib.sha1(path.name.replace(".zst", "").encode()).hexdigest()[:10]


def parse_demo(path: str | Path, out_root: Path = DATA_DIR, progress=None, force: bool = False) -> dict:
    path = Path(path)
    say = progress or (lambda msg, pct=None: None)
    mid = match_id_for(path)
    out = out_root / mid
    if (out / "meta.json").exists() and not force:
        return json.loads((out / "meta.json").read_text(encoding="utf-8"))

    tmpdir = None
    dem = path
    try:
        if path.suffix == ".zst":
            say("Descomprimiendo demo…", 5)
            tmpdir = Path(tempfile.mkdtemp(prefix="dem_", dir=DEMOS_DIR))
            dem = decompress(path, tmpdir)
        say("Leyendo ticks…", 20)
        parser = DemoParser(str(dem))
        map_name = parser.parse_header().get("map_name", "unknown")
        df = parser.parse_ticks(PROPS)
        try:
            gren = parser.parse_grenades()
        except Exception:  # noqa: BLE001
            gren = None
    finally:
        pass

    try:
        say("Reconstruyendo rondas…", 45)
        result = _build(df, map_name, mid, path, gren)
        say("Guardando…", 90)
        out.mkdir(parents=True, exist_ok=True)
        for name in ("rounds", "pr", "kills", "pos", "grenades"):
            result[name].to_parquet(out / f"{name}.parquet", index=False)
        (out / "meta.json").write_text(json.dumps(result["meta"], ensure_ascii=False), encoding="utf-8")
        say("Listo", 100)
        return result["meta"]
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


GREN_KINDS = {"CSmokeGrenadeProjectile": "smoke", "CMolotovProjectile": "molotov",
              "CHEGrenadeProjectile": "he", "CFlashbangProjectile": "flash"}
FIRE_SECONDS, SMOKE_SECONDS, HE_FUSE = 7.0, 18.0, 1.6


def grenade_segments(g, gt, gts, tickrate: int) -> list[dict]:
    """Un registro por granada lanzada: trayectoria, instante de detonación y duración del efecto."""
    if g is None or g.empty:
        return []
    g = g[g.grenade_type.isin(GREN_KINDS) & g.x.notna()].sort_values(["grenade_entity_id", "tick"])
    out = []
    for _, grp in g.groupby("grenade_entity_id"):
        ticks = grp.tick.values
        xs, ys, sid = grp.x.values, grp.y.values, int(grp.steamid.iloc[0])
        kind = GREN_KINDS[grp.grenade_type.iloc[0]]
        cuts = np.r_[0, np.where(np.diff(ticks) > 4)[0] + 1, len(ticks)]
        for a, b in zip(cuts[:-1], cuts[1:]):
            tk_, x_, y_ = ticks[a:b], xs[a:b], ys[a:b]
            if len(tk_) < 8:
                continue
            end = len(tk_) - 1
            if kind == "he":
                det = min(end, int(HE_FUSE * tickrate))
            elif kind == "smoke":
                step = np.hypot(np.diff(x_), np.diff(y_))
                still = np.where((step[3:] < 0.5))[0]
                det = int(still[0] + 3) if len(still) else end
            else:
                det = end
            t_end_tick = tk_[end] if kind in ("flash", "he") else tk_[det]
            idx = np.unique(np.r_[np.arange(0, det + 1, 4), det])
            path = [[float(np.interp(tk_[i], gt, gts)), round(float(x_[i]), 1), round(float(y_[i]), 1)] for i in idx]
            t_det = float(np.interp(tk_[det], gt, gts))
            life = {"smoke": SMOKE_SECONDS, "molotov": FIRE_SECONDS, "flash": 0.6, "he": 0.6}[kind]
            t_last = float(np.interp(tk_[end], gt, gts)) if kind == "smoke" else t_det + life
            out.append(dict(kind=kind, steamid=sid, tick0=int(tk_[0]), path=path, t_det=t_det,
                            x=round(float(x_[det]), 1), y=round(float(y_[det]), 1),
                            t_end=min(t_det + life, t_last) if kind == "smoke" else t_det + life))
    return out


def _build(df: pd.DataFrame, map_name: str, mid: str, path: Path, gren=None) -> dict:
    df = df[df.team_num.isin([2, 3])].copy()
    df["team_clan_name"] = df["team_clan_name"].fillna("")
    df["active_weapon_name"] = df["active_weapon_name"].fillna("")
    df["last_place_name"] = df["last_place_name"].fillna("")
    for bool_col in ("is_freeze_period", "is_warmup_period", "is_bomb_planted"):
        df[bool_col] = df[bool_col].fillna(False).astype(bool)

    df = df.sort_values(["steamid", "tick"]).reset_index(drop=True)
    for src, dst in COUNTERS.items():
        df[dst] = df.groupby("steamid")[src].diff().fillna(0).astype(float)
    df = df.sort_values(["tick", "steamid"]).reset_index(drop=True)
    tk = df["tick"].values

    g = df.drop_duplicates("tick").set_index("tick").sort_index()
    gt = g.index.values
    tr = g["total_rounds_played"].fillna(0).values.astype(int)
    drops = np.where(np.diff(tr) < 0)[0]
    start_idx = int(drops[-1] + 1) if len(drops) else 0
    live = (~g["is_freeze_period"].values) & (~g["is_warmup_period"].values)
    live[:start_idx] = False

    # tickrate estimado
    gts = g["game_time"].values
    seg_mask = live & np.r_[live[1:], False]
    dt = np.diff(gts)[seg_mask[:-1]]
    dtick = np.diff(gt)[seg_mask[:-1]]
    ok = dt > 0
    tickrate = int(round(float(np.median(dtick[ok] / dt[ok])))) if ok.any() else 64
    tickrate = 128 if tickrate > 90 else 64
    trade_window = 5 * tickrate

    # segmentos live
    seg_id = np.cumsum(np.r_[True, live[1:] != live[:-1]])
    segments = []
    for sid in np.unique(seg_id[live]):
        idx = np.where((seg_id == sid) & live)[0]
        i0, i1 = idx[0], idx[-1]
        tr0 = tr[i0]
        lookahead = min(i1 + 5 * 64, len(tr) - 1)
        changed = np.where(tr[i0:lookahead + 1] != tr0)[0]
        if not len(changed):
            continue  # ronda sin terminar (reinicio / fin de partida)
        ie = i0 + changed[0]
        segments.append((int(tr0) + 1, int(gt[i0]), int(gt[ie]), i0, ie, i1))
    rounds_seg = {}
    for rn, s, e, i0, ie, i1 in segments:  # la última con el mismo nº sobrescribe (reinicios)
        rounds_seg[rn] = (s, e, i0, ie, i1)

    rounds_rows, pr_rows, kill_rows, pos_rows = [], [], [], []
    swap_round = None
    first_t_team = None
    player_names: dict[int, str] = {}
    clan_votes: dict[int, Counter] = {}

    # --- pasada 1: equipo (clan) por jugador
    cum_start: dict[int, dict[int, tuple]] = {}
    active: set[int] = set()
    for rn, (s, e, i0, ie, i1) in sorted(rounds_seg.items()):
        a, b = np.searchsorted(tk, s, "left"), np.searchsorted(tk, s, "right")
        cum_start[rn] = {}
        for r in df.iloc[a:b].itertuples():
            cum_start[rn][int(r.steamid)] = (r.damage_total, r.utility_damage_total, r.enemies_flashed_total)
            if r.health > 0:
                active.add(int(r.steamid))
            player_names[r.steamid] = r.name
            if r.team_clan_name:
                clan_votes.setdefault(r.steamid, Counter())[r.team_clan_name] += 1
    player_names = {k: v for k, v in player_names.items() if k in active}
    last_rows = df[df.tick == tk[-1]]
    cum_final = {int(r.steamid): (r.damage_total, r.utility_damage_total, r.enemies_flashed_total)
                 for r in last_rows.itertuples()}
    first_round = min(rounds_seg) if rounds_seg else 1
    s0 = rounds_seg[first_round][0]
    a, b = np.searchsorted(tk, s0, "left"), np.searchsorted(tk, s0, "right")
    first_side = {r.steamid: int(r.team_num) for r in df.iloc[a:b].itertuples()}

    group_name = {}
    for gid in (2, 3):
        members = [sid for sid, sd in first_side.items() if sd == gid]
        votes = Counter()
        for sid in members:
            votes.update(clan_votes.get(sid, {}))
        group_name[gid] = votes.most_common(1)[0][0] if votes else ("Equipo A" if gid == 2 else "Equipo B")
    if group_name[2] == group_name[3]:
        group_name = {2: "Equipo A", 3: "Equipo B"}
    team_of: dict[int, str] = {}
    for sid, sd in first_side.items():
        team_of[sid] = group_name[sd]
    # jugadores que no estaban en la 1ª ronda: por clan, o por la ronda en que aparecen
    for sid in player_names:
        if sid in team_of:
            continue
        top = clan_votes.get(sid, Counter()).most_common(1)
        team_of[sid] = top[0][0] if top and top[0][0] in group_name.values() else group_name[2]

    # --- pasada 2: rondas
    for rn, (s, e, i0, ie, i1) in sorted(rounds_seg.items()):
        a, b = np.searchsorted(tk, s, "left"), np.searchsorted(tk, e, "right")
        sub = df.iloc[a:b]
        start = sub[sub.tick == s]
        t0 = float(start.game_time.iloc[0])
        sides = {int(r.steamid): int(r.team_num) for r in start.itertuples() if int(r.steamid) in active}
        alive0 = {sid for sid, h in zip(start.steamid, start.health) if h > 0}
        equip = {int(r.steamid): float(r.current_equip_value or 0) for r in start.itertuples()}
        t_team = Counter(team_of[x] for x, sd in sides.items() if sd == 2).most_common(1)[0][0]
        ct_team = Counter(team_of[x] for x, sd in sides.items() if sd == 3).most_common(1)[0][0]
        if first_t_team is None:
            first_t_team = t_team
        if swap_round is None and t_team != first_t_team:
            swap_round = rn

        # ganador
        wi = np.searchsorted(gt, e, "left")
        win_slice = slice(wi, wi + tickrate)
        status = int(np.max(g["round_win_status"].values[win_slice])) if len(gt[win_slice]) else 0
        reason = int(np.max(g["round_win_reason"].values[win_slice])) if len(gt[win_slice]) else 0
        if status not in (2, 3):
            status = 0
        win_side = status
        win_team = t_team if win_side == 2 else ct_team if win_side == 3 else ""
        planted_rows = sub[sub.is_bomb_planted]
        plant_tick = int(planted_rows.tick.min()) if len(planted_rows) else None
        plant_t = round((float(sub[sub.tick == plant_tick].game_time.iloc[0]) - t0), 1) if plant_tick else None

        # eventos
        deaths = sub[sub.d_deaths > 0]
        kev = sub[sub.d_kills > 0]
        tkev = sub[sub.d_kills < 0]
        aev = sub[sub.d_assists > 0]
        kev_l = [dict(tick=int(r.tick), sid=int(r.steamid), side=int(r.team_num), w=r.active_weapon_name,
                      hs=r.d_hs > 0, x=r.X, y=r.Y, used=False) for r in kev.itertuples()]
        tk_l = [dict(tick=int(r.tick), sid=int(r.steamid), side=int(r.team_num), used=False) for r in tkev.itertuples()]
        as_l = [dict(tick=int(r.tick), sid=int(r.steamid), side=int(r.team_num), used=False) for r in aev.itertuples()]

        alive = {2: {x for x in alive0 if sides.get(x) == 2}, 3: {x for x in alive0 if sides.get(x) == 3}}
        dead_set = set()
        events = []
        clutches = {}
        for r in deaths.itertuples():
            vic, vside, dtick = int(r.steamid), int(r.team_num), int(r.tick)
            killer = None
            best = None
            for k in kev_l:
                if not k["used"] and k["side"] != vside and abs(k["tick"] - dtick) <= PAIR_WINDOW:
                    if best is None or abs(k["tick"] - dtick) < abs(best["tick"] - dtick):
                        best = k
            teamkill = False
            if best is not None:
                best["used"] = True
                killer = best
            else:
                for k in tk_l:
                    if not k["used"] and k["side"] == vside and abs(k["tick"] - dtick) <= PAIR_WINDOW:
                        k["used"] = True
                        teamkill = True
                        break
            assister = None
            if killer is not None:
                for ass in as_l:
                    if not ass["used"] and ass["side"] == killer["side"] and abs(ass["tick"] - dtick) <= PAIR_WINDOW:
                        ass["used"] = True
                        assister = ass["sid"]
                        break
            t = (float(r.game_time) - t0)
            planted = plant_tick is not None and dtick >= plant_tick
            nt, nct = len(alive[2]), len(alive[3])
            pb = p_t(nt, nct, planted)
            alive[vside].discard(vic)
            dead_set.add(vic)
            pa = p_t(len(alive[2]), len(alive[3]), planted)
            delta = (pa - pb) if (killer and killer["side"] == 2) or (not killer and vside == 3) else (pb - pa)
            delta = abs(delta)
            ev = dict(tick=dtick, t=round(t, 1), victim=vic, vside=vside, vx=r.X, vy=r.Y, place=r.last_place_name,
                      killer=killer["sid"] if killer else None, kside=killer["side"] if killer else None,
                      weapon=killer["w"] if killer else "", hs=killer["hs"] if killer else False,
                      kx=killer["x"] if killer else None, ky=killer["y"] if killer else None,
                      assist=assister, teamkill=teamkill, planted=planted, phase=phase_of(t, planted),
                      nt=nt, nct=nct, wpa=round(delta, 4))
            events.append(ev)
            # clutch: un equipo queda con 1 vivo contra >=1
            for side_, other in ((2, 3), (3, 2)):
                if len(alive[side_]) == 1 and len(alive[other]) >= 1:
                    sid = next(iter(alive[side_]))
                    if sid not in clutches:
                        clutches[sid] = dict(vs=len(alive[other]), tick=dtick)

        # trades y apertura
        dmap = {ev["victim"]: ev for ev in events}
        opening = next((ev for ev in events if ev["killer"] is not None), None)
        for ev in events:
            ev["trade"] = False   # esta kill es un trade
            ev["traded"] = False  # esta muerte fue vengada
            ev["opening"] = ev is opening
        for ev in events:
            if ev["killer"] is None:
                continue
            krec = dmap.get(ev["killer"])
            if krec and krec["killer"] is not None and krec["kside"] == ev["vside"] \
                    and 0 < krec["tick"] - ev["tick"] <= trade_window:
                ev["traded"] = True
                krec["trade"] = True

        # posiciones muestreadas
        samp = sub[((sub.tick - s) % SAMPLE_TICKS == 0) & (sub.health > 0) & (sub.tick <= gt[i1])]
        awp_rounds = set(samp[samp.active_weapon_name.isin(SNIPERS)].steamid)
        for r in samp.itertuples():
            pos_rows.append((mid, rn, int(r.steamid), int(r.team_num), round(float(r.X), 1), round(float(r.Y), 1),
                             round(float(r.game_time) - t0, 2), r.last_place_name, round(float(r.yaw), 1),
                             int(r.health), int(r.armor_value or 0), r.active_weapon_name,
                             bool((r.flash_duration or 0) > 0.5), bool(r.is_defusing)))

        # tabla jugador-ronda
        nxt = cum_start.get(rn + 1, cum_final)

        def cdiff(sid, k):
            a_, b_ = cum_start[rn].get(sid), nxt.get(sid)
            return float(max((b_[k] or 0) - (a_[k] or 0), 0)) if a_ and b_ else 0.0
        buy_equip = [equip.get(x, 0) for x in sides if sides[x] == 2]
        for sid, side in sides.items():
            my_k = [ev for ev in events if ev["killer"] == sid]
            my_d = next((ev for ev in events if ev["victim"] == sid), None)
            kills = len(my_k)
            asts = sum(1 for ev in events if ev["assist"] == sid)
            trade_kills = sum(1 for ev in my_k if ev["trade"])
            traded = bool(my_d and my_d["traded"])
            survived = sid not in dead_set
            cl = clutches.get(sid)
            won_round = win_side == side
            pr_rows.append(dict(
                match_id=mid, round=rn, steamid=sid, name=player_names.get(sid, str(sid)), team=team_of.get(sid, ""),
                side=side, kills=kills, hs=sum(1 for ev in my_k if ev["hs"]), deaths=0 if survived else 1,
                assists=asts, damage=cdiff(sid, 0), util_damage=cdiff(sid, 1),
                flashed=cdiff(sid, 2), survived=survived,
                kast=bool(kills or asts or survived or traded),
                opening_kill=bool(opening and opening["killer"] == sid),
                opening_death=bool(opening and opening["victim"] == sid),
                trade_kills=trade_kills, traded_death=traded,
                sniper_kills=sum(1 for ev in my_k if ev["weapon"] in SNIPERS),
                early_kills=sum(1 for ev in my_k if ev["t"] <= 30),
                clutch_vs=cl["vs"] if cl else 0, clutch_won=bool(cl and won_round),
                clutch_saved=bool(cl and not won_round and survived),
                awp_round=sid in awp_rounds, equip=equip.get(sid, 0.0), won_round=won_round,
                impact_kill=float(sum(ev["wpa"] for ev in my_k)),
                impact_death=float(my_d["wpa"]) if my_d else 0.0,
            ))
        for ev in events:
            kill_rows.append(dict(
                match_id=mid, round=rn, tick=ev["tick"], t=ev["t"], killer=ev["killer"], victim=ev["victim"],
                killer_side=ev["kside"], victim_side=ev["vside"], weapon=ev["weapon"], hs=bool(ev["hs"]),
                assist=ev["assist"], kx=ev["kx"], ky=ev["ky"], vx=ev["vx"], vy=ev["vy"], place=ev["place"],
                planted=ev["planted"], phase=ev["phase"], nt=ev["nt"], nct=ev["nct"], wpa=ev["wpa"],
                opening=ev["opening"], trade=ev["trade"], traded=ev["traded"], teamkill=ev["teamkill"],
            ))
        rounds_rows.append(dict(
            match_id=mid, round=rn, t_team=t_team, ct_team=ct_team, winner_side=win_side, winner_team=win_team,
            reason=reason, reason_txt=REASONS.get(reason, f"Motivo {reason}"),
            duration=round((float(gts[ie]) - t0), 1), planted=plant_tick is not None, plant_t=plant_t,
            t_equip=float(np.mean(buy_equip)) if buy_equip else 0.0,
            ct_equip=float(np.mean([equip.get(x, 0) for x in sides if sides[x] == 3])) if any(v == 3 for v in sides.values()) else 0.0,
            first_kill_side=opening["kside"] if opening else 0,
        ))

    # granadas: se asignan a la ronda en cuyo intervalo se lanzaron
    gsegs = grenade_segments(gren, gt, gts, tickrate)
    spans = sorted((s_, e_, rn_) for rn_, (s_, e_, *_r) in rounds_seg.items())
    side_by_round = {(r["round"], r["steamid"]): r["side"] for r in pr_rows}
    gr_rows = []
    for gs in gsegs:
        for s_, e_, rn_ in spans:
            if s_ <= gs["tick0"] <= e_:
                t0_ = float(np.interp(s_, gt, gts))
                path_ = [[round(t - t0_, 2), x, y] for t, x, y in gs["path"]]
                gr_rows.append(dict(match_id=mid, round=rn_, kind=gs["kind"], steamid=gs["steamid"],
                                    side=side_by_round.get((rn_, gs["steamid"]), 0), path=json.dumps(path_),
                                    t_det=round(gs["t_det"] - t0_, 2), x=gs["x"], y=gs["y"],
                                    t_end=round(gs["t_end"] - t0_, 2)))
                break
    grenades = pd.DataFrame(gr_rows, columns=["match_id", "round", "kind", "steamid", "side", "path", "t_det", "x", "y", "t_end"])

    rounds = pd.DataFrame(rounds_rows)
    if rounds.empty:
        raise RuntimeError("No se encontraron rondas válidas en la demo.")
    pistols = {int(rounds["round"].min())} | ({swap_round} if swap_round else set())
    rounds["pistol"] = rounds["round"].isin(pistols)

    def buy(eq, pist):
        if pist:
            return "pistol"
        return "eco" if eq < 1500 else "force" if eq < 3500 else "full"
    rounds["t_buy"] = [buy(e, p) for e, p in zip(rounds.t_equip, rounds.pistol)]
    rounds["ct_buy"] = [buy(e, p) for e, p in zip(rounds.ct_equip, rounds.pistol)]

    teams = sorted(set(rounds.t_team) | set(rounds.ct_team))
    score = {t: int((rounds.winner_team == t).sum()) for t in teams}
    meta = dict(
        id=mid, map=map_name, source=path.name.replace(".zst", ""), teams=teams, score=score,
        rounds=int(len(rounds)), tickrate=tickrate, version=2, mtime=int(path.stat().st_mtime),
        winner=max(score, key=score.get) if score else "",
        players=[dict(steamid=str(s), name=player_names[s], team=team_of[s]) for s in player_names
                 if any(r["steamid"] == s for r in pr_rows)],
    )
    pos = pd.DataFrame(pos_rows, columns=["match_id", "round", "steamid", "side", "x", "y", "t", "place",
                                          "yaw", "hp", "armor", "weapon", "flash", "defusing"])
    kills = pd.DataFrame(kill_rows).drop(columns=["killer", "assist"])
    # Int64 nulable: un float64 pierde precisión con SteamID de 17 dígitos
    kills.insert(5, "killer", pd.array([r["killer"] for r in kill_rows], dtype="Int64"))
    kills["assist"] = pd.array([r["assist"] for r in kill_rows], dtype="Int64")
    return dict(meta=meta, rounds=rounds, pr=pd.DataFrame(pr_rows), kills=kills, pos=pos, grenades=grenades)


def main(argv):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    force = "--force" in argv
    argv = [a for a in argv if a != "--force"]
    target = Path(argv[1]) if len(argv) > 1 else RAW_DIR
    files = [target] if target.is_file() else sorted(list(target.glob("*.dem")) + list(target.glob("*.dem.zst")))
    for f in files:
        print(f"→ {f.name}")
        meta = parse_demo(f, progress=lambda m, p=None: print(f"   {m}"), force=force)
        print(f"   {meta['map']} {meta['score']} ({meta['rounds']} rondas)")


if __name__ == "__main__":
    main(sys.argv)
