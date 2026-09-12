# Recepción del encargo de la fase C (las pantallas de Modificadores)

**11/09/2026 (Madrid, reloj de la base).** Recibido y archivado. **No se empieza.**

El propio encargo lo dice en su cabecera: *«Estado: preparado. Se entrega a Code
cuando la fase B esté cerrada y verificada… Hasta entonces no se toca: una cosa
cada vez.»* Esta nota existe para que quede constancia de que llegó, de dónde
está en la cola, y de dos cosas ya medidas que quien lo construya necesita saber
antes de escribir la primera línea.

El encargo íntegro **vive fuera del repositorio**, igual que su hermano
`ENCARGO_CODE_modificadores_ninguna_venta_sin_descontar_20260911.md` y que la
lista maestra de reglas. No se copia aquí: una segunda copia de un documento que
no es mío es una segunda verdad esperando a divergir.

## Dónde está en la cola, hoy

Por delante, y en este orden:

1. **Un incidente abierto**: por qué mi escritor de A4a devolvió cero sin dar
   excepción en el pedido de las 14:26:24
   (`claude/folvy_incidente_aplicacion_en_banda_20260911.md`). Reproducirlo en
   transacción deshecha es lo primero.
2. **Fase A sin cerrar**: A2c y A4a ensayados y sin aplicar (van a partir de las
   23:45, reloj de la base), más A4 (qué regenerar y el coste), A5 (el vigía
   diario) y A6 (ensayo por caminos y las cifras antes/después).
3. **Los 516 duplicados**, autorizados por Julio pero después de la fase A.
4. **Fase B entera**: que el extra exista una sola vez, que «qué lleva» cuelgue
   del extra y que «sustituye» viva en la pregunta puesta en un plato.
5. **Entonces**, y sólo entonces, esta fase C.

## Dos cosas medidas que el encargo necesita saber

### 1 · Tablero 7 · «enseñar a Folvy el código» no es lo mismo en HubRise que en Last

El encargo dice: *«Confirmar "es este" enseña a Folvy el código. Se guarda la
relación código → extra, `resolver_opcion_de_extra` la consulta»*. Medido hoy
sobre el cuerpo vivo de las dos piezas:

- **En Last**, el código que trae el pedido es **de Last** (`organizationModifierId`),
  y desde A1 se guarda en `modifier_option.pos_modifier_id`. Aprenderlo es
  escribir esa columna. Hay sitio. *(A2c lo hace ya, de hecho: rescata el código
  de los propios pedidos antes de retirar una opción.)*
- **En HubRise NO hay tal columna, y el código no es suyo: es nuestro.**
  `_modifier_option_ref(option_id)` devuelve `mo.external_id` si existe y, si no,
  `'mo_' || mo.id` para las marcas cuyo catálogo publica Folvy. O sea que la
  referencia con la que casa un pedido de HubRise es **lo que nosotros
  publicamos**, no algo que HubRise asigne.

**Consecuencia:** para una línea de HubRise que llegó con una referencia que
Folvy no conoce, «guardar la relación código → extra» no tiene hoy dónde
escribirse. O se añade una columna (o tabla) de referencias aprendidas por
origen, o para HubRise el arreglo es otro (republicar el catálogo para que la
referencia vuelva a ser la nuestra). **No está decidido, y hay que decidirlo
antes de construir el tablero 7**, que es donde vive el botón «Enlazar».

### 2 · Tablero 7 · «Ya no está en Last» sí tiene su campo, y coincide

`deactivated_by = 'last'` existe a partir de A2c, con exactamente esos dos
valores (`'last'` y `'persona'`) más NULL para lo que se apagó antes de que el
campo existiera. El encargo y la migración dicen lo mismo. Nada que reconciliar.

## Lo que el §0 pedirá medir, y que NO se ha medido

Queda dicho para que nadie lo dé por hecho: **no se ha mirado todavía** qué
dispara `hubrise-catalog-publish`, qué publica de preguntas y opciones, ni
cuánto tarda (§0.1). Es la primera tarea del encargo cuando se entregue, y de su
respuesta depende si la pantalla necesita el aviso «Pendiente de publicar en
Glovo, Uber y la web» (regla 35).

---

## ACTUALIZACION DEL ENCARGO · §5 añadido por Julio el 12/09

Julio reenvía el encargo con una sección nueva, que recoge la deuda que declaré
en el parte de A4a de esta madrugada y le pone una regla.

> **§5 · Una cosa que el tablero no puede pintar como avería**
>
> Desde A4a, cada movimiento de consumo lleva la línea de venta de la que sale.
> Con dos excepciones legítimas, y ninguna de las dos es un fallo:
>
> - Los movimientos anteriores al corte por ingrediente los escribió el motor
>   viejo y nunca tuvieron línea.
> - Un movimiento congelado por el corte pierde su línea si la venta se
>   reprocesa: las líneas se borran y se rehacen, y esa fila, por estar
>   congelada, no se puede reescribir. El stock no se mueve.
>
> Así que en los tableros, y en cualquier aviso:
>
> - «sin procedencia» solo por encima del corte;
> - por debajo, si hace falta decir algo, se dice lo que es: «de antes del
>   corte», en gris, sin botón y sin alarma.

### Es la regla 7, en su tercera forma

La 7 dice que un umbral ordena y no esconde. El §5 dice lo simétrico y no es lo
mismo: **un umbral tampoco puede inventar una avería.** Una fila que está bien
por diseño no se pinta en rojo porque el contador no sepa distinguirla. Lo caro
es el mismo de la 7, por el otro lado: si el operario aprende que el rojo no
significa nada, deja de mirarlo también cuando significa algo.

### BARRIDO HECHO HOY (regla 18), porque el §5 tiene un plazo que no es fase C

El §5 está escrito para pantallas que no existen. Pero la columna
`sale_line_id` **empezó a llenarse anoche**, así que si algo HOY contara
«movimientos sin procedencia», pasaría a ver 68.122 de golpe y empezaría a
gritar antes de que fase C llegue. Medido el 12/09:

- **Funciones que tocan `stock_movement.sale_line_id`: dos.**
  `generate_sale_consumption` (el escritor) y
  `cron_recompute_missing_sale_consumption`. **Ninguna informa de los que
  faltan** (`sale_line_id IS NULL`: no aparece en ninguna de las dos).
- **Vistas que la nombran: ninguna.**
- **Front y edge functions: ninguna** referencia que cuente nulos (fuera de
  `src/types/database.ts`, que es generado).
- Los `sale_line_id IS NULL` que sí existen en la base (`kds_board`,
  `order_for_print`, `orders_feed`, `ensure_label_tokens`,
  `fill_line_discounts`, `pos_open_sales`, `pos_pending_delivery_sales`,
  `shop_order_status`) son de **otra columna homónima** —la de KDS, etiquetas y
  descuentos—, no la de `stock_movement`.

**Conclusión: nada va a gritar hoy.** El §5 llega antes de que exista lo que
podría equivocarse, que es exactamente cuando una regla así sirve para algo.

### Lo que hace falta para cumplir el §5 cuando se construya

El tablero necesita saber, por cada movimiento sin llave, **de qué lado del
corte está**. La pieza ya existe y es una sola: `cortes_aprobados(location_id,
items[])`, de A4a — la misma vara, en un solo sitio. Un movimiento sin llave es:

- **«sin procedencia»** (rojo, con botón) si `occurred_at >= corte` de su
  ingrediente en su local;
- **«de antes del corte»** (gris, sin botón) si está por debajo, o si no hay
  corte y su venta es anterior a `_corte_motor_viejo()`.

Queda dicho aquí para que el tablero no invente una segunda definición del
corte. Dos definiciones del mismo corte es como se consigue que el ensayo diga
una cosa y la pantalla otra.

### Estado: SIGUE SIN EMPEZAR

Fase B no está cerrada. No se ha escrito ni una línea de fase C, ni se va a
escribir hasta que lo esté. Una cosa cada vez.
