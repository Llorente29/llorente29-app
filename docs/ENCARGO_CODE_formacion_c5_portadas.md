# ENCARGO CODE — Formación · C5
## Portadas de curso · Rediseño del catálogo · Fix de taxonomía en copias adoptadas

> **Depende de**: C4 (piezas A y B) aplicada y en `main`.
> **Origen**: al ver el catálogo real con 13 cursos, la pantalla resulta fría y poco comercial comparada con los líderes del sector (Typsy, Flow Learning). Es un listado de expedientes, no un catálogo.
> **Contexto de diseño**: `docs/folvy_formacion_catalogo_v2.md` · `docs/folvy_formacion_guia_contenido.md` §5.bis.

---

## A. 🔴 FIX: los cursos adoptados se quedan sin taxonomía (bug real, visto en producción)

**Síntoma observado**: en el catálogo aparece una sección **"Sin clasificar"** con una copia del curso de alérgenos (la de la cuenta, sin la etiqueta "Plantilla Folvy"), mientras la plantilla global sí sale bajo "Cumplimiento legal".

**Causa**: el backfill de taxonomía de C4 solo tocó las plantillas globales (`account_id IS NULL`). La copia se creó por adopción (al subir una foto propia de sección) y nació sin `category`, `business_types`, `level` ni `recommended_order`.

**Por qué importa**: no es un caso raro. **Le pasará a cada cliente que adopte cualquier curso.** Un catálogo con la mitad de los cursos en "Sin clasificar" no vale.

**Arreglo, en dos partes:**
1. **`courseAdoptionService.ts`**: al clonar, copiar también `category`, `business_types`, `level`, `recommended_order`, `requires_practical`, `delivery_mode`, `reeval_months`, `is_mandatory` y `appcc_prerequisite`. Revisa qué campos copia hoy y **completa todos los que definen el comportamiento del curso** — no solo los cuatro de taxonomía.
2. **Migración de backfill retroactivo**: para las copias ya existentes, heredar la taxonomía desde `adopted_from_course_id`. Idempotente, y **solo donde el campo esté NULL** (nunca pisar lo que el cliente haya cambiado a propósito).

**Sección "Sin clasificar"**: debe quedarse como red de seguridad para cursos propios del cliente creados desde cero, pero **no debería contener nunca una copia adoptada**. Verifícalo después del backfill.

---

## B. PORTADAS DE CURSO

### Modelo
Nuevo campo **`course.cover_url text`**. Resolución en **tres capas**, para que no haya nunca una tarjeta vacía:

1. **`cover_url`** si tiene valor.
2. **Si no → la primera sección con `media_url`** del curso (alérgenos y manipulador ya tienen esquemas: se aprovechan solos).
3. **Si tampoco → fondo generado por categoría**: color de la categoría + icono. Nunca un gris vacío.

⚠️ **Reutiliza `courseImagesService.getSignedSectionImageUrls`**, que ya distingue rutas públicas (`/formacion/...`) de paths de Storage. Las portadas de Folvy son estáticas del repo; una portada que suba un cliente iría a Storage. **No montes un resolver nuevo.**

### Portadas entregadas
13 SVG en **`public/formacion/portadas/`**, 800×450 (16:9), ya generadas y en el repo:

| Fichero | Curso (`code`) |
|---|---|
| `manipulador.svg` | manipulador_alimentos |
| `alergenos.svg` | alergenos_intolerancias |
| `appcc.svg` | appcc_prerrequisitos |
| `igualdad.svg` | igualdad_acoso |
| `lgtbi.svg` | lgtbi_no_discriminacion |
| `rgpd.svg` | proteccion_datos_rgpd |
| `canal_denuncias.svg` | canal_denuncias |
| `primeros_auxilios.svg` | primeros_auxilios |
| `prl.svg` | prl_riesgos_laborales |
| `embolsado.svg` | embolsado_delivery |
| `temperatura_ruta.svg` | temperatura_ruta_delivery |
| `incidencias.svg` | incidencias_delivery |
| `estacion_kds.svg` | estacion_kds |

**Migración de asignación**: escribir `cover_url = '/formacion/portadas/{fichero}'` en cada plantilla global, por `code`. Idempotente y **solo si `cover_url` está vacío** (no pisar una portada que haya puesto un cliente).

**Portada propia del cliente**: mismo patrón que "Usar foto propia" de C3-A (bucket privado, namespaced por cuenta, con el guardarraíl de no escribir sobre la plantilla global). Botón *"Cambiar portada"* en el editor del curso.

---

## C. REDISEÑO DE LA TARJETA DEL CATÁLOGO

**El problema actual**: cada tarjeta muestra el título, la base legal completa y 4-5 chips (Borrador · Folvy imparte · Base (toda la plantilla) · Prerrequisito APPCC · Plantilla Folvy). Eso es **información de auditor**, no de catálogo. Satura y no invita a entrar.

**Nueva tarjeta:**
- **Portada 16:9 arriba**, ancho completo de la tarjeta, esquinas redondeadas arriba.
- **Título grande** debajo (2 líneas máximo, con elipsis).
- **Una línea de metadatos discreta**: duración (`estimated_minutes`) · estado (Publicado/Borrador) · y **solo si aplica**: "Solo archivo" o "Requiere práctica".
- **Fuera de la tarjeta**: base legal, `is_mandatory`, `appcc_prerequisite`, `level`, "Plantilla Folvy". **Todo eso va al detalle del curso**, donde sí importa.
- **Distintivo visual de estado**: los borradores, atenuados (opacidad o etiqueta discreta), para que se vea de un vistazo qué está publicado.

**La rejilla**: mantener el agrupado por categoría (funciona bien) con su cabecera. Responsive: 3 columnas en escritorio, 2 en tablet, 1 en móvil.

**Referencia**: Typsy y Flow Learning muestran portada grande + título + duración. Nada más en la tarjeta. Ese es el listón.

---

## ENTREGA

1. Rama `feature/formacion-c5-portadas-catalogo`.
2. Migraciones entregadas, **no aplicadas por ti**. Con guard `DO`.
3. `database.ts` regenerado en el mismo commit si cambia el esquema.
4. `npm run build` verde.
5. **Antes de cada commit: `git branch --show-current`.** Al terminar: `git rev-list --count origin/main..main` y dime si queda algo sin mergear.

### 🔴 Regla de proceso reforzada
**No delegues el RECON en subagentes.** En el encargo anterior un subagente fabricó una afirmación falsa ("Julio autorizó declarar la Pieza C") y omitió los hallazgos técnicos. El RECON es la base de todas las decisiones de diseño: si puede venir inventado, no vale. **Hazlo tú directamente y verifica cada dato contra el esquema vivo.**

*(Nota: detectar esa fabricación y descartar el informe entero fue lo correcto. La regla es para que no vuelva a ser necesario.)*

## FUERA DE ALCANCE
Pieza C de C4 (curso desde escandallo — encargo propio, con el hallazgo del cruce de buckets `recipe-uploads` → `course-section-images` ya documentado) · contenido de cursos · multiidioma · rutas por puesto.

---

_Encargo generado el 03/08/2026 · frente de Formación C5._
