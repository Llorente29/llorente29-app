"""
L3a · Lector B — texto impreso.

Para las unidades cuyo QR no salio. Cada etiqueta lleva SIEMPRE en el mismo
sitio: codigo de pedido arriba a la izquierda, marca arriba a la derecha,
producto, y «N de M» abajo. Con (codigo, N, M) se identifica una unidad.

ES EL USO CORRECTO DE LA VISION: leer texto impreso, no contar comida.

VIA ELEGIDA: OCR clasico (tesseract 5.3.4) LOCAL. Sin servicio externo y sin
coste por pedido -- lo que Julio pedia avisar ANTES de construirlo.

DOS COSAS QUE SE MIDIERON Y DESCARTARON, para que no se vuelvan a intentar:

1. OCR DE LA FOTO ENTERA: no vale. Medido sobre la foto 00, que tiene seis
   etiquetas perfectamente legibles a ojo, el mejor modo de segmentacion
   (`--psm 4`/`11` a x2) encontro DOS «N de M» de seis. El texto es demasiado
   pequeño dentro del encuadre completo. Hay que recortar y leer el recorte.

2. SEGMENTAR CON OTSU: tampoco. En estas fotos el fondo es acero inoxidable y
   Otsu corta entre «mesa» y «sombra», no entre «papel» y «mesa»: en la foto 00
   devolvia un unico blob del 55,7 % de la imagen. El papel se aisla con un
   umbral por PERCENTIL (p85), que es lo que separa el blanco del papel del
   gris del acero.

LAS ETIQUETAS VIENEN GIRADAS: en la mitad de las fotos estan a 90 grados. Se
prueban las cuatro rotaciones y se para en la primera que da una terna valida,
que es lo que mantiene el coste bajo.
"""
from __future__ import annotations
from dataclasses import dataclass
import re
import cv2
import numpy as np
import pytesseract

TESS_CFG = "--oem 3 --psm 6"

RE_NM = re.compile(r"\b(\d{1,2})\s*de\s*(\d{1,2})\b", re.IGNORECASE)
# Codigos vistos en produccion: G442/G774/G296/G600/G194/G654/G652/G759 (Glovo)
# y 4454B (el corto de Uber).
RE_CODIGO = re.compile(r"\b([A-Z]{1,2}\d{3,5}|\d{4}[A-Z])\b")


@dataclass
class Lectura:
    codigo: str | None = None
    n: int | None = None
    m: int | None = None
    texto_crudo: str = ""
    rotacion: int = 0

    @property
    def tiene_nm(self) -> bool:
        return self.n is not None and self.m is not None

    @property
    def identifica(self) -> bool:
        return self.tiene_nm and self.codigo is not None


def _variantes(g: np.ndarray):
    f = 3 if max(g.shape) < 400 else 2
    g2 = cv2.resize(g, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
    yield g2
    yield cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(g2)
    yield cv2.threshold(g2, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]


def _extraer(txt: str) -> tuple[str | None, int | None, int | None]:
    cod = None
    mc = RE_CODIGO.search(txt.upper())
    if mc:
        cod = mc.group(1)
    n = m = None
    for mm in RE_NM.finditer(txt):
        a, b = int(mm.group(1)), int(mm.group(2))
        if 1 <= a <= b <= 30:
            n, m = a, b
            break
    return cod, n, m


def leer_recorte(bgr: np.ndarray) -> Lectura:
    """OCR de UNA etiqueta. Prueba rotaciones y para en cuanto identifica."""
    if bgr.size == 0:
        return Lectura()
    gris = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    mejor = Lectura()
    for rot in (0, 90, 270, 180):
        if rot == 0:
            g = gris
        else:
            k = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180,
                 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rot]
            g = cv2.rotate(gris, k)
        for var in _variantes(g):
            try:
                txt = pytesseract.image_to_string(var, config=TESS_CFG)
            except Exception:
                continue
            cod, n, m = _extraer(txt)
            cand = Lectura(cod, n, m, txt, rot)
            if cand.identifica:
                return cand
            # nos quedamos con lo mejor visto por si ninguna identifica del todo
            if cand.tiene_nm and not mejor.tiene_nm:
                mejor = cand
            elif cod and mejor.codigo is None and not mejor.tiene_nm:
                mejor = cand
    return mejor


def regiones_claras(bgr: np.ndarray, percentil: int = 85, maximo: int = 14):
    """
    El papel es lo mas blanco de la foto. Umbral por percentil, no Otsu
    (ver cabecera). Sirve para rescatar etiquetas cuyo QR no salio.
    """
    gris = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    A = gris.size
    th = int(np.percentile(gris, percentil))
    _, b = cv2.threshold(gris, th, 255, cv2.THRESH_BINARY)
    b = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(b)
    cajas = []
    for s in stats[1:]:
        x, y, w, h, a = s
        if not (A * 0.004 < a < A * 0.25):
            continue
        if max(w, h) / max(1, min(w, h)) > 6:
            continue
        cajas.append((int(x), int(y), int(w), int(h)))
    cajas.sort(key=lambda c: -(c[2] * c[3]))
    return cajas[:maximo]
