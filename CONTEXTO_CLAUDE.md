FOODINT — Contexto para Claude
> **Propósito:** este documento es el "salvavidas" del proyecto. Si una conversación con Claude se queda sin contexto, abre una nueva conversación, pega el contenido de este archivo y dile: *"Continúa el desarrollo de Foodint. Lee este contexto y dime el estado actual antes de proseguir."*
>
> **Cómo mantenerlo:** al final de cada sesión productiva, pídele a Claude: *"Actualiza el CONTEXTO_CLAUDE.md con lo que hemos hecho hoy."*
---
1. Identidad del proyecto
Foodint (antes "Andy App") — software de gestión de hostelería para 3 locales en Madrid.
Locales: Foodint Alcalá, Foodint Carabanchel, Foodint Pza Castilla
Empleados totales: ~20 entre los 3 locales
Stack: React + TypeScript + Vite + Tailwind CSS + Supabase (Postgres + Realtime + Storage)
Modo: PWA en GitHub Pages instalable como app
Logo: PNG con texto "Foodint" en granate, llama naranja sobre la "o"
Paleta de marca
Granate principal: `#7C1A1A`
Granate oscuro (hovers): `#5A1212`
Naranja/llama (acento): `#F39C2A`
Crema/humo (fondos suaves): `#F5E9D9`
Verde esmeralda: SOLO en estados semánticos de éxito (jornada abierta, fichaje correcto)
Rojo/naranja: SOLO en estados semánticos de salida o error
---
2. Infraestructura
Repositorio principal
GitHub: `github.com/Llorente29/llorente29-app`
Rama `source`: código fuente que editamos
Rama `main`: build compilado que sirve GitHub Pages
URL pública: `https://llorente29.github.io/llorente29-app/`
Flujo de despliegue
Editamos archivos en la rama `source` desde la web de GitHub
Al hacer commit en `source`, se dispara el workflow `deploy.yml`
El workflow compila con `npm install --no-audit --no-fund` (NO usar `npm ci`) y publica `/dist` en `main`
GitHub Pages sirve `main` automáticamente
Settings → Pages está como "Deploy from a branch → main / (root)"
Settings → Actions → Workflow permissions: Read and write
El `deploy.yml` está en `.github/workflows/deploy.yml` en la rama `source`
El workflow inyecta `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` desde Settings → Secrets
Tiempo de deploy: ~1-2 minutos
Webhook Last.app (otro repo)
GitHub: `github.com/Llorente29/lastapp-webhook`
Deploy: Vercel → `lastapp-webhook.vercel.app`
Variables (Vercel): `LASTAPP_TOKEN`, `GOOGLE_MAPS_KEY` = `AIzaSyBNDI7ONEHb0h9JyAyNboFIR0DoPYIADUY`
Endpoints:
`POST /api/webhook?days=N` → bills de Last.app paginando offset/limit=100
`POST /api/geodata` → Photon/Nominatim (fallback)
`POST /api/geocode` → Google Maps (rápido, requiere key)
`/api/debug` → debug temporal
Function timeout: 120s
Supabase
Project URL: `https://xzmpnchlguibclvxyynt.supabase.co`
Region: West EU (Ireland)
Plan: Free
Publishable key (frontend): `sb_publishable_PyzPVoi69TlRLWcfsEMPlA_pxMU8S9-`
Tablas creadas:
`locations`, `employees`, `clock_entries` (Personal y kiosko)
`documents` (documentos del empleado)
`vacations` (solicitudes de vacaciones/permisos)
`vacation_settings` (config global y por empleado)
`app_settings` (config global de fichajes y bolsa horas)
`open_shifts` (turnos abiertos publicables)
`open_shift_requests` (solicitudes de empleados para turnos)
Realtime: activado para todas las tablas
RLS: activado, policies `anon_all_*` permiten todo (refinar con auth real en futuro)
Storage: bucket `employee-documents` (público, RLS abierto: policy `anon_all_employee_documents` en `storage.objects`)
---
3. ⚠️ SEGURIDAD CRÍTICA — PENDIENTE
LASTAPP_TOKEN expuesto en el webhook con fallback hardcodeado:
`api/webhook.js:1` y `api/debug.js:1`
Token expuesto: `247ef137-6740-4c9c-bc1e-5e9a70fbad43`
ACCIONES PENDIENTES:
Rotar el token en Last.app
Actualizar env var `LASTAPP_TOKEN` en Vercel
Eliminar el fallback hardcodeado de `api/webhook.js` y `api/debug.js`
---
4. Estado de los módulos
Personal — FASES 1A, 1B, 2 y 3 COMPLETAS ✅
Modo Gestor (sidebar completa):
Sección "Personal":
👤 Personal: ficha empleado con 7 pestañas: Datos, Fichajes, Documentos (Supabase), Ausencias/Vacaciones (Supabase), Contrato, Disponibilidad, Bolsa horas (3 vistas reales)
🟢 Ahora mismo: panel tiempo real con 4 KPIs y agrupaciones por estado (trabajando, no fichó, olvidó salir, esperados, terminados, sin horario). Reloj autoactualizable cada minuto. Filtro por local.
⏰ Control Horario: fichajes históricos con GPS, KPIs
🕐 Kiosko Fichaje: modo pantalla completa
📨 Solicitudes pendientes: vacaciones con tabs Pendientes/Aprobadas/Todas, badge en menú con conteo
🪑 Turnos abiertos: publicación de turnos con candidatos múltiples y asignación con rechazo automático del resto
📅 Calendario: parcial (terminar)
📄 Informes Gestoría: descarga TXT mensual
Sección "Configuración":
🔔 Avisos: página real con toggle visibilidad bolsa horas, tolerancia redondeo, alertas (retraso, olvido salida)
Modo Kiosko (tablet del local):
Selección empleado → PIN → fichaje
Detección automática entrada/salida
Geofencing 200m con bloqueo (configurable)
Multi-local por empleado
Redondeo amistoso aplicado automáticamente: si fichas dentro de ±8 min del horario teórico, se computa como hora teórica (la hora real siempre se guarda en `realDatetime`)
Modo pantalla completa + manifest PWA + iconos para "instalar como app"
Banner de instalación con instrucciones específicas iOS/Android
Modo Trabajador (móvil personal):
Selector inicial "¿Quién eres?"
Login PIN, sesión persistente
Home con menú: Fichar / Mi horario / Turnos abiertos / Mis fichajes / Mi bolsa de horas (si setting activo) / Mis documentos / Mis vacaciones
Fichaje con geofencing 200m, selector de local si tiene varios, redondeo aplicado
Mi horario semanal con día actual destacado
Mis fichajes agrupados por día con horas trabajadas
Mi bolsa de horas (visible solo si gestor activó toggle): vistas Esta semana / Este mes / Acumulado
Mis documentos con subida (PDF/JPG/PNG/WEBP, 5 MB)
Mis vacaciones con saldo prorrateado, solicitud, historial, cancelar pendientes
Turnos abiertos con tabs Disponibles/Mis solicitudes, solicitud con notas opcionales, retirar pendientes
Sincronización Supabase realtime probada:
Fichaje en tablet → aparece al instante en gestor
Empleado solicita vacaciones → aparece al instante en panel del gestor
Gestor aprueba → trabajador ve el cambio al instante
Subida de documentos por trabajador → visible al instante en ficha del gestor
Gestor publica turno → aparece al instante en móvil del trabajador
Trabajador solicita turno → aparece al instante en panel del gestor
Gestor asigna → trabajador ve aceptación + rechazos al resto al instante
Foodint Brand — APLICADO ✅
Nombre: "Foodint" (antes "Andy App")
Subtítulo sidebar: "App del equipo"
Iconos PWA con logo Foodint (192x192, 512x512)
Favicon SVG con la "F" en granate
Manifest con tema granate
Componente `Logo` reutilizable (size sm/md/lg/xl, withBg true/false)
Componente `LogoSquare` para sidebar/avatares
Paleta granate aplicada en TODAS las pantallas (Login, Home, Fichaje, Mi horario, Mis fichajes, Mis documentos, Mis vacaciones, Mi bolsa, Mis turnos, Kiosko, ModeSelector, Sidebar gestor, Solicitudes, Turnos Abiertos, Ahora Mismo, Avisos)
Zonas de Pedido (FUNCIONAL — sin migrar a Supabase)
Subida CSV de Last.app
Geocodificación con Google Maps + cache localStorage
5 pestañas: Mapa, Barrios, Comparativa, Solape, Rentabilidad
Solape: distancia recorrido vs local dominante (factor urbano ×1.40)
Rentabilidad: Coste Rider vs Glovo 15%/30%
NO migrado a Supabase aún
Módulos en stub (PENDIENTES)
Programadas
Plantillas
Auditorías
Historial
Locales (página de gestión, los locales se crean en Supabase pero no hay UI de edición)
Módulos funcionales (en localStorage, sin migrar)
Dashboard, Tareas, Incidencias, Fichas Técnicas, Análisis de Ventas, Predicción Personal, Inventario
---
5. Decisiones técnicas/de negocio
IVAs
Pedido al cliente: IVA 10% → base = importe / 1.10
Envío al cliente: IVA 10% → base = €4.50 / 1.10 = €4.09 sin IVA
Coste Rider: ya viene sin IVA
Comisión Glovo: sobre base sin IVA
Tarifa Rider
0–3 km ruta: €5.75
3–5 km ruta: €5.95
+€0.50 por cada 500m a partir de 5 km
Comisiones Glovo
15% reparto propio
30% si Glovo gestiona reparto
Coordenadas locales
Foodint Alcalá: `40.4346, -3.6528` (C/Florencio Llorente 29)
Foodint Carabanchel: `40.3912, -3.7399` (C/Camichi 4)
Foodint Pza Castilla: `40.4698, -3.6928` (C/Cañaveral 75)
Decisiones del Kiosko
Identificación: selección de nombre + PIN de 4 dígitos
Tipos: solo entrada/salida (no pausa). Turno partido = 2 entradas y 2 salidas.
Detección automática del próximo tipo
Geofencing 200m configurable, bloqueo total fuera de zona
Foto al fichar: campo en BD pero desactivado
Decisiones del Modo Trabajador
Login con selección nombre + PIN
Geofencing bloqueo total
Modo trabajador puro (no ve menú gestor); para volver, "Salir"
Selector inicial en localStorage `andy-app-mode-v1`
Sesión empleado en `andy-empleado-session-v1`
Decisiones de Vacaciones
22 días vacaciones / año + 3 asuntos propios (configurable global)
Prorrateo automático si entró este año (2.5 días/mes vacaciones)
Tipos: vacaciones, asuntos propios, baja médica, permiso matrimonio (15d), fallecimiento, mudanza, otro
Aviso visual si solicita con menos de 30 días de antelación
Aviso al gestor si al aprobar quedaría menos de 2 empleados trabajando
Cómputo: año natural (1 enero - 31 diciembre)
Días contados: laborables (lunes-viernes)
Decisiones de Documentos
Tipos predefinidos: nómina, contrato, baja médica, certificado médico, formación, otro
Posibilidad de tipo personalizado
Subida desde gestor o trabajador (con badge identificativo)
Formatos: PDF, JPG, PNG, WEBP. Máximo 5 MB
Trabajador puede borrar SUS documentos. Gestor puede borrar todos.
Decisiones de Bolsa de Horas / Redondeo
Tolerancia redondeo: ±8 minutos (configurable)
Si fichaje cae dentro de tolerancia respecto al horario teórico → se computa como hora teórica (`datetime` campo en BD)
Hora real siempre se conserva en `real_datetime` para auditoría
Bolsa = horas trabajadas (pares cerrados) - horas teóricas según `weeklySchedule`
3 vistas: Esta semana (lunes-domingo), Este mes (1-último), Acumulado (desde alta)
Solo cuenta días pasados o el día actual hasta el momento (no anticipa días futuros)
Visibilidad para trabajador: configurable global (toggle en Avisos)
Saldo positivo = horas extra. Saldo negativo = horas pendientes.
Permite ajuste manual en ficha del empleado para casos especiales (festivos compensados, etc.)
Decisiones de Turnos Abiertos
Cualquier empleado activo puede solicitar coger un turno
El gestor confirma quién se queda con cada turno (no es primero llega primero sirve)
Al asignar a un candidato, el resto de solicitudes pendientes se rechazan automáticamente con mensaje "Asignado a otro empleado"
Estados turno: `abierto`, `asignado`, `cancelado`
Estados solicitud: `pendiente`, `aceptada`, `rechazada`, `retirada`
Empleado puede retirar su solicitud mientras esté pendiente
Realtime entre dispositivos
Decisiones de Alertas (Ahora mismo)
Alerta retraso: +15 min del horario teórico → "No fichó"
Alerta olvido salida: +30 min después del horario teórico de salida → "Olvidó salir"
Ambos configurables en Avisos
Por ahora son alertas visuales en la app (nivel 1). Push se hará en Fase 4.
---
6. Convenciones del código
Estructura de carpetas
```
src/
  pages/
    trabajador/                ← submódulo del modo trabajador
      LoginEmpleado.tsx
      HomeEmpleado.tsx
      FichajeEmpleado.tsx
      MiHorario.tsx
      MisFichajes.tsx
      MisDocumentos.tsx
      MisVacaciones.tsx
      MiBolsaHoras.tsx
      MisTurnos.tsx
      TrabajadorApp.tsx        ← orquestador del modo
    KioskoFichajePage.tsx
    SolicitudesPendientesPage.tsx
    AhoraMismoPage.tsx
    AvisosSettingsPage.tsx
    TurnosAbiertosPage.tsx
    StaffPage.tsx, etc.
  components/
    ui/                        ← Button, Card, Input, Select…
    personal/                  ← componentes del módulo Personal
      DocumentosTab.tsx
      VacacionesTab.tsx
      BolsaHorasView.tsx       ← reutilizable gestor + trabajador
    Logo.tsx                   ← logo Foodint (Logo + LogoSquare)
  context/
    AppContext.tsx             ← estado global con sync Supabase
  services/
    supabaseSync.ts            ← sync de empleados, locales, fichajes
    documentsService.ts        ← CRUD documentos + Storage
    vacationsService.ts        ← CRUD vacaciones + cálculos
    appSettingsService.ts      ← config global (toggle, tolerancia)
    horasComputo.ts            ← redondeo, horas trabajadas, bolsa, status
    openShiftsService.ts       ← CRUD turnos abiertos y solicitudes
    fichajeKiosko.ts           ← lógica de geofencing y PIN (+aplica redondeo)
    deliveryZones.ts
  lib/
    supabase.ts                ← cliente Supabase
  types/
    index.ts                   ← tipos generales (Page, Employee, etc.)
    personal.ts                ← tipos de Personal (DocumentFile, VacationRequest, etc.)
public/
  manifest.json
  icon-192.png, icon-512.png
  favicon.svg
```
Patrón de uso del contexto con Supabase
Para leer estado: `staff`, `locations`, `tasks` del `useApp()`
Para escribir empleados: `saveEmployee(emp)` o `removeEmployee(id)` (NO `setStaff`)
Para escribir fichajes: `addClockEntry(employeeId, entry)`
Para escribir locales: `saveLocation(l)` o `removeLocation(id)`
Documentos / Vacaciones / Settings / OpenShifts: llamar directamente a sus servicios
Lo demás (tasks, incidents) sigue en localStorage hasta que migremos cada módulo
Claves de localStorage
`andy-app-v4` → cache local de TODO el estado
`andy-app-mode-v1` → modo seleccionado (gestor/trabajador)
`andy-empleado-session-v1` → id empleado con sesión activa en modo trabajador
`andy-delivery-v1`, `andy-delivery-zones-v1`, `andy-geo-cache`, `andy-geodata-csv-date` → Zonas de Pedido
`andy-kiosko-config-v1` → config local del kiosko
Reglas TypeScript estrictas
`noUnusedLocals: true` → variables no usadas → eliminar (NO sirve `_` delante)
`noUnusedParameters: true`
`noImplicitAny: true`
Para narrowing de null en closures: const local `if (!supabase) return; const sb = supabase; sb.foo()`
Importante sobre el deploy
NO usar `npm ci` — usa `npm install --no-audit --no-fund`. El lock file no siempre está sincronizado.
Builds intermedios al subir varios archivos seguidos suelen fallar; solo importa que el ÚLTIMO esté en verde.
Nombres de archivo: los nombres con prefijos tipo `services_`, `trabajador_`, `personal_` son SOLO mi convención local de nombrado; en GitHub el archivo va con su nombre real (sin prefijo).
Patrón Storage de Supabase
Bucket público con RLS abierta (policy `anon_all_employee_documents`)
Estructura paths: `{bucket}/{employee_id}/{timestamp}-{filename}`
URLs públicas con `getPublicUrl(filePath)`
---
7. Plan de fases — Estado
Fase 1A — Kiosko de fichaje ✅ COMPLETA
[x] PWA + iconos
[x] Modo kiosko pantalla completa
[x] Login/PIN
[x] Detección automática entrada/salida
[x] Geofencing 200m
[x] Multi-local por empleado
[x] Configuración con prueba GPS
[x] Sincronización Supabase realtime
[ ] Foto al fichar (campo preparado, sin UI)
Fase 1B — Modo trabajador móvil ✅ COMPLETA
[x] Selector modo gestor/trabajador
[x] Login PIN, sesión persistente
[x] Home con menú
[x] Fichar con geofencing
[x] Mi horario semanal
[x] Mis fichajes históricos
[x] Mis documentos (subida y descarga)
[x] Mis vacaciones (saldo, solicitar, historial)
Fase 2 — Gestor: aprobaciones y gestión ✅ COMPLETA
[x] Pestaña Documentos en ficha empleado (Supabase + Storage)
[x] Pestaña Vacaciones con saldo y aprobación
[x] Página dedicada Solicitudes con tabs
[x] Badge con conteo pendientes en menú
[x] Alertas: antelación corta, mínimo plantilla
[x] Modal de aprobación con cálculo plantilla restante
[x] Realtime sync entre dispositivos
[x] Cambio de marca a Foodint con paleta nueva
Fase 3 — Operativa avanzada del encargado ✅ COMPLETA
[x] Panel "Ahora mismo" tiempo real (KPIs + agrupaciones)
[x] Redondeo amistoso de fichajes con tolerancia (±8 min default)
[x] Bolsa de horas (3 vistas: semana/mes/acumulado)
[x] Configuración global en página Avisos
[x] Visibilidad bolsa horas configurable para trabajador
[x] Turnos abiertos publicables
[x] Solicitudes con asignación + rechazo automático
[x] Realtime en todo
[ ] Calendario completo de horarios (T1/T2/T3, libra rotativa) — pendiente
Fase 4 — Notificaciones push (PENDIENTE)
[ ] Service worker
[ ] VAPID keys
[ ] Suscripciones por usuario
[ ] Triggers desde Supabase (Edge Functions)
[ ] Email automático para alertas críticas
Fase 5 — Migrar resto de módulos a Supabase (PENDIENTE)
[ ] Tasks, Incidents, Audits, Schedules, Templates
[ ] Zonas de Pedido (delivery_records, delivery_zones)
---
8. Cómo trabajar con Claude (instrucciones para el próximo Claude)
Lee este archivo completo antes de hacer nada.
Pregunta al usuario el estado antes de empezar.
No reinventes lo ya construido. Si algo está como "funcional", se usa.
Edición en GitHub: el usuario edita en rama `source` desde la web. Tu rol: generar código en `/mnt/user-data/outputs/`. El usuario hace lápiz ✏️ → Ctrl+A → pega → commit a `source`.
Cuando un build falle: suele ser TypeScript estricto (variables no usadas, narrowing null en closures). Eliminar variables no usadas, no marcar con `_`.
Versiona archivos con sufijo `_vN.tsx`.
Al terminar sesión: ofrece actualizar este `CONTEXTO_CLAUDE.md`.
Datos compartidos entre dispositivos: SIEMPRE Supabase (tabla + servicio + acción). NO localStorage.
Aplicar paleta Foodint en todo: granate `#7C1A1A`, crema `#F5E9D9`. Verde solo éxito. Rojo solo error/salida.
Cuidado con nombres de archivo: los prefijos `services_`, `trabajador_`, `personal_` que uso son solo MI convención. El usuario debe quitarlos al subir a GitHub.
---
9. Última versión del código clave (referencia en GitHub `source`)
Páginas
`src/pages/ZonasPedidoPage.tsx` — v17 (Coste Rider en lugar de Jelp)
`src/pages/KioskoFichajePage.tsx` — v4 (paleta Foodint)
`src/pages/SolicitudesPendientesPage.tsx`
`src/pages/AhoraMismoPage.tsx` — v2 (imports limpios)
`src/pages/AvisosSettingsPage.tsx`
`src/pages/TurnosAbiertosPage.tsx`
`src/pages/StaffPage.tsx` — v5 (con BolsaHorasView)
`src/pages/trabajador/*` — todos con paleta Foodint
`src/App.tsx` — v7 (con ahora_mismo, turnos_abiertos, modo trabajador, Foodint)
Componentes
`src/components/Logo.tsx` — Logo + LogoSquare
`src/components/personal/DocumentosTab.tsx`
`src/components/personal/VacacionesTab.tsx`
`src/components/personal/BolsaHorasView.tsx`
Servicios
`src/services/supabaseSync.ts` — v3 (logs realtime)
`src/services/documentsService.ts`
`src/services/vacationsService.ts`
`src/services/appSettingsService.ts`
`src/services/horasComputo.ts` — v2 (con bolsa horas)
`src/services/openShiftsService.ts`
`src/services/fichajeKiosko.ts` — v2 (con redondeo)
Tipos
`src/types/index.ts` — v5 (con `ahora_mismo`, `turnos_abiertos`)
`src/types/personal.ts`
Cliente
`src/lib/supabase.ts`
Public
`public/manifest.json` — Foodint
`public/icon-192.png`, `icon-512.png` — logo Foodint
`public/favicon.svg`
---
10. Bitácora de sesiones
2026-05-07 — Sesión inicial (Zonas de Pedido + Kiosko + Supabase)
Construcción inicial Zonas de Pedido (5 pestañas, 17 versiones)
Análisis de mercado para módulo Personal
Fase 1A — Kiosko completo: PWA, geofencing, PIN, multi-local
Migración a Supabase: cuenta, tablas, RLS, realtime
Fase 1B parcial: modo trabajador con login, home, fichaje, horario, fichajes
2026-05-08 — Sesión Foodint (Documentos, Vacaciones, Branding) + Fase 3
Mañana:
Fase 1B documentos y vacaciones (trabajador):
Tablas Supabase: documents, vacations, vacation_settings
Bucket Storage employee-documents (público, RLS abierto)
Servicios: documentsService, vacationsService
Pantallas: MisDocumentos, MisVacaciones con saldo prorrateado
Cambio de marca: "Andy App" → "Foodint"
Procesado del logo (transparente)
Iconos PWA generados (192, 512)
Manifest, index.html, favicon
Componente Logo y LogoSquare reutilizables
Paleta granate aplicada a todas las pantallas
Fase 2 (gestor):
DocumentosTab y VacacionesTab en ficha empleado
SolicitudesPendientesPage con tabs y aprobación
Badge en sidebar con conteo de pendientes
Alertas: antelación corta, mínimo de plantilla
Modal de aprobación con cálculo plantilla restante
Política de RLS arreglada para Storage
Tarde:
Fase 3 — Operativa avanzada (COMPLETA):
Entrega 1: Panel "Ahora mismo" + redondeo amistoso ±8 min
Tabla `app_settings`
Servicios `appSettingsService`, `horasComputo`
Página `AhoraMismoPage` con 4 KPIs y agrupaciones
Modificación `fichajeKiosko` para aplicar redondeo automático
Entrega 2: Bolsa de horas
Funciones cómputo en `horasComputo` (semanal/mensual/acumulado)
Componente reutilizable `BolsaHorasView`
Pantalla `MiBolsaHoras` para móvil trabajador
Pestaña "Bolsa horas" en ficha gestor con cálculo real + ajuste manual
Página `AvisosSettingsPage` con toggle visibilidad y configuración
Entrega 3: Turnos abiertos
Tablas `open_shifts`, `open_shift_requests`
Servicio `openShiftsService` con asignación + rechazo automático
Página `TurnosAbiertosPage` para gestor con candidatos expandibles
Pantalla `MisTurnos` para trabajador con tabs Disponibles/Mis solicitudes
Realtime entre dispositivos
Probado y funcionando end-to-end:
Trabajador solicita vacaciones → gestor las ve al instante → aprueba → trabajador ve aprobación al instante
Trabajador sube documento → gestor lo ve al instante en ficha
Gestor sube nómina → trabajador la ve al instante
Panel Ahora Mismo detecta retrasos correctamente (con horario teórico vs hora actual)
Bolsa de horas calcula contratos vs trabajado y muestra balance +/-
Toggle visibilidad bolsa para trabajador funciona
Configuración de tolerancia se guarda y aplica
Gestor publica turno → empleado lo ve al instante → solicita → gestor ve candidato → asigna → empleado ve aceptación + el resto rechazo
---
Última actualización: 2026-05-08 (Fase 3 COMPLETA — Ahora mismo, Bolsa horas, Turnos abiertos)
