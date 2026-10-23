"""Punto de entrada de Deichal Analytics (también es el que se empaqueta en el .exe).

Arranca el servidor local, abre el navegador y espera. Para salir, cierra esta ventana o pulsa Ctrl+C.
"""
from __future__ import annotations

import multiprocessing
import os
import socket
import sys
import threading
import webbrowser


def free_port(start: int = 8000, tries: int = 30) -> int:
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:  # nadie escuchando: libre
                return port
    raise RuntimeError(f"No hay ningún puerto libre entre {start} y {start + tries - 1}")


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    from app.paths import BASE_DIR, MAPS_DIR, RAW_DIR, VERSION
    print(f"Deichal Analytics v{VERSION} - cargando datos...")
    from app import server  # importa pandas/pyarrow: tarda unos segundos la primera vez
    import uvicorn

    port = int(os.environ.get("PORT", 0)) or free_port()
    url = f"http://localhost:{port}"
    print(f"\n  Abre {url}  (se abrirá solo en tu navegador)")
    print(f"  Demos:  {RAW_DIR}")
    print(f"  Datos:  {BASE_DIR / 'data'}")
    print(f"  Radares opcionales:  {MAPS_DIR}")
    print("\n  Para salir, cierra esta ventana o pulsa Ctrl+C.\n")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(server.app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
