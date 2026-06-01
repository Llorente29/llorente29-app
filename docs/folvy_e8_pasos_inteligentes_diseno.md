# E8 — Pasos inteligentes enlazados a ingredientes (diseño para aprobación)

**Fecha:** 30/05/2026
**Estado:** diseño previo a construcción (igual método que E3). NADA construido aún.
**Decisión de alcance:** E8 absorbe E4 (el reordenar manual + por coste pasan a ser
opciones de orden dentro de E8). E4 no se construye por separado.

---

## 0. Por qué esto es goleada (no paridad)

Benchmark verificado (30/05): en meez/Apicbase los pasos de preparación son **texto
libre** con foto/vídeo, pero **no reconocen qué ingrediente nombran**, no avisan de
faltantes, y no ordenan el escandallo por elaboración. Los pasos y los ingredientes
**no se hablan**. Lo más cerca que llega meez es la "prep action" (picado/laminado),
que afecta al *rendimiento/coste*, no al *orden*.

El hueco: coherencia paso ↔ ingrediente ↔ coste. Es terreno virgen y casi todo se
resuelve con **lógica local barata** (emparejamiento de texto), no con IA. La IA se
reserva para lo único que el código no sabe hacer: redactar un primer borrador.

---

## 1. Estado real de partida (verificado en BBDD, 30/05)

- `recipe_item_step` EXISTE, VACÍA (0 pasos, 0 platos).
  Columnas: `id, recipe_item_id (FK), position int, kind text (default), text,
  duration_min int|null, temperature_c numeric|null, photo_url text|null,
  created_at, updated_at`.
- NO existe tabla puente paso↔línea.
- NO existe `recipeStepService.ts`, ni tipo `RecipeItemStep` en cliente.
- Solapa "Receta" del editor = placeholder genérico "pendiente" (líneas 1889–1895).
- `RecipeLineBreakdown` (en recipeLineService.ts) ya trae por línea: `lineId,
  childItemId, childName, quantityNet, unitAbbr, lineCost, needsReview…`. Es la
  fuente para el emparejamiento y para el orden-por-coste.

---

## 2. El puente: `recipe_item_step_line` (NUEVO, muchos-a-muchos)

Decisión Julio (30/05): un paso puede usar VARIOS ingredientes, y un ingrediente
puede aparecer en VARIOS pasos. Por tanto, tabla puente, no campo simple.

```
recipe_item_step_line
  id            uuid  pk
  step_id       uuid  → FK recipe_item_step(id)  ON DELETE CASCADE
  line_id       uuid  → FK recipe_line(id)        ON DELETE CASCADE
  created_at    timestamptz default now()
  UNIQUE (step_id, line_id)   -- un mismo ingrediente no se duplica en un paso
```

Notas de diseño:
- `ON DELETE CASCADE` en ambas FKs: si se borra el paso o la línea, el vínculo se va
  solo (no quedan vínculos huérfanos).
- `UNIQUE(step_id, line_id)`: idempotente; volver a detectar el mismo ingrediente en
  el mismo paso no crea duplicado.
- RLS: hereda el patrón multi-tenant del resto (acceso por la cuenta del
  `recipe_item` padre). Se blinda igual que las 40 tablas del Bloque S.
- El vínculo se llena de forma AUTOMÁTICA por el resaltado en vivo (§4.1), no a mano.

---

## 3. Capa cliente nueva (lo que falta construir)

1. **Tipo** `RecipeItemStep` — dónde vive el patrón del proyecto (a confirmar: junto a
   `RecipeLineBreakdown` en recipeLineService, o en kitchen.ts). Campos = columnas de
   la tabla + `lineIds: string[]` (las líneas vinculadas, resueltas para la UI).
2. **`recipeStepService.ts`** (NUEVO) — CRUD multi-tenant siguiendo el patrón
   consolidado (ver brandsService.ts):
   - `listStepsByRecipe(recipeItemId)` → pasos ordenados por `position`, con sus
     `lineIds` vinculados (un join al puente).
   - `createStep`, `updateStep` (texto/kind/duración/temp/foto), `deleteStep`.
   - `reorderSteps(recipeItemId, orderedIds[])` → reescribe `position` en bloque
     (transaccional).
   - `setStepLines(stepId, lineIds[])` → sincroniza el puente para un paso (borra las
     que sobran, inserta las nuevas; respeta el UNIQUE). Lo llama el resaltado.
   - `uploadStepPhoto(...)` → reutiliza el patrón de `recipePhotoService` (path en
     bucket privado, URL firmada al render). Misma fuente de verdad del bucket.
3. **UI**: la solapa "Receta" del editor deja de ser placeholder y pasa a ser el
   editor de pasos (§4).

---

## 4. Las cuatro piezas de inteligencia (3 gratis + 1 IA puntual)

### 4.1 Resaltar el ingrediente en vivo  → CERO IA  (pieza central)
Mientras Pamela escribe el texto de un paso, el cliente compara el texto contra la
lista de ingredientes del escandallo (`childName` de cada `RecipeLineBreakdown`) por
emparejamiento de texto normalizado (minúsculas, sin acentos, por tokens — se reusa
la `normalize()`/`matchesTokens()` que ya existe en KitchenRecipesPage).

- Los ingredientes detectados se **resaltan** dentro del texto del paso (chip/realce).
- Al detectarlos, se **crea/actualiza el vínculo** en `recipe_item_step_line` vía
  `setStepLines`. ESTE es el mecanismo que llena el puente, gratis.
- Coste: 0 llamadas a IA. Es matching local, instantáneo.
- Matiz honesto: el matching por nombre puede fallar en bordes ("queso" vs "Queso
  Cheddar Loncheado"). Por eso el vínculo es EDITABLE: Pamela puede confirmar/quitar
  un ingrediente del paso con un clic (chip con ✕). El resaltado PROPONE; ella manda.

### 4.2 Aviso de ingredientes que faltan en los pasos  → CERO IA
Comparar dos conjuntos: líneas del escandallo vs. líneas vinculadas a algún paso.
Si el escandallo tiene 9 ingredientes y los pasos solo cubren 7, se avisa: "2
ingredientes no aparecen en ningún paso: Bacon Ahumado, Bolsa Lobber". Coste 0.
- Sutil, no bloqueante (es ayuda, no error). Los no-alimentarios (envoltorio, bolsa,
  servilletas) podrán marcarse como "no va en pasos" para no ensuciar el aviso.

### 4.3 Borrador de pasos por IA  → SÍ IA, UNA llamada puntual, guardada
Botón "Generar borrador de pasos". Toma la lista de ingredientes + cantidades y pide
a la IA una secuencia de pasos coherente. Control de coste POR DISEÑO (igual que la
merma de E3):
- Se llama SOLO al pulsar el botón. Nunca automático, nunca en bucle.
- El resultado se GUARDA como pasos editables (no se re-llama al re-renderizar).
- Es un punto de partida que Pamela edita; no la verdad final.
- Marcado de origen: los pasos generados nacen como borrador hasta que se editan/
  confirman (campo de origen/confianza, a definir si reusamos `kind` o añadimos flag).
- El borrador, al escribirse, dispara el resaltado (4.1) → ya nace con vínculos.

### 4.4 Foto por paso  → ya soportado
`recipe_item_step.photo_url` ya existe. Misma mecánica que la foto del plato (E5):
path en bucket privado, URL firmada al render, vía recipePhotoService. Estilo meez
(foto por paso de prep). Subir/cambiar/quitar por paso.

---

## 5. El orden-por-elaboración (la idea original de Julio) = consecuencia

Con el puente lleno (4.1), el escandallo puede ordenarse por el orden de los pasos:
para cada línea, su "posición de elaboración" = el `position` del primer paso que la
usa. Las líneas sin paso van al final (y enlazan con el aviso 4.2).

Opciones de orden del escandallo (esto absorbe E4):
1. **Por elaboración** (1ª opción de Julio) — si hay pasos con vínculos. Por defecto
   cuando existan pasos.
2. **Por coste descendente** — siempre disponible (ya tenemos `lineCost`). Útil para
   ver de un vistazo qué ingrediente pesa más.
3. **Manual** (arrastrar) — siempre disponible; un orden manual explícito gana sobre
   los automáticos (se persiste en `recipe_line.position`).

Regla de precedencia: si Pamela arrastra manualmente, manda el manual. Si no ha
tocado nada y hay pasos, manda elaboración. Si no hay pasos, el orden actual / por
coste. (El detalle fino de cómo se guarda "modo de orden elegido" se cierra en el
sub-paso de construcción correspondiente.)

---

## 6. Plan de construcción por sub-pasos (seguros, uno cada vez)

E8 es grande; se construye en orden, cada sub-paso compila y es verificable solo:

- **E8.1 — BBDD:** crear `recipe_item_step_line` + RLS + FKs. SQL transaccional
  revisable. Regenerar `database.ts`. (Cimiento.)
- **E8.2 — Service + tipo:** `recipeStepService.ts` + tipo `RecipeItemStep`. CRUD +
  reorder + setStepLines + foto. Sin UI todavía; se valida con build.
- **E8.3 — UI base de la solapa "Receta":** listar/crear/editar/borrar/reordenar
  pasos (texto, kind, duración, temp). Sin inteligencia aún. Reemplaza el placeholder.
- **E8.4 — Resaltado en vivo + puente (4.1):** la pieza central gratis. Detecta y
  vincula ingredientes; chips editables.
- **E8.5 — Aviso de faltantes (4.2):** gratis, sobre lo anterior.
- **E8.6 — Orden-por-elaboración + por coste + manual (4.3/§5):** absorbe E4.
- **E8.7 — Foto por paso (4.4).**
- **E8.8 — Borrador IA puntual (4.3):** la única pieza con IA, al final, con su
  control de coste.

Cada sub-paso = su propio "pídeme los ficheros / te doy bloque pegable / build /
verificas". No se mezclan.

---

## 7. Lo que NO entra en E8 (para no inflarlo)

- Vídeo por paso y galería multi-foto del plato → G8 (pestaña "Fotos").
- "Prep actions" estilo meez (rendimiento por acción: picado/laminado con yield) →
  es otra cosa, ligada al sistema de unidades/formatos de compra (Bloque inventario).
  NO se mezcla aquí. Se puede anotar como idea futura.
- Modo "slideshow" de cocina (pasos a pantalla completa para el pase) → posible G
  posterior; E8 deja los datos listos para ello.

---

## 8. Riesgos / honestidad

- El matching por nombre (4.1) es bueno pero no infalible: nombres compuestos,
  plurales, sinónimos ("ternera" vs "Carne mixta picada"). Mitigación: vínculo
  siempre editable + el aviso de faltantes (4.2) hace de red de seguridad. NO se
  intenta resolver con IA en bucle (sería caro y frágil). Si en pruebas el matching
  se queda corto, se evalúa un diccionario de alias local (gratis), no IA.
- El orden-por-elaboración necesita que los pasos estén bien vinculados; por eso el
  manual siempre manda y el por-coste siempre está como alternativa fiable.
- Coste IA: una sola llamada por uso del botón de borrador. Encaja con el medidor de
  coste IA por cuenta (deuda HIGH ya anotada, prerequisito 2º cliente).

---

## 9. Lo que necesito para arrancar E8.1 (cuando apruebes el diseño)

Nada más por ahora: el modelo está claro y la BBDD verificada. Al aprobar, te paso el
SQL transaccional de `recipe_item_step_line` (revisable antes de ejecutar) como primer
sub-paso. El resto de ficheros (service, tipos, UI) se piden tramo a tramo.
