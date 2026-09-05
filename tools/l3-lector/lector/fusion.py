"""
L3a · Fusion de los dos lectores + agrupacion por pedido.

AGRUPAR POR CODIGO DE PEDIDO no es un adorno: en la foto 00 conviven TRES
pedidos, y el verificador de L3 evaluara solo el que se esta marcando. Las
unidades de otros pedidos ni suman ni restan.

DE DONDE SALEN LOS RECORTES. El ancla buena es el QR: cae siempre dentro de su
etiqueta, asi que un cuadro alrededor del QR es un recorte de UNA etiqueta y de
una sola. Para las unidades cuyo QR no salio -- que son justo las que el lector
B tiene que rescatar -- se añaden los componentes claros (papel), sin cierre
morfologico, porque cerrar vuelve a fundir las etiquetas que se tocan.
"""
from __future__ import annotations
from dataclasses import dataclass
import cv2
import numpy as np

from .qr import leer_qr, Deteccion
from .texto import leer_recorte, regiones_claras, Lectura


@dataclass
class Unidad:
    rect: tuple[int, int, int, int]
    qr: Deteccion | None = None
    texto: Lectura | None = None

    @property
    def codigo(self):
        return self.texto.codigo if self.texto else None

    @property
    def nm(self):
        if self.texto and self.texto.tiene_nm:
            return (self.texto.n, self.texto.m)
        return None

    @property
    def por_qr(self) -> bool:
        return self.qr is not None

    @property
    def por_texto(self) -> bool:
        return self.nm is not None


def _caja_de_qr(q: Deteccion, shape, factor: float = 4.0):
    x, y, w, h = q.rect
    cx, cy = q.centro
    r = max(w, h) * factor
    H, W = shape[:2]
    x0, y0 = int(max(0, cx - r)), int(max(0, cy - r))
    x1, y1 = int(min(W, cx + r)), int(min(H, cy + r))
    return (x0, y0, x1 - x0, y1 - y0)


def _solapa(a, b, tol=0.6) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    if inter == 0:
        return False
    return inter / max(1, min(aw * ah, bw * bh)) >= tol


def analizar(bgr: np.ndarray, con_texto: bool = True):
    """Devuelve (unidades, qrs_nuestros)."""
    qrs, _ = leer_qr(bgr)
    nuestros = [q for q in qrs if q.es_nuestra]

    unidades: list[Unidad] = []
    for q in nuestros:
        unidades.append(Unidad(rect=_caja_de_qr(q, bgr.shape), qr=q))

    # rescate: papel claro donde NO hay ya una unidad con QR
    for c in regiones_claras(bgr):
        if any(_solapa(c, u.rect) for u in unidades):
            continue
        unidades.append(Unidad(rect=c))

    if con_texto:
        for u in unidades:
            x, y, w, h = u.rect
            u.texto = leer_recorte(bgr[y:y + h, x:x + w])

    return unidades, nuestros


def agrupar_por_pedido(unidades):
    g = {}
    for u in unidades:
        g.setdefault(u.codigo or "?", []).append(u)
    return g
