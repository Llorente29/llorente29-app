# El albarán con IVA incluido — qué se ha construido

**Fecha:** 31/08/2026 · **Rama:** `claude/recepcion-iva-coste-visible`
**Reportado por:** Julio, captura de ALB-00134 (AMIRSA, Alcalá)

---

## 0. Verificado en producción antes de tocar nada

Regla 5 — verificar con la query, no con la afirmación.

**ALB-00134** (`goods_receipt.code`, nº de proveedor 2026/15660):

| Línea | `qty_received` | `qty_in_base` | `doc_amount` | `unit_cost` | editado |
|---|---|---|---|---|---|
| Pollo loncheado 10x1Kg | 1 | 10.000 g | 92,00 | **83,63636363636364** | 17:48:07 UTC |
| Ternera loncheada 10x1Kg | 1 | 10.000 g | 99,00 | **90** | 17:48:49 UTC |
| PAGADO (`not_goods`) | 1 | — | 0,00 | — | 17:46:37 UTC |

Los dos costes son el importe del papel ÷ 1,10. **Las dos ediciones se guardaron.**
El fallo estaba entero en la lectura.

**El esquema, comprobado en `information_schema`:**
- `goods_receipt_line` tiene `doc_amount` y `unit_cost` — dos columnas, dos verdades. Correcto, no se toca.
- `supplier` **no tiene ninguna columna de IVA** → el punto 4b necesita SQL (ver §4).
- Ya existen `vat_category`, `vat_rate` y `family_vat_default`. Responden a otra pregunta
  (qué tipo lleva un ARTÍCULO); no sirven para «cómo escribe sus importes este PROVEEDOR».

**Huella del histórico, para la verificación 6:**
```sql
select count(*) as lineas,
       md5(string_agg(id::text||':'||coalesce(unit_cost::text,'-')||':'||coalesce(doc_amount::text,'-'), ',' order by id)) as huella
  from goods_receipt_line;
```
→ **921 líneas · `0f41e326de3f2b17c6ef8fc6bf45a16f`**, antes y después. Idéntica.

---

## 1. Las tres capas del fallo, y dónde estaba cada una

| # | Lo reportado | Dónde | Arreglo |
|---|---|---|---|
| 1 | La tarjeta plegada enseña `doc_amount`, no `unit_cost` | `ResueltaRow`, línea del importe | `ImportesLinea`: **«Papel: 92,00 € · Al almacén: 83,64 €»**, siempre las dos con su nombre |
| 2 | El redondeo esconde la corrección | `perUnit` se calculaba desde `doc_amount` **y** se pintaba con `fmtMoney` (2 decimales) | sale de `unit_cost` y se pinta con `fmtMoneyPrecise` → **0,0084 €/g** frente a 0,0092 |
| 3 | Guardar no confirma nada | `saveEditor` solo recargaba | banner verde con el valor **que devuelve el servidor** |

El §2 tenía **dos** causas encadenadas, no una: aunque se hubiera arreglado el redondeo, el
número seguía saliendo del papel y no se habría movido al corregir el coste. Y el mismo cálculo
estaba copiado a mano en **tres** sitios (`ResueltaRow`, `DudosaRow` y el bloque del desglose),
los tres partiendo de `doc_amount`: el mismo error tres veces. Ahora vive una sola vez en
`src/modules/supply/lib/lineCost.ts` (regla del 19/08: un dato se calcula en un sitio).

---

## 2. Los cinco puntos

**1 · Las dos cifras con su nombre.** `ImportesLinea`, usado por la fila resuelta; el desglose de
la dudosa enseña las dos cuentas («Al almacén: 83,64 ÷ 10.000 = 0,0084 la g» y debajo la del
papel). Se enseñan **también cuando coinciden**: que coincidan es información.

**2 · Precisión suficiente.** `fmtMoneyPrecise` en `src/lib/format.ts` — al menos dos cifras
significativas, suelo de 2 decimales y techo de 6. Los importes de línea siguen con `fmtMoney`:
quien cuadra un albarán contra un papel espera «92,00 €», no «92,0000 €».

**3 · Guardar confirma o falla.** La confirmación se **deriva en render** de la línea recargada,
nunca de lo tecleado, y no se pinta hasta que ha vuelto una recarga *posterior* a la petición
(`pendingConfirm.tick` vs `loadedTick`) — si no, durante el hueco enseñaría el valor viejo y diría
«guardado: 92,00 €» justo después de guardar 83,64: el mismo fallo, en verde. Si la escritura
falla, el editor se queda abierto con lo escrito y el error a la vista: no se recarga, no se
cierra y **no se confirma nada**.

**4 · Quitar el IVA deja de ser aritmética mental.**
- Casilla **«El precio del papel lleva IVA»** en el editor de línea, con 4/10/21 % y un hueco para
  escribir otro. Marcarla calcula el neto, **lo escribe en el campo** (que sigue editable) y
  enseña la frase: *«Papel 92,00 € con IVA 10 % → al almacén 83,64 € cada uno»*.
- El bruto sale del papel (`doc_amount ÷ unidades`); si el papel no dice importe, se toma lo
  escrito y el texto lo dice («Lo escrito 92,00 €…»), en vez de callarse de dónde sale.
- **El TIPO es del ARTÍCULO** (decisión de Julio, 31/08). Ver §2-bis.
- En el proveedor solo se guarda **la costumbre**: un booleano. Si está marcado, el editor lo dice
  y ofrece la casilla, pero hay que marcarla. Nunca en silencio.

---

## 2-bis · De dónde sale el tipo (revisión de Julio, 31/08)

> «El tipo sale de vat_category/vat_rate del artículo (con family_vat_default como cascada). Si un
> artículo no tiene categoría, la línea lo dice y pide el tipo en vez de suponerlo.»

Un `default_vat_rate` en `supplier` habría sido una **tercera verdad sobre el tipo**, compitiendo
con la del artículo y ganándole por estar más a mano. El tipo es del artículo; la costumbre de
meterlo o no en el importe de línea es del proveedor. Dos ejes, dos sitios.

La cascada vive en `src/modules/kitchen/services/vatRateService.ts` y tiene **tres salidas**:

| Salida | Cuándo | Qué hace la pantalla |
|---|---|---|
| `articulo` | `recipe_item.vat_category_id` con tipo vigente | siembra el tipo y dice de dónde sale: «10 % por su categoría fiscal (Alimento general)» |
| `familia` | sin categoría propia, familia mapeada y **no mixta** | siembra y lo dice: «10 % por su familia «Carnes y aves»» |
| `ninguno` | ni una cosa ni la otra | **campo vacío**, y lo dice: «Este artículo no tiene categoría fiscal… Elige el tipo que ponga el albarán» |

**Dos frenos que salen de los propios datos, para no suponer:**

- **`family_vat_default.is_mixed`** — 6 de las 16 familias mapeadas están marcadas como mixtas
  (Bebidas sin alcohol, Congelados, Charcutería y quesos, Cereales, Aceites, Panadería). Mixta
  significa «esta familia tiene varios tipos»: su defecto es una lista de candidatos, no una
  respuesta. **Una familia mixta no resuelve: pregunta.**
- **`recipe_item.vat_category_source`** — el modelo distingue `proposed` de `confirmed`
  precisamente para no mentir en silencio. Una categoría solo propuesta **sí** resuelve (es la
  mejor respuesta que hay) pero viaja marcada, y la pantalla lo dice: «…propuesta y aún sin
  confirmar».

**Estado real del catálogo fiscal (contado en producción el 31/08):**

| | |
|---|---|
| categorías / tipos / vigentes hoy | 5 / 6 / 5 |
| familias mapeadas | 16, **6 de ellas mixtas** |
| artículos | 1.072 |
| **con categoría propia** | **273 (25 %)** |

O sea: **hoy el camino mayoritario es el que pregunta.** No es un fallo del módulo, es el estado
del catálogo — y es la razón por la que preguntar tiene que quedar bien resuelto en pantalla y no
ser un caso raro de esquina. Cada ficha que se clasifique es una línea que deja de preguntar.

**El caso real resuelve solo:** los dos artículos del ALB-00134 (Kebab Pollo Loncheado y Kebab
Ternera Loncheado, familia «Carnes y aves») están en `alimento_general` = **10 %** por su propia
categoría — exactamente el tipo que Pamela aplicó a mano. Su `source` es `proposed`, así que la
pantalla lo dirá.

**5 · Aviso «este importe parece llevar el IVA dentro».** Bloqueante-suave antes de cerrar, junto
a los avisos de coste que ya existían. Es el caso ALB-00080. **Solo salta si el proveedor está
marcado**: en Cloudtown (597 líneas), Makro (79) o Europastry (22) `unit_cost = doc_amount` y eso
es lo *normal* si el albarán lista base imponible. Un aviso que no se puede afirmar enseña a
ignorar los que sí. Si el artículo no tiene tipo resuelto, el aviso **salta igual** pero sin
proponer cifra: papel = almacén sigue siendo sospechoso en ese proveedor, y callarse el aviso por
no saber el tipo sería esconder el problema.

---

## 3. Lo que NO se ha hecho, y por qué

- **Ni un UPDATE sobre el histórico.** La huella de `goods_receipt_line` es la misma antes y
  después. La pregunta abierta del encargo sigue abierta y es de Julio con los papeles delante.
- **Nada retroactivo sobre ALB-00080.** Está fuera de alcance por el propio encargo.
- **`border-default`** (deuda heredada, ver el RECON del filtro por local): no se toca aquí.

---

## 4. LO ÚNICO QUE FALTA POR EJECUTAR — y no bloquea el despliegue

`supabase/migrations/PROPUESTA_20260831T1900_supplier_iva_incluido.sql`
**Está SIN APLICAR.** Claude Code propone, Julio ejecuta y verifica.

Añade **una** columna a `supplier` — `iva_incluido_en_linea boolean not null default false` — y
marca **AMIRSA** con guarda anti-homónimos. Sin tipo: la guarda final **falla a propósito** si
alguien añade un `default_vat_rate` o `vat_rate` a `supplier`, y comprueba que existen las tres
tablas de las que sí sale el tipo. **No toca `goods_receipt_line`.**

Julio (31/08): entra mañana en la ventana; es aditiva y de riesgo bajo.

**El front va desplegado ya y funciona sin ella**, porque los puntos 1, 2, 3 y la casilla por
línea del 4 no necesitan base de datos. La lectura de las columnas usa el patrón de
`notify_group` (`select('*')` + mapeo tolerante), así que no falla cuando no existen; y
`vatSettingsAvailable` distingue «la columna no existe» de «existe y vale false», de modo que la
ficha del proveedor **esconde** el bloque «Cómo factura» hasta que el SQL esté aplicado, en vez de
ofrecer un interruptor cuyo guardado devolvería un 400. No hay despliegue que coordinar en
ninguna de las dos direcciones.

Lo que queda dormido hasta aplicarla: el defecto por proveedor (4b) y el aviso del punto 5.

---

## 5. Verificación

| # | Exigido | Estado |
|---|---|---|
| 1 | ALB-00134: «papel 92,00 · al almacén 83,64» y el €/g distingue 0,0084 de 0,0092 | **Probado** con los datos reales en `tests/unit/modules/supply/lineCost.test.ts`, incluido el test que demuestra que `fmtMoney` los aplastaba los dos en «0,01 €». Falta verlo en pantalla |
| 2 | Editar y guardar: confirmación con el valor nuevo; recargar lo mantiene | Construido; el texto sale del servidor, no de lo tecleado. **Comprobación en vivo de Julio** |
| 3 | Error de red al guardar: la pantalla NO da el cambio por bueno | Construido: en el `catch` se limpia `pendingConfirm`, no se recarga y no se cierra el editor |
| 4 | Marcar «IVA 10 %» sobre 92,00 propone 83,64 y deja editarlo | **Probado** (`netoDesdeBruto(92, 10)` → 83,63636…; el campo queda editable) |
| 5 | El total sigue cuadrando (191,00 de 191,00) aunque los netos sumen menos | **Probado**: papel 191,00 · almacén 173,64. El pie del albarán no se ha tocado |
| 6 | Ninguna línea del histórico cambia | **Verificado en BBDD**: 921 líneas, huella `0f41e326…` idéntica antes y después |
| 7 | build + tsc + lint limpios | `tsc -b` sin salida · `vite build` ✓ · lint sobre los ficheros tocados: **los mismos 5 hallazgos que en main**, cero nuevos. 23 tests nuevos verdes; los 6 fallos de la suite son los de main |

### La comprobación en pantalla
1. Abrir ALB-00134 → la línea de Pollo dice «Papel: 92,00 € · Al almacén: **83,64 €** · **0,0084 €** la g».
2. «Corregir» → cambiar el coste → Guardar → banner verde: «Guardado: … entra al almacén por
   83,64 € (0,0084 € la g). El papel sigue diciendo 92,00 €». Recargar: se mantiene.
3. «Corregir» → marcar «El precio del papel lleva IVA» al 10 % → el campo se rellena con 83,64 y
   sale la frase. Sin pulsar Guardar no cambia nada.
4. El pie sigue diciendo **191,00 € de 191,00 €**.
