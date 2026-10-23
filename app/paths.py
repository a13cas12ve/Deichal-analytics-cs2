"""Rutas y versión. En el .exe (PyInstaller) los recursos de la web viven en una carpeta temporal de solo lectura,
mientras que los datos del usuario (demos, partidas procesadas, roles, radares) viven junto al ejecutable."""
from __future__ import annotations

import sys
from pathlib import Path

VERSION = "1.0.1"

FROZEN = bool(getattr(sys, "frozen", False))
_SRC = Path(__file__).resolve().parent.parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", _SRC))          # web empaquetada (solo lectura)
BASE_DIR = Path(sys.executable).resolve().parent if FROZEN else _SRC  # datos del usuario

STATIC_DIR = RESOURCE_DIR / "app" / "static"
DATA_DIR = BASE_DIR / "data"
MATCHES_DIR = DATA_DIR / "matches"
ROLES_FILE = DATA_DIR / "roles.json"
DEMOS_DIR = BASE_DIR / "demos"
RAW_DIR = DEMOS_DIR / "raw"
MAPS_DIR = BASE_DIR / "maps"                                  # radares <mapa>.png (1024x1024) opcionales


def radar_path(map_name: str) -> Path | None:
    """Radar del mapa: primero la carpeta `maps/` del usuario, después los empaquetados en la web."""
    for folder in (MAPS_DIR, STATIC_DIR / "maps"):
        p = folder / f"{map_name}.png"
        if p.exists():
            return p
    return None
