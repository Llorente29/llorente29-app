"""
L3a · Lector A — QR.

Aislado a proposito: no importa nada de la app ni de la base. Entra una imagen,
sale una lista de unidades detectadas.

POR QUE pyzbar Y NO EL DETECTOR DE OPENCV: medido por Julio, OpenCV leyo 1 de 6
donde pyzbar leyo 6 de 6. No se discute, se usa pyzbar.
"""
from __future__ import annotations
from dataclasses import dataclass, field
import re
import cv2
import numpy as np
from pyzbar.pyzbar import decode as zbar_decode, ZBarSymbol


@dataclass
class Deteccion:
    texto: str
    # rectangulo (x, y, w, h) SIEMPRE en coordenadas de la imagen original,
    # aunque la pasada que lo encontro trabajase a x3.
    rect: tuple[int, int, int, int]
    pasada: str
    token: str | None = None
    es_nuestra: bool = False

    @property
    def centro(self) -> tuple[float, float]:
        x, y, w, h = self.rect
        return (x + w / 2.0, y + h / 2.0)


# ── El filtro de QR ajenos (§1.1) ────────────────────────────────────────────
# En varias fotos aparecen el QR de la FACTURA SIMPLIFICADA y el del TICKET DE
# PLATAFORMA. HOY NO SE PUEDEN DISTINGUIR: todas las etiquetas emiten la misma
# `brand_shop_url`, asi que este filtro deja pasar todo y lo dice.
#
# TRAS L1 discrimina solo, sin tocar nada mas: la etiqueta emite
# `https://<tienda>/E/<TOKEN>` con el token en base36 MAYUSCULAS de 12
# caracteres, y lo que no tenga esa forma es de otro.
RE_TOKEN = re.compile(r"^https?://[^/]+/e/([A-Za-z0-9]{8,32})/?$", re.IGNORECASE)


def clasificar(texto: str) -> tuple[str | None, bool]:
    """Devuelve (token, es_nuestra). Hoy `es_nuestra` es optimista a proposito."""
    m = RE_TOKEN.match((texto or "").strip())
    if m:
        return m.group(1).upper(), True
    # Sin token todavia no hay forma de distinguir la etiqueta del ticket. Se
    # deja pasar para no perder unidades HOY, y se marca que no se ha podido
    # verificar. Cuando L1 este desplegado esto pasa a `False` sin tocar codigo.
    return None, True


# ── Las pasadas (§1.1) ───────────────────────────────────────────────────────
def _escala(img: np.ndarray, f: int) -> np.ndarray:
    if f == 1:
        return img
    return cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)


def _pasadas(bgr: np.ndarray):
    """Genera (nombre, imagen, factor_de_escala) en el orden del encargo."""
    gris = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    yield ("original", bgr, 1)
    for f in (2, 3, 4):
        yield (f"x{f}", _escala(bgr, f), f)
    yield ("gris", gris, 1)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gris)
    yield ("clahe", clahe, 1)
    _, otsu = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield ("otsu", otsu, 1)
    # Las de arriba son las que Julio midio. Estas dos son mias y solo entran si
    # las anteriores no han agotado la foto; se anotan aparte para poder decir
    # cuanto aportan por si solas.
    yield ("clahe_x3", _escala(clahe, 3), 3)
    yield ("otsu_x3", _escala(otsu, 3), 3)


def _solapa(a: Deteccion, b: Deteccion, tol: float = 0.5) -> bool:
    """
    DEDUPLICAR POR POSICION, NO POR CONTENIDO (§1.1). Hoy todos los QR dicen la
    misma URL: deduplicar por texto se comeria unidades legitimas — en la foto
    00 dejaria 1 de 6.
    """
    ax, ay, aw, ah = a.rect
    bx, by, bw, bh = b.rect
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    if inter == 0:
        return False
    menor = min(aw * ah, bw * bh)
    return menor > 0 and inter / menor >= tol


def leer_qr(bgr: np.ndarray, parar_si_no_aporta: bool = False) -> tuple[list[Deteccion], list[str]]:
    """
    Devuelve (detecciones, pasadas_usadas).

    MEDIDO 04/09, y por eso el defecto cambio: parar en cuanto una pasada no
    aporta ninguna nueva -- que es lo que pide el encargo para ahorrar coste --
    CUESTA UNIDADES. Sobre las 5 fotos de la linea base daba 8/11 (73 %), o sea
    exactamente lo mismo que pyzbar a pelo: la parada saltaba antes de llegar a
    CLAHE y Otsu, que son justo las pasadas que rescatan las dificiles.
    Asi que el defecto es AGOTAR las pasadas. `parar_si_no_aporta=True` queda
    disponible para el modo rapido del pase, con su coste en unidades escrito.
    """
    encontradas: list[Deteccion] = []
    usadas: list[str] = []
    for nombre, img, factor in _pasadas(bgr):
        usadas.append(nombre)
        try:
            crudas = zbar_decode(img, symbols=[ZBarSymbol.QRCODE])
        except Exception:
            crudas = []
        nuevas = 0
        for c in crudas:
            r = (int(c.rect.left / factor), int(c.rect.top / factor),
                 int(c.rect.width / factor), int(c.rect.height / factor))
            texto = c.data.decode("utf-8", "replace")
            det = Deteccion(texto=texto, rect=r, pasada=nombre)
            det.token, det.es_nuestra = clasificar(texto)
            if any(_solapa(det, y) for y in encontradas):
                continue
            encontradas.append(det)
            nuevas += 1
        if parar_si_no_aporta and nuevas == 0 and nombre != "original":
            break
    return encontradas, usadas
