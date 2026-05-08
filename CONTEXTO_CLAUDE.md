FOODINT — Contexto para Claude
> **Propósito:** este documento es el "salvavidas" del proyecto. Si una conversación con Claude se queda sin contexto, abre una nueva conversación, pega el contenido de este archivo y dile: *"Continúa el desarrollo de Foodint. Lee este contexto y dime el estado actual antes de proseguir."*
---
1. Identidad del proyecto
Foodint (antes "Andy App") — software de gestión de hostelería para 3 locales en Madrid.
Locales: Foodint Alcalá, Foodint Carabanchel, Foodint Pza Castilla
Empleados totales: ~20 entre los 3 locales
Stack: React + TypeScript + Vite + Tailwind CSS + Supabase (Postgres + Realtime + Storage)
Modo: PWA en GitHub Pages instalable como app
Paleta de marca
Granate principal: `#7C1A1A`
Granate oscuro: `#5A1212`
Naranja/llama: `#F39C2A`
Crema/humo: `#F5E9D9`
Verde solo en éxito; rojo solo en error/salida
---
2. Infraestructura
GitHub: `github.com/Llorente29/llorente29-app` (rama `source` editamos, `main` deploy)
URL: `https://llorente29.github.io/llorente29-app/`
Workflow: `npm install --no-audit --no-fund` (NO `npm ci`). Inyecta secretos VITE_*.
Webhook Last.app: `github.com/Llorente29/lastapp-webhook` → Vercel
Supabase: `https://xzmpnchlguibclvxyynt.supabase.co` (West EU, Free)
Publishable key: `sb_publishable_PyzPVoi69TlRLWcfsEMPlA_pxMU8S9-`
Tablas Supabase
`locations`, `employees`, `clock_entries`
`documents`, `vacations`, `vacation_settings`
`app_settings`
`open_shifts`, `open_shift_requests`
`shift_types` (T1/T2/T3/T1+T3/LIBRE)
`weekly_plans` (cabecera plan semanal)
`shift_assignments` (celdas calendario)
`shift_minimums` (mínimos plantilla)
Bucket Storage: `employee-documents` (público, policy abierta)
RLS abierto, realtime activo
---
3. ⚠️ SEGURIDAD CRÍTICA — PENDIENTE
LASTAPP_TOKEN expuesto hardcodeado en webhook Vercel:
`api/webhook.js:1` y `api/debug.js:1`
Token: `247ef137-6740-4c9c-bc1e-5e9a70fbad43`
Acciones: rotar token Last.app, actualizar Vercel env, eliminar fallback.
---
4. ⚠️ DECISIÓN CLAVE: MODELO A
El calendario publicado es la única fuente de verdad para el horario teórico:
"Ahora mismo" usa calendarCtx
Bolsa de horas usa calendarCtx
Mi horario solo muestra calendario publicado (sin fallback a weeklySchedule)
Redondeo solo si hay calendario publicado
`weeklySchedule` queda como plantilla informativa para auto-generar
---
5. Estado de los módulos
Personal — COMPLETO ✅
Gestor:
👤 Personal (ficha empleado con 7 pestañas, Bolsa horas Modelo A)
🟢 Ahora mismo (KPIs, Modelo A)
⏰ Control Horario
🕐 Kiosko Fichaje
📨 Solicitudes pendientes (badge con conteo)
🪑 Turnos abiertos (rechazo automático del resto al asignar)
📅 Calendario (completo)
📄 Informes Gestoría
🔔 Avisos (toggle bolsa, tolerancia, alertas, mínimos plantilla)
Kiosko: PIN, geofencing 200m, multi-local, redondeo Modelo A, PWA.
Trabajador: Login PIN, sesión persistente. Menú: Fichar / Mi horario / Turnos abiertos / Mis fichajes / Mi bolsa / Mis docs / Mis vacaciones.
Calendario — COMPLETO ✅
Tipos turno Foodint:
T1 Mañana 12:30-16:45 (4.25h)
T2 Tarde 14:45-00:15 (9.5h)
T3 Noche 16:45-00:15 (7.5h)
T1+T3 Partido 12:30-16:45+19:45-00:15 (8.75h)
LIBRE
Mínimos plantilla:
T1: default 1
T2/T3: default 2, V/S/D 3
T1+T3: default 1
Configurables por local en Avisos
Funciones:
Vista semanal tabla + vista por empleado (toggle)
Auto-gen con 3 modos: solo huecos vacíos / solo libras / reasignar todo
Período auto-gen: 1 / 4 / 8 semanas
Auto-gen respeta weeklySchedule como plantilla
NO asigna LIBRE automáticamente en V/S/D
Validaciones convenio en tiempo real:
Errores: <12h descanso, >10.5h diarias, mínimo a 0
Warnings: >40h semana, >6 días seguidos, sin libra, libra V/S/D, cobertura insuf
Filas cobertura (X/Y) con colores
Botones: Duplicar semana anterior, Limpiar semana
Estado borrador/publicado, botón Publicar
Realtime entre dispositivos
Foodint Brand ✅
Logo, iconos PWA, manifest, favicon
Componente Logo/LogoSquare reutilizable
Paleta granate en TODAS las pantallas
Zonas de Pedido (FUNCIONAL — sin migrar a Supabase)
5 pestañas: Mapa, Barrios, Comparativa, Solape, Rentabilidad
Coste Rider vs Glovo 15%/30%
Pendientes
Programadas, Plantillas, Auditorías, Historial, Locales (UI gestión): stubs
Tasks, Incidents, Audits, Schedules, Templates, Inventory: localStorage (sin migrar)
---
6. Decisiones técnicas/de negocio
IVAs
Pedido al cliente: IVA 10%
Envío: €4.50/1.10 = €4.09 sin IVA
Coste Rider: ya sin IVA
Glovo: sobre base sin IVA
Tarifa Rider
0–3 km: €5.75 / 3–5 km: €5.95 / +€0.50/500m extra
Comisiones Glovo
15% reparto propio / 30% Glovo
Coordenadas locales
Alcalá: 40.4346, -3.6528
Carabanchel: 40.3912, -3.7399
Pza Castilla: 40.4698, -3.6928
Vacaciones
22 días + 3 asuntos propios; prorrateo 2.5/mes
Aviso si <30 días antelación
Aviso si quedaría <2 trabajadores
Año natural
Bolsa horas / Redondeo (MODELO A)
Tolerancia ±8 min (configurable)
Solo si hay calendario publicado
`real_datetime` siempre se guarda
Bolsa = trabajadas - calendario publicado
3 vistas: Esta semana / Este mes / Acumulado
Si no hay plan publicado, NO penaliza
Toggle visibilidad para trabajador
Calendario / Libra
Libra hostelería: 1 día completo + media mañana o media tarde, a ser posible seguidos
Día de libra FIJO por defecto (siempre el mismo)
Cambios manuales puntuales
NUNCA librar V/S/D salvo excepción manual (alta demanda)
⚠️ PENDIENTE: modelo formal de "1.5 días libres" (no implementado aún — el usuario y Claude estaban discutiéndolo al cierre)
Alertas Ahora mismo
Retraso: +15 min de horario teórico
Olvido salida: +30 min después de salida teórica
Configurables. Push: Fase 4.
---
7. Convenciones código
Estructura
```
src/
  pages/
    trabajador/                ← LoginEmpleado, HomeEmpleado, FichajeEmpleado,
                                 MiHorario v5 (Modelo A), MisFichajes,
                                 MisDocumentos, MisVacaciones, MiBolsaHoras,
                                 MisTurnos, TrabajadorApp v3
    KioskoFichajePage v4
    SolicitudesPendientesPage
    AhoraMismoPage v3 (Modelo A)
    AvisosSettingsPage v3 (con MinimumsSection)
    TurnosAbiertosPage
    CalendarioPage v5 (auto-gen mensual)
    StaffPage v5
  components/
    ui/
    personal/
      DocumentosTab, VacacionesTab
      BolsaHorasView v2 (Modelo A)
    Logo
  context/
    AppContext
  services/
    supabaseSync v3
    documentsService, vacationsService, appSettingsService
    horasComputo v3 (CalendarContext)
    openShiftsService
    fichajeKiosko v3 (calendarCtx)
    calendarService v4 (fetchPublishedAssignmentsForRange)
    calendarValidations
    calendarAutoGen v2 (no LIBRE en V/S/D)
    deliveryZones
  lib/supabase
  types/ index v5, personal
```
Patrones
Leer: `useApp()` → staff, locations, tasks
Escribir empleados: `saveEmployee` / `removeEmployee`
Fichajes: `addClockEntry`
Locales: `saveLocation` / `removeLocation`
Documentos/Vacaciones/Settings/OpenShifts/Calendar: llamar servicios
Tasks/Incidents: localStorage (pendiente migrar)
LocalStorage keys
`andy-app-v4` — cache estado completo
`andy-app-mode-v1` — gestor/trabajador
`andy-empleado-session-v1` — sesión empleado
`andy-delivery-*`, `andy-geo-*` — Zonas de Pedido
`andy-kiosko-config-v1` — config kiosko
TS estricto
`noUnusedLocals: true` → eliminar variables no usadas (NO `_`)
`noUnusedParameters: true`
`noImplicitAny: true`
Narrowing null en closures: `if (!supabase) return; const sb = supabase`
Deploy
NO `npm ci`. Usar `npm install --no-audit --no-fund`
Builds intermedios pueden fallar; solo importa el ÚLTIMO en verde
Nombres archivo: prefijos `services_`, `trabajador_`, `personal_` son SOLO mi convención local
Bug timezone (RESUELTO)
NUNCA `toISOString()` para YYYY-MM-DD de fecha local (España UTC+1/+2)
Construir manual:
```javascript
const y = d.getFullYear()
const m = String(d.getMonth() + 1).padStart(2, '0')
const dd = String(d.getDate()).padStart(2, '0')
const iso = `${y}-${m}-${dd}`
```
---
8. Plan de fases — Estado
Fase 1A — Kiosko ✅ (foto al fichar pendiente UI)
Fase 1B — Modo trabajador móvil ✅
Fase 2 — Gestor: aprobaciones ✅
Fase 3 — Operativa avanzada ✅
Ahora mismo, Bolsa horas, Turnos abiertos, Avisos config
Fase 3 PARTE 2 — Calendario ✅
Entrega 1: Modelo BD + vistas
Entrega 2: Validaciones + mínimos + por empleado + duplicar
Entrega 3A: Auto-gen 3 modos
Entrega 3C: Modelo A puro
Entrega 3D: Auto-gen mensual (1/4/8 semanas)
Entrega 3B PENDIENTE: Cambios de turno entre empleados (tabla `shift_swaps`)
Fase 4 — Notificaciones push (PENDIENTE)
Fase 5 — Migrar resto módulos a Supabase (PENDIENTE)
---
9. Cómo trabajar con Claude
Lee este archivo completo antes de hacer nada.
Pregunta al usuario el estado antes de empezar.
No reinventes lo construido.
Edición: usuario edita en GitHub web rama `source`. Claude genera en `/mnt/user-data/outputs/`.
Build falla: suele ser TS estricto. Eliminar variables, NO `_` delante.
Versiona: `_vN.tsx`.
Al terminar sesión: ofrece actualizar `CONTEXTO_CLAUDE.md`.
Datos compartidos: Supabase, NO localStorage.
Paleta Foodint: granate `#7C1A1A`, crema `#F5E9D9`. Verde solo éxito. Rojo solo error.
Nombres archivo: prefijos `services_/trabajador_/personal_` son solo mi convención. Usuario los quita al subir.
MODELO A: calendario publicado = verdad. weeklySchedule = plantilla informativa.
Bug timezone: nunca `toISOString()` para YYYY-MM-DD de fecha local.
---
10. Versión actual del código clave
Páginas
`src/pages/CalendarioPage.tsx` — v5 (auto-gen mensual)
`src/pages/AhoraMismoPage.tsx` — v3 (Modelo A)
`src/pages/AvisosSettingsPage.tsx` — v3 (MinimumsSection)
`src/pages/StaffPage.tsx` — v5
`src/pages/trabajador/MiHorario.tsx` — v5 (Modelo A)
`src/pages/trabajador/TrabajadorApp.tsx` — v4
`src/pages/trabajador/HomeEmpleado.tsx` — v5
`src/App.tsx` — v7
Componentes
`src/components/personal/BolsaHorasView.tsx` — v2 (Modelo A)
`src/components/Logo.tsx`
Servicios
`src/services/horasComputo.ts` — v3 (CalendarContext)
`src/services/calendarService.ts` — v4 (fetchPublishedAssignmentsForRange)
`src/services/calendarAutoGen.ts` — v2 (no LIBRE en V/S/D)
`src/services/calendarValidations.ts`
`src/services/fichajeKiosko.ts` — v3 (calendarCtx)
`src/services/openShiftsService.ts`
`src/services/appSettingsService.ts`
`src/services/documentsService.ts`
`src/services/vacationsService.ts`
`src/services/supabaseSync.ts` — v3
Tipos
`src/types/index.ts` — v5
`src/types/personal.ts`
---
11. Bitácora
2026-05-07 — Sesión inicial
Zonas de Pedido, Análisis Personal, Fase 1A, migración Supabase, Fase 1B parcial.
2026-05-08 mañana — Fase 1B + 2 + Branding
Documentos, vacaciones, branding Foodint, Fase 2 aprobaciones, RLS Storage.
2026-05-08 tarde — Fase 3 + Calendario
Fase 3 completa (Ahora mismo, Bolsa, Turnos abiertos)
Calendario completo:
Entrega 1: SQL + vistas + bug timezone resuelto
Entrega 2: validaciones + cobertura + duplicar/limpiar + por empleado + mínimos
Entrega 3A: auto-gen 3 modos
Decisión: Modelo A
Entrega 3C: refactor a Modelo A puro (horasComputo, AhoraMismoPage, BolsaHorasView, MiHorario, fichajeKiosko)
Entrega 3D: auto-gen mensual
Regla: no LIBRE auto en V/S/D
Estado al CIERRE
Usuario sigue viendo LIBRE en S/D del calendario después de regenerar
Explicación probable: asignaciones LIBRE persisten en BD desde generaciones anteriores al cambio de regla, hay que limpiar manualmente
Pendiente confirmar con captura del usuario tras "Limpiar semana + Generar de nuevo"
Pendiente decisión sobre cómo modelar formalmente "1.5 días libres seguidos":
Opción simple: marcar día completo + día con media libra, sin asignar turno reducido (gestor lo pone a mano)
Opción completa: añadir tipos T1-MEDIA y T3-MEDIA al sistema
Recomendación de Claude: opción simple
Pendiente Entrega 3B: cambios de turno entre empleados (tabla `shift_swaps`)
---
Última actualización: 2026-05-08 (tarde) — Calendario Modelo A + auto-gen mensual + regla V/S/D
