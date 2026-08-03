# Folvy — MÓDULO DE FORMACIÓN · DISEÑO

> **Estado**: diseño para aprobación de Julio. Ritual: RECON ✅ · BENCHMARK ✅ (`folvy_formacion_benchmark.md`) · **DISEÑO (este doc)** · MEDIR.
> **Encaje**: módulo COMPARTIDO Team ↔ Safety. Pago extra.
> **Alcance decidido (Julio)**: Folvy **imparte** los cursos internos **y** archiva los externos.
> **Disparador real**: en inspección sanitaria pidieron formación específica del personal en alérgenos. 3ª pata del cumplimiento junto a la matriz de alérgenos y las fichas técnicas.

---

## 0. LA IDEA FUERZA (lo que hay que enseñar en una demo)

### El botón "Listo para la inspección"

Un clic → **un PDF que demuestra el sistema entero**:
- Quién está formado en qué, a fecha de hoy, por local y por puesto.
- Los **contenidos impartidos** de cada curso (lo que exige el RD para que el certificado valga).
- La **firma de cada empleado**, con su nombre, DNI, fecha y hora exactas.
- Los **certificados externos** archivados y sus caducidades.
- Los **huecos**: quién va tarde, qué caduca en 30 días. En rojo, sin esconderlo.

Ese es el gancho comercial. Un grupo con 150 locales tiene que formar a cientos de personas y **demostrarlo**. Hoy lo hacen con carpetas de papel y hojas de firmas. Nadie lo resuelve en un clic.

**Todo lo demás de este módulo existe para alimentar ese botón.**

### Las 3 frases de venta
1. *"Tu personal se forma en el móvil, firma con el dedo, y tú tienes el acta al segundo."*
2. *"Cuando venga el inspector, un botón."*
3. *"Si una auditoría de higiene falla, el sistema vuelve a formar a quien falló. Solo."*

---

## 1. EL LÍMITE LEGAL QUE MANDA EN EL DISEÑO (no negociable)

Hay **dos regímenes** y confundirlos sería vender cumplimiento falso:

**Régimen A — Folvy PUEDE impartir y certificar** (la empresa alimentaria es la responsable de formar; no hay homologación previa):
- Higiene alimentaria / manipulador (RD 109/2010 + Reg. CE 852/2004)
- Alérgenos e intolerancias (Reg. UE 1169/2011)
- APPCC y prerrequisitos (Reg. CE 852/2004)
- Igualdad y acoso sexual / por razón de sexo (LO 3/2007, RD 901/2020)
- LGTBI (Ley 4/2023, RD 1026/2024)
- Protección de datos / RGPD
- Canal de denuncias (Ley 2/2023)

**Régimen B — Folvy NO puede impartir** (actividad preventiva reservada):
- **PRL** (Ley 31/1995, RD 39/1997). Solo el Servicio de Prevención (propio o ajeno acreditado) puede impartirla y certificarla; el formador necesita titulación técnica. Folvy **archiva, avisa y demuestra**, pero NO emite.

→ **Cada curso lleva `delivery_mode`**: `folvy_imparte` | `solo_archivo` | `mixto`.
→ **UI honesta** (regla §4): en PRL la pantalla dice *"Esta formación la imparte tu servicio de prevención. Súbela aquí y Folvy la vigila."* Nunca un botón que no cumple.

**Extra del convenio de hostelería de Madrid (desde 2024)**: obligación de formar a quien preste ≥90 días/año, y **el tiempo de formación es tiempo efectivo de trabajo** → Folvy registra el tiempo dedicado (engancha con fichaje/cuadrante). Argumento comercial y requisito a la vez.

---

## 2. CATÁLOGO DE CURSOS (contenido que entrega Folvy)

Cursos **plantilla GLOBALES** (patrón `ingredient_template`): Folvy los redacta UNA vez, sin `account_id`; cada cuenta los **adopta** y puede personalizarlos. Efecto: un cliente nuevo nace con todo el cumplimiento montado el día 1.

| # | Curso | Base legal | Modo | Reeval. sugerida |
|---|---|---|---|---|
| 1 | Alérgenos e intolerancias | Reg. UE 1169/2011 | imparte | 12 meses |
| 2 | Higiene alimentaria / manipulador | RD 109/2010 | imparte | 48 meses |
| 3 | APPCC y prerrequisitos | Reg. CE 852/2004 | imparte | 12 meses |
| 4 | Igualdad y prevención del acoso | LO 3/2007, RD 901/2020 | imparte | 24 meses |
| 5 | Igualdad y no discriminación LGTBI | Ley 4/2023 | imparte | 24 meses |
| 6 | Protección de datos (RGPD) | RGPD / LOPDGDD | imparte | 24 meses |
| 7 | Canal de denuncias | Ley 2/2023 | imparte | 24 meses |
| 8 | **PRL** básico + específico de puesto | Ley 31/1995, RD 39/1997 | **solo archivo** | según SPA |
| 9 | Primeros auxilios / DESA, incendios | recomendado | mixto | 24 meses |

**Oleadas de contenido** (el motor soporta las 9 desde el día 1; el texto se carga por fases):
- **Oleada 1** — Alérgenos (ya redactado por Julio) + Manipulador. Son los de inspección sanitaria.
- **Oleada 2** — APPCC + PRL (ficha de archivo).
- **Oleada 3** — Bloque legal-laboral: igualdad, LGTBI, RGPD, canal de denuncias.

---

## 3. MODELO DE DATOS

### Nuevo
- **`course`** *(global si `account_id IS NULL` = plantilla Folvy; o propio de la cuenta)*
  `id, account_id (nullable), code, title, summary, legal_basis, delivery_mode, reeval_months, is_mandatory, appcc_prerequisite bool, estimated_minutes, pass_threshold_pct, version int, status (draft/published/archived), created_*`
- **`course_section`** — teoría por bloques: `course_id, ord, title, body (md), media_url`
- **`course_question`** / **`course_option`** — test: `question(course_id, ord, text)`, `option(question_id, text, is_correct, explanation)`
- **`course_assignment`** — a quién: `course_id, account_id, employee_id | role | location_id, due_at, origin (manual/onboarding/reeval_periodica/reeval_evento), source_incident_id (nullable)`
- **`course_attempt`** — intento: `assignment_id, employee_id, started_at, finished_at, score_pct, passed, answers jsonb, time_spent_seconds`
- **`course_signature`** — **la evidencia**: `attempt_id, employee_id, signature_png (storage), signer_name, signer_doc_id (DNI), signed_at, ip, user_agent, auth_method ('magic_link_qr'), auth_uid uuid (de auth.uid(), NO confiar en el cliente), course_version` *(inmutable, append-only)*
- **`course_certificate`** — acta/diploma: `attempt_id, pdf_url, issued_at, issued_by, serial`

### Reutilizado
- **`employee_formations`** (ya existe, versionada) → **certificados externos**. Se le añade `origin ('interno_folvy' | 'externo')` + `course_id` (nullable) para enlazar el interno con su curso.
- **`FORMATION_CATALOG`** (hoy hardcodeado en `types/personal.ts`, 9 tipos con metadatos legales) → migra a tabla `course` como semilla. Ya tiene los 5 obligatorios y años de caducidad: buen punto de partida, no se tira.
- **Acciones correctivas APPCC** (`incidentsService`, `IncidentTimeline`) → gancho de reevaluación por evento.

**Reglas duras:**
- `course_signature` **inmutable** (nunca UPDATE; corregir = nueva firma). Es prueba legal.
- Guarda **`course_version`**: si el curso cambia después, el acta sigue diciendo qué firmó exactamente esa persona.
- Todas las funciones `SECURITY DEFINER` con `p_account_id` llevan guard `belongs_to_account`.

---

## 4. LAS 4 PIEZAS

### Pieza 1 — Cursos internos (el corazón, nuevo)

**Oficina (Team):**
- *Cursos*: catálogo con los 9; "Adoptar" un plantilla, editar teoría/test, publicar (versión++).
- *Asignar*: por empleado, puesto o local. Fecha límite.
- *Seguimiento*: tabla viva — **quién ha hecho qué, quién va tarde, quién caduca pronto**. Filtros por local/puesto. Exportable.

**Móvil del empleado** (dentro de SU sesión real de Supabase Auth). **Mecanismo verificado**: el manager genera un *enlace de acceso* desde `AccesoTrabajadorPanel.tsx` → `generateAccessLink()` → Edge `manage-employee` → `tokenHash` → URL `/acceso?token_hash=…&type=magiclink`, que se entrega **como QR** (o enlace por WhatsApp). El empleado **escanea el QR y entra sin teclear nada**; el token se canjea con `verifyOtp` (sin PKCE), es de un solo uso y caduca. → **Al firmar hay `auth.uid()` real y verificable server-side**: la firma queda atada a una identidad autenticada por Supabase, no a un PIN de cliente. Esta es la base de la solidez legal de la evidencia. La sección vive como hermana de `MisChecklistsPage` / `MisDocumentos` en `PortalEmpleado.tsx`:
1. *Mi formación*: tarjetas pendiente / superado / caduca pronto.
2. *Teoría*: secciones con scroll, se registra el tiempo.
3. *Test*: **una pregunta por pantalla**, botones grandes; al fallar, explicación.
4. *Firma*: dibujo con el dedo + DNI + sello de tiempo. Frase de compromiso visible.
5. *Diploma*: se ve y se descarga.

**Salida automática**: **acta PDF por curso/sesión** (el "Documento 4" relleno solo) con contenidos, asistentes, notas y firmas. Y **diploma individual**.

### Pieza 2 — Certificados externos (existe, se completa)
La pestaña actual ya hace alta/edición/caducidad/estado. Se añade:
- **Aviso proactivo** (hoy solo es color): notificación a manager 60/30/7 días antes de caducar. Sin vigía, un sistema vivo no se protege solo (regla §4).
- Subida del PDF directa (hoy pide pegar URL de la pestaña Documentos).
- `origin='externo'` para separarlo del interno.

### Pieza 3 — Reevaluación
- **Periódica**: `reeval_months` por curso → al cumplirse, genera `course_assignment` con `origin='reeval_periodica'`. Un cron diario, igual patrón que los watchdogs vivos.
- **Por evento**: ver Pieza 4.

### Pieza 4 — Prerrequisito APPCC (el círculo cerrado)
- La formación **aparece en Safety/APPCC** como prerrequisito del plan de higiene, con su semáforo.
- **Una auditoría APPCC que detecte incumplimiento dispara la reevaluación** del personal implicado: la acción correctiva ofrece *"Reformar al personal implicado"* → crea `course_assignment` con `origin='reeval_evento'` y `source_incident_id`.
- El ciclo queda cerrado y **trazable**: fallo → formación → evidencia firmada → se refleja en la auditoría siguiente.

---

## 5. EL INFORME DE INSPECCIÓN (la pieza estrella)

**Un botón en Safety → PDF.** Contenido:
1. Portada: empresa, local(es), fecha, responsable de formación.
2. **Matriz personal × cursos** con estado (vigente / caducado / pendiente) y fecha.
3. Por curso: base legal + **contenidos impartidos** + nº de asistentes.
4. **Anexo de firmas**: firma, nombre, DNI, fecha y hora de cada empleado.
5. Certificados externos con caducidades.
6. **Huecos declarados** en rojo (honestidad: un informe que oculta lo que falta no vale ante un inspector).

Mismo motor que ya usa el informe de alérgenos (`allergenCompliancePdfService`) → se reutiliza, no se reinventa.

---

## 6. DÓNDE VIVE CADA COSA (Team ↔ Safety)

| Zona | Qué |
|---|---|
| **Team** → Formación | Catálogo de cursos, editor, asignaciones, seguimiento "quién va tarde" |
| **Team** → ficha de empleado | Pestaña Formaciones (internas + externas), su historial y firmas |
| **Safety/APPCC** → Formación | Prerrequisito con semáforo + **botón "Listo para la inspección"** + disparo de reevaluación desde acción correctiva |
| **Móvil del empleado** | Mi formación, teoría, test, firma, diploma |

Una sola verdad: los datos viven en las tablas `course*`; Team y Safety son dos ventanas a lo mismo.

---

## 7. PLAN POR CAPAS (cada capa usable sola — principio MRP II)

- **C1 — Motor + curso de alérgenos end-to-end**: modelo de datos, editor mínimo, móvil (teoría→test→firma), acta PDF. *Con esto ya cubres la inspección que motivó el frente.*
- **C2 — Informe "Listo para la inspección"** + seguimiento de oficina (quién va tarde). *Aquí aparece el gancho de venta.*
- **C3 — Catálogo completo** (oleadas 2 y 3) + adopción de plantillas globales.
- **C4 — Reevaluación** periódica (cron) + externos con aviso proactivo.
- **C5 — Círculo cerrado APPCC** (acción correctiva → reevaluación).
- **C6 — Extras**: tiempo de formación al cuadrante, onboarding automático (empleado nuevo → asignaciones), IA que genera borrador de curso.

---

## 8. CÓMO SE MIDE (paso 4 del ritual)

- % de plantilla con las obligatorias vigentes, por local *(el KPI que mira el inspector)*.
- Nº de actas generadas y firmas capturadas.
- Días de antelación media con que se renueva un certificado (antes de caducar, no después).
- Reevaluaciones disparadas por evento APPCC y su cierre.
- Tiempo medio de un curso en el móvil (si es >15 min, el empleado no lo termina en turno).

---

## 9. DEUDAS / DECISIONES ABIERTAS

- **PRL**: solo archivo. Deuda futura: convenio con un SPA acreditado para ofrecerlo dentro (modelo marketplace).
- **Firma**: es manuscrita electrónica (no cualificada). Suficiente para acreditar formación interna ante Sanidad; **no** equivale a firma cualificada eIDRAS. Declararlo en la UI.
- **Contenido**: redactar 7 cursos es volumen real. Por oleadas; alérgenos ya está.
- **`FORMATION_CATALOG` hardcodeado** → migrar a tabla sin romper la pestaña actual.
- **Idioma**: plantilla de personal no siempre castellanoparlante → cursos multiidioma es frente propio (engancha con i18n aparcado).

---

_Benchmark: `folvy_formacion_benchmark.md`. Al aprobar, este doc pasa a ser la verdad del frente y se enlaza en `folvy_indice.md`._
