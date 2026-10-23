"""Motor de métricas: carga las partidas parseadas y agrega por jugador / equipo / mapa / bando."""
from __future__ import annotations

import json
import math
import threading
from pathlib import Path

import numpy as np
import pandas as pd

from app.paths import MATCHES_DIR, ROLES_FILE, VERSION, radar_path

SIDE_NUM = {"T": 2, "CT": 3}
PHASES = ["0-15s", "15-30s", "30-60s", "60-90s", "90s+", "Post-plant"]
ROLES = ["Entry", "AWPer", "Lurker", "Support", "IGL", "Rifler"]

# Calibración de radares estándar (pos_x, pos_y, escala) para cuando haya radar en app/static/maps/<mapa>.png
RADAR_CAL = {
    "de_mirage": (-3230, 1713, 5.0), "de_inferno": (-2087, 3870, 4.9), "de_ancient": (-2953, 2164, 5.0),
    "de_dust2": (-2476, 3239, 4.4), "de_nuke": (-3453, 2887, 7.0), "de_overpass": (-4831, 1781, 5.2),
    "de_anubis": (-2796, 3328, 5.22), "de_vertigo": (-3168, 1762, 4.0), "de_train": (-2308, 2078, 4.082),
}

# Rangos (0 -> 100) usados para normalizar los ejes del radar. Aproximan el rango de jugadores profesionales.
RANGES = {
    "kpr": (0.50, 0.85), "adr": (55, 92), "rwk": (0.42, 0.70),
    "att": (0.08, 0.24), "early": (0.08, 0.34),
    "tk": (0.03, 0.20), "tdp": (0.15, 0.60),
    "osr": (0.35, 0.65), "okr": (0.03, 0.13),
    "clp": (0.0, 0.07), "clw": (0.0, 0.04),
    "snk": (0.0, 0.30), "sns": (0.0, 0.55),
    "utd": (2.0, 14.0), "fl": (0.05, 0.50),
    "rating": (0.70, 1.40), "kast": (60, 85), "impact": (0.50, 1.40),
}
AXES = ["Firepower", "Entrying", "Trading", "Opening", "Clutching", "Sniping", "Utility"]


def norm(v, key):
    lo, hi = RANGES[key]
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return 0.0
    return float(min(max((v - lo) / (hi - lo), 0.0), 1.0) * 100)


def mapname_short(m):
    return (m or "").replace("de_", "").capitalize()


def safe_div(a, b):
    return float(a) / float(b) if b else float("nan")


def clean(o):
    """Convierte NaN/numpy a tipos JSON."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else round(float(o), 4)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


# ---------------------------------------------------------------------------------------------
class Store:
    def __init__(self):
        self.lock = threading.RLock()
        self.meta: dict[str, dict] = {}
        self.rounds = self.pr = self.kills = self.pos = self.grenades = pd.DataFrame()
        self.roles: dict[str, str] = {}
        self.reload()

    def reload(self):
        with self.lock:
            metas, R, P, K, S, G = {}, [], [], [], [], []
            for d in sorted(MATCHES_DIR.glob("*")):
                if not (d / "meta.json").exists():
                    continue
                m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
                metas[m["id"]] = m
                R.append(pd.read_parquet(d / "rounds.parquet"))
                P.append(pd.read_parquet(d / "pr.parquet"))
                K.append(pd.read_parquet(d / "kills.parquet"))
                S.append(pd.read_parquet(d / "pos.parquet"))
                if (d / "grenades.parquet").exists():
                    G.append(pd.read_parquet(d / "grenades.parquet"))
            self.meta = metas
            cat = lambda xs: pd.concat(xs, ignore_index=True) if xs else pd.DataFrame()
            self.rounds, self.pr, self.kills, self.pos, self.grenades = cat(R), cat(P), cat(K), cat(S), cat(G)
            if len(self.pr):
                mp = {k: v["map"] for k, v in metas.items()}
                for df in (self.rounds, self.pr, self.kills, self.pos):
                    df["map"] = df["match_id"].map(mp)
                self.pr["steamid"] = self.pr["steamid"].astype("int64")
            self.roles = json.loads(ROLES_FILE.read_text(encoding="utf-8")) if ROLES_FILE.exists() else {}
            self._merge_team_aliases()
            self._enrich()

    def _enrich(self):
        """Columnas derivadas que cruzan tablas: vida perdida, tiempo de vida, cegados, granadas, economía, sitio de plant."""
        pr, rounds, kills, pos, gr = self.pr, self.rounds, self.kills, self.pos, self.grenades
        if pr.empty:
            return
        key = ["match_id", "round", "steamid"]
        idx3 = pd.MultiIndex.from_frame(pr[key])
        idx2 = pd.MultiIndex.from_frame(pr[["match_id", "round"]])
        # vida perdida por ronda (100 si murió)
        pr["hp_lost"] = 0.0
        if "hp" in pos and pos["hp"].notna().any():
            last = pos.dropna(subset=["hp"]).sort_values("t").groupby(key).hp.last()
            hp_end = last.reindex(idx3).to_numpy(dtype=float)
            pr["hp_lost"] = np.where(pr.deaths > 0, 100.0, 100.0 - np.nan_to_num(hp_end, nan=100.0))
        # tiempo de vida: instante de la muerte o duración de la ronda
        rr = rounds.set_index(["match_id", "round"])
        dur = rr.duration.reindex(idx2).to_numpy(dtype=float)
        dt_ = kills.groupby(["match_id", "round", "victim"]).t.min()
        dt_.index.names = key
        death_t = dt_.reindex(idx3).to_numpy(dtype=float)
        pr["life_t"] = np.where(np.isnan(death_t), dur, death_t)
        # kills sobre enemigos cegados / muertes estando cegado
        kills["victim_flashed"] = False
        pr["kills_flashed"] = 0
        pr["deaths_flashed"] = 0
        if "flash" in pos and pos["flash"].notna().any():
            p = pos.dropna(subset=["flash"])[["match_id", "round", "steamid", "t", "flash"]].copy()
            p["flash"] = p.flash.astype(bool)
            k = kills.sort_values("t").drop(columns=["victim_flashed"])
            m = pd.merge_asof(k, p.sort_values("t").rename(columns={"steamid": "victim"}), on="t",
                              by=["match_id", "round", "victim"], direction="backward", tolerance=0.6)
            m["victim_flashed"] = m["flash"].fillna(False).astype(bool)
            kills = m.drop(columns=["flash"]).reset_index(drop=True)
            kf = kills[kills.victim_flashed & kills.killer.notna()].assign(killer=lambda d: d.killer.astype("int64"))
            kf = kf.groupby(["match_id", "round", "killer"]).size()
            kf.index.names = key
            pr["kills_flashed"] = kf.reindex(idx3).fillna(0).to_numpy(dtype=int)
            df_ = kills[kills.victim_flashed].groupby(["match_id", "round", "victim"]).size()
            df_.index.names = key
            pr["deaths_flashed"] = df_.reindex(idx3).fillna(0).to_numpy(dtype=int)
        self.kills = kills
        # granadas lanzadas por jugador y ronda
        kinds = (("smoke", "n_smoke"), ("flash", "n_flash"), ("he", "n_he"), ("molotov", "n_molo"))
        for _, col in kinds:
            pr[col] = 0
        if len(gr):
            gr["steamid"] = gr["steamid"].astype("int64")
            for kind, col in kinds:
                c = gr[gr.kind == kind].groupby(key).size()
                pr[col] = c.reindex(idx3).fillna(0).to_numpy(dtype=int)
            gr = gr.merge(pr[key + ["team"]].drop_duplicates(key), on=key, how="left")
            gr["map"] = gr["match_id"].map({k: v["map"] for k, v in self.meta.items()})
            self.grenades = gr
        # economía propia en la ronda
        t_buy = rr.t_buy.reindex(idx2).to_numpy(dtype=object)
        ct_buy = rr.ct_buy.reindex(idx2).to_numpy(dtype=object)
        pr["buy"] = np.where(pr.side == 2, t_buy, ct_buy)
        # sitio de plant y posición aproximada de la bomba (T dentro de una zona Bombsite al plantar)
        site, px, py = [], [], []
        posT = pos[(pos.side == 2) & pos.place.fillna("").str.startswith("Bombsite")]
        grp = {k: g for k, g in posT.groupby(["match_id", "round"])}
        for _, r in rounds.iterrows():
            s_, x_, y_ = None, None, None
            g = grp.get((r.match_id, r["round"]))
            if bool(r.planted) and g is not None and pd.notna(r.plant_t):
                w = g[(g.t >= r.plant_t - 8) & (g.t <= r.plant_t + 1)]
                if len(w):
                    s_ = w.place.str[-1].mode().iloc[0]
                    w = w[w.place.str[-1] == s_]
                    x_, y_ = float(w.x.mean()), float(w.y.mean())
            site.append(s_)
            px.append(x_)
            py.append(y_)
        rounds["site"], rounds["plant_x"], rounds["plant_y"] = site, px, py

    def _merge_team_aliases(self, min_shared: int = 3):
        """Une clanes distintos que comparten >=3 jugadores (mismo equipo jugando con otro nombre/stand-ins)."""
        self.aliases: dict[str, str] = {}
        for m in self.meta.values():
            m["labels"] = {t: t for t in m["teams"]}
        if self.pr.empty:
            return
        groups = {k: set(g.steamid) for k, g in self.pr.groupby(["match_id", "team"])}
        weight = self.pr.groupby("team").size()
        parent = {t: t for t in weight.index}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        match_teams: dict[str, set] = {}
        for m, t in groups:
            match_teams.setdefault(m, set()).add(t)
        keys = list(groups)
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                (m1, t1), (m2, t2) = keys[i], keys[j]
                if m1 == m2 or t1 == t2 or len(groups[keys[i]] & groups[keys[j]]) < min_shared:
                    continue
                r1, r2 = find(t1), find(t2)
                if r1 == r2:
                    continue
                merged = {t for t in parent if find(t) in (r1, r2)}
                if any(len(ts & merged) > 1 for ts in match_teams.values()):
                    continue  # dos rivales de una misma partida no pueden ser el mismo equipo
                parent[r2] = r1
        comps: dict[str, list] = {}
        for t in parent:
            comps.setdefault(find(t), []).append(t)
        for members in comps.values():
            best = max(members, key=lambda t: weight[t])
            for t in members:
                if t != best:
                    self.aliases[t] = best
        if not self.aliases:
            return
        a = self.aliases
        self.pr["team"] = self.pr["team"].replace(a)
        for col in ("t_team", "ct_team", "winner_team"):
            self.rounds[col] = self.rounds[col].replace(a)
        for m in self.meta.values():
            raw_score, raw_teams = m["score"], m["teams"]
            m["labels"] = {a.get(t, t): t for t in raw_teams}
            m["teams"] = [a.get(t, t) for t in raw_teams]
            m["score"] = {a.get(t, t): v for t, v in raw_score.items()}
            m["winner"] = a.get(m["winner"], m["winner"])
            for p in m["players"]:
                p["team"] = a.get(p["team"], p["team"])

    def delete_match(self, mid: str):
        import shutil
        shutil.rmtree(MATCHES_DIR / mid, ignore_errors=True)
        self.reload()

    def set_role(self, steamid: str, role: str):
        with self.lock:
            if role:
                self.roles[steamid] = role
            else:
                self.roles.pop(steamid, None)
            ROLES_FILE.parent.mkdir(parents=True, exist_ok=True)
            ROLES_FILE.write_text(json.dumps(self.roles, ensure_ascii=False), encoding="utf-8")

    # --- filtrado ---------------------------------------------------------------------------
    def selection(self, maps=None, matches=None) -> set[str]:
        ids = set(self.meta)
        if maps:
            ids &= {k for k, v in self.meta.items() if v["map"] in maps}
        if matches:
            ids &= set(matches)
        return ids

    def sub(self, ids: set[str], side: str = "all"):
        pr = self.pr[self.pr.match_id.isin(ids)] if len(self.pr) else self.pr
        if side in SIDE_NUM and len(pr):
            pr = pr[pr.side == SIDE_NUM[side]]
        return pr

    # --- catálogo ---------------------------------------------------------------------------
    def catalog(self):
        players = {}
        if len(self.pr):
            last = self.pr.sort_values(["match_id", "round"]).groupby("steamid").agg(
                name=("name", "last"), rounds=("round", "size"), maps=("map", lambda s: sorted(set(s))))
            for sid, r in last.iterrows():
                teams = self.pr[self.pr.steamid == sid].groupby("team").size().sort_values(ascending=False)
                players[str(sid)] = dict(name=r["name"], rounds=int(r["rounds"]), maps=r["maps"],
                                         team=teams.index[0], teams=list(teams.index))
        teams = {}
        for sid, p in players.items():
            teams.setdefault(p["team"], []).append(sid)
        matches = sorted(self.meta.values(), key=lambda m: -m.get("mtime", 0))
        return clean(dict(
            version=VERSION, maps=sorted({m["map"] for m in matches}), matches=matches, players=players,
            teams={t: len(v) for t, v in teams.items()}, roles=self.roles, role_options=ROLES,
            aliases={c: sorted(k for k, v in self.aliases.items() if v == c) for c in set(self.aliases.values())}))

    # --- estadísticas -----------------------------------------------------------------------
    def player_table(self, pr: pd.DataFrame) -> pd.DataFrame:
        """Una fila por jugador con todas las métricas derivadas."""
        if pr.empty:
            return pd.DataFrame()
        pr = pr.assign(sw_k=np.where(pr.won_round, pr.impact_kill, 0.0))
        pr = pr.assign(swing_r=pr.sw_k - pr.impact_death)
        g = pr.groupby("steamid")
        t = g.agg(
            name=("name", "last"), team=("team", lambda s: s.value_counts().index[0]), rounds=("round", "size"),
            kills=("kills", "sum"), deaths=("deaths", "sum"), assists=("assists", "sum"), hs=("hs", "sum"),
            damage=("damage", "sum"), util=("util_damage", "sum"), flashed=("flashed", "sum"),
            survived=("survived", "sum"), kast=("kast", "sum"), ok=("opening_kill", "sum"),
            od=("opening_death", "sum"), tk=("trade_kills", "sum"), traded=("traded_death", "sum"),
            sniper=("sniper_kills", "sum"), early=("early_kills", "sum"), rwk=("kills", lambda s: (s > 0).sum()),
            k2=("kills", lambda s: (s == 2).sum()), k3=("kills", lambda s: (s == 3).sum()),
            k4=("kills", lambda s: (s == 4).sum()), k5=("kills", lambda s: (s >= 5).sum()),
            cl_n=("clutch_vs", lambda s: (s > 0).sum()), cl_won=("clutch_won", "sum"),
            cl_saved=("clutch_saved", "sum"), awp_rounds=("awp_round", "sum"),
            imp_k=("impact_kill", "sum"), imp_d=("impact_death", "sum"), won=("won_round", "sum"),
            sw_k=("sw_k", "sum"), sw_total=("swing_r", "sum"),
            hp_lost=("hp_lost", "sum"), life_sum=("life_t", "sum"), kf=("kills_flashed", "sum"), dfl=("deaths_flashed", "sum"),
            n_smoke=("n_smoke", "sum"), n_flash=("n_flash", "sum"), n_he=("n_he", "sum"), n_molo=("n_molo", "sum"),
        )
        won_n = pr[pr.won_round].groupby("steamid").size().reindex(t.index).fillna(0)
        lost_n = pr[~pr.won_round].groupby("steamid").size().reindex(t.index).fillna(0)
        t["sw_won_sum"] = pr[pr.won_round].groupby("steamid").swing_r.sum().reindex(t.index).fillna(0)
        t["sw_lost_sum"] = pr[~pr.won_round].groupby("steamid").swing_r.sum().reindex(t.index).fillna(0)
        t["swing_won"] = t.sw_won_sum / won_n.replace(0, np.nan) * 100
        t["swing_lost"] = t.sw_lost_sum / lost_n.replace(0, np.nan) * 100
        cp = pr[pr.clutch_won].groupby("steamid").clutch_vs.sum()
        t["cl_pts"] = cp.reindex(t.index).fillna(0)
        n = t.rounds
        t["kpr"], t["dpr"], t["apr"] = t.kills / n, t.deaths / n, t.assists / n
        t["adr"], t["kast_pct"] = t.damage / n, t.kast / n * 100
        t["impact"] = 2.13 * t.kpr + 0.42 * t.apr - 0.41
        t["rating"] = 0.0073 * t.kast_pct + 0.3591 * t.kpr - 0.5329 * t.dpr + 0.2372 * t.impact + 0.0032 * t.adr + 0.1587
        t["kd"] = t.kills / t.deaths.replace(0, np.nan)
        t["hs_pct"] = t.hs / t.kills.replace(0, np.nan) * 100
        t["survival"] = t.survived / n * 100
        t["rwk_pct"] = t.rwk / n
        t["opening_att"] = (t.ok + t.od) / n
        t["opening_succ"] = t.ok / (t.ok + t.od).replace(0, np.nan) * 100
        t["tk_pr"] = t.tk / n
        t["traded_pct"] = t.traded / t.deaths.replace(0, np.nan) * 100
        t["cl_win_pct"] = t.cl_won / t.cl_n.replace(0, np.nan) * 100
        lost = t.cl_n - t.cl_won
        t["cl_save_pct"] = t.cl_saved / lost.replace(0, np.nan) * 100
        t["util_pr"], t["flash_pr"] = t.util / n, t.flashed / n
        t["sniper_pr"] = t.sniper / n
        t["sniper_share"] = t.sniper / t.kills.replace(0, np.nan)
        t["early_pr"] = t.early / n
        t["impact_pr"] = (t.imp_k - t.imp_d) / n
        # Round swing estilo HLTV (pp de prob. de ronda por ronda): kills solo cuentan en rondas ganadas
        t["swing"] = t.sw_total / n * 100
        t["swing_k"] = t.sw_k / n * 100
        t["swing_d"] = -t.imp_d / n * 100
        t["swing_raw"] = t.impact_pr * 100
        t["win_pct"] = t.won / n * 100
        t["hp_lost_pr"] = t.hp_lost / n
        t["life_t"] = t.life_sum / n
        t["kf_pr"] = t.kf / n
        t["smoke_pr"], t["flash_th_pr"], t["he_pr"], t["molo_pr"] = t.n_smoke / n, t.n_flash / n, t.n_he / n, t.n_molo / n
        t["nades_pr"] = (t.n_smoke + t.n_flash + t.n_he + t.n_molo) / n
        t["flash_eff"] = t.flashed / t.n_flash.replace(0, np.nan)
        t["multi"] = t.k2 + t.k3 + t.k4 + t.k5
        return self.add_axes(t)

    @staticmethod
    def add_axes(t: pd.DataFrame) -> pd.DataFrame:
        rows = []
        for _, r in t.iterrows():
            fp = np.mean([norm(r.kpr, "kpr"), norm(r.adr, "adr"), norm(r.rwk_pct, "rwk")])
            en = 0.6 * norm(r.opening_att, "att") + 0.4 * norm(r.early_pr, "early")
            tr = 0.6 * norm(r.tk_pr, "tk") + 0.4 * norm((r.traded_pct / 100) if not math.isnan(r.traded_pct) else 0, "tdp")
            op = 0.5 * norm((r.opening_succ / 100) if not math.isnan(r.opening_succ) else 0.0, "osr") \
                + 0.5 * norm(r.ok / r.rounds, "okr")
            cl = 0.6 * norm(r.cl_pts / r.rounds, "clp") + 0.4 * norm(r.cl_won / r.rounds, "clw")
            sn = 0.5 * norm(r.sniper_pr, "snk") + 0.5 * norm(0 if math.isnan(r.sniper_share) else r.sniper_share, "sns")
            ut = 0.5 * norm(r.util_pr, "utd") + 0.5 * norm(r.flash_pr, "fl")
            power = (0.45 * norm(r.rating, "rating") + 0.20 * norm(r.kast_pct, "kast")
                     + 0.20 * norm(r.adr, "adr") + 0.15 * norm(r.impact, "impact"))
            rows.append([fp, en, tr, op, cl, sn, ut, power])
        ax = pd.DataFrame(rows, index=t.index, columns=[*AXES, "power"])
        return pd.concat([t, ax], axis=1)

    def split_stats(self, ids, steamid, side="all"):
        t = self.player_table(self.sub(ids, side))
        return t.loc[steamid] if steamid in t.index else None

    # --- jugador ----------------------------------------------------------------------------
    def player_detail(self, steamid: int, maps, matches, side):
        ids = self.selection(maps, matches)
        pr_all = self.sub(ids, "all")
        mine = pr_all[pr_all.steamid == steamid]
        if mine.empty:
            return None
        overall_t = self.player_table(self.sub(ids, side))
        if steamid not in overall_t.index:
            return None
        overall = overall_t.loc[steamid]
        team = overall.team
        team_ids = overall_t[overall_t.team == team]
        team_avg = {a: float(team_ids[a].mean()) for a in AXES}

        by_side = {}
        for s in ("T", "CT"):
            tt = self.player_table(self.sub(ids, s))
            by_side[s] = tt.loc[steamid].to_dict() if steamid in tt.index else None

        by_map = []
        for mp in sorted(set(self.meta[i]["map"] for i in ids)):
            mids = {i for i in ids if self.meta[i]["map"] == mp}
            tt = self.player_table(self.sub(mids, side))
            if steamid in tt.index:
                d = tt.loc[steamid].to_dict()
                d["map"] = mp
                d["matches"] = len(mids)
                by_map.append(d)

        # modelado de impacto por momento de la ronda
        k = self.kills[self.kills.match_id.isin(ids)]
        sidenum = SIDE_NUM.get(side)
        kk = k[(k.killer == steamid).fillna(False).astype(bool) & ((k.killer_side == sidenum) if sidenum else True)]
        dd = k[(k.victim == steamid) & ((k.victim_side == sidenum) if sidenum else True)]
        nrounds = int(overall.rounds)
        impact = []
        for ph in PHASES:
            ks, ds = kk[kk.phase == ph], dd[dd.phase == ph]
            gain, loss = float(ks.wpa.sum()), float(ds.wpa.sum())
            impact.append(dict(phase=ph, kills=len(ks), deaths=len(ds), gain=gain, loss=loss,
                               net=gain - loss, net_pr=(gain - loss) / nrounds))
        weapons = kk.groupby("weapon").size().sort_values(ascending=False).head(8)

        # clutches
        cl = mine[mine.clutch_vs > 0]
        if sidenum:
            cl = cl[cl.side == sidenum]
        clutch_rows = [dict(vs=int(v), n=int(len(g)), won=int(g.clutch_won.sum()), saved=int(g.clutch_saved.sum()))
                       for v, g in cl.groupby("clutch_vs")]
        mm = mine if not sidenum else mine[mine.side == sidenum]
        rr = mm.assign(swing=(np.where(mm.won_round, mm.impact_kill, 0.0) - mm.impact_death) * 100)
        order = {m: i for i, m in enumerate(sorted(ids, key=lambda i: self.meta[i].get("mtime", 0)))}
        rr = rr.assign(o=rr.match_id.map(order)).sort_values(["o", "round"])
        round_rows = [dict(match=r.match_id, map=self.meta[r.match_id]["map"], round=int(r["round"]),
                           side="T" if r.side == 2 else "CT", won=bool(r.won_round), kills=int(r.kills),
                           died=bool(r.deaths), swing=float(r.swing)) for _, r in rr.iterrows()]
        # rendimiento según economía propia
        pr_side = self.sub(ids, side)
        pr_side = pr_side[pr_side.steamid == steamid]
        by_buy = []
        for b, label in (("pistol", "Pistol"), ("eco", "Eco"), ("force", "Force"), ("full", "Full buy")):
            sb = pr_side[pr_side.buy == b]
            if sb.empty:
                continue
            row = self.player_table(sb).iloc[0]
            by_buy.append(dict(buy=label, rounds=int(row.rounds), kills=int(row.kills), deaths=int(row.deaths), adr=row.adr,
                               kast_pct=row.kast_pct, win_pct=row.win_pct, swing=row.swing, rating=row.rating,
                               equip=float(sb.equip.mean())))
        # zonas: dónde juega, dónde mata y dónde muere
        pz = self.pos[self.pos.match_id.isin(ids) & (self.pos.steamid == steamid) & (self.pos.place.fillna("") != "")]
        if sidenum:
            pz = pz[pz.side == sidenum]
        multi_map = len({self.meta[i]["map"] for i in ids}) > 1
        zname = lambda mp, pl: f"{mapname_short(mp)} · {pl}" if multi_map else pl
        cnt = pz.groupby(["map", "place"]).size().sort_values(ascending=False)
        tot = max(int(cnt.sum()), 1)
        zones = [dict(zone=zname(m_, pl), share=n_ / tot * 100, secs=n_ * 0.25) for (m_, pl), n_ in cnt.head(8).items()]
        kz = kk[kk.place.fillna("") != ""].groupby(["map", "place"]).size().sort_values(ascending=False).head(6)
        dz = dd[dd.place.fillna("") != ""].groupby(["map", "place"]).size().sort_values(ascending=False).head(6)
        zone_kills = [dict(zone=zname(m_, pl), n=int(n_)) for (m_, pl), n_ in kz.items()]
        zone_deaths = [dict(zone=zname(m_, pl), n=int(n_)) for (m_, pl), n_ in dz.items()]
        return clean(dict(
            by_buy=by_buy, zones=zones, zone_kills=zone_kills, zone_deaths=zone_deaths,
            rounds=round_rows,
            steamid=str(steamid), name=overall["name"], team=team, role=self.roles.get(str(steamid)),
            overall=overall.to_dict(), by_side=by_side, by_map=by_map, team_avg=team_avg, impact=impact,
            weapons=[dict(weapon=w, kills=int(n)) for w, n in weapons.items()], clutches=clutch_rows,
            axes=AXES,
        ))

    def roster(self, team: str, maps, matches, side):
        """Jugadores cuyo equipo principal es `team`, con sus métricas en todas sus rondas del filtro."""
        ids = self.selection(maps, matches)
        pr = self.sub(ids, side)
        if pr.empty:
            return []
        main = self.pr.groupby("steamid").team.agg(lambda s: s.value_counts().index[0])
        sids = set(main[main == team].index)
        t = self.player_table(pr[pr.steamid.isin(sids)])
        out = []
        for sid, r in t.sort_values("rating", ascending=False).iterrows():
            out.append(dict(steamid=str(sid), name=r["name"], rounds=int(r.rounds), rating=r.rating,
                            kd=r.kd, adr=r.adr, role=self.roles.get(str(sid))))
        return clean(out)

    # --- equipo -----------------------------------------------------------------------------
    def suggest_roles(self, t: pd.DataFrame) -> dict[str, str]:
        out = {}
        rest = []
        for sid, r in t.iterrows():
            if r.sniper_share >= 0.25 and r.sniper_pr >= 0.1:
                out[str(sid)] = "AWPer"
            else:
                rest.append(sid)
        if rest:
            sub = t.loc[rest]
            entry = sub.opening_att.idxmax()
            out[str(entry)] = "Entry"
            rest = [s for s in rest if s != entry]
        if rest:
            sub = t.loc[rest]
            sup = sub.util_pr.idxmax()
            out[str(sup)] = "Support"
            rest = [s for s in rest if s != sup]
        if len(rest) > 1:
            sub = t.loc[rest]
            lu = sub.opening_att.idxmin()
            out[str(lu)] = "Lurker"
            rest = [s for s in rest if s != lu]
        for s in rest:
            out[str(s)] = "Rifler"
        return out

    def team_detail(self, team: str, maps, matches, side):
        ids = self.selection(maps, matches)
        ids = {i for i in ids if team in self.meta[i]["teams"]}
        if not ids:
            return None
        pr = self.sub(ids, side)
        pr = pr[pr.team == team]
        t = self.player_table(pr)
        if t.empty:
            return None
        suggested = self.suggest_roles(t)
        roles = {str(s): self.roles.get(str(s)) or suggested.get(str(s), "Rifler") for s in t.index}
        t["role"] = [roles[str(s)] for s in t.index]

        metrics = ["rating", "kast_pct", "adr", "kpr", "dpr", "impact", "opening_succ", "opening_att", "tk_pr",
                   "traded_pct", "cl_win_pct", "cl_save_pct", "util_pr", "flash_pr", "hs_pct", "survival",
                   "sniper_pr", "impact_pr", "swing", "swing_k", "swing_d", "swing_won", "swing_lost", "power",
                   "hp_lost_pr", "life_t", "kf_pr", "nades_pr", "smoke_pr", "flash_th_pr", "he_pr", "molo_pr", "flash_eff", *AXES]
        by_role = []
        for role, g in t.groupby("role"):
            by_role.append(dict(role=role, players=[g.loc[i, "name"] for i in g.index], n=len(g),
                                **{m: float(g[m].mean()) for m in metrics}))
        team_avg = {m: float(t[m].mean()) for m in metrics}

        rounds = self.rounds[self.rounds.match_id.isin(ids)]
        rec = []
        for _, r in rounds.iterrows():
            is_t = r.t_team == team
            rec.append(dict(
                match_id=r.match_id, map=self.meta[r.match_id]["map"], round=r["round"], side="T" if is_t else "CT",
                won=r.winner_team == team, pistol=bool(r.pistol), buy=r.t_buy if is_t else r.ct_buy,
                opp_buy=r.ct_buy if is_t else r.t_buy, planted=bool(r.planted), site=r.site, reason=r.reason_txt,
                equip=r.t_equip if is_t else r.ct_equip, duration=r.duration,
                first_kill_ours=(r.first_kill_side == (2 if is_t else 3)), first_kill=r.first_kill_side != 0))
        rr = pd.DataFrame(rec)
        rs = rr[rr.side == side] if side in ("T", "CT") else rr

        def wr(df):
            return dict(n=int(len(df)), win=safe_div(df.won.sum(), len(df)) * 100)
        sides = {s: wr(rr[rr.side == s]) for s in ("T", "CT")}
        pistol = wr(rs[rs.pistol])
        buys = {b: wr(rs[(rs.buy == b)]) for b in ("pistol", "eco", "force", "full")}
        t_rounds = rs[rs.side == "T"]
        post_plant = wr(t_rounds[t_rounds.planted])
        ct_rounds = rs[rs.side == "CT"]
        retake = wr(ct_rounds[ct_rounds.planted])
        first_kill = dict(
            got=wr(rs[rs.first_kill & rs.first_kill_ours]), conceded=wr(rs[rs.first_kill & ~rs.first_kill_ours]))
        plant_rate = safe_div(t_rounds.planted.sum(), len(t_rounds)) * 100

        by_map = []
        for mp, g in rr.groupby("map"):
            gs = g[g.side == side] if side in ("T", "CT") else g
            mids = set(g.match_id)
            pm = self.player_table(self.sub(mids, side))
            pm = pm[pm.team == team]
            wins = sum(1 for i in mids if self.meta[i]["winner"] == team)
            by_map.append(dict(map=mp, matches=len(mids), wins=wins, rounds=len(gs),
                               win_pct=safe_div(gs.won.sum(), len(gs)) * 100,
                               t=wr(g[g.side == "T"]), ct=wr(g[g.side == "CT"]),
                               rating=float(pm.rating.mean()) if len(pm) else None,
                               power=float(pm.power.mean()) if len(pm) else None))
        wins = sum(1 for i in ids if self.meta[i]["winner"] == team)

        # sitios: dónde plantamos (T) y dónde nos plantan (CT)
        sites = {}
        for s_ in ("A", "B"):
            sites[s_] = dict(t=wr(t_rounds[t_rounds.site == s_]), ct=wr(ct_rounds[ct_rounds.site == s_]))
        sites["none"] = dict(t=wr(t_rounds[~t_rounds.planted]), ct=wr(ct_rounds[~ct_rounds.planted]))

        # pool de mapas: recomendación simple por % de rondas ganadas
        pool = sorted(by_map, key=lambda m: -(m["win_pct"] or 0))
        for m_ in pool:
            m_["confidence"] = "alta" if m_["rounds"] >= 60 else "media" if m_["rounds"] >= 30 else "baja"
        pick = pool[0]["map"] if pool else None
        ban = pool[-1]["map"] if len(pool) > 1 else None

        # evolución partida a partida
        trend = []
        for mid in sorted(ids, key=lambda i: self.meta[i].get("mtime", 0)):
            mt = self.meta[mid]
            opp = next((x for x in mt["teams"] if x != team), "?")
            pm = self.player_table(self.sub({mid}, "all"))
            pm = pm[pm.team == team]
            gm = rr[rr.match_id == mid]
            trend.append(dict(match_id=mid, map=mt["map"], opponent=opp, won=mt["winner"] == team,
                              score_us=mt["score"].get(team, 0), score_them=mt["score"].get(opp, 0),
                              rating=float(pm.rating.mean()), swing=float(pm.swing.mean()), adr=float(pm.adr.mean()),
                              t_win=wr(gm[gm.side == "T"])["win"], ct_win=wr(gm[gm.side == "CT"])["win"]))

        # economía y cómo se ganan / pierden las rondas
        economy = dict(
            avg_t=float(rs[rs.side == "T"].equip.mean()), avg_ct=float(rs[rs.side == "CT"].equip.mean()),
            counts=rs.buy.value_counts().to_dict(),
            anti_eco=wr(rs[(rs.buy == "full") & (rs.opp_buy == "eco")]),
            upset=wr(rs[(rs.buy == "eco") & (rs.opp_buy == "full")]),
            force_vs_full=wr(rs[(rs.buy == "force") & (rs.opp_buy == "full")]),
            full_vs_full=wr(rs[(rs.buy == "full") & (rs.opp_buy == "full")]))
        endings_win = rs[rs.won].reason.value_counts().to_dict()
        endings_loss = rs[~rs.won].reason.value_counts().to_dict()
        players = []
        for sid, r in t.iterrows():
            d = r.to_dict()
            d["steamid"] = str(sid)
            players.append(d)
        return clean(dict(
            team=team, matches=len(ids), wins=wins, losses=len(ids) - wins, rounds=int(len(rr)) if side == "all" else int(len(rs)),
            players=players, team_avg=team_avg, by_role=by_role, roles=roles, suggested=suggested,
            sides=sides, pistol=pistol, buys=buys, post_plant=post_plant, retake=retake, first_kill=first_kill,
            plant_rate=plant_rate, by_map=by_map, axes=AXES,
            sites=sites, pool=pool, pick=pick, ban=ban, trend=trend, economy=economy,
            endings_win=endings_win, endings_loss=endings_loss,
            totals=dict(kills=int(t.kills.sum()), deaths=int(t.deaths.sum()), util_pr=float(t.util_pr.mean()),
                        multi=int(t.multi.sum()), k5=int(t.k5.sum())),
        ))

    # --- mapa de utilidad -------------------------------------------------------------------
    def utility_points(self, map_name: str, side: str, matches=None, steamid: int | None = None, team: str | None = None):
        ids = self.selection([map_name], matches)
        g = self.grenades
        view = self.map_view(map_name)
        empty = dict(view=view, points=[], counts={})
        if g is None or g.empty:
            return clean(empty)
        g = g[g.match_id.isin(ids) & (g["map"] == map_name)]
        if side in SIDE_NUM:
            g = g[g.side == SIDE_NUM[side]]
        if steamid:
            g = g[g.steamid == steamid]
        if team:
            g = g[g.team == team]
        pts = []
        for r in g.itertuples():
            path = json.loads(r.path)
            pts.append(dict(k=r.kind, x=r.x, y=r.y, x0=path[0][1], y0=path[0][2], s=int(r.side), sid=str(r.steamid)))
        counts = g.kind.value_counts().to_dict()
        return clean(dict(view=view, points=pts, counts=counts, n=len(pts)))

    # --- resumen de partida -----------------------------------------------------------------
    def match_summary(self, mid: str):
        meta = self.meta.get(mid)
        if not meta:
            return None
        pr = self.pr[self.pr.match_id == mid]
        rounds = self.rounds[self.rounds.match_id == mid].sort_values("round").reset_index(drop=True)
        kills = self.kills[self.kills.match_id == mid]
        t = self.player_table(pr)
        teams = meta["teams"]
        names = dict(zip(pr.steamid, pr.name))

        board = {}
        for team in teams:
            rows = t[t.team == team].sort_values("rating", ascending=False)
            board[team] = [dict(
                steamid=str(sid), name=r["name"], kills=int(r.kills), deaths=int(r.deaths), assists=int(r.assists),
                diff=int(r.kills - r.deaths), adr=r.adr, kast=r.kast_pct, rating=r.rating, swing=r.swing,
                hs=r.hs_pct, ok=int(r.ok), od=int(r.od), cl_won=int(r.cl_won), cl_n=int(r.cl_n), util=r.util_pr,
                flashed=r.flashed, multi=int(r.multi), k3=int(r.k3 + r.k4 + r.k5), dmg=int(r.damage),
                kf=int(r.kf), life=r.life_t, power=r.power) for sid, r in rows.iterrows()]

        # mitades: la 2ª empieza en la 2ª ronda de pistol
        pistols = sorted(rounds[rounds.pistol]["round"].tolist())
        swap = pistols[1] if len(pistols) > 1 else None
        reg = (swap - 1) * 2 if swap else len(rounds)
        parts = [("1ª parte", 1, (swap - 1) if swap else len(rounds))]
        if swap:
            parts.append(("2ª parte", swap, reg))
        if len(rounds) > reg:
            parts.append(("Prórroga", reg + 1, int(rounds["round"].max())))
        halves = []
        for label, a, b in parts:
            seg = rounds[(rounds["round"] >= a) & (rounds["round"] <= b)]
            entry = dict(label=label, teams={})
            for team in teams:
                as_t = seg[seg.t_team == team]
                as_ct = seg[seg.ct_team == team]
                entry["teams"][team] = dict(
                    t_wins=int((as_t.winner_team == team).sum()), t_rounds=int(len(as_t)),
                    ct_wins=int((as_ct.winner_team == team).sum()), ct_rounds=int(len(as_ct)))
            halves.append(entry)

        # línea de rondas, economía y marcador acumulado
        first = kills[kills.opening == True]  # noqa: E712
        opening = {int(r["round"]): dict(killer=names.get(int(r.killer)) if pd.notna(r.killer) else None,
                                         victim=names.get(int(r.victim)), weapon=r.weapon) for _, r in first.iterrows()}
        kcount = kills.groupby("round").size()
        score = {tm: 0 for tm in teams}
        timeline, economy = [], {tm: [] for tm in teams}
        for _, r in rounds.iterrows():
            if r.winner_team in score:
                score[r.winner_team] += 1
            timeline.append(dict(
                round=int(r["round"]), winner_team=r.winner_team, winner_side=int(r.winner_side), reason=r.reason_txt,
                reason_code=int(r.reason), kills=int(kcount.get(r["round"], 0)), planted=bool(r.planted),
                site=r.site, duration=r.duration, t_team=r.t_team, ct_team=r.ct_team, t_equip=r.t_equip,
                ct_equip=r.ct_equip, t_buy=r.t_buy, ct_buy=r.ct_buy, pistol=bool(r.pistol),
                score=dict(score), opening=opening.get(int(r["round"]))))
            for tm in teams:
                economy[tm].append(dict(round=int(r["round"]), equip=r.t_equip if r.t_team == tm else r.ct_equip,
                                        buy=r.t_buy if r.t_team == tm else r.ct_buy, won=bool(r.winner_team == tm)))

        # destacados
        mk = pr[pr.kills >= 3].sort_values(["kills", "round"], ascending=[False, True])
        multikills = [dict(round=int(r["round"]), name=r["name"], team=r.team, kills=int(r.kills)) for _, r in mk.head(8).iterrows()]
        cl = pr[pr.clutch_won].sort_values("clutch_vs", ascending=False)
        clutches = [dict(round=int(r["round"]), name=r["name"], team=r.team, vs=int(r.clutch_vs)) for _, r in cl.head(8).iterrows()]
        mvp = t.sort_values("rating", ascending=False).iloc[0]
        # resumen por equipo
        team_stats = {}
        for tm in teams:
            tp = pr[pr.team == tm]
            wins = rounds[rounds.winner_team == tm]
            team_stats[tm] = dict(
                score=int(meta["score"].get(tm, 0)), kills=int(tp.kills.sum()), deaths=int(tp.deaths.sum()),
                first_kills=int(tp.opening_kill.sum()), pistol_wins=int(wins.pistol.sum()),
                plants=int(((rounds.t_team == tm) & rounds.planted).sum()),
                util_dmg=int(tp.util_damage.sum()), flashes=int(tp.n_flash.sum()), smokes=int(tp.n_smoke.sum()),
                endings=wins.reason_txt.value_counts().to_dict(),
                avg_equip=float(np.mean([e["equip"] for e in economy[tm]])))
        longest = rounds.loc[rounds.duration.idxmax()]
        shortest = rounds.loc[rounds.duration.idxmin()]
        return clean(dict(
            match=meta, board=board, halves=halves, timeline=timeline, economy=economy, multikills=multikills,
            clutches=clutches, mvp=dict(name=mvp["name"], team=mvp.team, rating=mvp.rating, kills=int(mvp.kills), deaths=int(mvp.deaths)),
            team_stats=team_stats, swap_round=swap,
            extremes=dict(longest=dict(round=int(longest["round"]), duration=longest.duration),
                          shortest=dict(round=int(shortest["round"]), duration=shortest.duration)),
            avg_duration=float(rounds.duration.mean())))

    # --- reproductor ------------------------------------------------------------------------
    def replay_rounds(self, mid: str):
        r = self.rounds[self.rounds.match_id == mid].sort_values("round")
        if r.empty:
            return None
        meta = self.meta[mid]
        k = self.kills[self.kills.match_id == mid].groupby("round").size()
        score = {t: 0 for t in meta["teams"]}
        out = []
        for _, row in r.iterrows():
            out.append(dict(round=int(row["round"]), t_team=row.t_team, ct_team=row.ct_team, winner_side=int(row.winner_side),
                            winner_team=row.winner_team, reason=row.reason_txt, duration=row.duration,
                            planted=bool(row.planted), plant_t=row.plant_t, kills=int(k.get(row["round"], 0)),
                            score_before=dict(score), pistol=bool(row.pistol)))
            if row.winner_team in score:
                score[row.winner_team] += 1
        has_replay = bool(meta.get("version", 1) >= 2)
        return clean(dict(match=meta, rounds=out, has_replay=has_replay, view=self.map_view(meta["map"])))

    def replay_round(self, mid: str, rn: int):
        meta = self.meta.get(mid)
        r = self.rounds[(self.rounds.match_id == mid) & (self.rounds["round"] == rn)]
        if meta is None or r.empty:
            return None
        row = r.iloc[0]
        pr = self.pr[(self.pr.match_id == mid) & (self.pr["round"] == rn)]
        players = [dict(sid=str(x.steamid), name=x.name, team=x.team, side=int(x.side), equip=float(x.equip)) for x in pr.itertuples()]
        pos = self.pos[(self.pos.match_id == mid) & (self.pos["round"] == rn)].sort_values("t")
        weapons = sorted(set(pos.weapon.dropna())) if "weapon" in pos else []
        widx = {w: i for i, w in enumerate(weapons)}
        frames = {}
        if "yaw" in pos and pos.yaw.notna().any():
            for sid, g in pos.groupby("steamid"):
                frames[str(sid)] = [[float(a), float(b), float(c), float(d), int(e), int(f), widx.get(w, -1), int(fl), int(df)]
                                    for a, b, c, d, e, f, w, fl, df in zip(g.t, g.x, g.y, g.yaw, g.hp, g.armor, g.weapon, g.flash, g.defusing)]
        k = self.kills[(self.kills.match_id == mid) & (self.kills["round"] == rn)].sort_values("t")
        kills = [dict(t=x.t, killer=None if pd.isna(x.killer) else str(int(x.killer)), victim=str(int(x.victim)),
                      weapon=x.weapon, hs=bool(x.hs), assist=None if pd.isna(x.assist) else str(int(x.assist)),
                      kx=x.kx, ky=x.ky, vx=x.vx, vy=x.vy, opening=bool(x.opening), trade=bool(x.trade), place=x.place)
                 for x in k.itertuples()]
        grenades = []
        if len(self.grenades):
            gg = self.grenades[(self.grenades.match_id == mid) & (self.grenades["round"] == rn)]
            grenades = [dict(kind=x.kind, sid=str(x.steamid), side=int(x.side), path=json.loads(x.path), t_det=x.t_det,
                             x=x.x, y=x.y, t_end=x.t_end) for x in gg.itertuples()]
        return clean(dict(
            map=meta["map"], view=self.map_view(meta["map"]), duration=row.duration, round=rn, players=players,
            weapons=weapons, frames=frames, kills=kills, grenades=grenades, plant_t=row.plant_t,
            winner_side=int(row.winner_side), reason=row.reason_txt, reason_code=int(row.reason),
            t_team=row.t_team, ct_team=row.ct_team,
            plant=dict(x=row.plant_x, y=row.plant_y, site=row.site) if bool(row.planted) else None))

    # --- mapa de calor ----------------------------------------------------------------------
    def map_view(self, map_name: str):
        p = self.pos[self.pos["map"] == map_name]
        k = self.kills[self.kills["map"] == map_name]
        if radar_path(map_name) and map_name in RADAR_CAL:
            px, py, sc = RADAR_CAL[map_name]
            return dict(minx=px, maxx=px + 1024 * sc, miny=py - 1024 * sc, maxy=py, radar=f"/radar/{map_name}.png")
        if p.empty:
            return dict(minx=-1000, maxx=1000, miny=-1000, maxy=1000, radar=None)
        x0, x1 = np.percentile(p.x, [0.2, 99.8])
        y0, y1 = np.percentile(p.y, [0.2, 99.8])
        span = max(x1 - x0, y1 - y0) * 1.06
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        return dict(minx=cx - span / 2, maxx=cx + span / 2, miny=cy - span / 2, maxy=cy + span / 2, radar=None)

    def heatmap(self, steamid: int | None, map_name: str, side: str, kind: str, matches=None, size: int = 128):
        view = self.map_view(map_name)
        ids = self.selection([map_name], matches)

        def grid(xs, ys):
            h, _, _ = np.histogram2d(
                ys, xs, bins=size, range=[[view["miny"], view["maxy"]], [view["minx"], view["maxx"]]])
            return np.flipud(h)  # fila 0 = norte (y máximo)

        base_p = self.pos[(self.pos["map"] == map_name) & self.pos.match_id.isin(ids)]
        footprint = grid(base_p.x.values, base_p.y.values) if len(base_p) else np.zeros((size, size))
        sidenum = SIDE_NUM.get(side)
        if kind == "pos":
            p = base_p
            if steamid:
                p = p[p.steamid == steamid]
            if sidenum:
                p = p[p.side == sidenum]
            heat = grid(p.x.values, p.y.values)
            n = len(p)
        else:
            k = self.kills[(self.kills["map"] == map_name) & self.kills.match_id.isin(ids)]
            if kind == "kills":
                if steamid:
                    k = k[(k.killer == steamid).fillna(False).astype(bool)]
                if sidenum:
                    k = k[k.killer_side == sidenum]
                k = k.dropna(subset=["kx", "ky"])
                heat = grid(k.kx.values, k.ky.values)
            else:
                if steamid:
                    k = k[k.victim == steamid]
                if sidenum:
                    k = k[k.victim_side == sidenum]
                heat = grid(k.vx.values, k.vy.values)
            n = len(k)
        # etiquetas de zonas
        places = []
        if len(base_p):
            for name, g in base_p[base_p.place != ""].groupby("place"):
                if len(g) > 30:
                    places.append(dict(name=name, x=float(g.x.median()), y=float(g.y.median())))
        return clean(dict(view=view, size=size, heat=heat.astype(int).tolist(), footprint=footprint.astype(int).tolist(),
                          n=n, places=places))


STORE = Store()
