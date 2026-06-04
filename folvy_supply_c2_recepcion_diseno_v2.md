# Folvy Supply — C2 v2: Recepción como keystone del "Guardián de Margen"
**Diseño para aprobación · 2026-06-04 · Julio Gª Colón / Claude**
**Estado:** PROPUESTA v2 (sustituye a v1). Nada construido. Aprobar antes de tocar BBDD/repo.
**Cambio vs v1:** v1 era un cimiento sólido pero, como demo, **paridad** (ledger+WAC+recepción los tienen todos). v2 subordina ese cimiento a un **arma defendible que ni los mejores tienen** y secuencia para que el wow salga pronto.
**Regla aplicada:** benchmark del mejor + lo más moderno + deuda 0. Tablas = diseño, no migración.

---

## 1. DECISIÓN ESTRATÉGICA — el arma (verificada 06/2026)

### Lo que hacen TODOS los mejores
R365, Supy, meez, Crunchtime, MarketMan calculan la varianza **real vs teórico**, la **desglosan por ingrediente** y muestran el *menú de causas posibles* (sobre-porción, merma, robo, subida de precio, error de conteo). Luego **el operador investiga la causa a mano**. Datos conectados sí; **atribución automática de la causa, no**. Y **ninguno** cruza personal + seguridad alimentaria + economía de canal de delivery (no los tienen nativos).

### El hueco que ni los mejores tienen
**Atribuir automáticamente cada € de fuga a su causa concreta, con evidencia, cruzando módulos.** Requiere una sola verdad con: compra (precio real), inventario (consumo), escandallo, ventas, **personal** (turno/estación), **APPCC** (descarte, rotura de frío) y **canal** (margen por marca/canal, ya calculado en EP1). **Folvy es el único sistema de hostelería que los tiene todos.** El dinero es real y conocido por el sector: ~4 % de varianza sobre 1 M€ ≈ 40.000 € recuperables sin vender más.

### El arma: "Guardián de Margen" (nombre de trabajo)
Bucle cerrado que, ante una fuga, responde con **causa + € + evidencia + acción**, en lenguaje de cocinero. Ejemplo objetivo de demo:
> *"Esta semana perdiste 47 € de solomillo. 30 € = sobre-porción en el turno del viernes noche (covers × escandallo vs consumo del ledger; partida y responsable). 17 € = el proveedor te subió el precio un 22 % en la última entrega (comparativa para renegociar o cambiar)."*

Es **moderno** (agéntico + proactivo): elige **qué verificar** (= autoinventario IA por cycle counting, idea obligatoria) y avisa **antes** de que la fuga componga. Es **ROI real**, no "otra IA que no mueve la aguja" (el mercado está lleno de claims sin entrega — esa es la grieta).

### North star vs alcance honesto (deuda 0)
El Guardián completo (atribución cruzando los 5 dominios) es la **estrella polar** y se completa según se conectan los módulos (C2 + C3 + consumo + IA + APPCC/Personal ya existentes). **C2 no entrega el Guardián entero**; entrega (a) la **verdad de coste y cantidad** que hoy le falta al bucle, y (b) el **primer trozo demostrable**. Lo que C2 no cierra se declara abajo, no se vende.

---

## 2. POR QUÉ C2 ES LA PIEZA CLAVE (no fontanería)

La recepción es donde entran como **dato duro** dos de las mayores causas de fuga:
- **Verdad del precio:** ¿te subió el proveedor? → ripple al escandallo y al margen por canal.
- **Verdad de la cantidad:** ¿te sirvió de menos / de más? → merma de proveedor que hoy nadie ve hasta el inventario.

Sin el ledger + recepción de C2, el Guardián es **ciego** a estas dos. Por eso C2 es el keystone: convierte el bucle de "dashboard" en "sistema con inputs reales".

---

## 2.bis — PRINCIPIO TRANSVERSAL: IA propone, humano decide (interacción constante)

No es una feature aislada: gobierna **cada paso** de C2. La IA hace el trabajo pesado y propone; **el humano confirma con un toque**, siempre con la confianza visible y la opción de corregir. Anti-invención absoluta: si la IA duda, marca `needs_review` y NO actúa. Dónde aparece en C2:

- **Mapeo de línea de albarán (OCR):** la IA propone el `recipe_item` y el formato (`map_confidence` visible); el humano confirma o reasigna. Confianza baja → `needs_review`, no se postea.
- **Create-on-scan:** la IA pre-rellena el alta de proveedor/artículo desde el albarán (`source='ocr'`, `needs_review=true`); **el humano valida** antes de que entren al maestro como confirmados. Nunca alta silenciosa.
- **Guardia en el momento de recibir:** la IA avisa ("te sirvieron de menos 2 kg = 11 €", "+22 % vs última entrega", "lote caduca en 2 días"); **el humano decide** (aceptar la merma, reclamar, registrar). La IA no reclama sola.
- **Atribución de causa (Guardián):** la IA propone la causa con su evidencia y €; **el humano valida o reclasifica**. Las correcciones reentrenan el criterio (mejor cada vez).
- **Cycle counting (autoinventario IA):** la IA elige **qué** contar (ABC/riesgo/anomalía) y **quién**; **el humano cuenta y confirma**. La diferencia se analiza y comunica sola, pero la acción la decide el humano.

Regla de UX: cada paso es **didáctico** (enseña mientras captura) y **de un toque** para el no-técnico. La IA reduce trabajo; nunca lo oculta ni decide sin el humano.

---

## 3. CIMIENTO (de v1, se mantiene — condensado)

- **Libro mayor `stock_movement` = única fuente de verdad.** El stock no es un campo editable; es la suma de movimientos (auditable, reconstruible).
- **Valoración: coste medio ponderado móvil (WAC) derivado del ledger.** Legal en España (PGC/NIIF). **LIFO descartado — ilegal en ES.** FIFO/FEFO no se descarta: el ledger lleva `lot_id`/caducidad **nullable día 1**, la capa de lotes lo activa después sin reescribir.
- **Dos lentes de coste deliberadas = el AvT:** escandallo (reposición, "qué cuesta hacerlo hoy", **intacto**) vs inventario (WAC, "qué valía lo que gasté"). Su diferencia es la merma. Mantenerlas separadas es correcto, no deuda.
- **Anti-invención:** línea sin conversión a base o sin mapear → `needs_review`, **no postea** dato inventado.
> Antes de implementar: RECON del cuerpo de la función de coste (`20260603T1700`) para confirmar independencia. El diseño las mantiene separadas a propósito.

---

## 4. MODELO DE DATOS (diseño, no migración)

Patrón de la casa: `account_id` + RLS, `is_active`/`archived_at`, timestamps, `created_by`/`created_by_name`.

### 4.1 `goods_receipt` — cabecera (qué llegó)
`purchase_order_id` **nullable** (recepción ciega), `location_id` **obligatorio** (multi-local), `supplier_id`, `receipt_code` (`ALB-00001`), `receipt_date`, `received_at`, `status` (`borrador`→`confirmado`→`anulado`), `notes`. **Ganchos OCR:** `source` (`manual`|`ocr`), `raw_document_url`, `ai_confidence`, `needs_review`.

### 4.2 `goods_receipt_line` — línea recibida
`goods_receipt_id`, `purchase_order_line_id` **nullable** (comparativa pedido↔recibido), `recipe_item_id` **nullable** (hasta mapear), `product_name`, `raw_text` (OCR), `qty_received` + `purchase_format_id` + `purchase_unit_id`, `qty_in_base` (derivado; NULL+`needs_review` si no hay conversión), `unit_cost` **nullable** (el albarán no suele traer precio), **ganchos FEFO:** `lot_code`/`expiry_date` nullable, trío `map_source`/`map_confidence`/`map_needs_review`, `position`, `notes`.

### 4.3 `stock_movement` — el libro mayor
`location_id`, `recipe_item_id`, `movement_type` (`recepcion`|`consumo`|`ajuste`|`traspaso_entrada`|`traspaso_salida`|`recuento`), `qty_base` (con signo), `unit_cost` + `cost_provisional` (entrada de albarán = provisional; C3 revalúa), **referencia polimórfica** `source_type`+`source_id` (`goods_receipt_line` hoy; `sale`/`inventory_count`/`transfer` futuros), `lot_id` nullable, `occurred_at`, `notes`. Índice `(recipe_item_id, location_id, occurred_at)`.

### 4.4 `recipe_item_location_stock` — snapshot por (artículo, local)
`qty_on_hand`, `avg_unit_cost` (WAC), `stock_value`, `updated_at`. Mantenido por función/trigger sobre `stock_movement`; **caché de lectura, la verdad es el ledger**. `recipe_item.current_stock` deja de escribirse a mano (verificar lectores con `git grep` antes de tocarlo).

### 4.5 CREATE-ON-SCAN (apunte de Julio — el albarán construye el maestro de datos)
Al resolver una línea de albarán, si falta la entidad **se crea en línea**, atacando el dolor nº1 (alta manual):
- **Proveedor desconocido →** crear `supplier` (nombre + `tax_id` si el albarán lo trae), `source` marcable, confirmable después.
- **Artículo desconocido →** crear `recipe_item` mínimo (`name`, unidad base propuesta, `is_purchasable=true`, `source='ocr'`, `needs_review=true`).
- **Relación →** crear/actualizar `article_supplier` (`supplier_code` del albarán, `purchase_format_id`) y el `recipe_item_purchase_format` si el formato es nuevo.
- **Regla de oro:** lo creado entra al catálogo para poder mapear y postear cantidad, **pero NO toca coste** hasta tener ingrediente + conversión resueltos. Coherente con anti-invención. La línea entra a stock solo cuando `recipe_item_id` + `qty_in_base` están resueltos; si no, queda `needs_review` sin postear.

> SECURITY DEFINER: la función que postea al ledger / crea entidades / refresca snapshot se prueba **desde la app** (sesión), nunca en SQL Editor. DDL sin BEGIN/COMMIT; verificación en transacción aparte.

---

## 5. SECUENCIA DE CONSTRUCCIÓN (wow temprano, no 3 semanas de tubería)

- **C2.1 — keystone + primer wow.** Recepción manual contra pedido (parcial / ciega / comparativa pedido-vs-recibido) + `stock_movement` + WAC + snapshot. **Y el primer golpe demostrable:** al recibir con un precio distinto, **ripple en vivo al escandallo y al margen por marca/canal** (reusando EP1). Demo: *"subes el pollo y ves al instante que tu plato X por Glovo entra en margen negativo"* — eso ningún incumbente lo enseña en 5 min con datos del cliente.
- **C2.2 — OCR + create-on-scan.** Foto del albarán → líneas → mapeo asistido (reusa el motor del webhook de Last) → create-on-scan de proveedor/artículo. Guardia en el momento: "te sirvieron de menos", "subió un 22 %", "este lote caduca en 2 días".
- **C3 — factura + three-way + revaluación** del coste provisional (eslabón coste real).
- **Consumo perpetuo + Guardián.** `movement_type='consumo'` (ventas × escandallo) → varianza → **atribución de causa cruzando módulos** (Personal/APPCC/precio) → autoinventario IA (cycle counting) eligiendo qué/quién contar.

---

## 6. DECISIONES (yo recomiendo; tú das el go)

**Las decido yo (recomendación, dime si discrepas):**
1. Punta de lanza de la demo = **bucle cerrado con causa + ripple de margen por canal** (combina tu idea obligatoria con el activo único EP1). 
2. Confirmar recepción = **reversible** (anular postea movimientos de reverso; honestidad del ledger).
3. `recipe_item.current_stock` = se deja, se deja de escribir a mano, lo rellena una vista; sin romper lectores (verifico con `git grep`).
4. Coste provisional al recibir = `est_unit_price` del pedido → `last_price`; el real lo fija C3.

**Lo que necesito de ti (un solo go):**
- ¿Apruebas este diseño v2 y arrancamos **C2.1**? Si sí, en el siguiente turno te pido **en un único mensaje** todos los ficheros que tocaré (servicios/UI de Supply, registro de módulos, tipos) y hago el **RECON del cuerpo de la función de coste** antes de la primera migración.

---

## 7. Veredicto "¿somos los mejores aquí?" (control rector)

- **Recepción + ledger + WAC:** paridad de cimiento, ahora **subordinado** al arma (no se vende como victoria).
- **Atribución de fuga por causa cruzando módulos:** **goleada defendible** — verificado que los mejores se quedan en desglose por ingrediente + investigación manual, y ninguno tiene personal+APPCC+canal nativos.
- **Create-on-scan (el albarán construye el maestro):** ataca el dolor nº1; iguala el OCR de xtraCHEF/MarketMan y suma el auto-alta que ellos no rematan.
- **Deuda explícita:** Guardián completo = north star multi-frente (C2 pone el keystone, no el todo). OCR real = C2.2. FIFO/FEFO real = capa de lotes (gancho hoy). Atribución multi-dominio total = según se conectan módulos.
