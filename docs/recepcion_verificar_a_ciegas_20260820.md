# ENCARGO «Verificar un albarán a ciegas» — resultado

Fecha: 2026-08-20 · Rama: `main` y `claude/redesign-pricing-modal-amxuzy`

> **Migración APLICADA** el 20/08/2026 vía MCP, a petición explícita de Julio, y verificada
> con consulta independiente contra `pg_proc`. Reverso en
> `supabase/migrations/REVERT_20260820T1700_recepcion_verificacion_a_ciegas.sql`.

---

## 0 · Qué pasó en ALB-00119, con los datos delante

Sesión de IA `9bae61b1-fdba-4fd0-a16e-c8450aec72d1`, leída de producción:

```json
"document":   { "handwritten": true, "supplier_name": null, "doc_number": null,
                "bill_to_name": "LLORENTE", "tax_base_total": 424.27,
                "tax_total": 42.27, "grand_total": 466.54 }
"lines":      [ { "raw_text": "Milanesas pollo", "quantity": 56.57, "unit": "kg",
                  "unit_price_net": 7.5, "line_amount": null } ]
"validation": { "needs_review": true,
                "reasons": ["No se pudo validar por base imponible (faltan importes)",
                            "Documento manuscrito", "Confianza de lectura baja"] }
```

**La IA lo leyó bien.** Los tres números distintos salen de tres fallos encadenados:

1. **`unit_price_net` sí estaba, `line_amount` no.** El asistente solo prerrellenaba
   el importe desde `line_amount`, así que la casilla salió vacía → `unit_cost = NULL`.
   424 € de pollo a coste cero.

2. **El artículo se mide en unidades, no en kilos.** `Milanesa de Pollo Rebozado`
   tiene unidad base `ud` (250 g cada una) y cuatro formatos, ninguno en kg. El papel
   dice 56,57 kg; el asistente lo convirtió a Paquetes (6 uds = 1,5 kg):
   56,57 ÷ 1,5 = 37,71 → **38 paquetes = 228 uds = 57 kg**. Sobran 1,72 uds (0,43 kg).
   La pantalla enseña «56,57 uds» porque pinta `doc_qty` con la etiqueta de la unidad
   base del artículo, sin decir que el papel hablaba de kilos.

3. **La bandera de la IA no llegaba a la recepción**, y por dos sitios a la vez:
   `createGoodsReceipt` se llamaba sin `needsReview`, y aunque se hubiera pasado,
   `receive_goods_receipt` la PISABA con `needs_review = (v_skipped > 0)` — un albarán
   con todas las líneas casadas sale `false` por definición, diga lo que diga la IA.

---

## 1 · El tamaño real, con el filtro que faltaba

Las 410 del encargo incluyen líneas de albaranes **anulados o archivados**. Sin ellos:

| | Del encargo | Medido hoy (albarán vivo, no anulado) |
|---|---:|---:|
| Líneas de recepción | 831 (dos cuentas) | 744 en Foodint |
| Marcadas sin confirmar | 410 | **341** |
| Importe en juego | — | **16.108,21 €** |
| Cantidad distinta a la del papel | 53 | 53 |
| Sin coste unitario | 8 | 5 en Foodint |

**Y el aviso amarillo describe mal el problema.** Decía siempre *«Lo emparejó el sistema
por parecido de nombre, no por código»*. De las 408 marcadas en Foodint, **400 son
`map_source='unmapped'`** — el sistema no las casó en absoluto — y en toda la base solo
hay **11 líneas `fuzzy`**. El aviso mandaba a mirar donde no era. Ahora cada línea dice
lo que le pasa a ella (`unverifiedReason`, con 8 pruebas).

---

## 2 · Lo que se ha hecho

### 2.1 · Ver el albarán — `ReceiptOfficeReview.tsx`

El componente ya existía (`ReceiptPhotoViewer`, con zoom, lightbox y visor de PDF) y
esta pantalla no lo usaba. Ahora:

- **Pantalla ancha**: dos columnas, el papel a la derecha y `sticky` — sigue visible al
  bajar por las líneas.
- **Móvil**: botón grande *Ver el albarán* (no un icono de 9 px).

Sirve para los dos formatos porque el visor ya los distinguía: ALB-00119 es `00-image.jpg`,
ALB-00117 es un PDF de Bidfood.

### 2.2 · Corregir cantidad, formato y coste

`adjust_goods_receipt_line` estaba desplegada desde el 13/08 y en 24 h se llamó 2 veces
frente a 357 peticiones de la pantalla. **No faltaba construirla: no se llegaba a ella.**
Dos huecos, los dos tapados:

- El editor **solo dejaba cambiar cantidad y coste, no el formato**. Un albarán en kilos
  casado a un formato de 6 unidades no tenía arreglo desde la pantalla — el caso ALB-00119.
  Ahora hay desplegable de formato con la medida en la etiqueta («Paquete (1,5 kg)»).
- El botón **solo estaba en las líneas resueltas**. Las 341 marcadas son *dudosas*, y una
  dudosa solo ofrecía *Sí, es esta* / *No, es otro artículo*: si el artículo era el
  correcto pero la cantidad estaba mal, no había por dónde. Ahora hay un tercer botón,
  **Corregir cantidad, formato o precio**.

El editor enseña, mientras escribes, **lo que va a entrar al almacén** y el total.
Exige motivo (`discrepancy_reason`) siempre que se mueva cantidad o formato — corregir
solo el coste no mueve stock. Escribe **siempre** por `adjust_goods_receipt_line`
(reverso + reposteo, quién y por qué), nunca por un `UPDATE` (§9.8).

### 2.3 · Proveedor y nº de albarán

Editables en la cabecera, y **obligatorios para cerrar** — en la pantalla y también en
el servidor (`confirm_goods_receipt`), para que no dependa de que la pantalla se acuerde.
La exigencia solo aplica al cierre de OFICINA (`recibido` → `confirmado`); un borrador
manual sigue igual, para no levantar un muro sin puerta donde no se puede arreglar.

Impacto medido: de 114 recepciones confirmadas, **0 sin proveedor y 4 sin nº**.

### 3 · Que no se repita — la migración

`20260820T1700_recepcion_verificacion_a_ciegas.sql`, tres piezas:

| | Qué |
|---|---|
| **A** | `_post_goods_receipt_lines(p_receipt_id, p_only_unposted default false)` — postear solo las líneas que nunca han posteado. Sin el parámetro, idéntica a hoy. |
| **B** | `receive_goods_receipt(p_receipt_id, p_hold default false)` — `p_hold` deja el albarán en `'recibido'` (para que la oficina lo pueda abrir) pero **no postea nada** y marca `needs_review`. Y deja de PISAR una bandera que venga puesta. |
| **C** | `confirm_goods_receipt` — al cerrar un `'recibido'`, entra lo que aún no había entrado. Para un albarán normal no cambia nada: sus líneas posteables ya tienen movimiento. |

**Por qué se retiene el posteo y no el estado**: un borrador va a `GoodsReceiptForm`, no
a la pantalla de oficina, y `adjust_goods_receipt_line` exige `status='recibido'`.
Retener en borrador dejaría el albarán fuera del único sitio donde se puede corregir.

Verificado que nada más en la base llama a esas funciones: solo se mencionan en
comentarios de `adjust_goods_receipt_line` y `post_pending_receipt_line`.

En el asistente, un albarán retenido:
- enseña al trabajador los motivos de la IA antes de guardar,
- cambia el botón a **«Guardar y mandar a oficina»**,
- y no aprende nada (`learnFromReceipt`, `last_price`, cascada de coste): aprender de un
  albarán que la IA marcó dudoso es exactamente cómo se contamina el catálogo.

### 6 · La lista de las líneas sin confirmar

`UnverifiedLinesPage.tsx`, nueva. Todas las líneas marcadas de la cuenta, **ordenadas por
importe**, cada una con su albarán detrás a un clic. Filtro por local. Distingue las que
están en el almacén de las que no entraron. Entrada desde el aviso de la lista de
recepciones, que ahora es un botón, no un cartel.

---

## Aplicación de la migración · 20/08/2026

**Primer intento: falló y revirtió solo.** La comprobación comparaba
`pg_get_function_identity_arguments(oid) = 'uuid, boolean'`, pero en este Postgres esa
función devuelve **los nombres** (`p_receipt_id uuid`), no solo los tipos. La transacción
revirtió entera y producción quedó intacta — verificado: las tres funciones seguían con
1 argumento. El cinturón hizo su trabajo; el fallo era de mi comprobación, no del SQL.
Ahora comprueba estructura (`pronargs` / `pronargdefaults` / `proargtypes`), no texto.

**Segundo intento: timeout de red**, sin respuesta. No se reintentó a ciegas: se comprobó
primero el estado (nada aplicado) y se troceó en tres pasos. Los estados intermedios son
seguros — con A puesta y B sin poner, la llamada de 1 argumento resuelve por el `default`.

**Estado final, verificado con consulta independiente:**

| Función | Argumentos | Comprobación |
|---|---|---|
| `_post_goods_receipt_lines` | `p_receipt_id uuid, p_only_unposted boolean DEFAULT false` | tiene el modo «solo lo no posteado» |
| `receive_goods_receipt` | `p_receipt_id uuid, p_hold boolean DEFAULT false` | tiene la rama de retención |
| `confirm_goods_receipt` | `p_receipt_id uuid` | postea lo no posteado · exige nº de albarán |

Exactamente una de cada. **Cero datos tocados**: 0 recepciones y 0 líneas modificadas;
los 67 movimientos de stock de esa hora son `consumo` por ventas, ninguno de esto.

### El cliente prueba las dos formas

Desde este entorno **no se puede probar la resolución de PostgREST** (la política de red
bloquea HTTPS directo a Supabase; solo pasa el MCP). En vez de asumir que PostgREST
resuelve el argumento por defecto, `receiveGoodsReceipt` intenta la llamada de **2**
argumentos y, si el servidor responde que esa función no existe, reintenta con la de **1**.

Eso cubre las tres formas de romperlo: la caché de esquema de PostgREST todavía con la
firma vieja, un despliegue en orden inverso, y que alguien ejecute el REVERT. Con
`hold=true` no hay reintento — retener no se puede emular con la firma vieja sin postear
el stock, que es justo lo que se evita: se explica y la recepción se queda en borrador.

---

## Criterio 1 · La corrección de ALB-00119

**No la he ejecutado yo, y es deliberado.** `adjust_goods_receipt_line` escribe
`created_by = auth.uid()`; llamándola desde MCP (rol de servicio) el movimiento de 424 €
quedaría firmado por nadie, que es justo lo contrario de lo que pide el criterio (§9.8,
rastro). Se hace desde la pantalla, con el botón **Corregir** nuevo — y así el criterio 3
se verifica con el mismo gesto.

**Los números, sacados del papel:**

| Campo | Valor | De dónde sale |
|---|---|---|
| Proveedor | **NOBLEZA VACUNA SL** (a confirmar con el papel) | es el proveedor **preferido** de este artículo y su ficha está en formato *Paquete*, el mismo de la línea. El albarán es manuscrito: la IA no leyó emisor. |
| Nº de albarán | el que venga en el papel | la IA lo leyó como `null` |
| Formato | **Paquete** (6 uds = 1,5 kg) | el que ya tiene; no hay ningún formato en kg |
| Cantidad | **37,713333** | 56,57 kg ÷ 1,5 kg/paquete |
| Coste de cada uno | **11,25 €** | 7,50 €/kg × 1,5 kg/paquete |
| Motivo | *lo dice el albarán* | |

Comprobación: 37,713333 × 11,25 = **424,27 €** ✓ (base imponible del papel)
y 37,713333 × 6 = **226,28 uds** al almacén, frente a las 228 que hay ahora.

**Aviso de precio**: `article_supplier.last_price` de este artículo con NOBLEZA está en
1,25 €/ud = 5,00 €/kg. El papel dice 7,50 €/kg, **un 50 % más**. Puede ser real o puede
ser un 5 leído como 7 en letra manuscrita. Con el papel delante se resuelve en un
segundo; ése es exactamente el punto del encargo.

---

## Criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | ALB-00119 corregido con la función y motivo | Números listos arriba · **lo ejecuta Julio desde el botón Corregir** (razón explicada) |
| 2 | El albarán se ve sin salir de la pantalla (foto y PDF) | ✅ implementado · falta tu captura |
| 3 | Cambiar cantidad, formato y coste con rastro | ✅ implementado · falta tu captura |
| 4 | Proveedor y nº se pueden poner y sin ellos no se cierra | ✅ pantalla + servidor (tras la migración) |
| 5 | Una recepción con `needs_review` no postea stock | ✅ código · **efectivo al aplicar la migración** |
| 6 | Lista de las líneas sin confirmar por importe | ✅ `UnverifiedLinesPage` · **341 líneas, 16.108,21 €** |

## Comprobaciones

`tsc -b` limpio · `npm run build` limpio · **31 pruebas, 3 ficheros, todas pasan**
(8 nuevas de `unverifiedReason`).
`eslint`: los mismos errores que ya había antes del encargo, verificado con `git stash`
(2 en `GoodsReceiptsPage`, 2 en `ReceiptScanPanel`/`ReceiptWizard`, todos
`set-state-in-effect` preexistentes). `UnverifiedLinesPage.tsx` sale limpia.
