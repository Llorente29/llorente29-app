# RECON de A4 · quién escribe el consumo, y qué encontré antes de tocarlo

**11/09/2026, 13:25 (Madrid, reloj de la base).** Medido contra producción, sin escribir nada.
Esto es lo que hay que saber ANTES de escribir A4, y hay dos cosas que
contradicen lo que dábamos por hecho.

---

## 1 · Hay DOS escritores de consumo, y comparten la misma llave

| función | llave que escribe | `occurred_at` | filas vivas |
|---|---|---|---|
| `generate_sale_consumption(sale_id)` | `source_type='sale'`, `source_id = ` **la venta** | `sale.created_at` | 62.975 |
| `compute_sale_line_consumption(line_id)` | `source_type='sale'`, `source_id = ` **la línea** | `sale.sold_at` | 3.277 |

`source_type` vale `'sale'` en las dos. O sea que **`source_id` significa dos
cosas distintas** según quién lo escribiera, y no hay forma de saber cuál
mirando la fila: hay que preguntar si ese uuid existe en `sale` o en
`sale_line`.

Y cada una **borra sólo lo suyo** antes de reescribir:

```sql
-- generate_sale_consumption
DELETE FROM stock_movement WHERE source_type='sale' AND source_id = p_sale_id ...
-- compute_sale_line_consumption
DELETE FROM stock_movement WHERE source_type='sale' AND source_id = p_sale_line_id ...
```

Ninguna ve a la otra. Si las dos pasan por la misma venta, **el consumo se
escribe dos veces**.

## 2 · Ya pasó: 516 movimientos duplicados, 52 ventas

Medido, no deducido:

| local | duplicados | después de su último conteo aprobado | corte |
|---|---:|---:|---|
| Foodint Alcalá | 369 | **0** | 11/09 00:33 |
| Foodint Carabanchel | 121 | **0** | 07/09 22:15 |
| Foodint Plaza Castilla | 26 | **13** | 11/07 01:09 |

516 movimientos, 505 pares (venta, artículo), 52 ventas, del **12/06 al
03/08**. Anclado por `location_id`, no por nombre: hay DOS «Foodint Plaza
Castilla», una de Foodint y otra del catálogo plantilla (regla 9). Las tres
filas de arriba son de la cuenta de Foodint (`51ad1792…`).

**Lo que esto sí toca y lo que no.** En Alcalá y Carabanchel los 490
duplicados son todos ANTERIORES al último conteo aprobado: el conteo volvió a
anclar el stock, así que **el stock de hoy no está mal por esto**; lo que está
mal es la historia de consumo y, con ella, cualquier varianza de esos días.

En Plaza Castilla hay **13 posteriores al corte del 11/07**, y ese local no ha
vuelto a contar. Esos 13 **sí están en el stock de hoy**, de más descontados:

| artículo | unidades de más |
|---|---:|
| Patatas Bastón | 270 |
| Lechuga Romana | 92,1 |
| Salsa Melt | 90 |
| Pulled Pork | 65 |
| Salsa BBQ | 60 |
| Queso Cheddar Loncheado | 60 |
| Salsa Sweet Chilli | 40 |
| Salsa Mil Islas | 40 |
| Pepinillos Agridulce en Rodajas | 32,2 |
| Salsa Coreana | 30 |
| Cebollino | 20 |
| Pan Hamburguesa | 2 |
| Agua Mineral 50 CL | 2 |

(Unidades base de cada artículo; no se suman entre sí, que sería un número que
no es de nadie.)

## 3 · Hoy no se puede repetir solo, pero la pistola sigue cargada

`compute_sale_line_consumption` **ya no la llama nadie**: ni otra función de la
base, ni `cron.job`, ni una edge function. El disparador que la llamaba
(`trg_sale_line_consumption`) fue reescrito y hoy llama a
`generate_sale_consumption`. Por eso la última fila con llave de línea es del
**03/08**.

Pero sigue **viva, `SECURITY DEFINER`, y con `EXECUTE` para `authenticated`**,
o sea expuesta por PostgREST. Cualquiera con sesión —de cualquier cuenta, no
hay guarda de cuenta dentro— puede volver a crear el duplicado con un uuid.
Lo mismo vale para `generate_sale_consumption`: `authenticated`, sin guarda de
cuenta.

`recompute_sales_consumption` sí tiene guarda dentro
(`current_user_is_admin() OR current_user_is_admin_or_manager_of`), aunque el
`EXECUTE` esté abierto a `PUBLIC` y `anon`. No es un agujero; es desorden.

## 4 · `stock_movement.sale_line_id` existe y está vacía: 0 de 68.582

La columna está, con su clave ajena a `sale_line`, y **no la ha escrito nadie
nunca**. Es exactamente el sitio donde A4 puede poner «de qué línea vengo» sin
tocar el CHECK `stock_movement_source_valid` —que sólo admite seis valores y no
incluye `sale_line`—. **No inventar un `source_type` nuevo**: ese es el fallo
de A3 del 12:32, un CHECK que no contempla el valor nuevo y un 23514 que se
lleva el pedido entero.

## 5 · Lo que contradice el encargo: la reescritura NO se lleva las correcciones

En la respuesta del 11/09 11:50 está escrito: «si alguien vuelve a generar la
venta entera con `generate_sale_consumption`, esa reescritura se lleva también
las correcciones».

**Medido, es al revés, y es peor.** El `DELETE` de `generate_sale_consumption`
es `source_type='sale' AND source_id = p_sale_id`. Un movimiento de A4 con
llave propia (la línea) **no cae en ese DELETE**: sobrevive a la reescritura y
se queda ENCIMA del consumo recién regenerado. Es decir, no se pierde la
corrección: **se duplica el descuento**. Exactamente los 516 de arriba, otra
vez, pero ahora a propósito.

Así que la decisión de A4 no es «cómo recuperar la corrección tras una
regeneración», sino **cómo evitar que la corrección se sume dos veces**. Dos
caminos, y prefiero que lo decidas tú:

**(A) Misma llave que el generador.** A4 escribe con
`source_type='sale'`, `source_id = venta`, `sale_line_id = la línea` y una nota
propia. Una regeneración se la lleva limpiamente, sin duplicar — y entonces A4
tiene que volver a pasar después. Ventaja: imposible duplicar. Coste: hace
falta un enganche que vuelva a aplicar A4 tras cada regeneración (el mismo
disparador, o un vigía que busque las ventas a las que les falta la parte de
los extras).

**(B) Llave propia y enseñarle al generador a borrarla.** Añadir al `DELETE` de
`generate_sale_consumption` un `OR sale_line_id IN (…)`. Ventaja: A4 vive
aparte y se ve. Coste: tocar la función más caliente del sistema —la que corre
en cada pedido— y eso, además, sólo se puede aplicar fuera de la banda.

**Recomiendo (A)**, y con el enganche en el mismo disparador que ya llama a
`generate_sale_consumption`, para que no exista ni un instante con la venta a
medias. Pero es tu decisión, porque (A) mete a A4 dentro del camino vivo de los
pedidos y (B) no.

## 6 · La fecha con la que se ancla

`generate_sale_consumption` pone `occurred_at = sale.created_at`; el escritor
viejo ponía `sold_at`. Confirmado en el cuerpo de las dos. Queda como estaba
dicho: **el corte, con la fecha del libro; la deuda declarada es fechar con
`sold_at`**.

Y una más, que no estaba apuntada: `generate_sale_consumption` **no mira
ningún conteo aprobado**. Reescribe el consumo de la venta que le den, sea de
la fecha que sea, por debajo de conteos ya cerrados. El corte de la regla 6 lo
tiene que poner A4 por su cuenta; hoy no lo pone nadie.

## 7 · Lo que hace falta decidir antes de escribir A4

1. **(A) o (B)** del §5.
2. Qué se hace con los **516 duplicados**: los 13 de Plaza Castilla tocan el
   stock de hoy; los otros 503, la historia. Corregirlos es reprocesar por
   debajo de conteos aprobados en Alcalá y Carabanchel, o sea que cae de lleno
   en la regla 6 y necesita tu autorización explícita y reanclaje después.
3. Si se cierra la puerta de `compute_sale_line_consumption` (quitarle el
   `EXECUTE` a `authenticated`, o directamente `DROP`, que no la llama nadie).
   Cualquiera de las dos, fuera de la banda.
