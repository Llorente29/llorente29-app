#!/usr/bin/env python
"""
L3a · El banco. Recorre las 8 fotos contra `referencia.json` y saca la tabla.

La referencia se comprometio en git ANTES de la primera ejecucion (531322d7).
Si un numero no cuadra, se corrige el lector, no la referencia.

CADA QR SE ATRIBUYE A SU UNIDAD POR POSICION, usando los centros del anexo de
la referencia. La primera version repartia «las N primeras de la lista» y eso
era un numero inventado: el desglose por envase es justo lo que Julio pide, y
repartido por orden de lista no dice nada.
"""
from __future__ import annotations
import json, os, statistics, sys, time
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TESSDATA_PREFIX", "/usr/share/tesseract-ocr/5/tessdata")

from lector.qr import leer_qr
from lector.fusion import analizar

BASE = os.path.dirname(os.path.abspath(__file__))
SOLO_QR = "--solo-qr" in sys.argv
RAPIDO = "--rapido" in sys.argv          # con parada temprana
SOLO = None
for a in sys.argv[1:]:
    if a.startswith("--fotos="):
        SOLO = a.split("=", 1)[1].split(",")


def main():
    ref = json.load(open(os.path.join(BASE, "referencia.json")))
    tiempos, filas = [], []
    tot = {"u": 0, "qr": 0, "txt": 0, "comb": 0, "fp": 0}
    envase: dict[str, list[int]] = {}
    fallos = []

    for foto in ref["fotos"]:
        if SOLO and not any(foto["fichero"].startswith(s) for s in SOLO):
            continue
        img = cv2.imread(os.path.join(BASE, "muestras", foto["fichero"]))
        if img is None:
            print("NO SE PUDO LEER", foto["fichero"]); continue
        H, W = img.shape[:2]
        esperadas = foto["unidades"]

        t0 = time.time()
        if SOLO_QR:
            qrs, _ = leer_qr(img, parar_si_no_aporta=RAPIDO)
            unidades = []
        else:
            unidades, qrs = analizar(img)
        dt = time.time() - t0
        tiempos.append(dt)

        # ── atribucion por posicion ──────────────────────────────────────────
        tol = 0.09 * max(W, H)
        libres = list(qrs)
        leidas_qr = set()
        for i, e in enumerate(esperadas):
            ex, ey = e["cx"] * W, e["cy"] * H
            mejor, dmin = None, 1e18
            for q in libres:
                qx, qy = q.centro
                d = ((qx - ex) ** 2 + (qy - ey) ** 2) ** 0.5
                if d < dmin:
                    mejor, dmin = q, d
            if mejor is not None and dmin <= tol:
                leidas_qr.add(i); libres.remove(mejor)
        fp = len(libres)   # QR que no cayeron sobre ninguna unidad = ajenos

        # ── texto: terna exacta ──────────────────────────────────────────────
        vistas = {(u.codigo.upper(), u.nm[0], u.nm[1])
                  for u in unidades if u.nm and u.codigo}
        leidas_txt = {i for i, e in enumerate(esperadas)
                      if (e["pedido"].upper(), e["n"], e["m"]) in vistas}

        comb = leidas_qr | leidas_txt
        for i, e in enumerate(esperadas):
            envase.setdefault(e["envase"], [0, 0, 0])
            envase[e["envase"]][2] += 1
            if i in leidas_qr: envase[e["envase"]][0] += 1
            if i in comb:      envase[e["envase"]][1] += 1
            else:
                fallos.append((foto["fichero"], e["pedido"], e["n"], e["m"], e["envase"]))

        tot["u"] += len(esperadas); tot["qr"] += len(leidas_qr)
        tot["txt"] += len(leidas_txt); tot["comb"] += len(comb); tot["fp"] += fp
        filas.append((foto["fichero"], len(esperadas), len(leidas_qr),
                      len(leidas_txt), len(comb), fp, dt))

    pc = lambda a, b: f"{100*a/b:.0f}%" if b else "-"
    print()
    print(f"{'foto':38} {'uds':>4} {'QR':>4} {'txt':>4} {'comb':>5} {'ajenos':>7} {'seg':>6}")
    print("-" * 76)
    for f, n, q, t, c, fp, dt in filas:
        print(f"{f[:38]:38} {n:4} {q:4} {t:4} {c:5} {fp:7} {dt:6.1f}")
    print("-" * 76)
    print(f"{'TOTAL':38} {tot['u']:4} {tot['qr']:4} {tot['txt']:4} {tot['comb']:5} {tot['fp']:7}")
    print(f"{'':38} {'':4} {pc(tot['qr'],tot['u']):>4} {pc(tot['txt'],tot['u']):>4} {pc(tot['comb'],tot['u']):>5}")
    if tiempos:
        s = sorted(tiempos)
        print(f"\ntiempo por foto: p50 {statistics.median(s):.1f}s · "
              f"p90 {s[min(len(s)-1,int(0.9*len(s)))]:.1f}s · max {max(s):.1f}s")
    print("\npor tipo de envase   (QR / combinado / total):")
    for env, (q, c, t) in sorted(envase.items(), key=lambda x: -x[1][2]):
        print(f"   {env:14} {q:2} / {c:2} / {t:2}   combinado {pc(c,t)}")
    if fallos:
        print("\nno leidas:")
        for f, p_, n, m, e in fallos:
            print(f"   {f[:36]:38} {p_:6} {n} de {m:<3} {e}")


if __name__ == "__main__":
    main()
