# Folvy Supply — C2.2: OCR de albarán + casado con memoria + create-on-scan + copiloto IA
### Documento de DISEÑO (para aprobar ANTES de construir). 04/06/2026.

> Regla: nada se construye hasta que Julio apruebe este diseño. Basado en RECON real
> (BBDD + repo + Edge Functions) y benchmark de mercado, no en suposiciones.

---

## 0. Qué es C2.2 y qué NO es

**Es:** que el receptor haga una foto (o suba un PDF) del albarán y la pantalla de
recepción que ya existe (C2 anti-error) se rellene sola con una PROPUESTA que él
revisa y confirma. IA propone, humano decide. Tres piezas:

- **C2.2.a — OCR del albarán** (visión → líneas estructuradas).
- **C2.2.b — casado con memoria + create-on-scan** (cada línea → tu artículo; si no existe, crearlo ahí).
- **C2.2.c — copiloto de avisos** (saltos de precio, caducidades; el de más/de menos ya vive en el resumen anti-error de C2).

**No es:** un módulo de contabilidad/AP (eso es C3 factura + three-way). C2.2 alimenta
la RECEPCIÓN (qué llegó a stock), no la contabilización de la factura.

---

## 1. Lo que el benchmark obliga (y dónde Folvy golea)

- **Precisión líder = 90-95%, no manos libres** (xtraCHEF/MarketMan): SIEMPRE hay revisión
  humana. El diseño la abraza (propuesta + confirmación), no la esconde.
- **La cabecera es fácil (97%+), las LÍNEAS son el problema difícil.** El esfuerzo va al
  casado de líneas, no a leer el nº de albarán.
- **Grieta del mercado #1: sin memoria.** "Tratan cada factura como la primera." → Folvy
  recuerda: por `supplier_code` (ancla fuerte) y por `mapping_proposal` (texto→artículo).
  En la 2ª factura del mismo proveedor, casi todo se auto-casa.
- **Apoyo al TRABAJADOR, no al contable:** la foto rellena la recepción que el cocinero ya
  sabe hacer, en su lenguaje (el panel llano de C2), no una pantalla de AP.

---

## 2. Lo que la muestra real de albaranes enseñó (9 ejemplos)

Rango cubierto, de mejor a peor:
1. **PDF nativo** (Europastry): texto perfecto, ~100%.
2. **Impreso foto recta** (Bidfood): columnas claras, **trae lote + caducidad por línea**.
3. **Impreso foto decente** (Coheldi, Joan): bien; Coheldi trae lote/caducidad y **descuentos %**.
4. **Foto torcida, multipágina, sobre encimera** (Makro): **factura** (no albarán), 2 páginas,
   páginas desordenadas (la foto 1 = pág 2 solo totales; foto 2 = pág 1 con líneas), layout denso.
5. **Manuscrito** (Nobleza Vacuna): escrito a mano, talonario, sello encima. Peor caso.

**Hallazgos que cambian el diseño:**
- **Documentos heterogéneos:** albarán puro, albarán/factura, factura. El extractor entiende
  el documento, no rellena una plantilla rígida.
- **Validar por BASE IMPONIBLE, no por total con IVA.** Cada uno expresa el total distinto
  (Europastry "Total factura" c/IVA; Makro "Importe" s/IVA; Coheldi "SUMA BASES"). La red de
  validación es Σ(líneas) ≈ base imponible; el IVA se chequea aparte (contra el motor fiscal).
- **Multipágina y fotos desordenadas:** una recepción acepta VARIAS imágenes; se juntan y se
  ordenan por el modelo (no asumir orden).
- **Lote y caducidad presentes** en varios → la extracción los captura desde día 1 (hueco FEFO
  ya existe en `goods_receipt_line.lot_code/expiry_date`).
- **Descuentos por línea** (Coheldi 10/12,5/20,39%; Joan %DTO): capturar el **precio NETO**
  (lo que pagas), que es lo que alimenta el coste, no el bruto.
- **Manuscrito existe:** detectarlo, bajar confianza, marcar needs_review. Leer lo que se pueda,
  nunca inventar.
- **Multi-marca/local:** Bidfood/Joan facturan a Cloudtown (marca cedida), Europastry/Coheldi a
  Llorente29; entregan en locales distintos. El destino (cuenta/marca/local) se resuelve, no se asume.

---

## 3. Arquitectura (clonando lo que YA funciona)

C2.2 clona `extract-recipe` (visión + sesión + propuestas de mapeo) y engancha al carril de
mapeo existente (`mapping_proposal` + `run_mapping`), en vez de inventar uno paralelo.

```
Foto/PDF del albarán
   │  (sube a Storage, bucket privado receipt-uploads/{account_id}/...)
   ▼
Edge Function  ocr-albaran   (clon de extract-recipe; visión claude-opus-4-8)
   │  → JSON estricto: cabecera {proveedor, nº albarán, fecha, base, iva, total}
   │                   + líneas [{raw_text, supplier_code?, qty, unit, precio_neto, lote?, caducidad?, descuento?}]
   │  → validación por BASE IMPONIBLE (Σlíneas ≈ base; si no cuadra → needs_review)
   ▼
Sesión IA  goods_receipt_ai_session  (pending_review, guarda raw + parsed + modelo + coste/latencia)
   │
   ▼
CASADO EN CASCADA (por confianza), por línea:
   1) supplier_code EXACTO en article_supplier  → match alta confianza (ancla fuerte)
   2) mapping_proposal existente (texto ya casado antes con este proveedor) → auto
   3) run_mapping / fuzzy por nombre normalizado  → propuesta con confianza
   4) nada  → needs_review  + CREATE-ON-SCAN (crear/elegir artículo o proveedor)
   ▼
Se MATERIALIZA un goods_receipt (status borrador, source='ocr') + sus goods_receipt_line
   con recipe_item_id, qty, precio, lote/caducidad, map_source/map_confidence/map_needs_review.
   ▼
Abre el FORMULARIO DE RECEPCIÓN C2 (anti-error) ya rellenado como PROPUESTA:
   celda Recibido con lo leído (editable), confianza visible, líneas sin casar marcadas.
   El humano revisa → "Revisar y confirmar" (resumen anti-error de C2) → confirma.
   ▼
Al confirmar: lo de siempre (ledger, auto-estado, ripple coste) + APRENDIZAJE:
   - supplier_code visto se guarda en article_supplier (si faltaba)
   - el casado confirmado consolida la mapping_proposal (memoria para la próxima)
```

**Anti-invención (absoluto):** nada toca stock ni coste hasta que la línea tiene artículo
resuelto Y el humano confirma. Confianza baja → needs_review, nunca auto-aplica. Es la celda
vacía de C2 llevada al OCR: el OCR PROPONE en la celda, no decide.

---

## 4. Las tres piezas, en detalle

### C2.2.a — OCR (Edge Function `ocr-albaran`)
- Clon de `extract-recipe`: misma auth dual, CORS, base64 desde Storage, Anthropic visión,
  `extractJson`, manejo 502/422. Modelo `claude-opus-4-8` (configurable).
- **Acepta varias imágenes** (multipágina) en una llamada; el prompt las trata como un único
  documento y ordena él.
- **Prompt específico de albarán español** (no de receta): extrae cabecera + líneas + bloque de
  impuestos. Pide `supplier_code` por línea (el código del proveedor: ancla de casado).
- **Validación por base imponible** en la propia función: Σ(precio_neto×qty) ≈ base → marca
  `needs_review` a nivel de albarán si no cuadra (umbral a definir, p.ej. >1%).
- **Detección de manuscrito / ilegible:** baja `ai_confidence`, marca needs_review.

### C2.2.b — casado con memoria + create-on-scan
- **Reusa `mapping_proposal`** con `source_kind='receipt_line'`, `context_brand_id` para
  multi-marca. NO tabla de memoria nueva.
- **Cascada de confianza** (sección 3). El `supplier_code` es el ancla más fiable (más que el
  nombre). Al confirmar, se guarda en `article_supplier.supplier_code` → la próxima es instantánea.
- **Create-on-scan:** si una línea no casa, en el form se puede (a) elegir un artículo existente,
  (b) crear artículo nuevo (alta mínima: nombre, familia, unidad base) — `source='ocr'`,
  needs_review, sin tocar coste hasta resolver, (c) crear/elegir proveedor si no existe.
- **Resolución de destino** (cuenta/marca/local): se propone por el NIF/nombre del documento y
  el local activo; el humano confirma. (Conecta con la deuda "local activo de sesión".)

### C2.2.c — copiloto de avisos (en el resumen anti-error de C2)
- **Salto de precio:** precio_neto del albarán vs `article_supplier.last_price` → si sube >X%,
  aviso ("Tomate: 1,20€ → 1,80€, +50%"). Conecta con C3/factura.
- **Caducidad próxima:** si la línea trae caducidad y está cerca, aviso.
- **De más / de menos / sin tocar:** YA construido en el resumen de C2.
- Todo con confianza visible. "IA propone, humano decide."

---

## 5. APRENDIZAJE (la grieta del mercado, en dos niveles)

- **Nivel 1 — casado (entra ahora):** cada confirmación alimenta `article_supplier.supplier_code`
  + `mapping_proposal`. La curva de auto-casado sube con el uso. El primer albarán de un proveedor
  nuevo sale a precisión base (90-95%, como los líderes); cada corrección lo mejora.
- **Nivel 2 — formato del proveedor (entra ahora que hay datos reales):** un perfil por proveedor
  con "pistas de formato" (qué columna es el código, si trae lote, cómo expresa cantidades) que se
  inyecta como contexto al modelo en la siguiente lectura (few-shot con la historia del proveedor,
  NO reentrenar un modelo). Diseñable porque hay muestra real variada. Se guarda en la sesión /
  un perfil ligero por supplier.

---

## 6. Esquema: qué se reusa y qué se añade

**Se reusa (sin cambios):** `goods_receipt`, `goods_receipt_line` (ya tienen raw_document_url,
ai_confidence, source, raw_text, map_*, lot_code, expiry_date), `mapping_proposal`,
`article_supplier` (supplier_code, last_price), `recipe_item` (supplier_codes, alt_names, source…),
bucket privado (clonar patrón `recipe-uploads`).

**Se añade (mínimo):**
- `goods_receipt_ai_session` (gemela de recipe_item_ai_session, atada a goods_receipt en vez de
  recipe_item) — o reusar recipe_item_ai_session con FK nullable (decidir; me inclino por tabla
  propia, más limpia).
- Bucket `receipt-uploads` (privado, por account_id) — o subcarpeta en uno existente.
- Perfil de formato por proveedor (Nivel 2): campo jsonb en `supplier` o tabla `supplier_ocr_profile`.

---

## 7. Plan de construcción por capas (cada una usable, deuda 0)

1. **C2.2.a-1:** bucket + subida de foto desde el form + `ocr-albaran` (visión → JSON cabecera+líneas+totales) + validación base imponible. Probar con los 9 albaranes reales.
2. **C2.2.a-2:** sesión IA + materializar goods_receipt borrador con líneas en `raw_text` (sin casar todavía) → abre el form como propuesta. Ya usable: el OCR rellena, el humano casa a mano.
3. **C2.2.b:** casado en cascada (supplier_code → mapping_proposal → fuzzy) + create-on-scan + aprendizaje al confirmar. Aquí se cierra la grieta del mercado.
4. **C2.2.c:** avisos de precio y caducidad en el resumen.
5. **Nivel 2 (formato por proveedor):** perfil + inyección de contexto, medido contra los albaranes reales.

---

## 8. Decisiones que necesito de Julio antes de construir

1. **Bucket:** ¿`receipt-uploads` nuevo (privado) o subcarpeta en `recipe-uploads`? (Recomiendo nuevo: separa dominios.)
2. **Sesión IA:** ¿tabla propia `goods_receipt_ai_session` (recomendado) o reusar `recipe_item_ai_session`?
3. **Orden de construcción:** ¿empezamos por C2.2.a-1 (el OCR puro, probándolo con tus 9 albaranes) y subimos capa a capa? (Recomendado.)
4. **Umbral de "no cuadra" en validación por base** (recomiendo >1% de descuadre → needs_review).
5. **Coste IA:** cada lectura de Opus visión cuesta. ¿Medimos coste por scan desde el día 1 (campo ya existe en la sesión, `ai_cost_eur`)? (Recomiendo sí — para vigilar el margen del propio Folvy.)

> Al aprobar, arranco por el paso 1 (C2.2.a-1) con su RECON puntual de Storage y te pido en UN
> mensaje los ficheros que tocaré.
