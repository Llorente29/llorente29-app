# ENCARGO CODE — Módulo de Formación · CAPA 2
## Informe "Listo para la inspección" + seguimiento de oficina

> **Diseño aprobado**: `docs/folvy_formacion_diseno.md` §5 y §4-Pieza 1. Benchmark: `docs/folvy_formacion_benchmark.md`.
> **Depende de**: C1 entregada y verificada (`docs/ENCARGO_CODE_formacion_c1.md`). **No empieces C2 hasta que C1 esté en `main` y funcionando.**
> **Objetivo**: convertir los datos que C1 captura en **la prueba que se le enseña al inspector** y en **el panel que dice quién va tarde**.

---

## 0. POR QUÉ EXISTE ESTA CAPA (léelo, gobierna las decisiones)

C1 hace que el empleado se forme y firme. **C2 es la que se vende.**

Un grupo de 150 locales tiene que formar a cientos de personas **y demostrarlo**. Hoy eso son carpetas de papel con hojas de firmas. El valor de Folvy es: **un botón → un PDF que lo demuestra todo**.

Dos escenarios de uso, y el fichero debe servir a ambos:
1. **La inspectora está delante.** Se le enseña en tablet o impreso. Tiene que entenderse **sin que nadie lo explique**.
2. **Demo comercial a un CEO.** Tiene que verse serio y hacer obvio el ahorro.

**Regla que gobierna todo (igual que en el informe de alérgenos):** ninguna casilla puede leerse como "formado" sin evidencia que lo respalde. Sin firma no hay formación acreditada. **Los huecos se muestran en rojo, no se esconden** — un informe que oculta lo que falta no vale ante un inspector y destruye la confianza en el producto.

---

## 1. BACKEND — RPCs de lectura

Migración `20260807Txxxx_formacion_c2_informes.sql`. Todas `SECURITY DEFINER` + guard `belongs_to_account` + `p_account_id`.

- **`training_compliance_matrix(p_account_id, p_location_id NULL, p_only_mandatory bool)`**
  Una fila por **empleado**, con: `employee_id, employee_name, doc_id, role, location_name`, y un `jsonb` de cursos → `{course_code: {state, completed_at, expires_at, score_pct, signed bool}}`.
  Estados: `vigente` · `caducado` · `pendiente` · `en_curso` · `no_aplica`.
  **Importante**: `vigente` **solo** si existe `course_signature` para un `course_attempt` con `passed = true`. Un test aprobado sin firmar NO es vigente (es `en_curso`). La firma es lo que acredita.

- **`training_gaps(p_account_id, p_days_ahead int default 30)`**
  Lo que hay que arreglar: `employee_name, course_title, gap_kind ('nunca_hecho'|'caducado'|'caduca_pronto'|'sin_firmar'), due_at, days_left`. Ordenado por urgencia.

- **`training_data_health(p_account_id)`**
  Honestidad del dato: empleados sin DNI (no se puede emitir acta válida), empleados sin acceso generado (no pueden formarse), cursos publicados sin asignar, asignaciones sin fecha límite.

- **`training_course_summary(p_account_id)`**
  Por curso: base legal, contenidos (títulos de secciones), nº asignados, nº formados, nº firmados, % cumplimiento.

Al final: `notify pgrst, 'reload schema';`
Guard `DO` que aborta si alguna función no quedó creada. Verifica **cada objeto con query independiente** (el SQL Editor solo devuelve la última consulta).

Servicio: `src/modules/kitchen/services/trainingComplianceService.ts` (o donde encaje con C1), patrón `allergenComplianceService.ts`.
⚠️ supabase-js: no guardes `rpc`/`from` en variable suelta. **Nunca** `catch(() => [])`: si falla, estado de error visible — jamás pintar "todo cumplido" por un fallo de red.

## 2. PANTALLA — Safety/APPCC → Formación

`src/modules/appcc/pages/TrainingCompliancePage.tsx`, hermana de `AllergensCompliancePage.tsx`. **Copia su estructura** (ya validada en producción): filtro + botones de export + matriz.

- **Cabecera**: título, subtítulo con base legal, selector de local, y **3 botones: Exportar PDF · Excel · CSV**.
- **Tira de KPIs**: `% plantilla con obligatorias vigentes` (el número que mira el inspector) · `nº caducan en 30 días` · `nº sin firmar` · `nº empleados sin DNI`.
- **Matriz** empleados × cursos, misma estética que la de alérgenos: celda con estado por color (verde vigente · ámbar caduca pronto · rojo caducado/pendiente · gris no aplica). Fila = empleado (nombre + puesto + local).
- **Panel "Qué falta"** (de `training_gaps`): lista accionable ordenada por urgencia, con botón **"Asignar formación"** que crea el `course_assignment` sin salir de la pantalla.
- **Panel de salud del dato** plegable (de `training_data_health`).

## 3. LA PIEZA ESTRELLA — `trainingCompliancePdfService.ts`

**Motor**: jsPDF + `ensureFraunces` + la paleta de `allergenCompliancePdfService.ts`. **NO montes un motor nuevo ni añadas `autotable`** — ese fichero dibuja sus tablas a mano; replica ese patrón (`drawSlimHeader`, `textBlock`, saltos de página con `PAGE_H - MARGIN`).

Estructura del documento:

1. **Portada / resumen ejecutivo**: razón social, CIF, local(es), fecha de emisión, responsable de formación, y el KPI grande: *"X de Y trabajadores con la formación obligatoria vigente"*. Si hay huecos, aquí se dicen.
2. **Matriz personal × cursos** con estado y fecha. Agrupada por local (salto de página entre locales, para que cada local imprima el suyo — igual que el de alérgenos hace por marca).
3. **Ficha por curso**: título, **base legal**, **contenidos impartidos** (títulos de las secciones — esto es lo que el RD exige que conste), duración, nº de asistentes.
4. **🔴 ANEXO DE FIRMAS** — el corazón legal. Por cada empleado formado: **imagen de la firma** (desde el bucket privado, vía URL firmada), nombre, DNI, puesto, curso, nota obtenida, y **fecha y hora exactas**. Este anexo **sustituye al Documento 4 en papel** del dosier de alérgenos.
5. **Certificados externos**: los de `employee_formations` con su caducidad (incluido PRL, que Folvy no imparte pero sí vigila).
6. **Huecos declarados**, en rojo: quién falta, qué caduca, quién no ha firmado.
7. **Pie de validez**: texto que explique qué es la firma (manuscrita electrónica capturada en sesión autenticada, con sello de tiempo) y su alcance. **No** afirmar que es firma cualificada eIDAS — no lo es. Honestidad legal.

**Detalle de rúbrica** (usa `qrcode`, ya está en `package.json`): QR en el pie de la portada que apunta a la verificación online del informe. Si no da tiempo en C2, **decláralo como deuda** — no lo dejes a medias sin decirlo.

**Excel/CSV**: replica `allergenComplianceExcelService.ts`. ⚠️ ese servicio importa `xlsx` de forma **estática** y ya generó un warning de bundling; impórtalo **dinámicamente** (`await import('xlsx')`) en el nuevo.

## 4. INTEGRACIÓN

- **Team → Formación**: enlace al informe desde el seguimiento.
- **Safety/APPCC**: la formación aparece como **prerrequisito del plan de higiene** con su semáforo (verde/ámbar/rojo según el KPI) y el botón del informe.
- **Ficha del empleado** (`FormacionesTab.tsx`): añadir sección de formaciones **internas** (de C1) junto a las externas que ya muestra. **NO rompas lo que ya hace con `employee_formations`.**

## 5. ENTREGA (las 5 etapas, sin atajos)

1. Rama `feature/formacion-c2`.
2. `database.ts` regenerado **en el mismo commit** que los tipos/servicios que lo usan.
3. Toda DDL aplicada → fichero en `supabase/migrations/`. **NO apliques tú las migraciones**: entrégalas para que Julio las corra en el SQL Editor.
4. `npm run build` verde antes de pushear.
5. Declara el estado git explícito: rama · commit · pushed · PR · deploy · verificado.

## 6. FUERA DE ALCANCE en C2

Catálogo completo de 9 cursos (C3) · reevaluación periódica y cron (C4) · círculo cerrado APPCC con acciones correctivas (C5) · migrar `FORMATION_CATALOG` a tabla (C3) · multiidioma · impartir PRL (es `solo_archivo` por ley, nunca se imparte).

---

## 7. CÓMO SE MIDE (paso 4 del ritual)

- El informe se genera **en menos de 5 segundos** para 50 empleados × 9 cursos.
- Un inspector entiende el PDF **sin que nadie se lo explique** (probarlo con alguien ajeno al proyecto).
- El KPI de portada cuadra **exactamente** con la matriz de pantalla (si difieren, hay un bug de criterio).
- Cero casillas en verde sin firma que las respalde.

---

_Diseño: `docs/folvy_formacion_diseno.md` · Encargo generado el 03/08/2026._
