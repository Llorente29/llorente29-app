# Parte — los descuadres en dos, el RECON de HubRise y el orden de esta noche

**16/09/2026, 12:40–13:20.** Respuesta a la corrección de Julio. Todo lo de aquí
está **escrito y SIN APLICAR**: son las 13:xx y la banda empieza a las 12:15.

---

## 1 · Corregido lo mío

- **La versión.** La migración quedó registrada como **`20260916085716`**
  (08:57:16 UTC = 10:57 de Madrid). El fichero se llamaba `20260916111500` y el
  parte decía «11:15»: las dos de memoria. Fichero renombrado y parte corregido,
  con la corrección escrita dentro y no borrada.
- **La sexta nota (U495).** Escribí que «sobra». No sobra: movimiento a las
  20:17, corte a las 20:33, nota a las 22:20 al regenerar. La nota **explica por
  qué ese movimiento viejo sigue ahí y no se reescribió**. Corregido en el parte
  del paso 2.
- **«Avería».** Los 37 descuadres del 14/09 no lo son. Comprobado también por mí
  contra la base: las cuatro fichas se tocaron **hoy** —Korean Fried Chicken and
  Fries 2.0 (KDB), Korean crispy Chicken Burger (KdB) y Ración patatas a las
  **09:47:38**, WRAP CESAR CH a las **09:37:00**—. El escritor escribió lo que la
  carta decía el 14/09; el cuadre compara con la de hoy.

---

## 2 · Los descuadres, repartidos en dos

`20260916234510_parte_del_dia_descuadres_en_dos.sql`, **sin aplicar**.

- **«Se puede recuperar: la ficha se arregló después»** → lleva botón.
- **«Avería: debía descontar y no lo hizo»** → rojo y sin botón.

Se reparten **los dos tipos de descuadre**, los que faltan y los que salieron
con cantidad distinta: los 37 del 14/09 son 27 + 10 y son el mismo caso.
`faltan` y `cantidad_distinta` siguen contando lo mismo que antes, para poder
seguir comparándolos con la misma vara.

**Probado sobre el 14/09: 37 en la primera, 0 en la segunda.** Nueve pedidos, y
cada uno con sus artículos y con qué se tocó después.

### Un ajuste sobre lo que pediste, con la medida delante

La pata del artículo (`recipe_item.updated_at`) va **acotada al artículo que
falta**, no a cualquiera del pedido. Por qué:

> **El 16/09 a las 06:00:01 se tocaron de golpe 162 de los 402 artículos de la
> cuenta.** Con la pata sin acotar, un barrido así marca «recuperable» el día
> entero y **la casilla de avería no vuelve a encenderse nunca**. Que es justo
> lo que no puede pasar: es la familia de la regla 7 un piso más abajo — el
> verde no puede tapar lo que existe.

Y la comprobación de que acotar no cambia nada hoy, las dos reglas medidas a la
vez sobre el 14/09:

| | tal cual | acotada |
|---|---|---|
| se puede recuperar | 37 | 37 |
| avería | 0 | 0 |

**Los 37 entran por la FICHA**, y **ni uno solo** entra por «un artículo
cualquiera del pedido». Acotar no mueve una fila hoy y cierra el agujero de
mañana.

### El lado flojo, en el pie y no escondido

Tal como avisaste: una ficha tocada por otra razón se cuela. Medido, y sale en
el propio parte:

> **G183, G616 y G957** salen recuperables por **«Ración patatas · ficha
> (16/09 09:47)»**, que es la razón de verdad — y también llevan **«Coca Cola
> Zero. · ficha (16/09 12:30)»**, que es ruido.

Por eso el parte enseña **todas** las tocadas, no solo la más nueva: quien mire
ve cuál manda. Si enseñara solo la última, esos tres dirían «Coca Cola Zero» y
parecería un disparate. El error cae del lado bueno: ofrecer recuperar de más es
barato; llamar avería a lo que no lo es, no.

---

## 3 · RECON de HubRise: reautorizar no rompe nada

Leído el código, no supuesto.

**1) No puede tocar al escritor de la carta.** Son **dos aplicaciones de HubRise
distintas**, con credenciales distintas: «Folvy Escritor» (`kind=writer`, scope
de cuenta, catálogo) y «Folvy» (`kind=location`, pedidos). La rama `location` de
`hubrise-oauth-callback` **nunca escribe en `hubrise_writer_connection`**, está
dicho en su cabecera y comprobado en el cuerpo: si no existe ya una conexión de
cuenta, ni siquiera continúa. `orders.read` se añade **solo** al scope de
`location`. El de `account` no se toca.

**2) No duplica ni deja huérfano.** Al reconectar busca la fila existente por
`(account_id, source='hubrise', external_location_id, connection_name='Folvy')`
y la **actualiza en su sitio**, sobrescribiendo el token. Nunca hace un INSERT a
ciegas. Y si la desconexión anterior se había quedado a medias, revoca el token
viejo antes.

**3) La recepción de pedidos vuelve en el mismo clic.** Después de guardar el
token llama a `ensureHubriseCallback` **de forma síncrona, dentro del propio
flujo**. Está puesto ahí justo por el hallazgo del 15/08 en Carabanchel-lab:
sin eso, un local recién conectado quedaba «conectado pero mudo».

**4) Si algo sale mal, no rompe: no guarda.** Si la location elegida es otra, o
el local ya está mapeado a otra, **rechaza y no escribe nada**; la conexión
sigue con su token y su callback de antes. Un intento fallido no es destructivo.

**Lo que NO puedo comprobar desde aquí**, y hay que decirlo: si HubRise acepta
`location[orders.read,orders.write]` tal cual, y si después `GET
/locations/:id/orders` responde. Eso solo se sabe haciendo la llamada con el
token. Por eso los pasos de abajo van **de uno en uno**, empezando por el local
pequeño.

### Los pasos, para Julio

**Cuándo:** mañana **17/09 entre las 09:00 y las 11:30**. Fuera de banda, con
gente despierta y con pedidos entrando para comprobar que la recepción sigue
viva. **No a las 23:45**: esto toca el camino del pedido y quieres verlo con luz,
no a medianoche.

1. **Yo primero** (la noche anterior o a primera hora): meter `orders.read` en el
   scope de `location` de la lista blanca de `hubrise-oauth-start` y desplegarlo.
   Ojo: fusionar a `main` **publica también el front**, así que va fuera de
   banda.
2. **Julio, Carabanchel primero** (es el de menos pedidos). Abrir en el
   navegador:
   `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-oauth-start?account_id=51ad1792-6629-4ef7-833a-b57b09a86710&scope=location&location_id=92d7656e-082e-452a-8ebc-236b2d6ebf5f`
   Entrar en HubRise, **elegir la MISMA location de siempre** (`1b6p8-2`), y
   aceptar. Si pide un local distinto, cancelar y avisarme.
3. **Comprobamos antes de seguir**: que la fila de Carabanchel sigue siendo una
   sola, con `token_status = ok` y `callback_status = ok`, y que **entra un
   pedido de verdad**. Hasta que no entre uno, no seguimos.
4. **Luego Alcalá**, mismo paso con
   `location_id=38158159-cd71-4056-950b-53425afac1ce` y location `1b6p8-0`.
5. Con el permiso dentro, añado el listado del día al cruce y **la línea del pie
   de HubRise desaparece**.

---

## 4 · El paso 3, escrito

`20260916234520_parte_plataformas_tabla.sql` y
`20260916234530_parte_plataformas_pasada.sql`, **sin aplicar**.

- Una fila por **(cuenta, día, plataforma, pedido)**, con las dos caras.
- **Cedidas por `platform_order_code`, propias por `external_ref`.** El código
  corto se guarda solo para que una persona reconozca el pedido; nunca para
  casar, y está escrito en el comentario de la columna para que nadie lo
  descubra por su cuenta.
- **Dos funciones de llenado sin una línea compartida**, como pide el §3.3:
  `_parte_plataformas_cedidas` y `_parte_plataformas_propias`.
- `origen` distingue **'aviso'** (lo que ya está en la base, que es lo de hoy)
  de **'listado'** (lo que se pida a la plataforma). Una fila que ya venía del
  listado **no baja** a 'aviso' al repasar.
- Idempotente: pasar dos veces el mismo día no escribe dos veces.
- Cron `parte-plataformas-diario` a las **06:00 de Madrid** (`0 4 * * *`), ayer y
  anteayer —porque un aviso de anulación llega de madrugada—, solo cuentas
  activas y no internas. Cuenta lo que ha hecho en un `notice`, que es lo que
  guarda pg_cron: una pasada muda no se puede creer (regla 8).

---

## 5 · El orden de esta noche, desde las 23:45

| | qué | antes/después que se mide |
|---|---|---|
| 1 | `20260916234500_indice_sale_line_parent` | el cuadre del 15/09 (hoy **5,180 s**) y un `EXPLAIN ANALYZE` de la consulta por `parent_sale_line_id` (hoy **Seq Scan, 31.563 filas descartadas, 9,351 ms**). Y lo que pediste: el tiempo de `generate_sale_consumption` sobre una venta real, antes y después |
| 2 | `20260916234510_parte_del_dia_descuadres_en_dos` | 14/09 y 15/09 con función y método **en el mismo instante**; y el reparto 37/0 |
| 3 | `20260916234520_parte_plataformas_tabla` | la tabla existe y la guarda de cuenta muerde |
| 4 | `20260916234530_parte_plataformas_pasada` | pasada sobre el 15/09 y el 14/09, y **pasada dos veces**: la segunda no puede escribir de nuevo |

**El índice, con `CREATE INDEX` normal.** Con 31.579 filas son milisegundos de
cierre `SHARE`, que frena escrituras y no lecturas, y a las 23:45 no hay
escrituras que frenar. `CONCURRENTLY` obligaría a sacarlo del bloque de la
migración —no puede ir en una transacción— y a cambio no gana nada en una tabla
de 11 MB a esa hora. Si prefieres lo contrario, se cambia en un minuto.

Antes de aplicar nada: `list_migrations`, por si la otra sesión ha dejado algo a
medias.
