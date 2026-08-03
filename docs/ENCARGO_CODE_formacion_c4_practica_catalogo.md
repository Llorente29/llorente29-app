# ENCARGO CODE — Formación · C4
## Verificación práctica · Taxonomía del catálogo · Curso desde el escandallo

> **Diseño**: `docs/folvy_formacion_catalogo_v2.md` (§2, §6, §7) y `docs/folvy_formacion_guia_contenido.md` (§5.bis). **Léelos antes de empezar.**
> **Depende de**: C1, C2, C3-A y el fix de imágenes, todos en `main` y verificados en producción.
> **Tamaño**: es el tramo más grande del módulo. Si ves que no cabe entero, **entrega A y B completos y declara C**, pero no entregues las tres a medias.

---

## A. VERIFICACIÓN PRÁCTICA EN EL PUESTO 🔴 (la pieza más importante)

### El problema que resuelve
Hoy un curso se supera con test + firma. Pero un manipulador que aprueba **sin que nadie compruebe que sabe usar un termómetro sonda** es exactamente el fallo que documenta la evidencia: nota alta, conducta sin cambiar. La normativa habla de formación *"teórica y práctica"*.

**Ningún LMS del mercado puede hacer esto** (Flow/Mapal, TalentLMS, Typsy son plataformas de e-learning, no están en la cocina). Folvy sí. Es el mayor diferenciador del módulo.

### Cómo funciona
- **`course.requires_practical bool default false`** — decisión de Julio: es un **check por curso**. No todos lo necesitan (RGPD no) y no todos los clientes pueden hacerlo.
- Si está activo, aprobar el test **NO** completa el curso: queda en estado **"pendiente de verificación práctica"**.
- El curso define **3-5 gestos observables** (`course_practical_item`).
- Un **responsable** (admin/manager) observa al trabajador ejecutándolos, los marca y **firma él también**.
- El acta pasa a llevar **dos firmas**: la del trabajador (*comprendió*) y la del verificador (*lo vi hacer*).

### Modelo de datos
```
course.requires_practical  bool default false

course_practical_item      (id, course_id, ord, text, help_text)

course_practical_check     (id, attempt_id, item_id, checked bool,
                            verified_by uuid, verified_at, notes)
```
- `verified_by` se resuelve **server-side desde `auth.uid()`** dentro de la RPC. **Nunca** de un parámetro del cliente — misma regla que `sign_course_attempt` en C1.
- El verificador **no puede ser el propio trabajador**: valídalo en la RPC y falla con mensaje claro.
- RLS: solo admin/manager de la cuenta puede escribir checks. Patrón `is_admin_or_manager_of`, como C2.
- Los checks son **append-only** en su efecto: si hay que corregir, se registra un nuevo estado con su `verified_at`; no se borra el histórico. (Es evidencia, igual que la firma.)

### 🔴 Impacto en el estado "vigente" (CRÍTICO, no lo pases por alto)
`training_compliance_matrix` (C2) calcula hoy *vigente* = firma + test aprobado. **Debe pasar a exigir además**: si `requires_practical`, todos los `course_practical_item` verificados.

Estado nuevo: **`pendiente_practica`** (test aprobado y firmado, falta la verificación). Colórealo distinto de `en_curso` en la matriz y añádelo a `training_gaps` con `gap_kind = 'falta_practica'`.

⚠️ **El PDF de inspección debe reflejarlo**: si un curso exige práctica y no está hecha, ese trabajador **no puede aparecer como vigente**. Sería exactamente el "vender un tie como victoria" que la regla prohíbe.

### UI
- **Oficina**: en el editor del curso, toggle *"Requiere verificación práctica"* + editor de la lista de gestos.
- **Oficina, seguimiento**: lista de *"pendientes de verificar"* con botón **"Verificar ahora"** → modal con los gestos, checkboxes, notas y firma del verificador.
- **Móvil del trabajador**: al aprobar el test y firmar, mensaje claro: *"Has superado la teoría. Falta que tu responsable verifique la parte práctica."* No debe parecer que ha terminado.

---

## B. TAXONOMÍA DEL CATÁLOGO

Con 30+ cursos el listado plano es inmanejable. Ver `folvy_formacion_guia_contenido.md` §5.bis para la definición completa.

```
course.category           text   -- cumplimiento | cocina | delivery | sala | equipo | producto | sostenibilidad
course.business_types     text[] -- restaurante | bar_cafeteria | dark_kitchen | delivery | hotel | cadena | catering | todos
course.level              text   -- base | especialista | mando
course.recommended_order  int
```

- **Filtrado por tipo de negocio**: un curso solo aparece en el catálogo de las cuentas cuyo `accounts.business_type` esté en su `business_types` (o si contiene `todos`).
- 🔴 **NUNCA filtrar por tipo de negocio un curso de `category = 'cumplimiento'`.** Si la ley obliga, obliga a todos: ocultarlo dejaría al cliente descubierto. Los 9 actuales van con `{todos}`.
- **Backfill de los 9 cursos existentes**: todos `category='cumplimiento'`, `business_types='{todos}'`, `level='base'` (excepto PRL, que además mantiene `delivery_mode='solo_archivo'`). `recommended_order`: manipulador 10, alérgenos 20, APPCC 30, el resto 40+.
- **UI**: catálogo agrupado por categoría, con filtros por categoría y nivel. Y **resolver la deuda pendiente**: un curso `solo_archivo` (PRL) NO debe ofrecer botón de "hacer curso" — debe mostrar *"Lo imparte tu servicio de prevención. Súbelo aquí."*

---

## C. GENERAR CURSO DESDE EL ESCANDALLO 🎯 (la jugada que nadie puede copiar)

### Por qué es estratégico
Folvy ya tiene **pasos de receta vinculados a ingredientes** (`recipe_item_step_line`, diferenciador E8 — meez y Apicbase tienen pasos de texto muerto). Eso permite generar un curso de producto **desde la receta**, sin escribir nada.

Ningún LMS del mundo puede hacerlo porque ninguno tiene el escandallo dentro. Misma victoria estructural que la matriz de alérgenos: se gana porque los módulos están conectados.

### Qué hace
Botón **"Crear curso de este plato"** en la ficha del plato (Kitchen). Genera un **borrador** (`status='draft'`) con:
- `category='producto'`, `business_types='{todos}'`, `level='especialista'`, `is_mandatory=false`, `reeval_months=null`, `delivery_mode='folvy_imparte'`, `requires_practical=true`.
- **Una sección por paso** de la receta, con sus ingredientes y cantidades.
- Una sección de **alérgenos del plato** (ya los calcula el motor de herencia de Capa 2 — reutilízalo, no lo recalcules).
- **Foto del plato** como `media_url` de la primera sección (ya existe en el escandallo).
- **Test autogenerado**: orden de los pasos, cantidades clave, alérgenos que lleva.
- **Verificación práctica**: un único item — *"Elabora el plato y sube la foto para que el responsable la valide"*.

### RECON obligatorio antes de construir
No asumas la forma de estos datos. Verifica contra la BBDD viva: `recipe_item`, `recipe_item_step_line`, `recipe_line`, `recipe_item_allergen`, y cómo se resuelve la foto del plato (`getDishPhotoUrl`, usa URLs firmadas).

### Reglas
- **Siempre borrador.** El cocinero revisa antes de publicar. La receta no es un curso: es la materia prima de un curso.
- **Copia, no referencia.** El curso guarda el texto del paso tal como estaba al generarlo. Si la receta cambia luego, el curso no muta bajo los pies de quien ya lo firmó. (Para actualizar: regenerar y subir `version`.)
- **Anti-duplicado**: si ya existe un curso generado de ese plato, ofrecer *"regenerar"* en vez de crear otro. Campo `course.source_recipe_item_id`.
- **Duración ≤ 10 min** (regla de la guía para cursos de producto).
- El curso pertenece a **la cuenta** (`account_id NOT NULL`), nunca es plantilla global: es contenido privado del cliente.

---

## ENTREGA

1. Rama `feature/formacion-c4-practica-catalogo`.
2. Migraciones en `supabase/migrations/`, **entregadas para que Julio las aplique** (no las apliques tú). Con guard `DO` al final.
3. `database.ts` regenerado en el mismo commit.
4. `npm run build` verde antes de pushear.
5. **Antes de cada commit: `git branch --show-current`.** Al terminar, `git rev-list --count origin/main..main` y dime explícitamente si queda algo sin mergear.

### Lección de C2 que no se debe repetir
Un guard que comprueba que una función **existe** no prueba que **funcione**: así se coló el bug de ambigüedad de columnas que reventó en pantalla. Si tocas `training_compliance_matrix`, prueba la ejecución real, no solo la creación.

## FUERA DE ALCANCE
Contenido de los cursos nuevos (lo escribe Julio con Claude) · multiidioma · rutas por puesto (`section.roles`) · píldoras · IA generadora de cursos (nivel 2) · grabar y convertir (nivel 3) · reevaluación C5.

---

_Encargo generado el 03/08/2026 · frente de Formación C4._
