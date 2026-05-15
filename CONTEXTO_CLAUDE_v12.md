# Módulo de operaciones — CONTEXTO v12

## INSTRUCCIONES DE USO PARA CLAUDE

Cuando empieces una nueva conversación con este archivo:
1. Lee el archivo entero antes de responder al usuario.
2. **No** preguntes datos que ya están aquí.
3. Confirma brevemente al usuario en qué punto estás retomando.
4. Estilo de comunicación: el usuario prefiere **paso a paso muy detallado**, con confirmaciones frecuentes, comandos uno a uno, y **substituir bloques enteros** vs editar línea por línea. Tiene buena tolerancia a errores y aprende rápido.
5. El usuario no tenía experiencia previa con Git/terminal antes del 12/05/2026. Hoy ya sabe lo básico.
6. **CRÍTICO**: NO generar `App.tsx` en outputs para descarga — tiene imports con rutas `@/platform/...` que varían. Cambios en App.tsx se hacen pidiendo el archivo al usuario, editando solo lo necesario y devolviéndolo.

---

## 1. PROYECTO

**Nombre:** Foodint (antes "llorente29-app")
**Descripción:** SaaS de gestión integral para hostelería.
**Pivot estratégico:** "Plataforma 360º hostelería" modular y comercializable.

### Locales propios (cuenta interna "Grupo Foodint")
- **Foodint Alcalá** — C/ Florencio Llorente 29, Madrid
- **Foodint Carabanchel** — C/ Camichi 4, Madrid
- **Foodint Pza Castilla** — C/ Cañaveral 75, Madrid

Los 3 locales operan en horario **12:30 – 23:30**.

### Empleados activos: 8
- **Natacha** (T1), **Yohanny** (T2), **Pamela** (T3) + 5 más

### Admins
- jgcolon@idasal.com
- llorente29food@gmail.com
- pamela@idasal.com (manager con permisos APPCC)

---

## 2. STACK TÉCNICO

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Supabase (xzmpnchlguibclvxyynt.supabase.co, **eu-west-1 = Irlanda**, GDPR-compliant)
- **Branding NUEVO (v12):** Azul tinta `#1E3A5F`, Beige claro `#F5F4F0`, fuentes Fraunces (display) + Inter (sans), iconos Lucide React
- **Branding VIEJO eliminado:** Granate `#7C1A1A` + Beige `#F5E9D9` + Instrument Serif → ya NO existe en el código (excepto Logo.tsx comentario + TiposTurnoPage PRESET_COLORS legítimo)
- **Repo:** github.com/Llorente29/llorente29-app
  - Rama producción: `gh-pages` (GitHub Pages, deploy con `npx gh-pages -d dist`)
  - **Rama activa de desarrollo: `feat/branding-refactor`**
  - Rama anterior APPCC: `feat/sprint2-appcc-frontend`
- **Entorno local:** Windows, Node v24.15.0, npm 11.12.1, Git 2.54.0, VS Code en `C:\dev\llorente29-app`
- App corre en `http://localhost:5175/llorente29-app/` con `npx vite --host`
- **Producción:** `https://llorente29.github.io/llorente29-app/` (GitHub Pages desde rama `gh-pages`)
- **Deploy:** `npm run build && npx gh-pages -d dist` (solo cuando el usuario decide)

### Supabase Auth — URLs configuradas
- Site URL: `https://llorente29.github.io/llorente29-app/`
- Redirect URLs incluyen: `http://localhost:5173/**`, `http://localhost:5174/**`, `http://localhost:5175/**` (todas con `/llorente29-app/**`)

### Cuenta interna Foodint
- **UUID account:** `00000000-0000-0000-0000-000000000001`
- Constante usada en código: `ACCOUNT_ID_FOODINT`

---

## 3. ESTADO DEL CÓDIGO AL CIERRE 15/05/2026

### Branch activa
```
feat/branding-refactor
Todo pusheado a origin. Working tree clean.
```

### Branding refactor — COMPLETADO
- **Fase 2b completa**: TODAS las páginas migradas de paleta vieja (#7C1A1A/#F5E9D9) a tokens semánticos (accent/accent-bg/etc.)
- **Verificación final**: `git grep -l "7C1A1A|F5E9D9|Instrument Serif" src/` devuelve SOLO:
  - `src/components/Logo.tsx` (comentario descriptivo, legítimo)
  - `src/pages/TiposTurnoPage.tsx` (PRESET_COLORS para selección de color de turno, legítimo)
- **Build limpio**: 0 errores TS, solo warnings de chunk size
- **@ts-expect-error en Sidebar.tsx**: ARREGLADO (eliminado)
- **Imports Lucide no usados**: ARREGLADOS (MisDocumentos, MisTurnos, MisVacaciones)

### Archivos refactorizados en sesión 15/05/2026 (acumulado)
**Fase 2b.22-23**: BolsaHorasPage, CalendarioPage, PlantillaTurnosPage, FichajeEmpleado, LoginEmpleado, MiHorario, CambiosTurnoPage, MisDocumentos, MisFichajes, MisTurnos, MisVacaciones, TrabajadorApp

---

## 4. MÓDULO APPCC — ESTADO COMPLETO

### Estructura de archivos actualizada
```
src/modules/appcc/
├── components/
│   ├── FieldRenderer.tsx       — inputs según field_type + PhotoSection universal en TODOS los campos
│   └── PhotoUploader.tsx       — NUEVO: cámara + galería + thumbs + lightbox + Supabase Storage
├── pages/
│   ├── TodayPage.tsx           — lazy generation con ASIGNACIÓN automática
│   ├── ExecutionPage.tsx       — rellenar checklist + botón Descargar PDF cuando completado
│   ├── IncidentsPage.tsx       — gestión incidencias
│   ├── OnboardingPage.tsx      — wizard 3 pasos + ANTI-DUPLICACIÓN (detecta local ya configurado)
│   └── ReportsPage.tsx         — NUEVO: 4 tipos de informe PDF con selector rango/tipo
├── services/
│   ├── templatesService.ts     — catálogo
│   ├── schedulesService.ts     — schedules + factory 8 esenciales
│   ├── executionsService.ts    — CRUD executions + assigned_to
│   ├── incidentsService.ts     — incidencias auto y manuales
│   ├── assignmentService.ts    — NUEVO: motor asignación (fijo → fichado → sin asignar)
│   ├── photosService.ts        — NUEVO: upload/list/delete fotos + compresión cliente
│   └── pdfExportService.ts     — NUEVO: 5 tipos PDF (checklist, diario, controles, incidencias, inspector)
└── types.ts
```

### Funcionalidades COMPLETADAS en sesión 15/05/2026

#### Sprint B1c — Anti-duplicación wizard
- Al seleccionar un local con schedules activos, muestra banner warning naranja
- Al guardar, pide confirmación → desactiva existentes → crea nuevos (sin borrar histórico)

#### Fotos/evidencias APPCC
- **Bucket Supabase Storage**: `appcc-photos` (privado, 5MB, jpeg/png/webp)
- **Políticas RLS**: authenticated_read, authenticated_upload, authenticated_delete
- **PhotoUploader.tsx**: botones Cámara (`capture="environment"` para móvil) + Galería, compresión a JPEG ~150KB vía canvas, thumbs 80×80, lightbox pantalla completa, borrar
- **FieldRenderer.tsx**: TODOS los tipos de campo (numeric, boolean, select, text, date) tienen "Adjuntar foto" colapsable debajo. Se expande al pulsar. Campo `photo` dedicado sigue existiendo para items solo-foto
- **photosService.ts**: compressImage, uploadPhoto, listPhotos, listPhotosForExecution, deletePhoto

#### PDF inspector-ready (5 tipos)
- **Certificado checklist individual**: datos del local, items con valores, indicadores color (verde OK, rojo out of range), firma SHA-256, referencia eIDAS
- **Resumen diario**: tabla con todos los controles del día + estadísticas
- **Informe de controles**: rango de fechas, agrupado por día, indicadores estado
- **Informe de incidencias**: rango de fechas, severidad, acciones correctoras
- **Informe inspector completo**: controles + incidencias + acciones + resumen ejecutivo + referencia CE 852/2004 y RD 109/2010
- **ReportsPage.tsx**: selector de local, tipo de informe (4 opciones con descripción), rango de fechas, botón generar
- **Librería**: jsPDF (cliente, sin backend)

#### Motor de asignación APPCC (Sprint 3b)
- **assignmentService.ts**: `resolveAssignment(scheduleId, locationId)` → prioridad: responsable fijo (appcc_schedule_responsibles) → empleado fichado (jornada abierta) → null
- **executionsService.ts**: `createExecution` acepta `assignedTo` en options
- **TodayPage.tsx**: lazy generation llama a `resolveAssignment` al crear cada execution
- **MisChecklistsPage.tsx**: trabajador ve solo checklists asignados a él + sin asignar

#### Home trabajador con módulos (Sprint 3a)
- **HomeEmpleado.tsx**: REESCRITO — 2 botones grandes (APPCC verde + Mi Portal azul), grid responsive, badge de pendientes, alerta naranja grande si hay controles pendientes
- **PortalEmpleado.tsx**: NUEVO — menú anterior (fichaje, horario, turnos, docs, vacaciones) con botón "Volver" al Home
- **MisChecklistsPage.tsx**: NUEVO — lista checklists del día para el trabajador (pendientes arriba, completados abajo), navega a ExecutionPage
- **TrabajadorApp.tsx**: REESCRITO — routing por módulos (home → appcc_list → appcc_execution / portal → subpáginas)
- **Botón APPCC solo visible** si el local del empleado tiene schedules activos

#### Permisos APPCC para managers
- Columnas SQL: `show_appcc_today`, `show_appcc_incidents` en `manager_permissions` (ya creadas)
- App.tsx: lee campos con cast `as unknown as Record<string, unknown>`
- ManagerPermissionsModal.tsx: sección "Operaciones" reemplazada por "APPCC" con 2 checkboxes (APPCC: Hoy, APPCC: Incidencias)
- Sidebar.tsx: entrada "APPCC: Informes" añadida entre Incidencias y Configurar

#### Cron pg_cron — overdue automático
- Extensión `pg_cron` activada en Supabase
- Función `appcc_mark_overdue()` marca como overdue los checklists pending/in_progress de días anteriores
- Cron schedule `appcc-mark-overdue` ejecuta a las 00:05 cada noche

### Tablas Supabase APPCC (14 + bucket Storage)
- **Catálogo**: appcc_plans (15), appcc_templates (30), appcc_template_items (149), appcc_template_item_options
- **Programación**: appcc_schedules (24 activos), appcc_schedule_responsibles
- **Ejecución**: appcc_executions (con assigned_to), appcc_execution_responses, **appcc_execution_photos (FUNCIONAL)**
- **Incidencias**: appcc_incidents, appcc_incident_actions, appcc_incident_photos (tabla existe, NO funcional aún)
- **Auditoría**: appcc_signatures, appcc_audit_log
- **Storage**: bucket `appcc-photos` (privado, 5MB, RLS authenticated)

---

## 5. DEPLOY Y PRODUCCIÓN

### GitHub Pages
- Branch: `gh-pages`
- URL: `https://llorente29.github.io/llorente29-app/`
- Deploy manual: `npm run build && npx gh-pages -d dist`
- **Solo se actualiza cuando el usuario dice "deploy"**

### Flujo de trabajo
1. Desarrollo en local (`feat/branding-refactor`) → `localhost:5175`
2. Commit + push a origin
3. Deploy a producción SOLO cuando el usuario lo decide

---

## 6. PENDIENTES (ROADMAP ACTUALIZADO)

### ✅ COMPLETADOS en sesión 15/05/2026
- [x] Fase 2b branding completa (todas las páginas)
- [x] Fase 3 build errors (imports no usados, @ts-expect-error)
- [x] Sprint B1c anti-duplicación wizard
- [x] Fotos/evidencias APPCC (bucket + componente + compresión + visor)
- [x] PDF inspector-ready (5 tipos)
- [x] Motor asignación APPCC (responsable fijo → fichado → sin asignar)
- [x] Home trabajador con módulos (APPCC + Portal)
- [x] Permisos APPCC para managers (columnas SQL + UI checkboxes)
- [x] Cron pg_cron overdue automático
- [x] Entrada menú APPCC: Informes
- [x] Deploy GitHub Pages configurado

### Pendientes próximos
- [ ] **SchedulesPage admin** (~2-3h) — editar/desactivar/añadir schedules sin reabrir wizard
- [ ] **Push notifications PWA** (~4-5h) — alertas al móvil del trabajador
- [ ] **Fotos en incidencias** (~1-2h) — reutilizar PhotoUploader en IncidentsPage
- [ ] **Firma canvas Pro** (~3-4h) — firma manuscrita en vez de SHA-256
- [ ] **React Router** — refresh vuelve a Dashboard
- [ ] **Auditar feature flags** — verificar todos los componentes filtran correctamente

### Sprint "Foodint Live" (desplegar para locales reales)
- [ ] Comprar dominio (sugerido `foodint.es`)
- [ ] Crear cuentas empleados + permisos
- [ ] Guía rápida para trabajadores
- [ ] Pilotaje en los 3 locales

### Largo plazo
- [ ] **Stripe Checkout** (Sprint 6, oct-nov 2026)
- [ ] **Stock & Recetario** (Sprint 4-5)
- [ ] **Onboarding cliente externo**
- [ ] **Legal**: RGPD, DPA, factura electrónica

---

## 7. ARCHIVOS CLAVE A CONOCER

### Para retomar APPCC
- `src/modules/appcc/services/assignmentService.ts` — motor asignación
- `src/modules/appcc/services/pdfExportService.ts` — generación 5 tipos PDF
- `src/modules/appcc/services/photosService.ts` — fotos Storage
- `src/modules/appcc/components/PhotoUploader.tsx` — componente fotos
- `src/modules/appcc/pages/ReportsPage.tsx` — pantalla informes

### Para retomar navegación trabajador
- `src/pages/trabajador/HomeEmpleado.tsx` — 2 botones grandes (APPCC + Portal)
- `src/pages/trabajador/PortalEmpleado.tsx` — menú fichaje/horario/docs
- `src/pages/trabajador/MisChecklistsPage.tsx` — checklists APPCC del trabajador
- `src/pages/trabajador/TrabajadorApp.tsx` — orquestador routing por módulos

### Para permisos
- `src/components/ManagerPermissionsModal.tsx` — checkboxes APPCC
- `src/App.tsx` — lectura permisos con cast `as unknown as Record<string, unknown>`

### PRECAUCIÓN con App.tsx
- **NO generar App.tsx en outputs**. Tiene imports con rutas `@/platform/feature-gate/featureGateService` que solo existen en el repo real
- Pedir SIEMPRE el archivo al usuario, editar solo lo necesario, devolver

---

## 8. NOTAS OPERATIVAS

### Tokens semánticos CSS (tailwind.config.js)
- `bg-page`, `bg-card`, `bg-accent-bg`, `bg-success-bg`, `bg-danger-bg`, `bg-warning-bg`
- `text-text-primary`, `text-text-secondary`, `text-accent`, `text-on-accent`, `text-success`, `text-danger`, `text-warning`
- `border-border-default`, `border-accent/30`, `border-success/30`, `border-danger/30`, `border-warning/30`
- `font-display` (Fraunces), `font-sans` (Inter)
- `transition-base` (150ms), `rounded-xl`, `rounded-lg`

### Constantes hardcodeadas
- `ACCOUNT_ID_FOODINT = '00000000-0000-0000-0000-000000000001'`
- Breakpoint móvil/desktop: 1024px (Tailwind `lg`)

### Comandos útiles
```powershell
# Desarrollo
npx vite --host

# Build
npm run build

# Deploy a producción
npm run build && npx gh-pages -d dist

# Verificación branding
git grep -l "7C1A1A|F5E9D9|Instrument Serif" src/
```

---

## 9. CÓMO RETOMAR EN PRÓXIMA SESIÓN

Al recibir "continuamos" o "seguimos":
1. Branch `feat/branding-refactor`, todo pusheado
2. Preguntar qué atacar — ofrecer pendientes de la sección 6
3. Estilo: paso a paso, archivos completos, sin explicaciones largas
4. **NO tocar App.tsx directamente** — pedir al usuario que lo suba
5. Recordar: deploy solo cuando el usuario diga
