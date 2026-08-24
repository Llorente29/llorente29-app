# Gestor de menús — auditoría verificada y F1 entregada

Fecha: 24/08/2026 · Solo front. Cero migraciones. `App.tsx` sin tocar.

## Lo primero: el §0 del encargo no es el estado de hoy

El RECON se hizo el 23/08. Contrastado contra el código de `main` a día de hoy,
**cinco filas de esa tabla están mal**. No es una queja: si se planifican F2–F7
sobre ellas, se pagaría trabajo ya hecho.

| El encargo dice | Realidad verificada |
|---|---|
| **QUITAR producto de carta — NO EXISTE (bloqueante)** | **Existe y está en producción** desde ayer por la tarde (PR #84, deploy `dpl_HMjXBcarWhru`). Botón por fila en la lista + acción en la ficha. |
| Desactivar/archivar — NO ACCESIBLE desde la carta | Accesible: quitar de la carta **es** archivar (`is_active=false` + `archived_at`). |
| **Búsqueda/filtro — NO EXISTE en la carta** | **Existe**: input «Buscar producto…» (línea 763) que filtra en vivo y colapsa las categorías sin resultados (líneas 251-257). Lo que falta son los **chips de filtro** (sin escandallo, sin foto, por canal). |
| **Fotos en la lista — no se muestran** | **Se muestran**: `<img src={p.photoUrl}>` con fallback a icono según sea plato o combo (líneas 876-880). |
| La ficha es `CatalogProductDetailPage` | Ese fichero **ya no existe**: se fusionó en `CatalogFichaPage` (ficha unificada de 8 pestañas). El §3 «no tocar» apunta a un fichero fantasma. |

Lo que el §0 acierta de lleno: no hay drag & drop, no hay edición inline, no hay
menú contextual, no hay renombrar categoría ni editar su emoji, y el estado de
publicación por canal no se ve en la lista.

## Lo entregado hoy: F1 completa

Ayer entró la mitad de F1 (quitar de la carta, con confirmación). Hoy entra el
resto de lo que pedía el §2.4 y el §5:

1. **Aviso de ventas recientes.** Al abrir la confirmación se cuenta cuántas
   veces se ha vendido esa semana y se avisa en ámbar: *«Se ha vendido 14 veces
   esta semana. Si solo se ha agotado hoy, quizá busques pausarlo en vez de
   quitarlo de la carta.»* Avisa, no bloquea.
2. **Deshacer.** Tras quitar aparece la barra de Deshacer que ya usaban mover en
   bloque y borrar categoría — mismo mecanismo, no uno nuevo. Reactiva
   exactamente los que se quitaron (`restoreMenuItem`).
3. **Quitar en bloque.** Botón «Quitar de la carta» en la barra de selección. El
   mismo diálogo sirve para uno o para veinte, y el Deshacer los restaura todos.

**Decisión técnica que conviene conocer:** el conteo de ventas usa
`sale_line.created_at` en vez de unir con `sale.sold_at`. Medido antes de
elegirlo: sobre las **1.922 líneas de los últimos 7 días, ninguna** se desvía más
de un día entre ambas fechas. Es una consulta en vez de un join, y es un aviso,
no un dato contable.

## Verificación

- `tsc --noEmit` limpio · `npm run build` ✓ · ESLint **5 avisos en
  `KitchenMenuPage` = los 5 del baseline**, `menuItemService` sin avisos · tests
  `6 failed | 239 passed`, idéntico a `main`.
- El §5.3 («el producto quitado sigue en `sale_line`, el dashboard no se ve
  afectado») se cumple por construcción y ya estaba verificado ayer: **nada se
  borra**, se marca `archived_at`. `sale_line.menu_item_id` sigue apuntando a la
  misma fila.
- Los pasos 1 y 2 del §5 (quitar con ventas → aviso → Deshacer; quitar 3 en
  bloque → Deshacer restaura los tres) son de UI en vivo: quedan para ti tras el
  deploy. No he tocado ningún dato de producción.

## El resto del rediseño: qué haría y en qué orden

Tomo el benchmark del §1 como dado —es tuyo, no lo he verificado— y lo uso solo
para ordenar. Mi lectura, ya con el código delante:

| Fase | Qué falta de verdad | Por qué ese orden |
|---|---|---|
| **F2** | Chips de filtro (sin escandallo · sin foto · archivados · por canal). El buscador ya está. | Barato y se nota: hoy no hay forma de encontrar «los que no tienen escandallo». |
| **F3** | Renombrar categoría y editar su emoji (el campo existe, no hay UI). Inline edit de nombre y precio. | El renombrado es media hora; el inline edit toca el guardado optimista. |
| **F6** | Indicador de publicación por canal en la fila. | **Aquí está el hueco más caro de la lista.** Hoy hay que abrir la ficha para saber si algo llega a Glovo. |
| **F4** | Menú contextual (clic derecho / long-press). | Agrupa acciones que para entonces ya existirán. Antes es una carcasa vacía. |
| **F5** | Drag & drop (`@dnd-kit`). | El más caro y el único con dependencia nueva. Las flechas ↑/↓ ya funcionan: es mejora de comodidad, no de capacidad. |
| **F7** | Pulido visual. | Al final, sobre lo que exista. |

Dos matices sobre el §2 que conviene decidir antes de empezarlos:

- **F5 y móvil.** El encargo pide drag & drop *y* mobile-first. En un teléfono, el
  long-press para arrastrar compite con el scroll y con el menú contextual de F4
  (que usa el mismo gesto). O el long-press abre el menú, o inicia el arrastre;
  las dos no. Mi recomendación: menú contextual en long-press, y drag & drop solo
  en escritorio con un «modo reordenar» explícito en móvil (que es lo que hace
  Square con su *Rearrange mode*).
- **F1 ya cubre «pausar (86)»**, pero no como acción propia. El campo
  `is_available` existe y `EnCartaTab` ya lo gestiona. Sacarlo a la lista es
  media hora y evita que la gente quite de la carta lo que solo se ha agotado —
  que es justo lo que previene el aviso ámbar que entra hoy. Lo pondría en F2, no
  en F4.

## Deuda que sigue abierta (de ayer, sin tocar)

La RLS de `menu_item` exige `admin` mientras `recipe_item` admite `manager`. Hoy
no bloquea (1 admin, 8 workers, cero managers), pero **todas** las acciones de
este rediseño fallarán para un encargado el día que exista. Si F2–F7 van a
construir sobre esta pantalla, esto conviene resolverlo antes que después.
