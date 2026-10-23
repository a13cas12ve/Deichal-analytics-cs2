"""Compila Deichal Analytics en un único ejecutable (.exe) con PyInstaller.

    pip install -r requirements.txt pyinstaller pillow
    python build.py

Resultado: dist/DeichalAnalytics.exe. Incluye los radares de app/static/maps (use --no-radars para omitirlos);
el usuario puede añadir más en una carpeta `maps/` junto al .exe.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"


def make_icon(dest: Path) -> Path | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    im = Image.open(ROOT / "app" / "static" / "img" / "logo.png").convert("RGBA")
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    sq.save(dest, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return dest


def main() -> None:
    with_radars = "--no-radars" not in sys.argv
    stage = BUILD / "_static"
    shutil.rmtree(stage, ignore_errors=True)
    BUILD.mkdir(exist_ok=True)
    shutil.copytree(ROOT / "app" / "static", stage, ignore=None if with_radars else shutil.ignore_patterns("maps"))
    icon = make_icon(BUILD / "logo.ico")

    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--console",
        "--name", "DeichalAnalytics",
        "--add-data", f"{stage}{os.pathsep}app/static",
        "--collect-submodules", "uvicorn", "--collect-all", "demoparser2", "--collect-all", "polars",
        "--hidden-import", "app.server", "--hidden-import", "app.analytics", "--hidden-import", "parser.demo_parser",
        "--exclude-module", "tkinter", "--exclude-module", "matplotlib", "--exclude-module", "scipy",
        "--exclude-module", "IPython", "--exclude-module", "pytest", "--exclude-module", "PIL",
        "--distpath", str(ROOT / "dist"), "--workpath", str(BUILD / "work"), "--specpath", str(BUILD),
    ]
    if icon:
        cmd += ["--icon", str(icon)]
    cmd += [str(ROOT / "main.py")]
    print(" ".join(cmd))
    subprocess.check_call(cmd, cwd=ROOT)
    exe = ROOT / "dist" / "DeichalAnalytics.exe"
    print(f"\nListo: {exe}  ({exe.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
