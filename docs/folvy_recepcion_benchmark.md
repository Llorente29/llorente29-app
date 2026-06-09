# Folvy — Benchmark del frente «Recepción usable y fiable»

> **Fecha:** 09/06/2026. **Estado:** benchmark cerrado; alimenta el DISEÑO (no rediseñar sin diseño aprobado).
> **Disparador:** Julio recepcionó albaranes reales y el flujo NO daba seguridad. Ritual: RECON → benchmark del mejor → diseño golear aprobado → construir.

---

## 1. Fuentes del benchmark

- **tspoon (incumbente), datos reales:** dump `tspoon_dump/71_compras_albaranes.json` (901 albaranes) + `70_compras_pedidos.json` (lado «Esperado») + `01_unidades.json` (38 unidades globales) + 2 capturas de pantalla (pantalla «Recibir pedido» con selector de formato abierto; vista de pedido C00997 con «Esperado»).
- **Líderes de AP/recepción:** xtraCHEF (Toast), MarketMan. R365 no profundizado en vivo (xtraCHEF marca el techo del bloqueo).
- **RECON propio (BBDD + repo):** `GoodsReceiptForm.tsx`, `goodsReceiptService.ts`, `learn_from_receipt`, `article_supplier`, `recipe_item_purchase_format`, `recipe_item_unit_conversion`, `unitConversion.ts`, `rescaleCostToFormat`.

---

## 2. Hallazgos sobre tspoon (qué hace y dónde falla)

**Modelo de formato (por línea de albarán, `listDeliveries`):**
- `quantity` + `unit` = lo que entra a stock (base).
- `quantityFormat` + `unitFormat` + `costFormat` = el formato de compra.
- El **factor es implícito** (p.ej. 1 Paquete → 0,5 Kg). Modela el compuesto como etiqueta ("Caja 3 Bolsa × 2 Kg") pero internamente aplana a dos capas.
- `recibido` (bool) e `idStore` (almacén) por línea. **No** lleva lote/caducidad.

**Hueco 1 — conversión de formatos confusa:** el selector de formato (captura 1) lista **las 38 unidades globales** del catálogo, incluido "Copa de Vino" o "Cuch. postre" para un Caldo de Birria. Sin curación por artículo: el cocinero ve ruido y precios por unidad sin sentido.

**Hueco 2 — la foto no se ve al editar:** búsqueda de `archivo/file/scan/foto/pdf` en los 901 albaranes → **cero campos de adjunto**. La pantalla tiene "Asociar archivo" y un icono de cámara, pero **la imagen no queda ligada al albarán** ni se muestra junto a la tabla mientras corriges cantidades. Se corrige a ciegas.

**Hueco 3 — no bloquea el descuadre:** la cabecera muestra `Esperado 606,27 € / Total 35,73 €` (captura 1, con una sola línea recibida) pero **deja aceptar igual**. Solo avisa. Además trae "MARCAR TODO COMO RECIBIDO" (sesgo de confirmación de fábrica).

---

## 3. Qué hacen los líderes (cambia el listón)

- **xtraCHEF — bloquea de verdad:** el botón de enviar solo se habilita cuando el importe de la factura cuadra con el subtotal de líneas; si no, una tarjeta de "factura descuadrada" en rojo arriba. Tras capturar la foto, te pide revisar la imagen del documento. PERO es **back-office de AP** (codificación contable, no recepción en muelle, ~24 h).
- **MarketMan:** escaneas la factura, casa lo entregado contra el inventario, **marca discrepancias** y alerta de cambios de precio; parsea la imagen (digital o manuscrita) y extrae los detalles. Escaneos por cupo en planes bajos. También back-office.
- **Conclusión clave:** los líderes **parten el proceso en dos** — recepción operativa (muelle) y codificación de factura (finanzas). El bloqueo y la imagen viven en finanzas, en idioma de oficina, no en el muelle con el cocinero.

---

## 4. Cuadro por los tres huecos — veredicto honesto

| Hueco | tspoon | xtraCHEF / MarketMan | Folvy si SOLO «lo arregla» | Para GOLEAR |
|---|---|---|---|---|
| **1. Conversión de formatos** | Lista global de 38 uds = ruido; factor implícito | UoM + pack size, pero en alta del artículo (oficina), no en picker de cocinero | empata-y-mejora | **GOL** — formatos **curados por artículo**, **creables en la línea** calcando el albarán (formato anidado), con factor explícito y base resultante en vivo, **aprendidos por artículo×proveedor**. Nadie lo hace. |
| **2. Foto del albarán al editar** | No la liga (gol fácil vs tspoon) | **Sí** la muestran al corregir (en oficina) | **empate** con los líderes | **GOL** solo si la foto va con el conteo ciego **en el muelle, en móvil, por el trabajador** (los líderes la enseñan en oficina, no en el momento de recibir) |
| **3. Bloqueo / control por descuadre** | Solo avisa | **xtraCHEF bloquea** pero solo el **total del documento** (un eje, en oficina) | **empate** si solo se controla el total | **GOL** — control **por línea y a DOS EJES**: cantidad recibida **y** importe en €, ambos visibles; referencia = línea del albarán si valorada, si no el total; **batería graduada de avisos de responsabilidad** (no bloqueo duro), anti-fatiga (solo ante anomalía, acto deliberado con causa, lenguaje humano). xtraCHEF solo mira el € total del documento → Folvy cubre más, sin atascar. |

**Regla:** bloquear o enseñar la foto **por separado** solo empata con el techo. El gol está en el *cómo* (lenguaje cocinero), el *cuándo* (muelle) y el *quién* (trabajador), unificados.

---

## 5. Hallazgo estratégico (lo que de verdad golea)

**Unificar los dos momentos en uno solo, en el muelle, en lenguaje de cocinero, por el trabajador de turno:** conteo ciego + foto del albarán al lado + total que bloquea con explicación por línea → y eso ya fluye a coste/AP. Los líderes separan recepción (ops) de codificación de factura (finanzas); tspoon hace recepción en vivo pero floja. La **unificación + el lenguaje + el momento** es lo que ninguno tiene.

Encaja con dos frentes ya anotados: **unidades de uso amigables por artículo** (hueco 1) y **portal del trabajador en dos bloques** personal/procesos (hueco 2, móvil).

---

## 6. Principio de diseño del hueco 1 (Julio, 09/06) — calcar el albarán

Cuando el OCR **no** desglosa el formato, el cocinero debe poder **copiar exactamente el formato que viene en el albarán, sin salir de la línea**, y que **se aprenda**:

- **Anidado, no plano.** Ejemplos reales: salsas = "Caja = 3 Bolsa; Bolsa = 1 Kg" → 3 Kg base; patatas = "2 Cajas × 4 Bolsas/caja". Guardar la **estructura**, no solo un factor aplanado.
- **Contar en la capa que llega.** Recibir "2 cajas" o "5 bolsas" indistintamente; Folvy convierte a base y a coste.
- **Crear en la línea + memoria.** Lo que se escribe una vez queda pegado al artículo y **se ofrece el primero** en el próximo pedido/recepción. La corrección de hoy = el valor por defecto de mañana.
- **Por proveedor.** La misma patata viene "Saco 25 Kg" de un proveedor y "Caja 2×4 Bolsas" de otro → vive en `article_supplier`.
- **Cierra el bucle con el OCR.** OCR desglosa → propone el formato (needs_review). OCR no puede → el cocinero lo calca → **enseña** al sistema a reconocer esa redacción de ese proveedor la próxima vez. "IA propone, humano decide" + el humano entrena.

---

## 6.bis Principio de diseño del hueco 3 (Julio, 09/06) — cantidad y € visibles + bloqueo a dos ejes

En cada línea, **bien visibles**: la **cantidad total recibida** y el **importe en €**. Cuando cantidad o importe no cuadran, el sistema lo **señala con una batería graduada de confirmaciones / avisos de responsabilidad** (no un bloqueo duro) — y lo hace **por línea y a dos ejes** (cantidad e importe), no solo sobre el total del documento como xtraCHEF.

- **Dos ejes, por línea:** cantidad recibida vs cantidad del albarán **y** importe (cantidad × precio) vs importe del albarán. Anomalía en cualquiera → aviso de responsabilidad.
- **Visibilidad:** el total recibido de la línea (en su unidad/formato y/o base) y el € se ven claros en la propia línea, no escondidos ni solo en un total de pie.
- **Referencia (decidido 09/06):** cuadra contra la **línea del albarán si está valorada** (precio por línea disponible → eje € por línea); **si no está valorada, contra el total** (la cantidad sigue comprobándose por línea). *(Microdetalle de diseño: cuando no hay valoración, "el total" = ¿esperado del pedido o total del albarán? Resolver en diseño, no bloquea.)*
- **Mecanismo (decidido 09/06): NO bloqueo duro, sino batería graduada de confirmaciones / avisos de responsabilidad.** No acepta a ciegas, pero no atasca al trabajador cuando el descuadre es real (proveedor manda 8 aunque el albarán diga 9). **ANTI-FATIGA (crítico, es el dolor original "del 3º-4º ya ni miraba"):** (1) los avisos salen **solo ante anomalía real**, no en cada línea; (2) son un **acto de responsabilidad deliberado** (elegir causa faltó/sobró/precio, o dejar constancia de quién asume), no un OK pasivo; (3) en **lenguaje humano** con nombre de producto. Si se convierte en click-through, recrea el problema que abrió el frente.
- **Coherente con anti-error:** la celda «Recibido» nace vacía (blind), el albarán es la referencia; el resumen previo en humano nombra el descuadre por producto.

---

## 7. Lo que YA existe en Folvy (extender, no reconstruir)

RECON al 09/06:
- **Arquitectura de 3 capas** (compra→stock→uso) ya en el modelo, frente al plano de tspoon.
- **`rescaleCostToFormat`**: cambiar de formato recalcula el €/formato en vivo (escalado matemático, sin inventar si no hay ancla).
- **`learn_from_receipt`** (mig 20260604T2200): al confirmar, upsert en `article_supplier` de código de proveedor + denominación + último precio **+ formato** → la próxima factura casa sola. El *recordar por artículo×proveedor* ya está en la columna vertebral.
- **Desglose "qué entra al almacén"** en lenguaje de cocinero en el panel pre-confirmar (los líderes no lo hacen).
- **Recepción anti-error / blind receiving**: celda «Recibido» nace vacía; pedido/pendiente = referencia gris; resumen en humano antes de confirmar.

**Lo que falta (lo nuevo de este frente):**
1. **Crear formato anidado al vuelo en la línea** (hoy se elige entre existentes; no se crea uno nuevo anidado inline).
2. **Contar en cualquier capa** del formato anidado.
3. Verificar que **lo aprendido se ofrece el primero** en el siguiente pedido/recepción (RECON del picker pendiente).
4. **Foto del albarán visible junto a la tabla** al editar (hoy no se muestra) + en móvil/portal del trabajador.
5. **Bloqueo por descuadre** con explicación por línea y clasificación de causa.

---

## 8. Decisiones de diseño abiertas (resolver en la fase de diseño)

- **Profundidad del anidamiento:** ¿2 capas (como hoy) o N capas reales (Caja→Bolsa→Kg)? La 3.ª capa habilita "contar en cualquier capa" pero añade complejidad. RECON de `recipe_item_purchase_format` + `recipe_item_unit_conversion` antes de decidir.
- **`qty_in_base` server-side:** hoy la conversión es cliente (`qtyInBaseFromFormat`/`unitConversion.ts`) y `confirm_goods_receipt` se fía del navegador → deuda declarada. Endurecer al tocar este frente (la robustez del hueco 1 lo pide).
- **Control del descuadre (decidido 09/06): batería graduada de avisos de responsabilidad, NO bloqueo duro.** xtraCHEF bloquea solo el € total del documento; Folvy controla **por línea y a dos ejes (cantidad + €)**. Referencia: línea del albarán si valorada, si no el total. Riesgo a vencer en el diseño: **fatiga de avisos** (el dolor original "del 3º-4º ya ni miraba") → avisos solo ante anomalía, acto deliberado con causa (faltó/sobró/precio), lenguaje humano. *(Microdetalle: cuando no hay valoración, "el total" = esperado del pedido o total del albarán; resolver en diseño.)*
- **Clasificación de causa del descuadre:** ¿albarán mal sumado / conté mal / precio cambió? — define qué acción ofrece (corregir conteo, abrir aviso de precio, nota de abono).
- **Aviso de precio vs escalado:** al escalar el coste por formato, el aviso de precio puede saltar solo por cambiar de formato (ruido). Ajuste fino del copiloto.

---

## 9. Veredicto

- **Hueco 1:** GOL limpio posible (calcar el albarán + curado por artículo + aprendido por proveedor); además gran parte del andamiaje (`learn_from_receipt`, 3 capas, `rescaleCostToFormat`) ya existe.
- **Hueco 2:** beats tspoon; solo EMPATA con los líderes salvo que vaya en el muelle/móvil con conteo ciego → entonces GOL.
- **Hueco 3:** GOL — control **por línea y a dos ejes (cantidad + €), ambos visibles**, referencia línea-si-valorada / total-si-no, con **batería graduada de avisos de responsabilidad** (no bloqueo duro) anti-fatiga. xtraCHEF solo controla el € total del documento → Folvy cubre más sin atascar al trabajador.
- **El verdadero diferenciador:** unificar recepción operativa + control de factura en un solo momento, en el muelle, por el trabajador, en lenguaje de cocinero. Ninguno lo hace.
