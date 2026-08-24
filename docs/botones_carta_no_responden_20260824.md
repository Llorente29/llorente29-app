# URGENTE «Los botones de la carta no funcionan» — resultado

Fecha: 24/08/2026 · Solo front. Cero migraciones. `App.tsx` sin tocar.

## Lo primero: los botones SÍ funcionaban. Uno de ellos mentía.

Antes de tocar código miré la BBDD, porque «no hace nada» y «hace algo que no se
ve» se distinguen ahí y no en el navegador. En las últimas 24 h, en tu cuenta:

| Hora (Madrid) | Producto | Qué quedó grabado |
|---|---|---|
| 09:18:15 | Birria Chicken Bowl (AMB) | `is_active=false` + `archived_at` |
| 09:15:08 | Nestea Limón | `is_active=false` + `archived_at` |
| 09:10:10 | Vegan Bowl (AMB) | `is_active=false` + `archived_at` |
| 09:10:07 | GRINGAS DE QUESO (AMB) | `is_active=false` + `archived_at` |

Cinco archivados y tres marcados agotado, con tus horas encima. **Cada clic tuyo
en la ✕ llegó y se ejecutó.** Lo que fallaba era lo de después: el producto se
volvía a pintar en la lista igual que antes, así que desde tu silla era
indistinguible de un botón muerto. Pulsaste varias veces, y cada vez archivaste
un producto distinto.

## Causa 1 — la ✕ «Quitar de esta carta» (KitchenMenuPage)

`listCategoriesWithProducts` (`brandCatalogService.ts`), que es la consulta que
alimenta la lista de la carta, **no filtraba `archived_at`**. Filtraba cuenta y
marca y nada más. Archivar dejaba el producto exactamente donde estaba.

```ts
.eq('brand_id', brandId)
.is('archived_at', null)   // ← esto es lo que faltaba
```

**Esto es un fallo de verificación mío, y lo digo entero:** al cerrar el PR #84
escribí «`listMenuItems` filtra `archived_at IS NULL` → desaparece de la carta».
Es cierto de `listMenuItems`, pero la lista de la carta **no usa esa función**.
Verifiqué la función equivocada y di por buena una promesa que el código no
cumplía. Por eso llevas desde ayer pulsando una ✕ que archivaba en silencio.

Comprobado contra producción antes de dar el filtro por bueno: de 523 `menu_item`
de la cuenta, el filtro esconde **8** (los archivados, ni uno más) y deja 515.
Cero filas con `archived_at` puesto y `is_active` en true. Las 4 filas inactivas
sin archivar siguen viéndose como hasta ahora, en gris: eso no lo toco.

## Causa 2 — «Agotado · reactivar» en la pestaña «En carta» (EnCartaTab)

Aquí el `onClick` también estaba bien conectado. El problema es el que
sospechabas en tu tercera hipótesis: **un estado que no se inicializa**.

`mirror` (¿es este producto un espejo de promoción?) empezaba en `null`, y el
`catch` también dejaba `null`. Con eso no se distingue «aún no lo sé» de «no lo
es» — y el control de disponibilidad usa `null` para caer en la rama «Agotado ·
reactivar». Un producto **espejo en espera** (oculto a propósito porque su
versión promo está activa, no agotado) mostraba durante ese instante el botón
equivocado: pulsarlo intenta reactivar algo que el sistema de espejos vuelve a
ocultar, y el resultado visible es que el enlace no responde.

«Burrito Colosal de Cochinita ★», que tocaste a las 07:45, es exactamente eso:
`es_espejo = true`.

El arreglo ancla el estado al id del producto (`{ itemId, value }`), así que
«cargando» y «no es espejo» dejan de ser el mismo valor, y añade una rama
**«Comprobando…»** mientras se resuelve. Es un parpadeo, no un bloqueo: cuando
llega la respuesta aparece el botón correcto, el de espejo o el de agotado.

## Lo que pediste y no pude hacer

Abrir la consola (F12) y reproducirlo en vivo: **no es posible desde aquí**. El
navegador de este entorno sale por un proxy que no deja pasar a producción
(`net::ERR_TUNNEL_CONNECTION_FAILED`; `curl` a la misma URL devuelve 000). Lo
intenté con Chromium y Playwright antes de decidirlo.

Así que la sustituí por la única evidencia mejor que un clic: **las escrituras
que tus clics dejaron en la BBDD**, con hora exacta. Prueban lo que la consola
habría mostrado —que el evento llegaba— y además dicen qué se rompía después,
que la consola no habría contado (no hay error: la consulta devolvía la fila
archivada porque nadie le pidió que no lo hiciera).

Queda para ti tras el deploy: quitar un producto y ver cómo desaparece de la
lista, y abrir la ficha de un espejo para comprobar que ya no ofrece «reactivar».

## Verificación

`tsc --noEmit` limpio · `npm run build` ✓ · ESLint: **idéntico al baseline** —
1 error preexistente en `brandCatalogService` (el `as any` del cast de
`mirror_of_item_id`, línea 177, que ya estaba en `main`), `EnCartaTab` cero ·
tests `6 failed | 239 passed`, los mismos que `main`.

No he tocado datos de producción: las consultas fueron de solo lectura.

## Los 8 archivados siguen ahí

Nada se ha borrado. Los 5 de hoy salieron de la carta porque tú lo pediste, y con
el filtro puesto ahora se comportan como esperabas. Si alguno se archivó de más
—pulsando dos veces creyendo que no funcionaba— dímelo y lo devuelvo:
`restoreMenuItem` lo deshace en una consulta.
