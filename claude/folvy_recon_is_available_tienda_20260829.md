# RECON — `menu_item.is_available` y la tienda propia (29/08/2026)

Ampliación del §5.1 del RECON del cierre de marca. Verificado en producción.
**No se ha tocado nada.** El arreglo cambió de forma al investigarlo y se
reporta antes de construir.

---

## 1. Corrección a lo que reporté esta tarde

Dije: «la tienda lo enseña, el cliente lo pide y **el pedido se cae**».
Es falso. `place_shop_order` **no aborta nunca** por disponibilidad: en todo su
cuerpo sólo hay tres apariciones de `valid`, y ninguna corta el flujo.

Lo que pasa de verdad es peor y más callado:

1. `_shop_reprice_line` (línea 24) busca el producto con
   `and mi.is_available is not false`. Si el espejo global dice `false`, **no lo
   encuentra**, y devuelve `'valid', false, 'unitPrice', 0, 'lineTotal', 0`.
2. `adapt_folvy_shop_order` (línea 33) llama a esa MISMA función y, sin mirar
   `valid`, inserta la línea de venta con
   `unit_price = (v_repr->>'unitPrice')` y `line_total = (v_repr->>'lineTotal')`
   — es decir, **0** — con `menu_item_id` correcto y `map_source = 'pos'`
   (líneas 42-56).

Resultado: **el plato entra en cocina y el cliente no lo paga.** No es un pedido
perdido: es un plato regalado. No lo he contado, como pediste.

Otros dos efectos verificados del mismo espejo:

- `shop_item_config` (línea 15) devuelve `NULL` → la ficha del producto no abre.
  El menú lo enseña y al pinchar no hay nada.
- «Repetir pedido» (`MyAccountRoute.tsx:162-167`) filtra las líneas con
  `valid !== false`; si caen todas, el cliente lee *«Ninguno de estos platos
  está disponible ahora mismo»*.

Menores: `shop_hub_by_slug:68` (lo saca del carrusel de más vendidos) y los dos
elegidores de regalo `_shop_account_free_gift:6` / `_shop_brand_free_gift:7`
(más el recheque de `place_shop_order:383`), que anulan el regalo.

---

## 2. El hecho que cambia el arreglo: la tienda SÍ sabe el local

- `place_shop_order:74` → `v_location := nullif(p_payload->>'locationId','')::uuid`,
  y con él sella la venta (`:457-462`).
- `ShopCartContext.tsx:8` lo dice en su propia cabecera: *«El local concreto
  (locationId) se ELIGE en el checkout»*; `:49` → `locationId: null = aún sin
  elegir`. El selector está en `CheckoutRoute.tsx:934`.
- `shop_brand_menu_by_slug(p_slug, p_brand_id)` **no recibe local**: cuando el
  cliente navega la carta, todavía no ha elegido.

O sea que hay **dos momentos con dos reglas distintas, y las dos son legítimas**:

| momento | qué se sabe | regla correcta |
|---|---|---|
| navegar la carta | no hay local | vendible **en algún local activo** de la marca |
| checkout / pedido | local elegido | vendible **en ESE local** |

Hoy ninguno de los dos usa su regla: el menú sí (la tiene inline y es correcta),
pero el repricing y el pedido usan el espejo global, que no es ni una ni otra.

---

## 3. Por qué NO se arregla «arreglando el espejo»

Fue mi primera idea y la descarté con datos. Probado en producción en solo
lectura, redefinir `menu_item.is_available` como «agotado sólo si lo está en
TODOS los locales activos» da:

```
se ENCIENDEN (los que hoy mienten)   125 fichas · 18 marcas
se APAGARIAN                           0 fichas
sin cambio                           989 fichas · 35 marcas
```

Cero apagados: la regla es segura para la carta. **Pero no para el pedido.** Si
el espejo pasa a significar «vendible en algún sitio» y el pedido sigue leyendo
el espejo, aceptaríamos una línea de un producto agotado **en el local que la va
a cocinar**. Cambiaríamos «regalar un plato» por «vender lo que no tenemos»,
que es peor. El espejo no puede ser la puerta del pedido: es una columna de una
tabla sin local, y el pedido tiene local.

---

## 4. Propuesta, en dos pasos

**Paso 1 — sin decisión de producto, estrictamente mejor.**
Un único hogar para la regla de navegación (`menu_item_vendible_en_alguna_parte`),
copiando literalmente la cascada que `shop_brand_menu_by_slug` ya tiene inline
(líneas 56-80 del cuerpo vivo), y que la usen los lectores de **momento
navegación**: `_shop_reprice_line`, `shop_item_config`, `shop_hub_by_slug`, los
dos elegidores de regalo — y el propio `shop_brand_menu_by_slug`, que deja de
tener su copia. Una regla, un sitio.

Efecto inmediato: se acaban las líneas a 0 € y las fichas que no abren, para las
125. No introduce ningún riesgo nuevo: el pedido queda exactamente igual de
ciego al local que hoy, ni más ni menos.

**Paso 2 — necesita tu decisión.**
Que el pedido gatee por el local elegido. Implica:

- `_shop_reprice_line` gana `p_location_id` → **DROP + CREATE**, nunca
  `CREATE OR REPLACE` (regla 2 de la casa: añadir un parámetro crea una
  sobrecarga y las llamadas viejas quedan ambiguas).
- Sus dos llamadores pasan el local: `place_shop_order:90` (que ya tiene
  `v_location`) y `adapt_folvy_shop_order:33`.
- `place_shop_order` son **28.221 caracteres**. Se transcribe con verificación
  por md5, como el resto, pero no es una función para tocar con prisa.

Y hay una decisión de producto que no es mía: **el cliente llena el carrito
antes de elegir local.** Si al elegir local en el checkout resulta que le faltan
tres platos, ¿qué ve?

- (a) se le quitan del carrito con un aviso claro;
- (b) se le bloquea el pedido hasta que elija otro local o los quite;
- (c) se le enseña el aviso y decide él.

Sea cual sea, **la línea inválida nunca puede acabar en `sale_line` a 0 €**: eso
se arregla en el paso 2 pase lo que pase.

---

## 5. Lo que queda declarado y con fecha

- `place_shop_order:383` (recheque del regalo contra el espejo) se queda en el
  paso 2: es la única lectura del espejo que sobrevive al paso 1, y su efecto es
  perder una promo, no regalar un plato ni vender de más.
- `brandCatalogService.ts:118-131` — el contador `unavailableCount` por marca lee
  `is_available` sin local. Con la regla nueva contaría sólo los agotados en
  todas partes. Es un contador que puede decir 0 habiendo filas: **regla 7**. Va
  con el paso 1, leyendo `product_availability`.
- `brandCatalogService.ts:290-299` ya hace lo correcto: con `locationId` **deja
  de leer** el espejo (su propio comentario lo llama «columna muerta»). No se
  toca.
- Caducidad: ni el recálculo del espejo ni el paso 1 revisan `available_until`
  contra el reloj de forma continua; un 86 vencido sigue apagado hasta el
  siguiente recálculo. Es el comportamiento de hoy, no lo empeora ninguno de los
  dos pasos, y se anota aquí para que no se descubra como sorpresa.

---

## 6. Decisiones de Julio (29/08, tarde)

**Volumen, que corrige la prioridad.** La tienda propia lleva 22 ventas desde el
27/06, 600,39 € históricos, **última venta el 12/08 — hace 17 días**, y **cero
líneas con `unit_price = 0`**. El plato regalado nunca ha ocurrido. El fallo es
real y el mecanismo está armado, pero no está costando dinero.

Por eso: **paso 1 escrito y commiteado, NO aplicado el sábado.** Se aplica el
lunes 01/09 con calma. Migración preparada en
`supabase/migrations/20260901T1000_tienda_deja_de_leer_el_espejo_global.sql`.

**Paso 2, decisión de producto tomada.** Cuando el cliente elige local en el
checkout y le faltan platos del carrito, **se los enseñamos marcados como no
disponibles en ese local, con el motivo, y decide él** — quitarlos o cambiar de
local.

No se le quitan en silencio: lo descubriría en el ticket. No se le bloquea el
pedido entero por un refresco.

Es la **regla 7** aplicada de cara al cliente: un umbral —o una falta de
existencias— ordena y etiqueta, no esconde la fila. Vale igual para el operario
que para quien está pagando.
