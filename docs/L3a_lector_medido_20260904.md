# L3a · El lector, medido en banco contra 8 fotos reales

**04/09/2026.** Biblioteca + banco en `tools/l3-lector/`. No despliega nada, no toca la base,
no toca la app. La referencia se comprometió en git (`531322d7`) **antes** de la primera
ejecución del lector.

---

## 1 · El número

| lector | leídas | % |
|---|---|---|
| Línea base de Julio — `pyzbar` a pelo (5 fotos, 11 uds) | 8/11 | 73 % |
| Línea base de Julio — con preprocesado (5 fotos, 11 uds) | 10/11 | 91 % |
| **Éste, sobre las MISMAS 5 fotos** | **10/11** | **91 %** |
| **Éste, sobre las 8 fotos completas (22 uds)** | **20/22** | **91 %** |

**Iguala la línea base, no la supera.** Y el techo está localizado: son dos unidades concretas.

**Discrepancia en el recuento, avisada antes de usarla:** el encargo dice «8 fotos, 20 unidades»
pero su propia tabla suma 22 (6+4+1+2+1+3+3+2). Contadas a ojo son 22. Se usa 22. La línea base
sí cuadra: las fotos 03–07 son 11 unidades.

### Lo que costó llegar al 91 %

La primera versión daba **8/11, exactamente el 73 % «a pelo»**. La causa era una instrucción del
propio encargo: *«parando en cuanto no aporte ninguna nueva»*. Esa parada saltaba antes de llegar
a CLAHE y a Otsu, que son justo las pasadas que rescatan las difíciles. El defecto ahora es
**agotar las pasadas**; la parada temprana sigue disponible como modo rápido, con su coste escrito.

---

## 2 · Dónde falla, por envase

| envase | leídas | |
|---|---|---|
| suelta | 6/6 | 100 % |
| caja blanca | 2/2 | 100 % |
| caja impresa | 2/2 | 100 % |
| bolsa | 2/2 | 100 % |
| **aluminio** | **2/2** | **100 %** |
| caja kraft | 5/6 | 83 % |
| **cono** | **1/2** | **50 %** |

**El aluminio NO es el problema, y esto contradice la medición previa.** El encargo dice que el
único irrecuperable fue «una hamburguesa envuelta en papel de aluminio arrugado». Aquí las dos
unidades sobre aluminio leen: en la foto `06` el QR del aluminio cae a 20 px de su sitio, y la
bolsa de esa misma foto se rescata con la pasada CLAHE. Las dos que fallan son otras:

- `01` · G442 · **4 de 5** · **cono**. La etiqueta va enrollada sobre una superficie cónica: el
  símbolo queda curvado en dos ejes a la vez. Su gemelo (2 de 5, el otro cono) sí lee, pero sólo
  a ×3 — o sea que el cono está al límite, no muerto.
- `06` · G652 · **1 de 3** · **caja kraft**. La etiqueta está doblada sobre el canto de la caja.

Las dos son **problemas de colocación, no de software**: superficie curva y pliegue. Se arreglan
pegando la etiqueta en una cara plana, que es gratis.

---

## 3 · Cuánto aporta el lector de texto: **cero**

OCR clásico (tesseract 5.3.4, local). Identifica 4 ternas `(pedido, N, M)` de 22 (18 %), y **las
cuatro son de unidades que el QR ya tenía**. No rescata ninguna de las dos que fallan. El
combinado se queda en 20/22, igual que el QR solo.

Y cuesta caro: pasa de **3,2 s a 25 s por foto**.

Dos cosas se midieron y se descartaron por el camino, anotadas para que no se reintenten:

1. **OCR de la foto entera**: sobre la foto `00`, que tiene seis etiquetas perfectamente legibles
   a ojo, el mejor modo de segmentación encuentra **dos** «N de M» de seis. El texto es demasiado
   pequeño dentro del encuadre completo; hay que recortar.
2. **Segmentar las etiquetas con Otsu**: el fondo es acero inoxidable y Otsu corta entre «mesa» y
   «sombra», no entre «papel» y «mesa». En la foto `00` devolvía **un único blob del 55,7 %** de
   la imagen, porque además las seis etiquetas se tocan. El papel se aísla con umbral por
   percentil (p85).

### 🔴 Lo que NO he construido, y por qué: el VLM

La otra vía para el lector B es un modelo de visión. **Es un servicio externo: cambia el coste por
pedido, y el encargo dice avisar ANTES de construirlo.** Así que no está construido.

Lo que sí puedo aportar como indicio: para escribir la referencia leí **21 de 22** unidades a ojo
de estas mismas fotos — todas menos la bolsa de `06`, cuyo código y «N de M» quedan **fuera del
encuadre** (el QR sí se ve entero). Un VLM haría eso mismo. O sea: la vía existe y probablemente
llegaría al 100 % del texto legible, pero **es decisión de Julio** porque tiene precio por pedido.

**Y ojo con la conclusión fácil:** si L1 sube el QR al 100 %, el lector de texto deja de hacer
falta y **L3 se simplifica**. Sólo merece la pena pagar un VLM si tras L1 siguen quedando fallos.

---

## 4 · Tiempo, y la disyuntiva que obliga a elegir

Medido sobre las 8 fotos, en un x86 de nube (no en la tablet):

| escenario | p50 | p90 | unidades |
|---|---|---|---|
| 1 pasada, foto original | **0,06 s** | 0,08 s | 11/22 (50 %) |
| con parada temprana (modo rápido) | **0,56 s** | 1,60 s | 18/22 (82 %) |
| todas las pasadas (lo de hoy) | **3,21 s** | 4,43 s | 20/22 (91 %) |
| 1 pasada a 1024 px | 0,02 s | 0,02 s | 5/22 (23 %) |

**El presupuesto de L3 son 3 s y hoy no se cumple al p90.** La disyuntiva, medida:

- **91 % cuesta 3,2 s (p50) / 4,4 s (p90)** — se pasa del presupuesto.
- **82 % cabe en 0,6 s** — sobra presupuesto.

**Reducir resolución no vale**: a 1024 px se cae a 5/22. Con módulo 4 el símbolo ya está al límite;
quitarle píxeles lo mata.

### En una tablet, con 5–6 unidades

Estos números son de una foto entera, no por unidad: el coste va con el tamaño de la imagen, no
con cuántas etiquetas haya, así que 5–6 unidades cuestan lo mismo que 2. Una tablet de gama media
va del orden de **3–5× más lenta** en este trabajo (el grueso son los reescalados ×2/×3/×4, que
son ancho de banda de memoria, donde una tablet pierde más que en cálculo puro):

| | estimado en tablet |
|---|---|
| modo rápido (82 %) | ~2–3 s p50 · ~5–8 s p90 |
| todas las pasadas (91 %) | ~10–16 s — **inservible en el pase** |
| 1 pasada (el caso tras L1) | ~0,2–0,3 s |

Es una **estimación por extrapolación, no una medida**: no tengo la tablet. Hay que confirmarlo
en una Lenovo del pase antes de fiarse.

---

## 5 · Predicción para cuando L1 esté desplegado (escrita ANTES — regla F6)

L1 cambia dos cosas: **ECC L → Q** (7 % → 25 % de corrección) y **módulo 4 → 6** (el símbolo crece
1,5× en lado). Además el token en base36 mayúsculas baja de versión 4 a 3, así que el símbolo
tiene *menos* módulos que codificar en *más* milímetros: el módulo físico crece más de ese 1,5×.

**La base de la predicción, medida hoy:** de las 20 unidades que leen, **sólo 11 leen en la foto
original**; las otras 9 necesitan ampliar (×2, ×3) o realzar (CLAHE, Otsu). Ampliar ×2 por software
es *exactamente* lo que hace subir el módulo de 4 a 6 en papel — pero mejor, porque en papel no se
inventan píxeles.

Predigo, y quiero que se contraste después:

1. **Las 6 unidades que hoy necesitan ×2 pasarán a leer en la pasada original.** Es la predicción
   más falsable de todas: se mide contando de qué pasada sale cada lectura.
2. **Las lecturas en la pasada original suben de 11/22 (50 %) a ≥ 18/22 (≥ 82 %).**
3. **El total sube de 20/22 a 22/22**, y la del cono es la que más dudo: la curvatura no la arregla
   la corrección de errores, la arregla pegar la etiqueta en una cara plana. Si tuviera que apostar
   por un fallo residual, apuesto por el cono.
4. **El tiempo del modo rápido baja a ~0,1–0,3 s** en x86 y a **menos de 1 s en tablet**, porque la
   mayoría de lecturas terminarán en la primera pasada. **El presupuesto de 3 s deja de ser un
   problema**, y con él desaparece la disyuntiva del §4.
5. **El lector de texto deja de hacer falta** y con él la pregunta del VLM y su coste por pedido.

Si tras L1 el número NO sube, la causa no será la corrección de errores: será la colocación
(conos y pliegues), y entonces lo que hay que cambiar es dónde se pega la etiqueta.

---

## 6 · Falsos positivos: 3 QR ajenos, y hoy son indistinguibles

El banco detecta 3 QR que no son de ninguna unidad: la **factura simplificada** (`07`), y etiquetas
de **otros pedidos** asomando por el borde (`04`, `05`). En `03` y `06` hay más QR ajenos a la vista
que el lector no llegó a decodificar.

**Hoy no se pueden distinguir**: todas las etiquetas emiten la misma `brand_shop_url`, así que un
filtro por contenido no discrimina nada. El filtro **está escrito ya** (`lector/qr.py::clasificar`)
y hoy deja pasar todo a propósito y lo marca. Tras L1 discrimina solo, sin tocar código: lo que no
sea `https://<tienda>/E/<TOKEN>` es de otro.

**Por eso se deduplica por posición y no por contenido.** Deduplicar por texto dejaría la foto `00`
en **1 unidad de 6**.

## 7 · Agrupar por pedido

La foto `00` tiene **tres pedidos mezclados** (G774, 4454B, G600) y el lector los separa: 1+3+2.
Hoy la agrupación sale del **texto**, porque el QR no lleva identidad todavía; tras L1 sale del
propio token y será fiable. Es la pieza que permite que el verificador evalúe sólo el pedido que se
está marcando, sin que las unidades de los otros sumen ni resten.

---

## Cómo repetirlo

```
cd tools/l3-lector
python3 -m venv .venv && .venv/bin/pip install pillow numpy opencv-python-headless pyzbar pytesseract
# sistema: libzbar0 y tesseract-ocr
.venv/bin/python banco.py --solo-qr     # 3 s por foto
.venv/bin/python banco.py               # con OCR, 25 s por foto
```

**Aviso de peso:** las 8 fotos ocupan 9 MB en el repositorio. Son el corpus del banco y sin ellas
no se puede reproducir el número, pero si molestan se sacan a un bucket y el banco las descarga.
