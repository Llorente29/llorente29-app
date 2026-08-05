# ENCARGO CODE — Vista previa de curso (desde el catálogo de gestión)

## Qué es

Un botón **"Vista previa"** en `CoursesPage.tsx` que abre el curso completo (secciones de teoría + test con corrección) **sin crear intento, sin asignación, sin employee_id**. Es una ventana de verificación para que el admin revise contenido, imágenes y preguntas antes de publicar. Funciona con cursos en `draft` y en `published`.

## Por qué

Hay 17 cursos en `draft` con contenido real (6 secciones + 10 preguntas cada uno). El CEO necesita revisarlos uno a uno para publicarlos. Hoy no hay forma de ver el curso como lo verá el empleado sin montarse todo el flujo de empleado+asignación+magic link.

## Qué NO es

- NO crea `course_attempt`, `course_signature` ni `course_assignment`.
- NO llama a `start_course_attempt`, `submit_course_attempt` ni `sign_course_attempt`.
- NO modifica ninguna tabla.
- NO necesita `employee_id` ni `auth.uid()` como empleado.
- NO es el flujo real del empleado — para eso existe `MiFormacion.tsx`.

## Datos que necesita (solo lectura)

Todo viene de las tablas del curso, accesible al admin por RLS (`belongs_to_account` o `account_id IS NULL` para los globales):

```
course_section    → id, course_id, ord, title, body (markdown), media_url
course_question   → id, course_id, ord, text
course_option     → id, question_id, text, is_correct, explanation
course             → id, title, code, pass_threshold_pct, requires_practical, status
course_practical_item → id, course_id, ord, text, help_text
```

## Servicio

Crear `src/services/coursePreviewService.ts`:

```typescript
// Lectura directa de contenido de un curso (global o de cuenta) para vista previa.
// NO crea intentos ni asignaciones. Acceso: admin/manager de la cuenta.

export interface PreviewSection {
  id: string; ord: number; title: string; body: string; mediaUrl: string | null
}
export interface PreviewOption {
  id: string; text: string; isCorrect: boolean; explanation: string | null
}
export interface PreviewQuestion {
  id: string; ord: number; text: string; options: PreviewOption[]
}
export interface PreviewPracticalItem {
  id: string; ord: number; text: string; helpText: string | null
}
export interface CoursePreview {
  id: string; title: string; code: string; status: string
  passThresholdPct: number; requiresPractical: boolean
  sections: PreviewSection[]
  questions: PreviewQuestion[]
  practicalItems: PreviewPracticalItem[]
}

export async function fetchCoursePreview(courseId: string): Promise<CoursePreview>
```

Implementación: 3 queries paralelas (sections por ord, questions+options por ord, practical_items por ord). Las `course_option.is_correct` SÍ se devuelven (es vista previa para el admin, no un test real — necesita ver cuál es la correcta).

Imágenes de sección: resolver con `getSignedSectionImageUrls` (ya existe en `courseImagesService.ts`), igual que hace `MiFormacion.tsx`.

## Componente

Crear `src/components/personal/CoursePreviewModal.tsx`:

### Props

```typescript
interface Props {
  courseId: string
  onClose: () => void
}
```

### Flujo (4 pasos internos, todo local)

1. **Carga** — llama a `fetchCoursePreview(courseId)`, muestra spinner.
2. **Teoría** — misma presentación que `MiFormacion.tsx` step `'teoria'`: una sección por pantalla, título + imagen (con `SectionImage` y fallback) + body en markdown (`ReactMarkdown` con los mismos `MARKDOWN_COMPONENTS`). Botones "Atrás" / "Siguiente" / "Empezar el test". Un banner visible arriba: **"Vista previa — no se registra ningún intento"** en fondo `bg-blue-50 text-blue-700`.
3. **Test** — misma presentación que step `'test'`: una pregunta por pantalla, 4 opciones como botones. El admin elige. Al terminar ("Corregir"), la **corrección es local** (comparar `answers[questionId]` con la opción que tiene `isCorrect=true`). NO llama a ninguna RPC.
4. **Resultado** — misma presentación que step `'resultados'`: nota, correcto/total, cada pregunta con ✓/✗ + explicación + la respuesta correcta marcada. Botón "Cerrar vista previa".

Si `requiresPractical`, mostrar debajo del resultado una sección "Verificación práctica" con la lista de `practicalItems` (solo lectura, sin checks — el admin solo ve qué gestos se pedirán).

### Visual

- **Modal `size="xl"`** (aprovecha la pantalla de oficina, no es un móvil).
- Reusar `MARKDOWN_COMPONENTS` y `SectionImage` de `MiFormacion.tsx` — extraerlos a un fichero compartido si Code lo ve limpio, o copiarlos (el encargo no obliga a refactorizar `MiFormacion`).
- El **banner "Vista previa"** debe ser inconfundible para que el admin no crea que está haciendo el curso de verdad.
- Las opciones del test NO se barajan (no hay seed de empleado+intento; el admin ve el orden original para verificar que la distribución de correctas no es adivinable).

## Integración en CoursesPage.tsx

En la vista de detalle de un curso (cuando `selectedId` no es null), añadir un botón:

```
<Button variant="outline" size="sm" onClick={() => setPreviewCourseId(selectedId)}>
  <BookOpen size={14} className="mr-1" /> Vista previa
</Button>
```

Ubicación natural: junto a los botones existentes de la cabecera del curso seleccionado (donde están "Editar", "Publicar", etc.).

Estado: `const [previewCourseId, setPreviewCourseId] = useState<string | null>(null)`

Render al final del componente:
```
{previewCourseId && (
  <CoursePreviewModal courseId={previewCourseId} onClose={() => setPreviewCourseId(null)} />
)}
```

## Ficheros que toca

| Fichero | Acción |
|---|---|
| `src/services/coursePreviewService.ts` | CREAR |
| `src/components/personal/CoursePreviewModal.tsx` | CREAR |
| `src/pages/CoursesPage.tsx` | AÑADIR botón + estado + render del modal |

**NO tocar:** `MiFormacion.tsx`, `mobileCoursesService.ts`, ninguna RPC, ninguna migración, `App.tsx`.

## Verificación

1. Abrir CoursesPage → seleccionar el curso `manipulador_alimentos` (published) → pulsar "Vista previa".
2. Ver las 6 secciones una a una: título, texto markdown renderizado, imagen (sección 2 tiene `zona-peligro-temperaturas.svg`, sección 3 tiene `lavado-de-manos.svg`).
3. Hacer el test (10 preguntas): elegir respuestas, corregir.
4. Ver resultado con nota, ✓/✗ por pregunta, explicaciones.
5. Repetir con un curso en `draft` (ej. `appcc_prerrequisitos`) — debe funcionar igual.
6. Verificar que NO se creó ninguna fila en `course_attempt` ni `course_assignment`.
7. Verificar que PRL (`prl_riesgos_laborales`, 4 secciones, 0 preguntas) muestra teoría y al llegar al test dice "Este curso no tiene test" y cierra.

## Reglas

- Build verde antes de entregar.
- NO crear ramas ni PRs — directamente en `main` (Julio y Code comparten directorio).
- Leer `CoursesPage.tsx` y `MiFormacion.tsx` antes de empezar.
