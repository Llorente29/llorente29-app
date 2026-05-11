# FOODINT — Contexto para Claude (v5)

> **Propósito:** este documento es el "salvavidas" del proyecto. Si una conversación con Claude se queda sin contexto, abre una nueva conversación, pega/sube el contenido de este archivo y dile: *"Continúa el desarrollo de Foodint. Lee este contexto y dime el estado actual antes de proseguir."*
>
> **Cómo mantenerlo:** al final de cada sesión productiva, pídele a Claude: *"Actualiza el CONTEXTO_CLAUDE.md con lo que hemos hecho hoy."*

---

## 🚨 PRIORIDAD CRÍTICA INMEDIATA — SISTEMA DE AUTH + ROLES

**Antes de meter trabajadores reales en la app**, hay que implementar el sistema de autenticación y control de acceso.

Estado actual: **la app no tiene auth real**. Cualquiera con la URL puede:
- Acceder al modo gestor
- Cambiar a modo trabajador y suplantar a cualquiera con su PIN
- Ver datos sensibles (salarios, contratos, etc.)

**El plan completo está documentado en:** [`docs/PLAN_AUTH_ROLES.md`](./docs/PLAN_AUTH_ROLES.md) (subido a la raíz del repo).

**Decisiones tomadas (sesión 2026-05-10):**
- 3 roles: `admin`, `manager`, `worker` (extensible a más en el futuro)
- Login con **Magic Link** (Supabase Auth)
- Kiosko de fichaje mantiene PIN aparte (caso especial)
- Implementación en 5 fases (3-15 sesiones distribuidas)

**Pasos antes de meter trabajadores:**
1. ⏳ Limpiar datos de pruebas (sesión actual o próxima)
2. ⏳ FASE 1: cimientos de auth (tabla user_profiles, login, diferenciación admin/worker)
3. ⏳ FASE 2: Personal protegido (RLS en employees, documents, vacations)
4. ⏳ FASES 3-5 según prioridad

Hasta que esto NO esté implementado, NO compartir la URL con trabajadores reales.

---

> **Propósito:** este documento es el "salvavidas" del proyecto. Si una conversación con Claude se queda sin contexto, abre una nueva conversación, pega/sube el contenido de este archivo y dile: *"Continúa el desarrollo de Foodint. Lee este contexto y dime el estado actual antes de proseguir."*
>
> **Cómo mantenerlo:** al final de cada sesión productiva, pídele a Claude: *"Actualiza el CONTEXTO_CLAUDE.md con lo que hemos hecho hoy."*

---

## 1. Identidad del proyecto

**Foodint** (antes "Andy App") — software de gestión de hostelería para 3 locales en Madrid.

- **Locales:** Foodint Alcalá, Foodint Carabanchel, Foodint Pza Castilla
- **Empleados totales:** ~8-20 entre los 3 locales
- **Stack:** React + TypeScript + Vite + Tailwind CSS + Supabase (Postgres + Realtime + Storage)
- **Modo:** PWA en GitHub Pages instalable como app
- **Logo:** PNG con texto "Foodint" en granate, llama naranja sobre la "o"

### Paleta de marca
- Granate principal: `#7C1A1A`
- Granate oscuro (hovers): `#5A1212`
- Naranja/llama (acento): `#F39C2A`
- Crema/humo (fondos suaves): `#F5E9D9`
- Verde esmeralda: SOLO se mantiene en estados semánticos de éxito (jornada abierta, fichaje correcto)
- Rojo/naranja: SOLO se mantiene en estados semánticos de salida o error

---

## 2. Infraestructura

### Repositorio principal
- **GitHub:** `github.com/Llorente29/llorente29-app`
- **Rama `source`:** código fuente que editamos
- **Rama `main`:** build compilado que sirve GitHub Pages
- **URL pública:** `https://llorente29.github.io/llorente29-app/`

### Flujo de despliegue
1. Editamos archivos en la rama `source` desde la web de GitHub
2. Al hacer commit en `source`, se dispara el workflow `deploy.yml`
3. El workflow compila con `npm install --no-audit --no-fund` (NO usar `npm ci`) y publica `/dist` en `main`
4. GitHub Pages sirve `main` automáticamente
5. **Settings → Pages está configurado como "Deploy from a branch → main / (root)"**
6. **Settings → Actions → Workflow permissions: Read and write**
7. El `deploy.yml` está en `.github/workflows/deploy.yml` **en la rama `source`**
8. Tiempo de deploy: ~1-2 minutos
9. **El workflow inyecta** `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` desde Settings → Secrets

### Webhook Last.app (otro repo)
- **GitHub:** `github.com/Llorente29/lastapp-webhook`
- **Deploy:** Vercel → `lastapp-webhook.vercel.app`
- **Variables de entorno (Vercel):**
  - `LASTAPP_TOKEN` (rotar — ver sección de seguridad)
  - `GOOGLE_MAPS_KEY` = `AIzaSyBNDI7ONEHb0h9JyAyNboFIR0DoPYIADUY`
- **Endpoints:**
  - `POST /api/webhook?days=N` → descarga bills de Last.app paginando offset/limit=100
  - `POST /api/geodata` → geocodifica con Photon/Nominatim (fallback)
  - `POST /api/geocode` → geocodifica con Google Maps (rápido, requiere key)
  - `/api/debug` → debug temporal
- **Function timeout:** 120s

### Supabase
- **Project URL:** `https://xzmpnchlguibclvxyynt.supabase.co`
- **Region:** West EU (Ireland)
- **Plan:** Free
- **Publishable key (segura para frontend):** `sb_publishable_PyzPVoi69TlRLWcfsEMPlA_pxMU8S9-`
- **Tablas creadas:**
  - `locations`, `employees`, `clock_entries` (Personal y kiosko)
  - `documents` (documentos del empleado)
  - `vacations` (solicitudes de vacaciones/permisos)
  - `vacation_settings` (config global y por empleado)
  - `schedules` (horarios semanales con cells JSONB)
  - `shift_templates` (plantillas de turnos)
  - `employee_availability` (disponibilidad por día/franja)
  - `hours_balance_periods`, `hours_balance_movements` (bolsa de horas)
  - `app_settings` (configuración global)
  - `employee_notifications` (notificaciones in-app)
  - `open_shifts`, `open_shift_requests` (turnos abiertos del gestor)
  - `employee_formations` (NUEVO v4 — formaciones/certificados con caducidad)
  - `shift_swap_requests` (NUEVO v4 — cambios de turno entre empleados)
- **Realtime:** activado para las tablas principales
- **RLS:** **DESACTIVADO** en la mayoría de tablas (ver decisión técnica más abajo). Importante hacerlo manual con `ALTER TABLE x DISABLE ROW LEVEL SECURITY` después de crear cada tabla.
- **Storage:** bucket `employee-documents` (público, con RLS abierto: policy `anon_all_employee_documents` en `storage.objects`)

---

## 3. ⚠️ SEGURIDAD CRÍTICA — PENDIENTE

**LASTAPP_TOKEN expuesto** en el código del webhook con fallback hardcodeado:
- `api/webhook.js:1` y `api/debug.js:1`
- Token expuesto: `247ef137-6740-4c9c-bc1e-5e9a70fbad43`

**ACCIONES PENDIENTES:**
1. Rotar el token en Last.app
2. Actualizar la env var `LASTAPP_TOKEN` en Vercel con el nuevo
3. Eliminar el fallback hardcodeado de `api/webhook.js` y `api/debug.js`

---

## 4. Estado de los módulos

### Personal — COMPLETO ✅ (incluyendo Insights, Formaciones, Cambios de turno)

**Modo Gestor** (la app completa de siempre):
- Lista empleados con búsqueda, filtros (estado/local/contrato) y avatares con foto/iniciales
- Banner de empleados con contrato/periodo de prueba próximo a vencer (30/15/7d)
- Ficha empleado con 7 pestañas: 👤 Datos, ⏰ Fichajes, 📄 Docs, 🏖 Ausencias, 🎓 Formaciones, 📋 Contrato, 📅 Disponibilidad
- **NUEVO v4 — Pestaña 📊 Insights:**
  - 5 KPIs grandes (trabajando ahora, bajas activas, vacaciones del mes, formaciones por renovar, bajas 12 meses)
  - Cumpleaños del mes
  - Aniversarios laborales
  - Eventos próximos (fin contrato, fin periodo prueba)
  - Distribuciones por local/contrato/puesto con barras
  - Listas detalladas de bajas activas, vacaciones del mes, rotación
- Control Horario con fichajes, GPS, KPIs en tiempo real
- Calendario de Horarios + Plantilla de turnos
- Informes Gestoría con descarga TXT mensual
- Bolsa de horas
- 📨 Solicitudes (vacaciones)
- **NUEVO v4 — 🔄 Cambios de turno**: pantalla con tabs Pendientes/Aprobados/Historial/Todos. Modal de aprobación con selector de atribución de horas (worker/requester) y aviso visual de impacto. Badge numérico en sidebar.
- 🪑 Turnos abiertos (gestor publica vacantes)

**Modo Kiosko** (tablet del local):
- Selección empleado → PIN → fichaje
- Detección automática de entrada/salida según último fichaje
- Geofencing 200m con bloqueo (configurable)
- Multi-local por empleado
- Modo pantalla completa + manifest PWA + iconos para "instalar como app"
- Banner de instalación con instrucciones específicas iOS/Android

**Modo Trabajador** (móvil personal del empleado):
- Selector inicial "¿Quién eres?" con persistencia en localStorage
- Login con selección de nombre + PIN
- Sesión persistente
- Home con menú: Fichar / Mi horario / Turnos abiertos / **🔄 Cambios de turno** / Mis fichajes / Mi bolsa de horas / Mis documentos / Mis vacaciones
- **Fichaje** con geofencing 200m, selector de local si tiene varios
- **Mi horario** semanal: turnos por día con botón "🔄 Solicitar cambio" en cada uno
- **NUEVO v4 — Cambios de turno**: pantalla con 2 tabs. **🌐 Tablón** muestra cesiones abiertas + peticiones que recibo. **📜 Mis solicitudes** historial filtrable por activos/historial/todos.
- **Mis fichajes** agrupados por día con horas trabajadas calculadas
- **Mis documentos** con subida (PDF/JPG/PNG/WEBP, 5 MB máx) y visualización
- **Mis vacaciones** con saldo prorrateado, solicitud, ver historial, cancelar pendientes
- 🔔 NotificationBell en header con notificaciones in-app

### Notificaciones in-app — COMPLETO ✅
- Tabla `employee_notifications` (id, employee_id, kind, title, body, data JSONB, read_at, created_at)
- Tipos disparados:
  - 💰 `period_closed` (cierre bolsa horas)
  - ✅/❌ `vacation_approved` / `vacation_rejected`
  - 📅 `schedule_published` (al publicar horario, masiva)
  - 🔄 `shift_swap_request` (cambios de turno: solicitud, aprobación, rechazo)
- Componente `NotificationBell` en headers
- Polling cada 30s + realtime cuando funciona

### Cambios de turno (NUEVO v4) — COMPLETO ✅
**3 modalidades:**
- **Cesión** (`cesion`): A libra un turno, cualquiera puede cogerlo
- **Intercambio** (`intercambio`): A propone cambiar SU turno por OTRO turno específico de B
- **Petición directa** (`peticion_directa`): A pide a B concreto que coja su turno

**Flujo de estados:**
```
abierta (esperando interesado) → propuesta (alguien la cogió) → aprobada (gestor aprobó) → schedule actualizado
                              ↘ cancelada (solicitante canceló) | rechazada (gestor rechazó)
```

**Atribución de horas (decisión clave):**
- Modelo A + opción de imputar al cedente (más flexible)
- Default `'worker'`: quien trabaja cobra (legal por defecto en convenio Hostelería)
- Opción `'requester'`: imputar al cedente (excepción, requiere acuerdo previo)
- Gestor elige al aprobar con avisos visuales del delta de horas

**Aplicación al schedule:**
- Cuando el gestor aprueba, modifica `schedules.cells[templateId][dayKey]` sustituyendo IDs
- Para intercambio: dos modificaciones (ambos turnos)

**Notificaciones:**
- Target recibe 🔔 cuando le llega intercambio o petición directa
- Ambas partes reciben 🔔 cuando gestor aprueba/rechaza

### Formaciones (NUEVO v4) — COMPLETO ✅
**Catálogo:** 9 formaciones con `mandatory: boolean` y `recommendedExpiryYears`:

Obligatorias (5):
- Manipulador de alimentos (4 años)
- Prevención Riesgos Laborales (3 años)
- Plan APPCC / Higiene (1 año)
- Alérgenos (1 año)
- Igualdad y acoso laboral (2 años)

Recomendadas (3):
- Primeros auxilios + DESA (2 años)
- Extinción de incendios (1 año)
- Manipulador especial alérgenos críticos (4 años)

Personalizada (1):
- "Otra" (sin caducidad por defecto)

**Estados visuales:** ⛔ Caducada / 🔴 7d / 🟠 15d / 🟡 30d / ✅ Vigente / ∞ No caduca

**Auto-cálculo de caducidad** al crear: `issueDate + recommendedExpiryYears`

**Resumen cumplimiento legal X/5** en pestaña Formaciones del empleado.

**Widget en Insights** "Formaciones por renovar" + KPI numérico.

### Foodint Brand — APLICADO ✅
- Nombre cambiado de "Andy App" a "Foodint"
- Subtítulo: "App del equipo"
- Iconos PWA con logo de Foodint (192x192, 512x512)
- Favicon SVG con la "F" en granate
- Manifest actualizado con tema granate
- Componente `Logo` reutilizable (size sm/md/lg/xl, withBg true/false)
- Componente `LogoSquare` para sidebar/avatares
- Paleta granate aplicada en TODAS las pantallas

### Zonas de Pedido (FUNCIONAL — sin migrar a Supabase)
**Tiene:**
- Subida CSV de Last.app (separador `,`)
- Geocodificación direcciones con Google Maps API + cache localStorage
- 5 pestañas: Mapa, Barrios, Comparativa, Solape, Rentabilidad
- **Solape:** análisis distancia recorrido vs local dominante (factor urbano ×1.40)
- **Rentabilidad:** comparativa Coste Rider vs Glovo 15% (reparto propio) y 30% (Glovo repartidor)
- **NO migrado a Supabase aún** — sigue en localStorage. Datos por dispositivo.

### Módulos en stub (PENDIENTES)
- Programadas, Plantillas, Auditorías, Historial
- Locales (página de gestión, los locales se crean en Supabase pero no hay UI para editarlos)

### Módulos funcionales (en localStorage, no migrados aún)
- Dashboard, Tareas, Incidencias, Fichas Técnicas, Análisis de Ventas, Predicción Personal, Inventario

---

## 5. Decisiones técnicas/de negocio importantes

### Decisión RLS en Supabase
**Por defecto DESACTIVADO** en todas las tablas. Coherencia con todo el sistema (single-tenant actual). 
Importante: tras crear cada tabla nueva, ejecutar `ALTER TABLE x DISABLE ROW LEVEL SECURITY`. Si no, INSERT/UPDATE devuelven 401.

### Decisión sobre Cambios de turno vs Turnos abiertos
Son módulos **separados** por filosofía distinta:
- **Turnos abiertos** (gestor): el gestor publica una vacante sin asignar para que alguien se ofrezca
- **Cambios de turno** (trabajador): un trabajador suelta un turno que YA tiene asignado

Mantienen tablas y servicios independientes. UI distinta. Acceso desde menú lateral del gestor: "🪑 Turnos abiertos" + "🔄 Cambios de turno".

### Decisión sobre atribución de horas en cambios
Modelo A + flexibilidad: por defecto quien trabaja cobra (legal según convenio Hostelería Madrid). Pero el gestor puede elegir al aprobar imputar las horas al cedente original (uso excepcional con acuerdo previo).

### IVAs (todo se trabaja sin IVA en cálculos)
- Importe pedido al cliente: **IVA 10%** (alimentación) → base = importe / 1.10
- Envío cobrado al cliente: **IVA 10%** → base = €4.50 / 1.10 = **€4.09 sin IVA**
- Coste Rider (proveedor): ya viene **sin IVA** en factura
- Comisión Glovo: aplicada sobre **base imponible sin IVA**

### Tarifa Rider actual
- 0–3 km ruta (≈2 km recta): **€5.75**
- 3–5 km ruta (≈3.5 km recta): **€5.95**
- +€0.50 por cada 500m a partir de 5 km

### Comisiones Glovo
- **15%** si reparto propio
- **30%** si Glovo gestiona también el reparto

### Coordenadas locales (fijas en código y BD)
- Foodint Alcalá: `40.4346, -3.6528` (C/Florencio Llorente 29)
- Foodint Carabanchel: `40.3912, -3.7399` (C/Camichi 4)
- Foodint Pza Castilla: `40.4698, -3.6928` (C/Cañaveral 75)

### Decisiones del Kiosko
- Identificación: **selección de nombre + PIN de 4 dígitos**
- Tipos de fichaje: **solo entrada/salida** (no pausa). En turno partido se hacen 2 entradas y 2 salidas.
- Detección automática del próximo tipo: si hay jornada abierta, ofrece SALIDA; si no, ENTRADA
- Geofencing: 200m configurable, **bloqueo total fuera de zona**
- Foto al fichar: campo en BD pero desactivado por defecto

### Decisiones del Modo Trabajador
- Login con selección nombre + PIN (mismo PIN que kiosko)
- Geofencing: bloqueo total
- Foto: preparada pero desactivada
- Modo trabajador puro (no ve menú gestor); para volver al gestor hay que hacer "Salir"
- Selector inicial guardado en localStorage `andy-app-mode-v1`
- Sesión empleado guardada en `andy-empleado-session-v1`

### Decisiones de Vacaciones
- Saldo: **22 días vacaciones / año + 3 días asuntos propios** (configurables globalmente)
- Prorrateo automático si el empleado entró este año (2.5 días/mes vacaciones)
- Tipos: vacaciones, asuntos propios, baja médica, permiso matrimonio (15d), fallecimiento, mudanza, otro
- Campo `paid?: boolean` en VacationRequest para distinguir retribuidas/no retribuidas
- Aviso visual si solicita con menos de **30 días** de antelación
- Aviso al gestor si al aprobar quedaría menos de **2 empleados** trabajando ese día
- Cómputo: año natural (1 enero - 31 diciembre)
- Días contados: laborables (lunes-viernes)

### Decisiones de Documentos
- Tipos predefinidos: nómina, contrato, baja médica, certificado médico, formación, otro
- Posibilidad de añadir tipo personalizado (campo "custom")
- Subida desde gestor o trabajador (con badge identificativo)
- Formatos: PDF, JPG, PNG, WEBP. Máximo 5 MB
- Trabajador puede borrar SUS documentos. Gestor puede borrar todos.

### Decisiones de Baja de empleado
- Tipos en `terminationType`: 'voluntaria', 'no_renovacion', 'despido', 'jubilacion', 'fin_contrato', 'otro'
- Motivo libre en `terminationReason`
- Email gestoría automático con URL Gmail Compose: `https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...` abierta con `window.open(url, '_blank')`
- NO usar `mailto:` — depende del navegador del usuario
- Flag `terminationCommunicatedToGestoria` para auditoría
- Reactivar empleado (resetea bajas)
- Eliminación permanente con doble confirmación

### Decisiones de Foto del empleado
- Compresión automática JPEG 800x800 calidad 0.85
- Avatar circular con foto o inicial sobre granate
- Field `photo` en Employee (URL o base64)

### Decisiones de Email a gestoría
- Mailto inicial NO sirvió (depende navegador del usuario)
- Solución: URL directa Gmail Compose con `window.open(url, '_blank')`
- Independiente de la configuración de mail por defecto del SO

---

## 6. Convenciones del código

### Estructura de carpetas
```
src/
  pages/                            ← una página por ruta
    trabajador/                     ← submódulo del modo trabajador
      LoginEmpleado.tsx
      HomeEmpleado.tsx
      FichajeEmpleado.tsx
      MiHorario.tsx
      MisFichajes.tsx
      MisDocumentos.tsx
      MisVacaciones.tsx
      MisTurnos.tsx                 ← turnos abiertos del gestor
      CambiosTurnoPage.tsx          ← v4 NUEVO
      TrabajadorApp.tsx             ← orquestador del modo
    KioskoFichajePage.tsx
    SolicitudesPendientesPage.tsx
    StaffPage.tsx
    TurnosAbiertosPage.tsx
    InsightsPage.tsx                ← v4 NUEVO
    CambiosPendientesPage.tsx       ← v4 NUEVO (gestor)
    BolsaHorasPage.tsx
    CalendarioPage.tsx
    PlantillaTurnosPage.tsx
    AhoraMismoPage.tsx
  components/
    ui/                             ← Button, Card, Input, Select…
    personal/                       ← componentes del módulo Personal
      DocumentosTab.tsx
      VacacionesTab.tsx
      FormacionesTab.tsx            ← v4 NUEVO
    trabajador/                     ← v4 NUEVO carpeta
      SolicitarCambioModal.tsx
      TablonCambiosView.tsx
      MisCambiosView.tsx
    AprobarCambioModal.tsx          ← v4 NUEVO (gestor)
    NotificationBell.tsx
    MiBolsaHoras.tsx
    Logo.tsx                        ← Logo + LogoSquare
  context/
    AppContext.tsx                  ← estado global con sync Supabase
  services/
    supabaseSync.ts                 ← sync de empleados, locales, fichajes
    documentsService.ts             ← CRUD documentos + Storage
    vacationsService.ts             ← CRUD vacaciones + cálculos
    fichajeKiosko.ts                ← lógica de geofencing y PIN
    deliveryZones.ts
    schedulerService.ts             ← schedules + templates
    scheduleGenerator.ts            ← generador automático
    hoursBalanceService.ts          ← bolsa de horas
    notificationsService.ts         ← notificaciones in-app
    exportGestoriaService.ts        ← export TXT mensual
    formationsService.ts            ← v4 NUEVO
    shiftSwapService.ts             ← v4 NUEVO
    openShiftsService.ts            ← turnos abiertos del gestor
  lib/
    supabase.ts                     ← cliente Supabase
  types/
    index.ts                        ← tipos generales
    personal.ts                     ← tipos Personal (DocumentFile, VacationRequest, Formation, etc.)
    scheduler.ts                    ← tipos del scheduler
    hoursBalance.ts                 ← tipos de bolsa de horas
    shiftSwap.ts                    ← v4 NUEVO
public/
  manifest.json
  icon-192.png
  icon-512.png
  favicon.svg
```

### Patrón de uso del contexto con Supabase
- **Para leer estado:** usar `staff`, `locations`, `tasks`, etc. del `useApp()`
- **Para escribir empleados:** usar `saveEmployee(emp)` o `removeEmployee(id)` (NO `setStaff`)
- **Para escribir fichajes:** usar `addClockEntry(employeeId, entry)`
- **Para escribir locales:** usar `saveLocation(l)` o `removeLocation(id)`
- **Documentos:** llamar directamente a las funciones de `documentsService.ts`
- **Vacaciones:** `vacationsService.ts`
- **Formaciones:** `formationsService.ts`
- **Cambios de turno:** `shiftSwapService.ts`
- **Lo demás (tasks, incidents, etc.) sigue en localStorage** hasta que migremos cada módulo

### Claves de localStorage activas
- `andy-app-v4` → cache local de TODO el estado (incluso los datos que vienen de Supabase)
- `andy-app-mode-v1` → modo seleccionado (gestor/trabajador)
- `andy-empleado-session-v1` → id del empleado con sesión activa en modo trabajador
- `andy-delivery-v1` → registros de entregas (Zonas de Pedido)
- `andy-delivery-zones-v1` → configuración zonas/radios
- `andy-geo-cache` → caché geocodificación direcciones
- `andy-geodata-csv-date` → fecha último CSV cargado
- `andy-kiosko-config-v1` → config local del kiosko (local activo, geofencing, etc.)

### Reglas TypeScript estrictas
- `noUnusedLocals: true` → toda variable declarada se usa o se elimina (NO sirve `_` delante)
- `noUnusedParameters: true`
- `noImplicitAny: true`
- Cuando TypeScript se queja de "possibly null" en una variable que ya hemos comprobado, asignarla a una const local: `if (!supabase) return; const sb = supabase; sb.foo()`
- Para Records con union types, castear con `as TipoExacto` cuando se indexa con string genérico

### Importante sobre el deploy
- **NO usar `npm ci`** — usa `npm install --no-audit --no-fund`. El lock file no siempre está sincronizado.
- Los builds intermedios cuando subes varios archivos seguidos a menudo fallan; solo importa que el ÚLTIMO esté en verde.

### Patrón Storage de Supabase
- Bucket público con RLS abierta (policy `anon_all_employee_documents` permite ALL)
- Estructura de paths: `{bucket}/{employee_id}/{timestamp}-{filename}`
- URLs públicas con `getPublicUrl(filePath)`

---

## 7. Plan de fases — Módulo Personal

### Fase 1A — Kiosko de fichaje ✅ COMPLETA
- [x] Manifest PWA + iconos para "instalar como app"
- [x] Modo kiosko a pantalla completa
- [x] Login/PIN del empleado (4 dígitos)
- [x] Detección automática entrada/salida
- [x] Geofencing 200m del local asignado
- [x] Multi-local por empleado
- [x] Configuración del kiosko con prueba de GPS
- [x] **Sincronización Supabase con realtime**
- [ ] Foto al fichar (campo preparado, sin UI)

### Fase 1B — Modo trabajador en móvil personal ✅ COMPLETA
- [x] Selector de modo inicial gestor/trabajador
- [x] Login con PIN, sesión persistente
- [x] Home con menú de opciones
- [x] Fichar entrada/salida con geofencing
- [x] Mi horario semanal
- [x] Mis fichajes históricos
- [x] Mis documentos (subida y descarga)
- [x] Mis vacaciones (saldo, solicitar, historial)

### Fase 2 — Gestor: aprobaciones y gestión ✅ COMPLETA
- [x] Pestaña Documentos en ficha empleado (Supabase + Storage)
- [x] Pestaña Vacaciones en ficha empleado con saldo y aprobación
- [x] Página dedicada 📨 Solicitudes con tabs Pendientes/Aprobadas/Todas
- [x] Badge con conteo de pendientes en menú lateral
- [x] Alertas: antelación corta y mínimo de plantilla
- [x] Modal de aprobación con cálculo de plantilla restante
- [x] Realtime sync entre dispositivos
- [x] Cambio de marca a Foodint con paleta nueva

### Fase 3 — Operativa avanzada del encargado ✅ COMPLETA
- [x] Panel "Ahora mismo" en tiempo real
- [x] Bolsa de horas automática (saldo +/-)
- [x] Turnos abiertos publicables
- [x] Aprobaciones unificadas (vacaciones + cambios)
- [x] Calendario de Horarios con Plantilla de turnos

### v4 BATCH 1 — Mejoras de Personal ✅ COMPLETA
- [x] 📷 Foto del empleado con compresión JPEG 800x800
- [x] 🎯 Filtros estado/contrato + búsqueda + avatares
- [x] ⚠️ Banner alerta vencimiento contratos/periodo prueba (30/15/7d)
- [x] 🛡️ Periodo de prueba con autocompletar fechas
- [x] 🚪 Baja empleado: tipos, motivo, email gestoría, reactivar, borrar permanente

### v4 BATCH 2 — Funcionalidades grandes ✅ COMPLETA
- [x] 📊 Insights/Reportes con widgets, KPIs, distribuciones
- [x] 🎂 Fecha de nacimiento + widget cumpleaños del mes
- [x] 🎓 Formaciones/certificados con catálogo hostelería + alertas
- [x] 🔄 Cambios de turno entre empleados (3 modos, tablón, atribución horas)

### 🚨 Fase 4 — Sistema de Auth + Roles (CRÍTICA, PENDIENTE)
- [ ] FASE 1: Cimientos (Supabase Auth, Magic Link, user_profiles, login, diferenciación admin/worker)
- [ ] FASE 2: Personal protegido (RLS en employees/documents/vacations, UI con permisos)
- [ ] FASE 3: Resto módulos protegidos (RLS en schedules/swap/etc., filtrado por local del manager)
- [ ] FASE 4: UI gestión de roles (admin gestiona usuarios desde la app)
- [ ] FASE 5: Refinamiento UX
- **Documento completo:** `docs/PLAN_AUTH_ROLES.md`
- **Email de Magic Link:** decisión Resend o Supabase nativo (Supabase nativo es gratis)

### Fase 4 (vieja) — Notificaciones push (PARCIAL)
- [x] Notificaciones in-app (campana 🔔 con badge)
- [ ] Push real con Service Worker / VAPID / Edge Function — DECISIÓN: NO implementar
- [ ] Email automático cuando ocurren eventos (decisión: usar Resend, no llegamos a implementar). Replanteable cuando esté auth.

### Fase 5 — Migrar el resto de módulos a Supabase (PENDIENTE)
- [ ] Tasks, Incidents, Audits, Templates, etc.
- [ ] Zonas de Pedido (delivery_records, delivery_zones)

### v4 BATCH 3 — Mejoras avanzadas (PENDIENTE)
- [ ] 🐛 BUG conocido: Pestaña Disponibilidad UI desincronizada con scheduler tabla `employee_availability`
- [ ] 📊 Sanciones/Amonestaciones
- [ ] 📂 Importar empleados desde CSV
- [ ] 🔍 Audit log
- [ ] 👥 Roles intermedios (encargado de turno con permisos parciales)
- [ ] 📅 Calendario laboral (festivos por local)
- [ ] 📤 Export Excel/PDF del listado
- [ ] 🔍 Búsqueda avanzada combinada
- [ ] 📈 Histórico salarial
- [ ] 📋 Evaluaciones de desempeño
- [ ] 💬 Notas privadas del gestor
- [ ] 🆔 Multi-tenancy con RLS (cuando se decida vender a otros clientes)

---

## 8. Cómo trabajar con Claude (instrucciones para el próximo Claude)

1. **Lee este archivo completo antes de hacer nada.**
2. **Pregunta al usuario el estado** antes de empezar (ej: "¿En qué punto estamos?").
3. **No reinventes lo ya construido.** Si algo está en este documento como "funcional", se usa, no se rehace.
4. **Edición de archivos en GitHub:**
   - El usuario edita en la rama `source` desde la web de GitHub
   - Tu rol es generar el código completo del archivo y dárselo en `/mnt/user-data/outputs/`
   - El usuario hace: lápiz ✏️ → Ctrl+A → borra → pega contenido → commit a `source`
   - Para archivos nuevos: el usuario navega a la carpeta correcta → "Add file" → "Create new file" → escribe ruta + contenido → commit
5. **Cuando un build falle:** suele ser por TypeScript estricto. Eliminar variables no usadas, no marcarlas con `_`. Para narrowing de null en closures, asignar a const local. Para Records con union types, castear con `as TipoExacto`.
6. **Versionar los archivos** que generes con sufijo `_vN.tsx` para que sea fácil rastrear (opcional).
7. **Al terminar una sesión productiva:** ofrece actualizar este `CONTEXTO_CLAUDE.md` con los cambios.
8. **Para cualquier dato nuevo que necesite persistir entre dispositivos:** crear tabla en Supabase + funciones en service correspondiente + acción en `AppContext.tsx` o llamada directa. NO usar localStorage para datos compartidos.
9. **Aplicar siempre la paleta Foodint** en componentes nuevos: granate `#7C1A1A`, crema `#F5E9D9`. Verde solo para estados de éxito (jornada abierta, fichaje correcto). Rojo solo para errores y "salida".
10. **IMPORTANTE — RLS:** al crear cualquier tabla nueva en Supabase, ejecutar `ALTER TABLE x DISABLE ROW LEVEL SECURITY` siempre, o los INSERT/UPDATE devolverán 401.
11. **IMPORTANTE — pegado en GitHub:** al sustituir contenido de archivos existentes, asegurarse de Ctrl+A → SUPRIMIR → Ctrl+V. Si solo se hace Ctrl+V, a veces se duplica el contenido. Verificar que el archivo final tenga el número de líneas esperado.
12. **IMPORTANTE — pedir archivo actual antes de modificar tipos centrales:** cuando vayas a modificar `types/index.ts` o cualquier archivo que pueda haber cambiado en otra sesión, PIDE PRIMERO el archivo desde GitHub Raw para evitar machacar campos previos.

---

## 9. Patrones recurrentes en bugs

### "Build rojo: variable declarada pero no usada"
TypeScript estricto. Eliminar la línea. NO usar `_VARIABLE`.

### "Build rojo: no exists property X on type Employee"
Suele ser que un archivo de tipos previamente actualizado se ha sustituido por una versión antigua. Pedir el archivo actual de GitHub y aplicar cambios encima.

### "401 Unauthorized" al INSERT/UPDATE en Supabase
RLS activo. Ejecutar `ALTER TABLE x DISABLE ROW LEVEL SECURITY`. Verificar con:
```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'x';
```

### "Cannot find module './X'"
El archivo X no existe en la carpeta. Verificar que el usuario lo subió en la ruta correcta. GitHub crea carpetas automáticamente al usar `carpeta/archivo.tsx` en el campo de nombre.

### Mailto no abre Gmail
No usar `mailto:`. Usar URL Gmail Compose: `https://mail.google.com/mail/?view=cm&fs=1&to=X&su=Y&body=Z` con `window.open(url, '_blank')`.

---

## 10. Empleados de referencia

**Foodint Alcalá:**
- Natacha (T1, 43.5h, partido)
- Yohanny (T2, 40.25h, tarde/noche)
- Pamela (T3, 40.5h, mañana)

(El resto de empleados de los demás locales se gestionan igual desde la app.)

---

## 11. Bitácora de sesiones

### 2026-05-07 — Sesión inicial (Zonas de Pedido + Kiosko + Supabase)
- Construcción inicial Zonas de Pedido (5 pestañas, 17 versiones)
- Análisis de mercado para módulo Personal
- **Fase 1A — Kiosko completo:** PWA, geofencing, PIN, multi-local
- **Migración a Supabase:** cuenta, tablas, RLS, realtime
- **Fase 1B parcial:** modo trabajador con login, home, fichaje, horario, fichajes
- Decisión de seguir con documentos y vacaciones

### 2026-05-08 — Sesión Foodint (Documentos, Vacaciones, Branding)
- **Fase 1B documentos y vacaciones (trabajador):**
  - Tablas Supabase: documents, vacations, vacation_settings
  - Bucket Storage employee-documents (público, RLS abierto)
  - Servicios: documentsService, vacationsService
  - Pantallas: MisDocumentos, MisVacaciones con saldo prorrateado
- **Cambio de marca: "Andy App" → "Foodint"**
  - Procesado del logo (transparente)
  - Iconos PWA generados (192, 512)
  - Manifest, index.html, favicon
  - Componente Logo y LogoSquare reutilizables
  - Paleta granate aplicada a todas las pantallas
- **Fase 2 (gestor):**
  - DocumentosTab y VacacionesTab en ficha empleado
  - Página SolicitudesPendientesPage con tabs y aprobación
  - Badge en sidebar con conteo de pendientes
  - Alertas: antelación corta, mínimo de plantilla
  - Modal de aprobación con cálculo de plantilla restante
  - Política de RLS arreglada para Storage
- Probado y funcionando end-to-end

### 2026-05-09 — Sesión Fase 3 (Bolsa de horas, Notificaciones in-app, Cambios de turno backend)
- Notificaciones in-app con campana 🔔 (4 eventos: period_closed, vacation_*, schedule_published, shift_swap_request)
- Bolsa de horas automática
- Turnos abiertos del gestor (módulo previo a "Cambios de turno")
- Backend de cambios de turno (tabla, tipos, servicio CRUD)

### 2026-05-10 — Sesión maratoniana v4 (esta)
**BATCH 1 — Mejoras Personal:**
- Foto comprimida JPEG 800x800
- Filtros + avatares en listado
- Banner alertas contrato/periodo prueba (30/15/7d)
- Periodo de prueba con autocompletar
- Baja empleado con email gestoría (Gmail Compose URL)
- Reactivar empleado y borrar permanente

**BATCH 2 — 4 funcionalidades grandes:**
- 📊 InsightsPage con KPIs, widgets, distribuciones
- 🎂 Campo birthDate + widget cumpleaños
- 🎓 Formaciones con catálogo de 9 (5 obligatorias + 3 recomendadas + otra)
- 🔄 Cambios de turno COMPLETO end-to-end (sesión 1: backend, 2: UI trabajador, 3: UI gestor)

**Cambios de turno con atribución de horas:**
- Decisión Modelo A + flexibilidad
- 3 modalidades: cesión, intercambio, petición directa
- Tablón con cesiones + peticiones que recibo
- Mis solicitudes con historial
- Modal de aprobación gestor con selector + impacto visual
- Aplicación automática al schedule cuando aprueba

**Lecciones aprendidas:**
- RLS suele activarse por defecto en Supabase aunque se incluya DISABLE en el script
- Pedir SIEMPRE el archivo actual antes de modificar tipos centrales (index.ts, etc.)
- Pegado en GitHub: Ctrl+A → SUPRIMIR → Ctrl+V (no solo Ctrl+V que duplica)

**Documentación creada al cerrar:**
- `docs/README.md` (portada manual)
- `docs/MANUAL.md` (índice manual)
- `docs/gestor/01-personal.md` (manual gestor del módulo Personal, ~450 líneas)
- `docs/trabajador/01-app-trabajador.md` (manual completo del trabajador, ~500 líneas)
- `docs/capturas/README.md` (lista de capturas pendientes)
- `docs/PLAN_AUTH_ROLES.md` (plan completo del sistema de auth y roles)

**Decisión final de la sesión:**
- Cerrar sesión documentando todo
- Próxima sesión: limpiar datos de prueba + empezar FASE 1 de auth (Supabase Auth + Magic Link + roles admin/manager/worker)
- Hasta que esté FASE 1+2 lista, NO meter trabajadores reales en la app

**Pendiente al cerrar v5:**
- 🚨 PRIORITARIO: implementar sistema de Auth + Roles (ver `docs/PLAN_AUTH_ROLES.md`)
- 🧹 Limpiar datos de prueba antes de implementar auth
- 🐛 Bug Disponibilidad (UI vs scheduler) — diferido hasta tener auth
- 📨 Email automático eventos (decisión Resend, no implementado)
- BATCH 3 (sanciones, CSV, audit log, roles)
- Migración resto módulos Fase 5

---

**Última actualización:** 2026-05-10 (Sesión maratoniana v4 — BATCH 1, BATCH 2, Cambios de turno completo + decisión sistema Auth + docs/ con manuales)
