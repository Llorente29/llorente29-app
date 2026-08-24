# Tareas A y B — Agotar (86) desde la lista y menú contextual (F4)

Fecha: 24/08/2026 · Solo front. Cero migraciones. `App.tsx` sin tocar.

## Tarea A — Agotar (86) desde la lista

### La verificación que pedías: sí, llega a las plataformas

Seguida hasta el final, no supuesta:

```
botón agotar (lista)
  └─ setProductAvailability()            menuOverrideService
      └─ RPC set_product_availability    cascada CROSS-BRAND + guard de acceso
          └─ net.http_post → availability-dispatch
              ├─ HubRise : PATCH /catalogs/{id}/locations/{loc}/inventory   ← empuje real
              ├─ Last    : SOLO LECTURA desde el 30/07 (se loguea, no se escribe)
              └─ Otter   : hueco declarado (se loguea, no se silencia)
```

Como HubRise es quien alimenta Glovo/Uber/JustEat, **agotar en la lista agota en
las plataformas**. Lo que llega es el `is_available` del producto; los overrides
por canal (`menu_item_override.is_available`) siguen siendo otro frente.

### Dos cosas que conviene que sepas

**El 86 es cross-brand, no «de esta carta».** La RPC cascadea a todas las
marcas que comparten el producto físico (mismo escandallo o misma matrícula).
Agotar la Coca-Cola en Milanesa Haus la agota también en Dos Coyotes. Es el
comportamiento que ya tenía la ficha, y es el correcto —el producto físico se ha
acabado de verdad—, pero desde una lista por marca no es obvio.

Por eso **no** pongo confirmación previa (pediste un toque, y el alcance no se
conoce hasta que responde el servidor) sino que el resultado lo dice después:
*«Coca-Cola agotado · 3 marcas · 4 canales»*, con **Deshacer** al lado. Un toque
para agotar, y la verdad completa a la vista con vuelta atrás.

**Terminología: unificada en «Agotado».** La primera versión decía «Pausado»,
pero el resto de la app llama a ese mismo estado **«agotado»** (`EnCartaTab`:
«Agotado · reactivar»; la pantalla de Disponibilidad igual) y es un campo único
(`is_available`) — dos nombres para lo mismo era una trampa. Ahora la lista dice
**«Agotado»**, el botón «Marcar agotado» / «Reactivar», y el aviso «… agotado ·
3 marcas · 4 canales». Los iconos también se alinean: `CircleSlash`, que es el
que el propio módulo asocia a Disponibilidad, y `CheckCircle2` para reactivar.

(«Pausar/Reanudar» sigue existiendo en Ofertas de plataformas, y ahí se queda:
eso es pausar una promoción, no marcar un producto sin stock.)

## Tarea B — Menú contextual (F4)

Clic derecho en escritorio, long-press de 500 ms en móvil (se cancela si el dedo
se mueve: el scroll de la lista manda). **Sin drag**, como pediste — eso irá en
un «modo reordenar» aparte.

Componente nuevo `ProductContextMenu.tsx`: fondo blanco, sombra, separadores
entre grupos, iconos a la izquierda, submenús para categoría y marca, se cierra
con Escape o tocando fuera, y se corrige contra los bordes de la ventana después
de medirse (su alto depende de cuántas acciones se ofrezcan).

Los iconos son **lucide**, no emojis. El §2.3 los dibuja con emoji, pero toda la
app usa lucide y mezclarlos se ve mal en Windows. Si los quieres emoji, es un
cambio de una línea por fila.

### Dos acciones del §2.3 que no son lo que parecen

**«Archivar» y «Quitar de esta carta» son la misma operación.** Las dos acaban en
`archiveMenuItem` (`is_active=false` + `archived_at`). Ofrecer dos entradas con
nombres distintos para el mismo efecto es prometer una diferencia que no existe:
alguien archivaría esperando algo distinto de quitar. He dejado **una**, «Quitar
de esta carta», con el tooltip que explica que archiva sin borrar nada. Si
quieres dos comportamientos de verdad distintos (p. ej. archivar = sale de la
carta pero se conserva en un cajón visible), eso es trabajo nuevo y lo hablamos.

**«Duplicar» no puede copiar el escandallo.** `menu_item` tiene un índice único
`(brand_id, channel_id, recipe_item_id)`: dos productos con la misma receta en la
misma marca y canal son imposibles — y son, exactamente, los duplicados que
hubo que limpiar a mano ayer. Copiar la receta sería fabricar uno nuevo.

La copia nace **sin escandallo**, con nombre «… (copia)», mismo precio, IVA y
categoría, y marcada `needs_review`: es un borrador que alguien termina. (En
Postgres dos NULL no colisionan en un índice único, así que siempre entra.)
Para vender el mismo plato en otra marca está «Añadir a otra marca», que
comparte la receta a propósito — coste único.

### Acciones entregadas

| Acción | Qué usa |
|---|---|
| Editar nombre · Editar precio | `updateMenuItem` + mini-diálogo (Enter guarda, Esc cancela) |
| Mover a categoría ▸ | `setMenuItemCategory`, submenú con las categorías + «Sin categoría» |
| Duplicar | `duplicateMenuItem` (nuevo, ver arriba) |
| Añadir a otra marca ▸ | `addRecipeToBrand`; deshabilitado con motivo si no hay escandallo o ya está en todas |
| Marcar agotado / Reactivar | la misma vía de la Tarea A |
| Quitar de esta carta | `archiveMenuItem`, con el diálogo y el aviso de ventas de ayer |
| Ir a ficha completa | la ficha de siempre |

## Verificación

`tsc --noEmit` limpio · `npm run build` ✓ · ESLint **5 avisos en
`KitchenMenuPage` = los 5 del baseline**; `ProductContextMenu` y
`menuItemService`, **cero** · tests `6 failed | 239 passed`, idéntico a `main`.

No he tocado datos de producción: no he pausado ni duplicado nada real. Lo que
queda es probarlo en vivo tras el deploy — en particular el long-press en el
teléfono, que es lo único que no se puede comprobar sin dedo.

## Nota de mantenimiento

Hay **dos** funciones `setProductAvailability` con firmas distintas:
`availabilityService` (`…, locationId, reason`) y `menuOverrideService`
(`…, reason`). Ambas llaman a la misma RPC y las dos se usan. Lo comprobé porque
parecía un bug —una llamada pasa `'manual'` donde la otra espera un local— y
**no lo es**: cada pantalla importa la suya. Pero un día alguien cambiará el
import y el fallo será silencioso. Unificarlas es media hora, cuando quieras.
