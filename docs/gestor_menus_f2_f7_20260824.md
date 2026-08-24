# Gestor de menús — F2, F3, F5, F6 y F7 entregadas

Fecha: 24/08/2026 · Solo front. **Cero migraciones.** `App.tsx` sin tocar.

## Antes de nada: el encargo de referencia no está en el repo

`claude_ENCARGO_CODE_gestor_menus_auditoria_rediseno.md` **no existe como
fichero** —ni en `main` ni en el historial—. Me lo pasaste pegado en la
conversación de ayer. He trabajado con la especificación de tu mensaje, que es
detallada, más el plan de fases que dejé escrito en
`gestor_menus_auditoria_f1_20260824.md`. Si el fichero tiene detalles que no
estaban en el mensaje, no los he podido leer: súbelo al repo y lo repaso.

## F2 · Chips de filtro

Cuatro chips bajo el buscador: **Sin escandallo · Sin foto · Agotados ·
Archivados**, con contador «12 de 480» y un «Quitar filtros».

**Los chips SUMAN entre sí.** «Sin foto» + «Agotados» pide los que cumplen las
dos cosas, no los que cumplen alguna: quien filtra está buscando *los que hay
que arreglar*, no una lista más larga.

**«Archivados» no acota: sustituye.** Los otros tres se resuelven en memoria
sobre la carta ya cargada, como pedías. Ese no puede: **los archivados están
fuera de la carta por definición**, así que hay que ir a buscarlos
(`listCategoriesWithProducts` gana la opción `includeArchived`). Cuando está
marcado se ven **solo** los archivados, en gris y con su etiqueta, y sale un
aviso: *verlos no es devolverlos*. Mezclarlos con los vivos sin decirlo sería
pintar como carta algo que no lo es.

Sus filas van **sin edición en línea y sin arrastre**: un producto archivado no
se reordena ni se le cambia el precio.

## F3 · Edición en la fila y categorías

- **Nombre y precio del producto**: doble clic → input; Enter confirma, Esc
  cancela, y **salir del campo también confirma** — en un teléfono «tocar
  fuera» es el gesto natural y perder lo escrito ahí enfada.
- **Guardado optimista con vuelta atrás**: se pinta ya y, si el servidor dice
  que no, se restaura el valor viejo y la fila lo dice. Aviso «Guardado» que se
  va solo, sin modal.
- **Precio**: `12,50` y `12.50` son la misma cifra. Que el separador decimal sea
  coma en español no puede ser motivo de un error.
- **Nombre de categoría**: doble clic, igual.
- **Emoji de categoría**: el campo `menu_category.emoji` existía en BBDD desde
  el principio **sin ninguna UI**. Ahora hay una rejilla corta de emojis útiles
  en una carta, más «Sin emoji». No es un selector completo (eso es una
  librería y un bundle nuevo) y no lo pretende.

También accesible desde teclado: `Enter`/`F2` sobre el campo abre la edición,
porque el doble clic no existe sin ratón.

## F5 · Arrastrar y soltar

`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, instalados **ahora
y no antes**, como pedía el §6.

- Productos **dentro** de una categoría (reordenar) y **entre** categorías
  (mover, con su `setMenuItemCategory` + renumerado del destino, para que caiga
  donde lo sueltas y no al final).
- Categorías entre sí.
- **Placeholder azul** en el destino (`background-info` / `text-info`, el azul
  marino del theme) y una etiqueta que sigue al dedo — sin ella se arrastra
  «nada», porque la fila original se queda en su hueco.
- **Flechas ↑/↓ conservadas** en escritorio: son el camino accesible.
- **Categoría vacía como destino**: sin eso no habría forma de llevarle el
  primer producto, que es justo cuando más falta hace.

**Móvil: NO hay arrastre suelto.** El long-press es el menú contextual de F4 y
dos gestos no pueden pelearse por el mismo dedo. Hay un botón **«Modo
reordenar»** explícito —lo mismo que hace Square— y solo dentro de él aparecen
las asas. Mientras está activo, tocar un producto **no** abre su ficha: si no,
cada intento de agarrar abriría una pantalla.

El arrastre se activa por el **asa**, no por la fila entera, y exige 6 px de
recorrido y 250 ms de pausa: sin eso, un clic normal se comería el «abrir
ficha» y el scroll del dedo arrastraría productos sin querer.

## F6 · Canales publicados

Chips de una letra por fila: **G U J S**, en verde (con precio propio en ese
canal), rojo (pausado ahí) o gris (sin precio: va al base, o no se vende).
Una sola consulta para toda la lista, no una por fila.

**Qué dice y qué no, dicho claro:** el chip lee `menu_item_override` cruzado con
`sales_channel`. Eso es **lo que tú has fijado por canal**, que es lo que se
puede cambiar desde Folvy. **No es «lo que HubRise está sirviendo ahora»** — esa
verdad vive en `external_catalog_product` y solo se conoce tras publicar. La
diferencia importa el día que una publicación falle, y por eso queda escrita en
el servicio y aquí, en vez de escondida detrás de un verde tranquilizador.

Los overrides pueden ser por local. Se agrega **al peor caso**: si en un local
está pausado, el chip lo dice. Y el color no viaja solo — cada chip lleva su
`title` explicando el estado.

## F7 · Pulido

**Un conflicto que resuelvo y te señalo: la paleta que pides es la de antes del
rebrand.** El encargo dice «terracota `#D67442`, azul marino `#1E3A5F`». Pero
`src/index.css` dice, literalmente:

```css
/* Acción / marca (rebrand 30/06/2026: tinta monocroma) */
--color-accent: #15171A;
/* Token 'terracota' conservado apuntando a tinta (herencia sin tocar JSX). */
--color-terracota: #15171A;
```

El terracota se retiró el 30/06 y el token se dejó apuntando a tinta. Meter
`#D67442` a mano en esta pantalla la dejaría siendo **la única terracota de toda
la app**. He usado el sistema vivo (`accent`, `text-primary`, `border-default`,
`page`, `card`) y el azul marino sí, que existe como `text-info`/`background-info`
y es el que usan el placeholder de arrastre. Si quieres el terracota de vuelta,
es una decisión de toda la app —un token, no una pantalla— y te la preparo.

Lo hecho: **114 clases `gray-*` heredadas migradas a tokens**, transición real al
plegar categorías (`grid-template-rows` 0fr↔1fr, que anima el alto sin
inventarse un `max-height`), chevron que rota, hover suave en filas, sombras del
sistema (`--shadow-lg`) en menú contextual y avisos, y foco visible en el
buscador.

**Mobile-first:** el bloque ancho de salud/coste y las flechas ↑/↓ se ocultan
bajo `sm` — no caben en un teléfono junto a lo accionable, y el dato completo
sigue estando en la ficha. Padding lateral reducido en móvil.

## Verificación

`tsc --noEmit` limpio · `npm run build` ✓ · ESLint **6 avisos = los 6 del
baseline exacto** (4 errores + 2 warnings, todos preexistentes; los **7 ficheros
nuevos, cero**) · tests `6 failed | 239 passed`, idéntico a `main`.

**Lo que NO he podido verificar, y lo digo:** pediste comprobar que funciona en
el móvil de Pamela. **Desde aquí no puedo abrir un navegador**: el entorno sale
por un proxy que no llega a producción (`ERR_TUNNEL_CONNECTION_FAILED`). Lo que
sí está hecho es escribir el código *para* el móvil —modo reordenar, `touch-none`
en las asas, umbrales de activación táctil, columnas que se retiran bajo `sm`— y
lo que queda es que alguien con un dedo lo pruebe. En particular:

1. Que el «Modo reordenar» arrastre y no haga scroll a la vez.
2. Que el long-press siga abriendo el menú contextual **fuera** de ese modo.
3. Que el doble toque sobre el nombre abra el input y el teclado numérico salga
   en el precio.

## Deuda que sigue abierta

- La **RLS de `menu_item`** exige `admin` mientras `recipe_item` admite
  `manager`. Todas las acciones de esta pantalla fallarán para un encargado el
  día que exista uno. Sigue sin tocarse desde que lo levanté el 23/08.
- `database.ts` lleva `kitchen_recompute_all` añadido a mano; conviene
  regenerarlo entero en una pasada aparte.
