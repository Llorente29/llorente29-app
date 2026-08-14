# Ficha por producto — informe de reconstrucción (Tramo C)

**Fecha:** 15/08/2026. Universo: 182 pares `(supplier_id, supplier_code)` con al menos una línea
histórica real (`qty_received>0`, `qty_in_base` conocido, artículo casado) tras el backfill del
Tramo B.

## Metodología

Para cada código: artículo dominante (el más usado en sus líneas reales) y mediana de
`qty_in_base ÷ qty_received` sobre esas líneas. Comparado contra la ficha ya existente para ese
código (si la hay), y — cuando hay una línea con `raw_text`+`pack_size` en sesión — contra el
resultado del intérprete de Ley 1.bis (`_interpret_pack_size`).

| Clasificación | Regla | N |
|---|---|---|
| `coincide` | Ficha ya existe y su formato coincide con la mediana histórica | 102 |
| `no_existe` → creadas | No había ficha. El intérprete confirma la mediana (12), o no hay señal de intérprete pero la mediana tiene ≥3 usos reales (5) | **17 creadas** |
| `no_existe` → sin crear | No había ficha y no hay evidencia suficiente para crear sola (sin intérprete y <3 usos) | 35 |
| `contradice` | Ficha existe pero su formato NO coincide con el histórico fuerte | 21 |
| `ficha_otro_articulo` | Ficha existe pero apunta a un artículo distinto del que usan sus propias líneas | 10 |
| `discrepa_interprete` | Solo aplica a candidatas "no_existe": el intérprete contradice la mediana histórica → no se crea | 3 |

**Criterio propio, no pedido literalmente por el encargo, declarado aquí:** para "no_existe" sin
señal del intérprete, exigir ≥3 usos históricos antes de crear sola (mismo umbral que ya usa todo
este proyecto para "histórico fuerte"). Con 1-2 usos y sin intérprete, no se crea — queda en la
lista de abajo, no autocorregida.

---

## 17 fichas CREADAS (source='albaran', sin verificar)

Doce confirmadas por el intérprete + cinco por mediana fuerte (≥3 usos, sin señal de intérprete):
Solomillo de Pollo Piri-piri (310210012→5000, 11 usos), Tortilla Trigo 30cm/CLOUDTOWN
(510907023→18, 9 usos), Aceite Alto Oleico/CLOUDTOWN (510101002→25000, 7 usos), Salsa White BBQ
(520801054→3000, 3 usos), Queso Rulo de Cabra (520406280→1000, 3 usos). El resto: Caja Milanesa
Haus, Aceite Alto Oleico/MAKRO, Peperoni Loncheado, Bolsas Basura, Delicias de Pollo Southern,
Jamón Dulce/MAKRO, Queso Parmesano, Agua Mineral 50CL, Papel de aluminio, Fanta Naranja Lata (×2
códigos), Coca-Cola Original Lata.

---

## 21 fichas que CONTRADICEN el histórico fuerte — decisión de Julio, no autocorregidas

| Proveedor | Código | Artículo | Usos | Histórico dice | Ficha dice |
|---|---|---|---|---|---|
| CLOUDTOWN | 510501019 | Arroz Largo | 5 | 5000 | 1000 |
| CLOUDTOWN | 310210020 | Bacon Ahumado | 3 | 5000 | 4800 |
| CLOUDTOWN | 210203006 | Cebolla Morada | 9 | 5000 | 1000 |
| CLOUDTOWN | 210204005 | Cebollino | 11 | 150 | 125 |
| CLOUDTOWN | 520407103 | Crema Agria | 4 | 750 | 2000 |
| CLOUDTOWN | 210606015 | Lechuga Romana | 10 | 400 | 650 |
| CLOUDTOWN | 220206036 | Patatas Bastón | 9 | 10000 | 12500 |
| CLOUDTOWN | 513602040 | Pepinillos Agridulce en Rodajas | 2 | 2050 | 2200 |
| CLOUDTOWN | 310210021 | Pulled Pork | 10 | 6500 | 6000 |
| CLOUDTOWN | 531001089 | Queso Mozarela | 11 | 1500 | 2000 |
| CLOUDTOWN | 513309019 | Salsa Verde | 8 | 250 | 220 |
| CLOUDTOWN | VS0100PPTR/P | Salsero 120 Cc | 2 | 365 | 100 |
| CLOUDTOWN | Q1150N | Servilletas 30 x 40 | 3 | 150 | 4500 |
| CLOUDTOWN | 513306005 | Tomate Frito | 5 | 2500 | 4100 |
| CLOUDTOWN | 510907016 | Tortilla Maíz 12 cm | 12 | 129 | 240 |
| MAKRO | 006346 | Cebollino | 4 | 150 | 125 |
| MAKRO | 225832 | Guacamole | 1 | 500 | 1000 |
| MAKRO | 163819 | Jamón Dulce | 1 | 500 | 450 |
| MAKRO | 217760 | Papel Aluminio 40cmX250Mts | 1 | 200 | 1 |
| MAKRO | 215756 | Piedra Limpia Plancha | 2 | 4,5 | 6 |
| PRODUCTOS LÁCTEOS TGT | 011066 | Queso Cheddar Loncheado | 2 | 1200 | 1000 |

**Nota:** `310210021` (Pulled Pork) es precisamente el segundo código de la colisión validada en vivo
en el Tramo A — su ficha actual (6000) es correcta para ESE código; la línea "contradice" aquí
compara contra el histórico DE ESE MISMO código, que incluye alguna línea del otro producto mal
casada antes del backfill. Revisar con el resto, no autoasumir cuál gana.

---

## 10 fichas que apuntan a un ARTÍCULO distinto del que usan sus propias líneas

| Proveedor | Código | Histórico usa | Ficha apunta a |
|---|---|---|---|
| CLOUDTOWN | 02195 | Cajas pinsa blanca | CAJAS PINSA BLANCA 360x240x45 (100 un/pq) |
| CLOUDTOWN | 02215 | Focaccia para Deep Pizza | Focaccia XXL |
| CLOUDTOWN | 241440R | Bolsa Marron Grande 25x15x43,5 | Bolsas Sos sin Asas Kraft 22x14x37 Cm |
| CLOUDTOWN | 513402018 | Salsa Tartufata | Pasta Trufada |
| CLOUDTOWN | 530502025 | **Tarta 3 Leches** | **Tortilla Trigo 30 cm** ← Tramo D |
| CLOUDTOWN | 630906137 | Bolsas Personalizadas Korean | Bolsas Koreans |
| CLOUDTOWN | TS0070PPTR/P | Tapa Salsero 120 Cc | Tapa Salsero Grande 120cc |
| MAKRO | 165871 | Servilletas 30 x 40 | Servilleta natural 30x40cm ← Tramo D |
| MAKRO | 431964 | Alubias rojas | **Frijoles Negros** ← Tramo D |
| MAKRO | 914654 | Nachos (tortilla Chip) | Nachos |

**Lectura:** la mayoría (Cajas pinsa, Focaccia, Bolsas Korean, Tapa Salsero, Servilletas, Nachos) huele
a **artículo duplicado en el catálogo** (mismo producto, dos fichas de `recipe_item` distintas) más
que a colisión real de código — se listan igual, decisión de Julio.

---

## 3 candidatas donde el intérprete CONTRADICE al histórico — no creadas

| Proveedor | Código | Artículo | Texto | Histórico | Intérprete |
|---|---|---|---|---|---|
| MAKRO | 220148 | Tajín con Limón | "Tajin tajin clasico 400 g" | 450 | 400 |
| CLOUDTOWN | K1002/25 | CAJA GENÉRICA 780 Ml | "Caja americana kraft 780 ml 112x90x65 300 UNIDADES" | 150,5 | 300 |
| BODEGA DE VALLECAS | 6100362 | Bobina papel cocina | "PAPE COCIN TENERELLA" | 1 | 3 |

**Bobina papel cocina** repite exactamente el patrón ya visto en Formatos (#79): el histórico da
consistentemente 1 (parece tratarse "por paquete", no por rollo) mientras `pack_size=3` (rollos
dentro). Puede ser un patrón de negocio real, no ruido — no se crea sola, para que Julio decida.

---

## Tramo D — las 5 colisiones nombradas por el encargo, con evidencia real

Confirmadas exactas contra `article_supplier` (antes de la reconstrucción del Tramo C). Ninguna se
resuelve aquí — la migración pasa sin tocarlas (el índice A.1 lo garantiza). Evidencia real de sus
propias líneas de recepción:

**`431964` (MAKRO) — Alubias rojas / Frijoles Negros.** Las 3 líneas históricas de este código
comparten el mismo `raw_text`: *"alubia cocida roja lata 1600gne (2500 g)"* — dice **roja**
explícitamente. 2 de las 3 quedaron casadas a "Frijoles Negros" (negras) y solo 1 al artículo
correcto ("Alubias rojas"). **Lectura: error de casado, no colisión real** — el texto contradice
directamente el artículo en 2 de 3 líneas.

**`165871` (MAKRO) — Servilletas 30x40 / Servilleta natural 30x40cm.** Mismo `raw_text` exacto
("METRO PROFESSIONAL Servilleta natural 30x40cm 150 unidades") en 2 de las 3 líneas, cada una casada
a un `recipe_item` DISTINTO. **Lectura: artículo duplicado en el catálogo**, no dos productos reales.

**`60440` (EUROPASTRY) — Bollo cocido / Pan Bocadillos.** Mismo `raw_text` ("Bollo Cocido 100g
(26u)"/"(28u)") en las 9 líneas; 1 casó a "Bollo cocido", 8 a "Pan Bocadillos". Sin evidencia textual
que distinga los dos artículos — **Julio decide** si son el mismo pan con dos nombres o dos usos
reales.

**`530502025` (CLOUDTOWN, dos `supplier_id` — los 4 proveedores "Cloudtown" de la deuda técnica
vuelven a aparecer aquí).** Las **12 líneas históricas reales** de este código, sin excepción, tienen
`raw_text` "TARRICO TRES LECHES CAJA 15 UD DE 212 ML" y están casadas a "Tarta 3 Leches". **Ninguna
línea real usa "Tortilla Trigo 30 cm"** — la ficha que apunta a Tortilla Trigo (Tramo C,
`ficha_otro_articulo`) no tiene ni una sola línea que la respalde. **Lectura: la ficha está
simplemente mal, no es una colisión de dos productos reales** — pero como el propio índice A.1 la
deja pasar sin bloquear, queda igual para que Julio la corrija explícitamente (no se autocorrige
aquí, seguimos "no se resuelve, solo se presenta").

---

## 35 candidatas "no_existe" sin evidencia suficiente para crear sola

Sin intérprete disponible y con 1-2 usos históricos únicamente. No se listan una a una aquí (bajo
volumen por código, la mayoría son artículos de un solo uso histórico) — recuperables vía
`_reconstruccion_20260815.clasificacion='no_existe'` excluyendo los 17 ya creados, si hace falta
revisarlas.
