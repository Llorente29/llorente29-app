# ENCARGO CODE — Formación · C3-A
## Renderizado didáctico del curso + imágenes (genéricas y propias del cliente)

> **Depende de**: C1 y C2, ya en `main` y verificadas en producción.
> **Diseño**: `docs/folvy_formacion_diseno.md`. Benchmark: `docs/folvy_formacion_benchmark.md`.
> **Por qué ahora**: el contenido de los cursos se va a reescribir con estilo didáctico (texto con formato + ilustraciones). Hoy el móvil **no puede mostrarlo**. Sin esta capa, el contenido nuevo se vería PEOR que el actual.

---

## 0. EL PROBLEMA (verificado en el repo)

`src/pages/trabajador/MiFormacion.tsx` línea ~182 pinta el cuerpo de la sección así:

```tsx
<p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{section.body}</p>
```

Consecuencias:
1. **El markdown se ve literal**: `**negrita**` sale con los asteriscos a la vista.
2. **`course_section.media_url` NO se usa en ninguna parte**: la columna existe desde C1 y está muerta.
3. Texto a `text-sm` para leer 6 secciones en un móvil, en cocina, es demasiado pequeño.

`react-markdown@^10.1.0` **ya está en `package.json`** — no hay que instalar nada.

**Fundamento pedagógico** (de la evidencia revisada, para que las decisiones de UI no se tomen a ojo): en formación de manipuladores, la mezcla eficaz es **esquema para lo abstracto** (zona de peligro, contaminación cruzada) + **foto real para lo que hay que reconocer o ejecutar** (indicios de plaga, orden de la cámara, lavado de manos). Y lo que más eleva la transferencia al puesto es que la foto sea **de la propia cocina del trabajador**. De ahí las dos piezas de este encargo.

---

## 1. RENDERIZADO DE LA TEORÍA (móvil)

En `MiFormacion.tsx`, sustituir el `<p>` por `react-markdown`:

- Soportar: `**negrita**`, listas (`-`), encabezados (`###`), y párrafos.
- **Legibilidad en cocina**: cuerpo mínimo **16px** (`text-base`, no `text-sm`), `leading-relaxed`, buen espaciado entre párrafos y listas. Se lee de pie, con prisa y a veces con las manos mojadas.
- Estilos de los elementos markdown con clases del proyecto (no CSS suelto).
- **Seguridad**: `react-markdown` NO renderiza HTML crudo por defecto — **no actives `rehype-raw`**. El contenido lo escribe la oficina, pero no queremos inyección de HTML en el portal del trabajador.

**Recuadro técnico**: el contenido usará blockquotes (`>`) para el recuadro de "dato técnico/legal" al final de cada sección. Dale un estilo diferenciado (fondo suave, borde izquierdo) para que se lea como caja aparte, no como cita.

## 2. IMAGEN DE LA SECCIÓN

- Si `course_section.media_url` tiene valor → mostrar la imagen **encima del texto** de la sección.
- Ancho completo del contenedor, `rounded`, sin recortar (`object-contain`), con `alt` = título de la sección.
- Si falla la carga → no romper el layout: ocultar el hueco y seguir con el texto.
- Las imágenes viven en un bucket de storage; sírvelas por **URL firmada** si el bucket es privado (patrón ya usado para las firmas en el PDF de C2).

**Mostrarla también en la pantalla de oficina** (previsualización del curso en `CoursesPage`), para que quien edita vea lo mismo que verá el empleado.

## 3. 🔴 IMÁGENES PROPIAS DEL CLIENTE (la pieza diferencial)

**Qué es**: el curso viene de fábrica con una imagen **genérica** por sección (esquema o foto de banco). Una cuenta puede **sustituirla por una foto de su propia cocina** (su cámara, su zona de lavado, su etiquetado). Sus empleados ven la suya; los demás clientes siguen viendo la genérica.

**Por qué importa**: es transferencia real al puesto — el trabajador ve SU sitio de trabajo, no una cocina ideal. Ningún LMS del mercado puede hacerlo porque no vive dentro de la operación. Es argumento de venta y de inspección.

**Implementación:**
- En el editor de sección (oficina), botón **"Usar foto propia"** → sube al bucket → escribe `media_url` **en la sección de la copia de la cuenta**.
- Botón **"Volver a la imagen de Folvy"** → limpia `media_url` de la copia y vuelve a mostrarse la genérica. **Nunca debe quedarse sin imagen.**
- Formatos: jpg/png/webp. **Límite de tamaño** y compresión antes de subir (son fotos de móvil de varios MB y esto se ve en cocina con datos móviles).

**🔴 GUARDARRAÍL CRÍTICO — el riesgo real de esta función:**
> Una cuenta **NUNCA** puede escribir sobre una sección cuya `course.account_id IS NULL` (la plantilla global de Folvy). Si pudiera, **cambiaría la imagen a todos los clientes de Folvy a la vez**.
>
> Debe impedirse **en la base de datos**, no solo ocultando el botón en la UI:
> - Revisar/ajustar las policies de `course_section` para que el `update` exija que el `course` padre tenga `account_id` = una cuenta de la que el usuario es admin/manager. Escribir sobre `account_id IS NULL` solo debe poder hacerlo un platform-admin.
> - Igual para las policies de storage del bucket de imágenes: ruta namespaceada por `account_id` (mismo patrón que las firmas de C1).
> - **Verifícalo con una prueba explícita**, no por inspección visual del código.

**Si el curso global aún no ha sido "adoptado" por la cuenta**: subir una foto propia debe disparar la adopción (crear la copia de la cuenta con sus secciones) y escribir ahí. Nunca tocar la global. Si el mecanismo de adopción no existe todavía, **decláralo y páralo** — no improvises una escritura sobre la plantilla.

## 4. ENTREGA (las 5 etapas, sin atajos)

1. Rama `feature/formacion-c3a-render-imagenes`.
2. Si hay DDL o cambios de policy → migración en `supabase/migrations/`, **entregada para que Julio la aplique** (no la apliques tú). Con guard `DO` al final.
3. `database.ts` regenerado en el mismo commit si cambia el esquema.
4. `npm run build` verde antes de pushear.
5. Declara el estado git explícito: rama · commits · pushed · PR · deploy · verificado.

**Lección de C2 que NO se debe repetir**: el guard de la migración verificaba que las funciones *existieran*, no que *se ejecutaran* — y salió verde con un bug que reventó en pantalla. Si esta migración toca policies, **prueba la operación real** (que un manager pueda escribir su copia y NO pueda escribir la global), no solo que la policy exista.

## 5. FUERA DE ALCANCE

Contenido de los cursos (lo escribe Julio con Claude) · multiidioma (frente propio) · vídeo · reevaluación (C4) · círculo APPCC (C5).

---

_Encargo generado el 03/08/2026, dentro del frente de Formación C3._
