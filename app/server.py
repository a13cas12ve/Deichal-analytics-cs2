"""Servidor local de Deichal Analytics.  Ejecutar:  python -m app.server   (http://localhost:8000)"""
from __future__ import annotations

import os
import queue
import re
import sys
import threading
import time
import traceback
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analytics import STORE  # noqa: E402
from app.paths import RAW_DIR, STATIC_DIR as STATIC, radar_path  # noqa: E402
from parser.demo_parser import match_id_for, parse_demo  # noqa: E402

RAW_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Deichal Analytics")

# ---------------- cola de procesado ----------------
JOBS: dict[str, dict] = {}
JOB_Q: "queue.Queue[str]" = queue.Queue()


def worker():
    while True:
        jid = JOB_Q.get()
        job = JOBS[jid]
        job.update(status="processing", pct=1, msg="Empezando…")

        def progress(msg, pct=None):
            job["msg"] = msg
            if pct is not None:
                job["pct"] = pct
        try:
            meta = parse_demo(job["path"], progress=progress, force=job.get("force", False))
            STORE.reload()
            job.update(status="done", pct=100, msg=f'{meta["map"]} · {meta["rounds"]} rondas', match_id=meta["id"])
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            job.update(status="error", msg=f"{type(exc).__name__}: {exc}")
        finally:
            job["finished"] = time.time()


threading.Thread(target=worker, daemon=True).start()


def enqueue(path: Path, force: bool = False) -> str:
    jid = f"{int(time.time() * 1000)}-{path.name[:12]}"
    JOBS[jid] = dict(id=jid, file=path.name, path=str(path), status="queued", pct=0, msg="En cola",
                     started=time.time(), force=force)
    JOB_Q.put(jid)
    return jid


def qlist(v: str | None):
    return [x for x in (v or "").split(",") if x]


# ---------------- API ----------------
@app.get("/api/catalog")
def catalog():
    return STORE.catalog()


@app.get("/api/player/{steamid}")
def player(steamid: int, maps: str = "", matches: str = "", side: str = "all"):
    d = STORE.player_detail(steamid, qlist(maps), qlist(matches), side)
    if d is None:
        raise HTTPException(404, "Sin datos para ese filtro")
    return d


@app.get("/api/roster")
def roster(name: str, maps: str = "", matches: str = "", side: str = "all"):
    return STORE.roster(name, qlist(maps), qlist(matches), side)


@app.get("/api/team")
def team(name: str, maps: str = "", matches: str = "", side: str = "all"):
    d = STORE.team_detail(name, qlist(maps), qlist(matches), side)
    if d is None:
        raise HTTPException(404, "Sin datos para ese filtro")
    return d


@app.get("/api/heatmap")
def heatmap(map: str, steamid: int | None = None, side: str = "all", kind: str = "pos", matches: str = ""):
    return STORE.heatmap(steamid, map, side, kind, qlist(matches))


@app.get("/api/match/{mid}/summary")
def match_summary(mid: str):
    d = STORE.match_summary(mid)
    if d is None:
        raise HTTPException(404, "Partida no encontrada")
    return d


@app.get("/api/replay/{mid}")
def replay_rounds(mid: str):
    d = STORE.replay_rounds(mid)
    if d is None:
        raise HTTPException(404, "Partida no encontrada")
    return d


@app.get("/api/replay/{mid}/{rnd}")
def replay_round(mid: str, rnd: int):
    d = STORE.replay_round(mid, rnd)
    if d is None:
        raise HTTPException(404, "Ronda no encontrada")
    return d


@app.post("/api/demos/reprocess_all")
def reprocess_all():
    queued = []
    for mid in list(STORE.meta):
        for f in RAW_DIR.glob("*.dem*"):
            if match_id_for(f) == mid:
                queued.append(enqueue(f, force=True))
    return dict(queued=queued)


@app.get("/api/utility")
def utility(map: str, side: str = "all", matches: str = "", steamid: int | None = None, team: str | None = None):
    return STORE.utility_points(map, side, qlist(matches), steamid, team)


@app.post("/api/roles")
async def set_role(request: Request):
    body = await request.json()
    STORE.set_role(str(body["steamid"]), body.get("role") or "")
    return {"ok": True}


@app.get("/api/demos")
def demos():
    processed = {m["source"]: m["id"] for m in STORE.meta.values()}
    files = []
    for f in sorted(RAW_DIR.glob("*.dem*")):
        base = f.name[:-4] if f.suffix == ".zst" else f.name
        files.append(dict(file=f.name, mb=round(f.stat().st_size / 1e6, 1), processed=base in processed,
                          match_id=processed.get(base)))
    return dict(files=files, jobs=sorted(JOBS.values(), key=lambda j: -j["started"])[:20])


@app.post("/api/demos/process")
def process_all():
    busy = {j["file"] for j in JOBS.values() if j["status"] in ("queued", "processing")}
    queued = []
    done = {m["source"] for m in STORE.meta.values()}
    for f in sorted(RAW_DIR.glob("*.dem*")):
        base = f.name[:-4] if f.suffix == ".zst" else f.name
        if base in done or f.name in busy:
            continue
        queued.append(enqueue(f))
    return dict(queued=queued)


@app.post("/api/demos/upload")
async def upload(request: Request, name: str):
    safe = re.sub(r"[^\w.\- ]", "_", Path(name).name)
    if not (safe.endswith(".dem") or safe.endswith(".dem.zst")):
        raise HTTPException(400, "Solo se admiten .dem o .dem.zst")
    dest = RAW_DIR / safe
    with open(dest, "wb") as fh:
        async for chunk in request.stream():
            fh.write(chunk)
    return dict(job=enqueue(dest))


@app.delete("/api/match/{mid}")
def delete_match(mid: str):
    STORE.delete_match(mid)
    return {"ok": True}


@app.post("/api/match/{mid}/reprocess")
def reprocess(mid: str):
    meta = STORE.meta.get(mid)
    if not meta:
        raise HTTPException(404)
    for f in RAW_DIR.glob("*.dem*"):
        if match_id_for(f) == mid:
            return dict(job=enqueue(f, force=True))
    raise HTTPException(404, "Demo original no encontrada en demos/raw")


# ---------------- estáticos ----------------
@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/radar/{name}")
def radar(name: str):
    p = radar_path(name.removesuffix(".png"))
    if p is None:
        raise HTTPException(404, "Sin radar para ese mapa")
    return FileResponse(p, headers={"Cache-Control": "max-age=3600"})


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/static/") and not request.url.path.startswith("/static/maps/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


app.mount("/static", StaticFiles(directory=STATIC), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8000)), log_level="warning")
