# ENCARGO CODE — Módulo de Formación · CAPA 1 (motor + alérgenos end-to-end)

> **Diseño aprobado**: `docs/folvy_formacion_diseno.md` (léelo entero antes de empezar). Benchmark: `docs/folvy_formacion_benchmark.md`.
> **Objetivo de C1**: que un empleado pueda hacer el curso de alérgenos en su móvil (teoría → test → firma) y que salga el acta PDF. Con esto Llorente29 ya cubre lo que pidió la inspección.
> **Reglas del proyecto**: `folvy_reglas.md`. Especial atención a §2 (migraciones, `database.ts` en el mismo commit), §3 (SQL Editor se traga statements: verificar cada objeto con query independiente) y §1.bis (commit→push→PR→deploy→verificar).

---

## 0. CONTEXTO VERIFICADO (RECON ya hecho, NO lo repitas a ciegas)

- **`employee_formations`** existe y está versionada (baseline). Hoy la usa `src/components/personal/FormacionesTab.tsx` (montada desde `src/pages/StaffPage.tsx`) vía `src/services/formationsService.ts`. **Es el registro de certificados EXTERNOS. NO la rompas.**
- **`FORMATION_CATALOG`** vive hardcodeado en `src/types/personal.ts` (9 tipos con metadatos legales). En C1 **se deja como está**; su migración a tabla es C3.
- **Portal del trabajador**: `src/pages/trabajador/` (`PortalEmpleado.tsx`, `HomeEmpleado.tsx`, `MisChecklistsPage.tsx`, `MisDocumentos.tsx`…).
- **🔴 ACCESO DEL EMPLEADO — VERIFICADO, no lo supongas**: es **enlace mágico entregado por QR**. El manager lo genera en `AccesoTrabajadorPanel.tsx` → `generateAccessLink()` (`src/services/employeeAuthService.ts`) → Edge `manage-employee` → `tokenHash` → URL `/acceso?token_hash=…&type=magiclink`, mostrada como QR (lib `qrcode`) o enlace copiable. El empleado **escanea y entra sin teclear**; se canjea con `verifyOtp` (sin PKCE), un solo uso, caduca.
  → **Consecuencia para la firma**: al firmar HAY sesión real de Supabase Auth. **`auth.uid()` se lee SIEMPRE en el servidor (dentro de la RPC), NUNCA se acepta un id de empleado enviado por el cliente.** Esa es la base legal de la evidencia.
  → Ignora el comentario de cabecera de `employeeAuthService.ts` que habla de usuario+contraseña: describe el ALTA, no el acceso. (`LoginEmpleado.tsx` con lista+PIN es otra vía/legado — **no** es el camino de la firma.)
- **Motor PDF a reutilizar**: `src/modules/appcc/services/allergenCompliancePdfService.ts` (recién mergeado, PR #19). Mismo patrón para el acta. No montes otro motor.
- **NO tocar `App.tsx`** sin permiso explícito de Julio. La sección nueva del portal cuelga de `PortalEmpleado.tsx`, no de rutas nuevas en App.

---

## 1. BBDD — migración `20260806T14xx_formacion_c1.sql`

Crea (todas con RLS multi-tenant, patrón de las tablas de Team):

- `course` — `id, account_id uuid NULL (NULL = plantilla global Folvy), code text, title, summary, legal_basis text, delivery_mode text CHECK IN ('folvy_imparte','solo_archivo','mixto'), reeval_months int, is_mandatory bool, appcc_prerequisite bool default false, estimated_minutes int, pass_threshold_pct int default 70, version int default 1, status text CHECK IN ('draft','published','archived') default 'draft', created_at, created_by`
- `course_section` — `id, course_id FK, ord int, title, body text, media_url text NULL`
- `course_question` — `id, course_id FK, ord int, text`
- `course_option` — `id, question_id FK, text, is_correct bool, explanation text NULL`
- `course_assignment` — `id, course_id FK, account_id, employee_id FK NULL, role text NULL, location_id NULL, due_at, origin text CHECK IN ('manual','onboarding','reeval_periodica','reeval_evento'), source_incident_id NULL, created_at`
- `course_attempt` — `id, assignment_id FK, employee_id FK, started_at, finished_at NULL, score_pct numeric NULL, passed bool NULL, answers jsonb, time_spent_seconds int`
- `course_signature` — `id, attempt_id FK, employee_id FK, signature_png text (path de storage), signer_name text, signer_doc_id text, signed_at timestamptz default now(), ip text NULL, user_agent text NULL, auth_method text default 'employee_session', course_version int`
- `course_certificate` — `id, attempt_id FK, pdf_url text, issued_at, issued_by, serial text`

**Reglas duras:**
- `course_signature` es **append-only e INMUTABLE**: policy que permite INSERT pero **NO UPDATE ni DELETE** (es prueba legal). Corregir = firma nueva.
- `course_attempt.answers` guarda las respuestas dadas (auditable).
- Guardar `course_version` en la firma: si el curso cambia luego, el acta dice qué firmó exactamente esa persona.
- Toda función `SECURITY DEFINER` con `p_account_id` lleva guard `belongs_to_account`.
- Bucket de storage para las firmas: **PRIVADO** (nunca público; es dato personal). Firma servida por URL firmada.
- Índices: `course_assignment(account_id, employee_id)`, `course_attempt(assignment_id)`, `course_signature(attempt_id)`.

**Guard obligatorio** (regla §3): la migración lleva bloque `DO` que consulta `pg_catalog` y **aborta con excepción** si alguna tabla/policy/índice no quedó creada. Y tras aplicar, **verifica cada objeto con query independiente** — no te fíes del "Success".

**RPCs mínimas de C1** (todas con guard):
- `start_course_attempt(p_assignment_id)` → crea attempt, devuelve curso + secciones + preguntas (sin `is_correct` en la respuesta al empleado, para que no se pueda leer la solución desde el cliente).
- `submit_course_attempt(p_attempt_id, p_answers jsonb)` → corrige **server-side**, calcula `score_pct`, marca `passed` según `pass_threshold_pct`, devuelve resultado con explicaciones.
- `sign_course_attempt(p_attempt_id, p_signature_path, p_signer_name, p_signer_doc_id)` → inserta firma. Falla si el attempt no está `passed`. **Resuelve el empleado desde `auth.uid()` dentro de la función** (nunca de un parámetro del cliente) y guarda ese `auth_uid` en la fila. Si `auth.uid()` es null → EXCEPTION (sin sesión no hay firma válida).
- `my_pending_courses()` → para el móvil: asignaciones del empleado **resuelto por `auth.uid()`**, con estado. Nunca recibe `employee_id` por parámetro.
- **Al final**: `notify pgrst, 'reload schema';`

**Corrección server-side, obligatoria**: la nota se calcula en SQL, nunca en el cliente. El cliente no debe recibir nunca `is_correct` antes de responder.

## 2. Semilla — curso de alérgenos

Migración aparte `20260806T15xx_seed_curso_alergenos.sql`: inserta como **plantilla global** (`account_id IS NULL`) el curso *"Gestión de alérgenos e intolerancias"* con `delivery_mode='folvy_imparte'`, `reeval_months=12`, `appcc_prerequisite=true`, `legal_basis='Reg. UE 1169/2011'`.

**Contenido**: Julio tiene el dosier redactado (guía didáctica de los 14 alérgenos, POE de prevención en recepción/cocina/sala, y test de 10 preguntas con solucionario: 1-b, 2-c, 3-b, 4-c, 5-b, 6-c, 7-b, 8-b, 9-b, 10-b). **PÍDESELO A JULIO antes de escribir la semilla — no inventes el contenido ni las preguntas.** Es material de cumplimiento legal.

Idempotente: `ON CONFLICT (code) DO NOTHING` con unique en `code` para plantillas globales.

## 3. Front — oficina (Team)

`src/modules/.../pages/CoursesPage.tsx` (o donde encaje con el patrón de Team):
- Lista de cursos (plantillas globales + propios), estado, modo de entrega.
- Detalle de curso: secciones de teoría + preguntas (editor sencillo, no un authoring tool completo — eso es C3).
- **Asignar**: modal para asignar a empleados / puesto / local con fecha límite.
- **Seguimiento**: tabla de quién lo ha hecho, nota, fecha de firma, quién va tarde.

Servicio: `coursesService.ts` siguiendo el patrón `brandsService.ts` (CRUD multi-tenant).
⚠️ **supabase-js**: NUNCA guardes `rpc`/`from` en variable suelta (regla §2) — pierde el `this`. Y un `catch(()=>[])` que devuelve vacío ESCONDE el fallo: si hay error, `console.warn` y estado de error, **nunca** renderizar éxito con lista vacía.

## 4. Front — móvil del empleado

Nueva sección `MiFormacion.tsx` en `src/pages/trabajador/`, hermana de `MisChecklistsPage.tsx`, enlazada desde `PortalEmpleado.tsx`:
1. **Tarjetas**: pendiente / superado / caduca pronto.
2. **Teoría**: secciones con scroll; registra `time_spent_seconds`.
3. **Test**: **una pregunta por pantalla**, botones grandes (dedo, no ratón). Al fallar, muestra la explicación.
4. **Firma**: canvas para dibujar con el dedo + campo DNI + frase de compromiso visible + sello de tiempo automático. Sube el PNG al bucket privado y llama a `sign_course_attempt`.
5. **Diploma**: ver/descargar.

UX: pensado para hacerse **en turno, en 10-15 minutos**, con una mano, en una pantalla pequeña.

## 5. Acta PDF

`courseCertificatePdfService.ts` reutilizando el patrón de `allergenCompliancePdfService.ts`:
- **Acta de sesión** por curso: portada (empresa, curso, base legal, fecha, responsable), **contenidos impartidos**, tabla de asistentes con nota, y **anexo de firmas** (imagen de la firma + nombre + DNI + fecha/hora).
- **Diploma individual** por empleado.

Es el documento que se enseña al inspector: que se explique solo, sin necesitar a nadie que lo interprete.

---

## 6. ENTREGA (regla §1.bis — las 5 etapas, sin atajos)

1. Rama `feature/formacion-c1`.
2. `database.ts` regenerado **en el mismo commit** que los tipos/services que lo usan.
3. Toda DDL aplicada → su fichero en `supabase/migrations/` (`YYYYMMDD'T'HHmm_descripcion.sql`).
4. **NO apliques las migraciones tú**: entrégalas para que Julio las corra en el SQL Editor (`supabase db push` NO funciona en este proyecto).
5. `npm run build` verde antes de pushear.
6. Al terminar declara el estado git explícito: rama · commit · pushed (sí/no) · PR (sí/no) · deploy (sí/no) · verificado (sí/no).

## 7. FUERA DE ALCANCE en C1 (no lo hagas)

- Informe "Listo para la inspección" (C2) · catálogo completo de 9 cursos (C3) · reevaluación periódica y cron (C4) · círculo cerrado APPCC (C5) · migrar `FORMATION_CATALOG` a tabla (C3) · tocar `FormacionesTab.tsx` o `employee_formations` · **PRL** (es `solo_archivo`, ni se imparte ni se testea).

---

_Diseño: `docs/folvy_formacion_diseno.md` · Encargo generado en la sesión del 03/08/2026._
