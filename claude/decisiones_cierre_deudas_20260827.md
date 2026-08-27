# Decisiones de cierre de deudas — 27/08/2026

Tomadas por Julio, ejecutadas o cerradas. **Esto no es una lista de pendientes:
es el registro de lo que se decidió y por qué.** Si dentro de tres meses alguien
encuentra una de estas cosas y piensa "hay que arreglarlo", que lea esto primero.

---

## CLOUDTOWN · 2.875,42 € en tres albaranes anulados — NO SE RECONSTRUYE

`ALB-00091` (05/08, 1.361,20 €), `ALB-00092` (05/08, 667,71 €) y `ALB-00106`
(12/08, 846,51 €). **Foodint Carabanchel**, 42 líneas, 0 movimientos posteados.

### Lo que se midió antes de decidir

| | |
|---|---|
| Líneas totales | 42 |
| Con `qty_received` y `unit_cost` | 42 |
| **Con artículo asignado** | **0** |
| **Que casan por nombre exacto contra `recipe_item`** | **0** |
| **Con unidad de compra o formato** | **0** |
| Artículos distintos a mapear | 31 |
| Conteos aprobados en el local desde el 05/08 | **14** (+1 en revisión) |

Reconstruirlas no es un script: son 31 decisiones de mapeo más 31 de formato
(sin formato no hay conversión a `qty_in_base`, que es lo que postea stock),
más revisar 42 cantidades con el albarán delante. Medio día largo.

### La decisión

**No se reconstruyen.** Los conteos ya absorbieron el hueco, el stock actual es
correcto, y medio día de trabajo para arreglar un histórico que nadie va a
mirar no compensa.

Y había un riesgo encima: postear esas entradas con fecha 05/08 y 12/08 las
metería **por debajo de catorce conteos aprobados** cuyos ajustes ya taparon el
agujero a mano. Es A3 otra vez, con más conteos encima.

**Cerrado. No es deuda pendiente.**

---

## A4 · Las 19 líneas de recepción "duplicadas" — NO ERAN DUPLICADOS

Pendientes de revisar una a una desde la auditoría del 25/08. Revisadas.

| veredicto | líneas | movimientos | € neto |
|---|---|---|---|
| Neto CERO (entrada + reversa) | 13 | 26 | 0,00 |
| Neto = la línea (albarán editado y reasentado) | 6 | 18 | 802,25 |
| **Descuadran** | **0** | | |

Ninguna es doble contabilización. Las 13 son albaranes anulados con su reversa
correcta; las 6 son albaranes editados (entrada + reversa + re-entrada) cuyo
neto cuadra exactamente con la línea.

**El test T7 estaba mal calibrado**: contaba multiplicidad de movimientos, que
es normal en cuanto alguien anula o corrige un albarán, no doble descuento. Con
un baseline permanente de 19, no vigilaba nada. Recalibrado a "neto ≠ cantidad
de la línea" — ver `claude/sql/20260825_tests_regresion_stock.sql`.

**Cerrado.**

---

## Lo que encontró T7 al recalibrarse — ABIERTO, pendiente de decisión

La versión nueva mira **todas** las líneas, no solo las de movimientos
repetidos, y cazó un fallo real en su primera vuelta:

`ALB-00005` · 16/06 · Foodint Plaza Castilla
"JA'E alubia cocida roja lata 1600gne" · 8 latas · 46,96 € · 20.000 g

La corrección del 15/08 (las alubias rojas sustituyeron a los frijoles negros)
dejó tres movimientos:

```
+20.000  recepción 16/06   entrada original sobre Frijoles Negros
-20.000  ajuste    14/08   "reverso sobre Frijoles Negros"   ✓
-20.000  ajuste    14/08   "alta sobre Alubias rojas"        ✗ signo negativo
```

El tercero dice **alta** y lleva signo **negativo**. Frijoles Negros quedó a
cero, correcto; Alubias rojas recibió −20.000 en vez de +20.000. Desvío de
40.000 g contra lo que dice el albarán.

Caché y ledger están de acuerdo (26.300 g): no hay desincronización, es el
histórico el que no cuadra con su documento. Y desde el 16/06 ha habido conteos
aprobados en Plaza Castilla que ya fijaron el stock real — **misma lógica que
CLOUDTOWN**: corregir el signo hoy arriesga doble descuento.

**Pendiente de decidir.** Mientras tanto el baseline de T7 es 1, documentado.

---

## Marcas duplicadas — NO LAS HAY (corrección de una afirmación mía)

Dije de pasada que había más de una marca con el mismo nombre y que eso haría
mentir a los informes por marca. **Era falso, y la comprobación lo desmiente:**

- Marcas con el mismo nombre **dentro de la misma cuenta**: **0**.
- Los 17 pares de nombres repetidos son siempre (Folvy Interno, Foodint) — la
  cuenta de demo y la real. Cuentas distintas, ningún informe se mezcla.

Lo que sí existe, y no es un error: **`Milanesa Haus` y `Milanesa House`
conviven en Foodint** y son dos marcas de verdad, no una partida en dos —
`licensed` vs `own`, 39 vs 29 productos, identificadores externos distintos,
ambas vendiendo a la vez en los tres locales desde el 12/06 (26.454,76 € y
18.256,87 €). Solo es un riesgo de lectura para quien no lo sepa: dos nombres a
una letra de distancia en la misma pantalla.
