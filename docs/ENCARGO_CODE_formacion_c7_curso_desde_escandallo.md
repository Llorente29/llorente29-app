# ENCARGO CODE — Formación · C7
## Generar curso desde el escandallo (la pieza que nadie puede copiar)

> **Origen**: Pieza C del encargo C4, declarada y no entregada tras tu RECON. Vuelve como encargo propio, con tu hallazgo del cruce de buckets ya incorporado.
> **Depende de**: C1–C6, todas en `main` y aplicadas.
> **Diseño**: `docs/folvy_formacion_catalogo_v2.md` §7 y §8 · Molde de contenido: `docs/folvy_formacion_guia_contenido.md`.

---

## 0. POR QUÉ ESTA PIEZA ES ESTRATÉGICA

Folvy tiene **pasos de receta vinculados a ingredientes** (`recipe_item_step_line`, el diferencial E8). meez y Apicbase tienen pasos de texto muerto; Folvy sabe **qué línea de ingrediente entra en qué paso**.

Eso permite generar un curso de producto **desde la receta, sin escribir nada**. Ningún LMS del mercado puede hacerlo, porque ninguno tiene el escandallo dentro. Es la misma victoria estructural que la matriz de alérgenos: se gana porque los módulos están conectados.

**El caso de uso real**: un grupo con 17 marcas y decenas de platos necesita que la smash burger salga igual en Alcalá que en Plaza Castilla. Hoy eso se transmite de boca en boca y se pierde con la rotación.

---

## 1. LO QUE YA VERIFICAMOS (no repitas este RECON, pero confírmalo)

Datos comprobados contra el esquema vivo el 04/08:

- **`recipe_item`** — el plato. Foto en `kitchen_photo_url`, resuelta con `getDishPhotoUrl()`.
- **`recipe_item_step`** — `position`, `text`, `kind`, `duration_min`, `temperature_c`, **`photo_url`**, **`video_url`**. Ojo: **cada paso puede tener su propia foto** — no lo aproveches solo para la portada.
- **`recipe_line`** — `parent_item_id`, `child_item_id`, `quantity_gross`, `quantity_net`, `unit_id`, `cut_type_id`, `position`, `comment`.
- **`recipe_item_step_line`** — `step_id` + `line_id`: qué ingrediente va en qué paso.
- **`recipe_item_allergen`** — alérgenos **ya calculados** por el motor de herencia. Reutiliza `listItemAllergens()`; **no recalcules nada**.

---

## 2. 🔴 EL PROBLEMA DE LOS BUCKETS (tu hallazgo, y el punto delicado)

Las fotos de receta viven en **`recipe-uploads`**; las imágenes de sección de curso, en **`course-section-images`**.

**Copiar solo la ruta falla en silencio**: el resolver de imágenes de curso firmaría contra el bucket equivocado y no se vería nada, sin error visible. Es el peor tipo de fallo.

**Solución**: al generar el curso, **descargar los bytes de `recipe-uploads` y volver a subirlos a `course-section-images`**, namespaceados por cuenta igual que el resto (`{accountId}/...`).

Reglas:
- **Copia, no referencia.** Si mañana se cambia la foto de la receta, el curso ya firmado no debe mutar.
- Si una foto falla al copiarse, **no abortes el curso entero**: genera la sección sin imagen y **regístralo en el resultado** para que el usuario lo sepa. Un curso sin una foto es útil; un curso que no se genera, no.
- Aplica a la foto del plato **y a las fotos de paso**.

---

## 3. QUÉ GENERA

Botón **"Crear curso de este plato"** en la ficha del plato (`CatalogFichaPage.tsx` — ya es una página grande y compleja; **añade, no reescribas**).

Produce un **borrador** con:

**Cabecera:**
`account_id` = la cuenta (nunca plantilla global) · `status='draft'` · `category='producto'` · `level='especialista'` · `is_mandatory=false` · `reeval_months=null` · `delivery_mode='folvy_imparte'` · `requires_practical=true` · `business_types='{todos}'` · `source_recipe_item_id` = el plato.

**Secciones** (siguiendo el molde de la guía, adaptado a producto):
1. **"Qué vas a preparar"** — nombre del plato, foto, tiempo total (suma de `duration_min`) y la lista de ingredientes con cantidades.
2. **Una sección por paso**, en orden de `position`: el texto del paso, sus ingredientes con cantidad y unidad (vía `recipe_item_step_line` → `recipe_line`), y **su foto si la tiene**. Si el paso tiene `temperature_c` o `duration_min`, muéstralos destacados.
3. **"Alérgenos de este plato"** — desde `recipe_item_allergen`, ya calculados.

**Test autogenerado** — y aquí hay que ser honesto sobre los límites:
- Genera lo que se puede generar con fiabilidad: **orden de los pasos**, **cantidades clave**, **alérgenos que lleva**, **temperatura o tiempo** si existen.
- **Casos límite que debes manejar** (los señalaste tú): platos con 1-2 ingredientes, platos sin pasos, platos sin alérgenos. En esos casos **genera menos preguntas en vez de inventar**, y dilo en la UI: *"Se han generado 4 preguntas. Revísalas y añade las que falten."*
- **Nunca completes con preguntas de relleno.** Un test malo es peor que un test corto.
- Distribución de la respuesta correcta **variada** (regla de la guía §Test).

**Verificación práctica** — un solo gesto:
> *"Elabora el plato siguiendo la ficha y enséñaselo a tu responsable."*

---

## 4. REGLAS DURAS

- **Siempre borrador.** La receta no es un curso: es la materia prima. El cocinero revisa antes de publicar.
- **Copia, no referencia.** El curso guarda el texto del paso tal como estaba al generarlo. Si la receta cambia, el curso no muta bajo los pies de quien ya lo firmó.
- **Anti-duplicado**: si ya existe un curso generado de ese plato (`source_recipe_item_id`), ofrecer **"Regenerar"** en vez de crear otro. Regenerar **sube `version`** y reemplaza el contenido, **sin tocar las firmas ya emitidas** (guardan su `course_version`).
- **Duración ≤ 10 min** (regla de la guía para cursos de producto). Si la receta tiene 15 pasos, el curso será largo — avísalo en la UI en vez de recortar en silencio.
- **Multi-tenant**: el curso pertenece a la cuenta del plato. Guard `belongs_to_account` en la RPC, y `auth.uid()` resuelto server-side.

---

## 5. ENTREGA

1. Rama `feature/formacion-c7-curso-desde-escandallo`.
2. Migraciones entregadas, **no aplicadas por ti**. Con guard `DO`.
3. 🔴 **Backfill y DDL en ficheros separados** (lección de C6: el SQL Editor envuelve todo en una transacción y un fallo de datos tumba el DDL).
4. 🔴 **Nunca `COMMIT` ni `ROLLBACK` dentro de un bloque `DO`.**
5. `database.ts` regenerado en el mismo commit.
6. `npm run build` verde.
7. **RECON directo, sin subagentes.**
8. Al terminar: `git branch --show-current` antes de cada commit y `git rev-list --count origin/main..main` al final.

**Y prueba la ejecución, no solo la creación** (lección de C2): genera un curso real desde un plato de Llorente29 y comprueba que las fotos **se ven** — que es justo donde el cruce de buckets fallaría en silencio.

## 6. FUERA DE ALCANCE
Generación con IA de cursos desde cero (nivel 2) · grabar y convertir (nivel 3) · marketplace · contenido de los cursos de catálogo.

---

_Encargo generado el 04/08/2026 · frente de Formación C7._
