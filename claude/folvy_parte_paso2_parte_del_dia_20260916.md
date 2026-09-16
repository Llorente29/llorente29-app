# Parte del paso 2 — `parte_del_dia` viva y verificada

**16/09/2026, 11:00–11:20 (hora de la base).** Paso 2 del encargo del 16/09:
la función del §3.1 y las comprobaciones 1 y 2 del §5.

---

## Lo aplicado, y cuándo

🔧 **APLICADA en producción** el 16/09 a las **08:57:16 UTC = 10:57 de Madrid**,
versión **`20260916085716`** (`parte_del_dia_lectura`). **Fuera de la banda**
(empieza a las 12:15), así que no hizo falta ninguna excepción.

> *Corregido el 16/09 a las 12:40.* Este parte decía «11:15» y el fichero se
> llamaba `20260916111500`: las dos cifras eran de memoria, no leídas del
> registro. La versión que registró la base es `20260916085716` y el fichero ya
> se llama así. Misma familia que la errata de la hora del Pase: una cifra
> puesta de memoria presentada como medida. Las tres cuentas de la banda,
medidas antes por si acaso: función **nueva**, cero funciones que la llamen,
cero crons, cero disparadores; y un `create function` no cierra ninguna tabla.
Antes de aplicar se miró `list_migrations`: la última de la otra sesión es
`20260915225209` (el Pase), nada a medio aplicar.

Son **dos piezas**, siguiendo el par que ya existía (`sales_unmapped_products` /
`_sales_unmapped_products_raw`):

- `_parte_del_dia_raw(cuenta, local, día)` — el cuerpo, **sin guarda**, para el
  cron del aviso de las 08:30, que no tiene sesión de usuario.
- `parte_del_dia(cuenta, local, día)` — **guarda de cuenta** + llamada. Es la de
  la pantalla. Comprobado que la guarda muerde:

  ```
  select public.parte_del_dia('51ad1792-…', null, date '2026-09-15');
  ERROR:  P0001: parte_del_dia: sin acceso a la cuenta 51ad1792-…
  ```

---

## Comprobación 1 — las once cifras del 15/09, misma consulta, mismo instante

No contra cifras congeladas: la función y el SQL del método, **dentro de la
misma sentencia**, cada uno por su lado.

| cifra | método | `parte_del_dia` | |
|---|---|---|---|
| pedidos | 94 | 94 | IGUAL |
| importe | 2.093,07 | 2.093,07 | IGUAL |
| anulados | 2 | 2 | IGUAL |
| bien | 992 | 992 | IGUAL |
| faltan | 0 | 0 | IGUAL |
| retenidos | 5 | 5 | IGUAL |
| cantidad distinta | 0 | 0 | IGUAL |
| de más en vivas | 0 | 0 | IGUAL |
| movimientos en anuladas | 0 | 0 | IGUAL |
| uds totales | 259,0 | 259,0 | IGUAL |
| uds que descuentan | 258,0 | 258,0 | IGUAL |

Y la línea que no descuenta, una sola: **THE HEURA CHIVUO'S®️**, Alcalá,
Chivuos, 1 ud, 12,90 €, pedido G570, causa «su código está en una ficha
archivada». Propias: 24 avisos · 24 ventas · 0 · 0 · ninguna anulada sin
aplicar.

---

## Comprobación 2 — el 14/09, las cinco causas que dijo Julio

Salen las cinco, exactas:

| plato | local | causa |
|---|---|---|
| Cochinita Bowl AMB (U981, U982) | Carabanchel | **su código ya tiene ficha viva: se puede recuperar** |
| Marquesa de Dulce de Leche (G957) | Carabanchel | **su código ya tiene ficha viva: se puede recuperar** |
| Wrap Cesar (KDB) (U973) | Carabanchel | ficha sin artículo |
| DOBLE EVERYDAY BURGER CH (G338) | Carabanchel | ficha sin artículo |
| Ración Boniatos (G183) | Carabanchel | ficha sin artículo |

### El contraste de Alcalá que pedía el §5.2, dicho como es

El §5.2 pedía comprobar que en Alcalá lo que esté por debajo de un recuento
aprobado salga **retenido** y no **recuperable**. Medido: **el 14/09 no hay ni
una línea recuperable en Alcalá** —las cinco son de Carabanchel—, así que ese
caso concreto no se da y no lo voy a fabricar.

Lo que sí se puede contrastar, y se contrasta, es el 15/09: **los 5 retenidos
son todos de Alcalá**, del pedido G645 (Cebolla Morada, Cilantro, Colorador
amarillo, Pulled Pork y Tomate Pera), con su nota de corte del recuento que se
cerró esa tarde entre las 19:31 y las 19:52. Salen como retenidos, no como
faltantes. La regla 6 se lee de la nota del escritor, no se recalcula.

**La sexta nota, y por qué NO sobra.** Hay **6** notas en
`sale_consumption_skip` para el 15/09 y el parte cuenta **5** retenidos. La
sexta —Milanesa de Pollo Rebozado, pedido U495— tiene nota **y** movimiento
escrito (esperado 1,0 · escrito 1,0), así que cuenta como «bien».

> *Corregido el 16/09.* Escribí que «la nota sobra». No sobra. La secuencia es:
> movimiento escrito a las **20:17**, recuento con corte a las **20:33**, nota
> escrita a las **22:20** al regenerar. **La nota explica por qué ese movimiento
> viejo sigue ahí y no se reescribió**: es el caso congelado de la regla 6, y es
> verdad. Que cuente como «bien» es correcto, y la nota tiene su trabajo.

---

## Lo que el 14/09 enseña — y NO es una avería

> *Corregido el 16/09 a las 12:40, con la comprobación de Julio delante.* Lo
> que sigue decía «consumo a medias silencioso» y «avería». **Era falso, y era
> mío.** Julio lo comprobó pedido a pedido y lo he vuelto a medir yo contra la
> base: las cuatro fichas están tocadas **hoy** —Korean Fried Chicken and Fries
> 2.0 (KDB), Korean crispy Chicken Burger (KdB) y Ración patatas a las
> **09:47:38**; WRAP CESAR CH a las **09:37:00**—. El escritor no falló: el
> 14/09 esas fichas no tenían artículo y escribió lo que la carta decía
> entonces. **El cuadre compara con la carta de hoy**, y por eso sale «falta».
> `sale_consumption_failure` a 0 es lo correcto aquí: no reventó nada.

El cuadre del 14/09 da **410 bien · 27 faltan · 10 con cantidad distinta · 0
retenidos**, todo en Carabanchel, en nueve pedidos: G120, G183, G199, G616,
G957, U968, U970, U973, U984. No están bajo ningún corte (el último recuento
aprobado de Carabanchel se cerró el 07/09 a las 22:15).

Es **exactamente la población que el paso 4 tiene que recuperar**: la ficha se
arregló después de la venta. Y es lo que obliga a que el parte reparta los
descuadres en dos, que es lo que entra esta noche.

## El cruce con las plataformas, funcionando desde dentro

El parte del 14/09 saca, sin salir a ninguna API:

> **U977** (`9CE20`), Carabanchel, 20,86 € — anulado en Last y **vivo en Folvy**.

Es el que Julio dijo que estaba cayendo esta semana. Se ve casando
`payload->'data'->>'name'` de los `frontera-tab-cancelled` con
`platform_order_code`, como marca el método.

El pie del parte dice lo que no puede ver, y lo dirá hasta que estén el listado
del día y el permiso de HubRise:

> «Las cedidas: solo se comparan con los avisos recibidos de Last, todavía no
> con el listado del día.»
> «HubRise: solo comparado con los avisos recibidos.»

El verde es honesto por construcción: `en_verde` solo mira lo que el parte
**puede** ver, y al lado va siempre `no_puede_ver`. Un verde no puede callar su
propio alcance (regla 7, un piso más abajo).

---

## La comprobación 6 del §5 NO se cumple, y por qué

**El parte del 15/09 tarda 5,180 s.** El techo del §5.6 son 2 s. Medido tres
veces, siempre igual. Dónde se va el tiempo:

| | |
|---|---|
| el cuadre entero | **5,180 s** |
| solo el bloque que llama a `_sale_line_raw_consumption` | **5,139 s** |
| todo lo demás (ventas, movimientos, notas, causas, plataformas) | **0,005 s** |
| reventar las 74 fichas distintas del día, por separado | **0,078 s** |

O sea: **no cuesta la receta, cuesta un barrido**. `sale_line` **no tiene índice
por `parent_sale_line_id`**, y `_sale_line_raw_consumption` pregunta por los
hijos de la línea al menos dos veces por llamada:

```
explain (analyze) select 1 from sale_line c
 where c.parent_sale_line_id = '…' and c.line_type = 'combo_item';
→ Seq Scan on sale_line (actual time=9.287..9.287 rows=0 loops=1)
  Rows Removed by Filter: 31563
  Execution Time: 9.351 ms
```

**Y esto no es un problema del parte: es del camino del pedido.**
`generate_sale_consumption` llama a esa misma función línea a línea **en cada
venta que se cierra**. Ese barrido de 31.563 filas se está pagando en servicio,
en cada pedido, desde siempre.

El arreglo está escrito y **SIN APLICAR**, en
`supabase/migrations/20260916234500_indice_sale_line_parent.sql`. Espera a las
**23:45** porque un `create index` toma cierre exclusivo sobre `sale_line`, que
es tabla del camino del pedido: es el caso 2 de la banda, y la duda va a favor
de esperar. **Hace falta el sí de Julio.**

El «después» se mide en cuanto se aplique, con la misma vara —el cuadre del
15/09— y se pegan los dos números. Hasta entonces la comprobación 6 está sin
cumplir, y no la doy por buena.

---

## Apuntado, sin tocar

- En el bloque `plataformas.propias`, `pedidos` cuenta las vivas y `ventas`
  cuenta también las anuladas (el 14/09: 4 y 5). Los dos números son correctos y
  son los del método, pero juntos en una pantalla invitan a pensar que algo
  falla. Se renombra en el paso 3, que reescribe ese bloque entero para leer de
  `parte_plataformas`; no merece una migración para ella sola.
- La deuda conocida del corte sigue igual: compara con `created_at`, no con
  `sold_at`. No se toca aquí.

## Lo siguiente

Paso 3: la tabla `parte_plataformas` y la pasada diaria. Antes de eso, dos
cosas que necesitan un sí:

1. **El índice de las 23:45.**
2. **HubRise `orders.read`**: el RECON de la reautorización (que no rompa el
   escritor de la carta ni la recepción de pedidos) y los pasos de persona para
   Julio.
