# La mañana del 12/09 · lo aplicado, lo medido y lo que NO se aplica

Ventana abierta hasta las 12:15. Reloj de la base en todo el documento.

---

## 1 · Lo aplicado, en orden

| # | qué | migración | reloj |
|---|---|---|---|
| 1 | Vigía v4: separa **fuga** de **cobertura** | `20260912072326` | 09:23 |
| — | **Arreglo del agujero mudo de la guarda** | `20260912073732` | 09:37 |
| 2 | Los 52 duplicados de los dos motores | (datos) | 09:40 |
| 3 | Las cerradas sin consumo con el motor en marcha | (datos) | 09:45 |
| 4 | Las de `add_item` sin descontar | **NO SE APLICA** | — |

---

## 2 · El vigía v4, y por qué la v3 abortó

La v3 hacía la misma separación con CTEs y abortó al aplicarla:
«El vigía tarda 20917 ms: demasiado para correr cada hora».

Medido después, paso a paso, sobre producción:

| | |
|---|---:|
| `_ventas_que_deberian_descontar()` | 9.651 filas, **35 ms** |
| `_ventas_con_consumo()` | 6.611 filas, **65 ms** |
| candidatas de 7 días | **29** |
| líneas de producto de esas 29 | **46** de 29.756 |
| el motor sobre esas 46 líneas | **1.344 ms** |

El trabajo no era el problema: **el plan lo era.** Postgres incorpora las CTE
no recursivas referenciadas una sola vez, así que `candidatas` y `escribe` se
disolvían y el `EXISTS` correlacionado acababa colgando de `sale` entera. En
variables plpgsql el plan ya no puede reordenar: **1.561 ms**.

El vigía devuelve **70** donde antes devolvía 99: los 29 que salen de la
alarma son cobertura (2 en Foodint, 27 en Kitchen Grill), y salen con
severidad `aviso` y freno de 7 días. **La cadencia semanal la pone el freno de
repetición, no un cron aparte:** el vigía sigue cada hora por la fuga.

---

## 3 · EL AGUJERO MUDO DE LA GUARDA (lo más importante del día)

La guarda de precio que entró a las 08:56 escribía:

```sql
( pr.medio < 0 OR (pr.medio > 0 AND ...) ) AS indefendible
```

Con `avg_unit_cost` **NULO** eso no da falso: da **NULO**. Y un nulo se cuela
por **las dos puertas a la vez**:

- `puesto` pide `NOT p.indefendible` → NULL → **no escribe el movimiento**
- `notas` pide `NOT libre OR indefendible` → NULL → **no apunta la nota**

Ni movimiento ni nota. Consumo que desaparece sin dejar rastro: regla 8 y
regla 30.

**Cómo apareció:** ensayando el paso 2. Cuatro cifras no cuadraban con el
RECON. Tres eran la guarda funcionando (coste medio negativo en Salsa Melt,
Salsa BBQ y Salsa Sweet Chilli: se borra lo viejo y no se escribe lo nuevo,
así que vuelve el consumo entero en vez de la diferencia). **La cuarta no
tenía explicación:** los Nachos de Carabanchel tenían −100 por cada motor, al
regenerar quedaban 0 movimientos y 0 notas, y el escandallo de hoy sí daba su
renglón.

**A cuánto alcanzaba:** en Foodint, 186 artículos sin fila de stock y 134
filas artículo-local con el medio a nulo.

**A quién había mordido: a nadie.** 0 ventas entre las 08:56 y las 09:30 —
los locales no habían abierto. Habría empezado sobre la 13:00, **dentro de la
banda prohibida y sin nadie mirando.**

El arreglo es `COALESCE(..., false)`: sin precio medio no hay nada que juzgar,
y el escritor ya sabía qué hacer con ese caso (`WHEN p.medio IS NULL THEN
p.escandallo`). Es la misma decisión que ya tomaste para el coste cero: entre
no mover el almacén y no valorarlo, gana mover el almacén.

Ensayado en transacción revertida, **0 fallos**: P1 nulo → 1 movimiento con el
coste del escandallo · P2 negativo → 0 movimientos y nota · P3 cero → 1
movimiento con coste nulo y la nota vieja limpiada · P4 sano → 1 movimiento
con ese coste · P5 50× → sigue frenado. Y por CAMINOS, como una persona de la
cuenta: cerrar una venta 6→6 · recibir un albarán corre (ese borrador no
escribió: 924→924, así que prueba que no lo rompo, **no** que escriba) ·
merma 1.670,00→1.665,00 · aprobar un recuento, ajustes 2.260→2.262.

---

## 4 · Paso 2 · los 52 duplicados

Mi primera vara dio **0** y eso no cuadraba con el RECON, así que paré: el
`source_id` de los dos motores **no apunta a lo mismo**. El motor B (nota
`consumo teorico`) apunta a la **línea**, 977 de 977; el motor A (`Consumo por
venta`) apunta a la **venta**, 64.858 de 64.858. Agrupar los dos por
`source_id` no podía casar nunca.

Con la vara corregida: **505 pares, 52 ventas, 516 movimientos del motor B y
769 del A** — las tres cifras del RECON, clavadas.

Aplicado: 52 regeneradas en 5.499 ms · motor viejo 977 → 936 · **19 filas
artículo-local movidas, ninguna baja, ningún negativo nuevo** · 731 notas de
corte y 4 de precio indefendible.

**Y una cosa que hay que decir: los duplicados NO han desaparecido.** Quedan
**466 pares en 51 ventas**, y los 466 están **protegidos por el corte, 466 de
466, ninguno sin explicación**. Es la regla 6 ganando al duplicado. Sólo se
han ido los 41 que estaban por encima del corte.

---

## 5 · Paso 3 · las cerradas sin consumo con el motor en marcha

**Tres cifras del RECON no se sostienen, y gana lo medido:**

1. La población no son 914: son **201** (Alcalá 142, Carabanchel 59).
2. **Plaza Castilla no pinta nada aquí: no tiene una sola venta desde el
   12/07.** 0 desde el corte del motor. La atribución «el grueso es Plaza
   Castilla» era de los movimientos de las ventas ANTERIORES al motor.
3. De las 201, sólo **34** tenían con qué descontar.

Aplicado: 201 regeneradas en 6.509 ms · **82 movimientos escritos** · 14 filas
artículo-local movidas, todas hacia abajo (es consumo que nunca se apuntó) ·
1.156 notas de corte.

**Un negativo nuevo: Queso Parmesano en Carabanchel, 8,4 → −31,6.** No lo
escondo y no lo maquillo: el consumo ocurrió de verdad, y el negativo está
diciendo que el stock de ese artículo está mal aguas arriba (una entrada sin
apuntar o un recuento). Es información, no avería del motor.

---

## 6 · Paso 4 · NO SE APLICA, y por qué

La población tampoco son 522. Con la vara de los impactos `add_item`
confirmados: **1.171 ventas y 1.240 pares** en total, de las cuales **341**
son posteriores al corte del motor.

Al ensayarlo con las 1.171, **la guarda de la tanda saltó y lo deshizo todo:
7 filas SUBÍAN**, o sea que regenerarlas borraría consumo en vez de añadirlo.
La causa era mía: mi población arrancaba en 12/06 y tú ya decidiste que las
anteriores al motor no se regeneran.

Rehecho con el corte del 05/08 delante, **341 ventas — y aún así 3 filas
suben**:

| artículo (Carabanchel) | sube | causa, medida |
|---|---:|---|
| Zanahoria | +27,5 | coste medio **negativo** → la guarda lo frena |
| MAHOU 5 ESTRELLAS | +1,0 | coste medio **negativo** → la guarda lo frena |
| Albahaca | +70,6 | **no es la guarda: su medio es defendible** |

Albahaca: 108 movimientos por −1.041,092 pasan a 102 por −970,504. Los 6 que
faltan son **seis ventas del 15 al 27/08** que pierden su único renglón de
Albahaca (−11,765 cada una) **y se quedan sin nota ninguna**.

### El hallazgo

**Cuando el escandallo de HOY ya no pide un ingrediente que la venta tenía
apuntado, el escritor lo borra y no dice nada.** Ese ingrediente sólo aparece
en `v_previos` (porque tenía movimiento); nunca llega a `base`, así que no hay
renglón que escribir ni fila en `plan`, y por tanto tampoco nota. Es la misma
familia que el agujero del nulo —regla 8 y regla 30— con otro mecanismo.

Borrar puede ser lo correcto: si la receta se corrigió, el consumo viejo
estaba mal. Pero **tiene que decirlo**, y hoy no lo dice.

### Y la decisión que no es mía

Esto es exactamente la pregunta §7.6 del RECON, la que dejaste sin contestar:
**regenerar aplica la receta de HOY a una venta vieja.** Con cinco semanas de
deriva ya se lleva 70,6 g de Albahaca por delante. Sobre tres meses, no sé
cuánto, y no lo daría por bueno sin que lo decidas tú.

**Por eso el paso 4 se queda sin aplicar.** Lo que propongo, y es propuesta:

1. Una nota nueva en el escritor: «el escandallo de hoy ya no pide este
   ingrediente». Barata, y cierra el silencio.
2. Con la nota puesta, el paso 4 se puede aplicar y **se ve** qué se
   reescribe y qué se retira.
3. El motor de coste medio, que es de donde salen los negativos que frenan a
   Zanahoria, MAHOU, Salsa Melt, Salsa BBQ y Salsa Sweet Chilli.

---

## 7 · Lo que queda abierto

- **Paso 4**, pendiente de tu decisión sobre §7.6.
- **La nota que falta** cuando el escandallo ya no pide un ingrediente.
- **Queso Parmesano en Carabanchel a −31,6**: mirar de dónde viene.
- **466 pares duplicados** vivos bajo el corte: no tocan el stock de hoy
  (el recuento lo reancló), pero ensucian la historia de consumo y de coste.
- El motor de coste medio y sus negativos.
