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
Verde esmeralda: SOLO se mantiene en estados semánticos de éxito (jornada abierta, fichaje correcto)
Rojo/naranja: SOLO se mantiene en estados semánticos de salida o error
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
Settings → Pages está configurado como "Deploy from a branch → main / (root)"
Settings → Actions → Workflow permissions: Read and write
El `deploy.yml` está en `.github/workflows/deploy.yml` en la rama `source`
Tiempo de deploy: ~1-2 minutos
El workflow inyecta `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` desde Settings → Secrets
Webhook Last.app (otro repo)
GitHub: `github.com/Llorente29/lastapp-webhook`
Deploy: Vercel → `lastapp-webhook.vercel.app`
Variables de entorno (Vercel):
`LASTAPP_TOKEN` (rotar — ver sección de seguridad)
`GOOGLE_MAPS_KEY` = `AIzaSyBNDI7ONEHb0h9JyAyNboFIR0DoPYIADUY`
Endpoints:
`POST /api/webhook?days=N` → descarga bills de Last.app paginando offset/limit=100
`POST /api/geodata` → geocodifica con Photon/Nominatim (fallback)
`POST /api/geocode` → geocodifica con Google Maps (rápido, requiere key)
`/api/debug` → debug temporal
Function timeout: 120s
Supabase
Project URL: `https://xzmpnchlguibclvxyynt.supabase.co`
Region: West EU (Ireland)
Plan: Free
Publishable key (segura para frontend): `sb_publishable_PyzPVoi69TlRLWcfsEMPlA_pxMU8S9-`
Tablas creadas:
`locations`, `employees`, `clock_entries` (Personal y kiosko)
`documents` (documentos del empleado)
`vacations` (solicitudes de vacaciones/permisos)
`vacation_settings` (config global y por empleado)
Realtime: activado para las 6 tablas
RLS: activado, policy `anon_all_*` que permite todo (a refinar en sub-fases siguientes con autenticación)
Storage: bucket `employee-documents` (público, con RLS abierto: policy `anon_all_employee_documents` en `storage.objects`)
---
3. ⚠️ SEGURIDAD CRÍTICA — PENDIENTE
LASTAPP_TOKEN expuesto en el código del webhook con fallback hardcodeado:
`api/webhook.js:1` y `api/debug.js:1`
Token expuesto: `247ef137-6740-4c9c-bc1e-5e9a70fbad43`
ACCIONES PENDIENTES:
Rotar el token en Last.app
Actualizar la env var `LASTAPP_TOKEN` en Vercel con el nuevo
Eliminar el fallback hardcodeado de `api/webhook.js` y `api/debug.js`
---
4. Estado de los módulos
Personal — FASES 1A + 1B + 2 (gestor) COMPLETAS ✅
Modo Gestor (la app completa de siempre):
Lista empleados con búsqueda y filtro por local
Ficha empleado con 7 pestañas: Datos, Fichajes, Documentos (Supabase), Ausencias/Vacaciones (Supabase), Contrato, Disponibilidad, Bolsa horas
Control Horario con fichajes, GPS, KPIs en tiempo real
Calendario de Horarios (parcial — terminar la pieza de generación de turnos)
Informes Gestoría con descarga TXT mensual
📨 Solicitudes — panel de aprobaciones con tabs Pendientes/Aprobadas/Todas, badge en menú con conteo, alertas de antelación corta y mínimo de plantilla, modal de aprobación con aviso si quedan menos de 2 personas
Modo Kiosko (tablet del local):
Selección empleado → PIN → fichaje
Detección automática de entrada/salida según último fichaje
Geofencing 200m con bloqueo (configurable)
Multi-local por empleado
Modo pantalla completa + manifest PWA + iconos para "instalar como app"
Banner de instalación con instrucciones específicas iOS/Android
Modo Trabajador (móvil personal del empleado):
Selector inicial "¿Quién eres?" con persistencia en localStorage
Login con selección de nombre + PIN
Sesión persistente (no pide PIN en cada apertura)
Home con menú: Fichar / Mi horario / Mis fichajes / Mis documentos / Mis vacaciones
Fichaje con geofencing 200m, selector de local si tiene varios
Mi horario semanal con día actual destacado y total horas
Mis fichajes agrupados por día con horas trabajadas calculadas
Mis documentos con subida (PDF/JPG/PNG/WEBP, 5 MB máx) y visualización
Mis vacaciones con saldo prorrateado, solicitud, ver historial, cancelar pendientes
Aviso visual si pides con menos de 30 días de antelación
Sincronización Supabase realtime:
Fichaje en tablet → aparece al instante en gestor
Empleado solicita vacaciones → aparece al instante en panel del gestor
Gestor aprueba → trabajador ve el cambio al instante
Subida de documentos por trabajador → visible al instante en ficha del gestor
Foodint Brand — APLICADO ✅
Nombre cambiado de "Andy App" a "Foodint"
Subtítulo: "App del equipo"
Iconos PWA con logo de Foodint (192x192, 512x512)
Favicon SVG con la "F" en granate
Manifest actualizado con tema granate
Componente `Logo` reutilizable (size sm/md/lg/xl, withBg true/false)
Componente `LogoSquare` para sidebar/avatares
Paleta granate aplicada en TODAS las pantallas (Login, Home, Fichaje, Mi horario, Mis fichajes, Mis documentos, Mis vacaciones, Kiosko, ModeSelector, Sidebar gestor)
Zonas de Pedido (FUNCIONAL — sin migrar a Supabase)
Tiene:
Subida CSV de Last.app (separador `,`)
Geocodificación direcciones con Google Maps API + cache localStorage
5 pestañas: Mapa, Barrios, Comparativa, Solape, Rentabilidad
Solape: análisis distancia recorrido vs local dominante (factor urbano ×1.40)
Rentabilidad: comparativa Coste Rider vs Glovo 15% (reparto propio) y 30% (Glovo repartidor)
NO migrado a Supabase aún — sigue en localStorage. Datos por dispositivo.
Módulos en stub (PENDIENTES)
Programadas
Plantillas
Auditorías
Historial
Locales (página de gestión, los locales se crean en Supabase pero no hay UI para editarlos)
Módulos funcionales (en localStorage, no migrados aún)
Dashboard, Tareas, Incidencias, Fichas Técnicas, Análisis de Ventas, Predicción Personal, Inventario
---
5. Decisiones técnicas/de negocio importantes
IVAs (todo se trabaja sin IVA en cálculos)
Importe pedido al cliente: IVA 10% (alimentación) → base = importe / 1.10
Envío cobrado al cliente: IVA 10% → base = €4.50 / 1.10 = €4.09 sin IVA
Coste Rider (proveedor): ya viene sin IVA en factura
Comisión Glovo: aplicada sobre base imponible sin IVA
Tarifa Rider actual
0–3 km ruta (≈2 km recta): €5.75
3–5 km ruta (≈3.5 km recta): €5.95
+€0.50 por cada 500m a partir de 5 km
Comisiones Glovo
15% si reparto propio
30% si Glovo gestiona también el reparto
Coordenadas locales (fijas en código y BD)
Foodint Alcalá: `40.4346, -3.6528` (C/Florencio Llorente 29)
Foodint Carabanchel: `40.3912, -3.7399` (C/Camichi 4)
Foodint Pza Castilla: `40.4698, -3.6928` (C/Cañaveral 75)
Decisiones del Kiosko
Identificación: selección de nombre + PIN de 4 dígitos
Tipos de fichaje: solo entrada/salida (no pausa). En turno partido se hacen 2 entradas y 2 salidas.
Detección automática del próximo tipo (Opción A): si hay jornada abierta, ofrece SALIDA; si no, ENTRADA
Geofencing: 200m configurable, bloqueo total fuera de zona
Foto al fichar: campo en BD pero desactivado por defecto (futura activación)
Decisiones del Modo Trabajador
Login con selección nombre + PIN (mismo PIN que kiosko)
Geofencing: bloqueo total
Foto: preparada pero desactivada
Modo trabajador puro (no ve menú gestor); para volver al gestor hay que hacer "Salir"
Selector inicial guardado en localStorage `andy-app-mode-v1`
Sesión empleado guardada en `andy-empleado-session-v1`
Decisiones de Vacaciones
Saldo: 22 días vacaciones / año + 3 días asuntos propios (configurables globalmente)
Prorrateo automático si el empleado entró este año (2.5 días/mes vacaciones)
Tipos: vacaciones, asuntos propios, baja médica, permiso matrimonio (15d), fallecimiento, mudanza, otro
Aviso visual si solicita con menos de 30 días de antelación (configurable)
Aviso al gestor si al aprobar quedaría menos de 2 empleados trabajando en el local ese día (configurable)
Cómputo: año natural (1 enero - 31 diciembre)
Días contados: laborables (lunes-viernes)
Decisiones de Documentos
Tipos predefinidos: nómina, contrato, baja médica, certificado médico, formación, otro
Posibilidad de añadir tipo personalizado (campo "custom")
Subida desde gestor o trabajador (con badge identificativo)
Formatos: PDF, JPG, PNG, WEBP. Máximo 5 MB
Trabajador puede borrar SUS documentos. Gestor puede borrar todos.
---
6. Convenciones del código
Estructura de carpetas
```
src/
  pages/                     ← una página por ruta
    trabajador/              ← submódulo del modo trabajador
      LoginEmpleado.tsx
      HomeEmpleado.tsx
      FichajeEmpleado.tsx
      MiHorario.tsx
      MisFichajes.tsx
      MisDocumentos.tsx
      MisVacaciones.tsx
      TrabajadorApp.tsx      ← orquestador del modo
    KioskoFichajePage.tsx
    SolicitudesPendientesPage.tsx
    StaffPage.tsx, etc.
  components/
    ui/                      ← Button, Card, Input, Select…
    personal/                ← componentes del módulo Personal
      DocumentosTab.tsx
      VacacionesTab.tsx
    Logo.tsx                 ← logo Foodint (Logo + LogoSquare)
  context/
    AppContext.tsx           ← estado global con sync Supabase
  services/
    supabaseSync.ts          ← sync de empleados, locales, fichajes
    documentsService.ts      ← CRUD documentos + Storage
    vacationsService.ts      ← CRUD vacaciones + cálculos
    fichajeKiosko.ts         ← lógica de geofencing y PIN
    deliveryZones.ts
  lib/
    supabase.ts              ← cliente Supabase
  types/
    index.ts                 ← tipos generales
    personal.ts              ← tipos de Personal (DocumentFile, VacationRequest, etc.)
public/
  manifest.json
  icon-192.png
  icon-512.png
  favicon.svg
```
Patrón de uso del contexto con Supabase
Para leer estado: usar `staff`, `locations`, `tasks`, etc. del `useApp()`
Para escribir empleados: usar `saveEmployee(emp)` o `removeEmployee(id)` (NO `setStaff`)
Para escribir fichajes: usar `addClockEntry(employeeId, entry)`
Para escribir locales: usar `saveLocation(l)` o `removeLocation(id)`
Documentos: llamar directamente a las funciones de `documentsService.ts`
Vacaciones: llamar directamente a las funciones de `vacationsService.ts`
Lo demás (tasks, incidents, etc.) sigue en localStorage hasta que migremos cada módulo
Claves de localStorage activas
`andy-app-v4` → cache local de TODO el estado (incluso los datos que vienen de Supabase)
`andy-app-mode-v1` → modo seleccionado (gestor/trabajador)
`andy-empleado-session-v1` → id del empleado con sesión activa en modo trabajador
`andy-delivery-v1` → registros de entregas (Zonas de Pedido)
`andy-delivery-zones-v1` → configuración zonas/radios
`andy-geo-cache` → caché geocodificación direcciones
`andy-geodata-csv-date` → fecha último CSV cargado
`andy-kiosko-config-v1` → config local del kiosko (local activo, geofencing, etc.)
Reglas TypeScript estrictas
`noUnusedLocals: true` → toda variable declarada se usa o se elimina (NO sirve `_` delante)
`noUnusedParameters: true`
`noImplicitAny: true`
Cuando TypeScript se queja de "possibly null" en una variable que ya hemos comprobado, asignarla a una const local: `if (!supabase) return; const sb = supabase; sb.foo()`
Importante sobre el deploy
NO usar `npm ci` — usa `npm install --no-audit --no-fund`. El lock file no siempre está sincronizado.
Los builds intermedios cuando subes varios archivos seguidos a menudo fallan; solo importa que el ÚLTIMO esté en verde.
Patrón Storage de Supabase
Bucket público con RLS abierta (policy `anon_all_employee_documents` permite ALL)
Estructura de paths: `{bucket}/{employee_id}/{timestamp}-{filename}`
URLs públicas con `getPublicUrl(filePath)`
---
7. Plan de fases — Módulo Personal
Fase 1A — Kiosko de fichaje ✅ COMPLETA
[x] Manifest PWA + iconos para "instalar como app"
[x] Modo kiosko a pantalla completa
[x] Login/PIN del empleado (4 dígitos)
[x] Detección automática entrada/salida
[x] Geofencing 200m del local asignado
[x] Multi-local por empleado
[x] Configuración del kiosko con prueba de GPS
[x] Sincronización Supabase con realtime
[ ] Foto al fichar (campo preparado, sin UI)
Fase 1B — Modo trabajador en móvil personal ✅ COMPLETA
[x] Selector de modo inicial gestor/trabajador
[x] Login con PIN, sesión persistente
[x] Home con menú de opciones
[x] Fichar entrada/salida con geofencing
[x] Mi horario semanal
[x] Mis fichajes históricos
[x] Mis documentos (subida y descarga)
[x] Mis vacaciones (saldo, solicitar, historial)
Fase 2 — Gestor: aprobaciones y gestión ✅ COMPLETA
[x] Pestaña Documentos en ficha empleado (Supabase + Storage)
[x] Pestaña Vacaciones en ficha empleado con saldo y aprobación
[x] Página dedicada 📨 Solicitudes con tabs Pendientes/Aprobadas/Todas
[x] Badge con conteo de pendientes en menú lateral
[x] Alertas: antelación corta y mínimo de plantilla
[x] Modal de aprobación con cálculo de plantilla restante
[x] Realtime sync entre dispositivos
[x] Cambio de marca a Foodint con paleta nueva
Fase 3 — Operativa avanzada del encargado (PENDIENTE)
[ ] Panel "Ahora mismo" en tiempo real
[ ] Bolsa de horas automática (saldo +/-)
[ ] Turnos abiertos publicables
[ ] Aprobaciones unificadas (vacaciones + cambios + incidencias)
[ ] Calendario de Horarios completo (T1/T2/T3, libra rotativa, validación convenio)
Fase 4 — Notificaciones push (PENDIENTE)
[ ] Service worker
[ ] VAPID keys
[ ] Suscripciones por usuario
[ ] Triggers desde Supabase (Edge Functions)
Fase 5 — Migrar el resto de módulos a Supabase (PENDIENTE)
[ ] Tasks, Incidents, Audits, Schedules, Templates, etc.
[ ] Zonas de Pedido (delivery_records, delivery_zones)
---
8. Cómo trabajar con Claude (instrucciones para el próximo Claude)
Lee este archivo completo antes de hacer nada.
Pregunta al usuario el estado antes de empezar (ej: "¿En qué punto estamos?").
No reinventes lo ya construido. Si algo está en este documento como "funcional", se usa, no se rehace.
Edición de archivos en GitHub:
El usuario edita en la rama `source` desde la web de GitHub
Tu rol es generar el código completo del archivo y dárselo en `/mnt/user-data/outputs/`
El usuario hace: lápiz ✏️ → Ctrl+A → borra → pega contenido → commit a `source`
Cuando un build falle: suele ser por TypeScript estricto. Eliminar variables no usadas, no marcarlas con `_`. Para narrowing de null en closures, asignar a const local.
Versionar los archivos que generes con sufijo `_vN.tsx` para que sea fácil rastrear.
Al terminar una sesión productiva: ofrece actualizar este `CONTEXTO_CLAUDE.md` con los cambios.
Para cualquier dato nuevo que necesite persistir entre dispositivos: crear tabla en Supabase + funciones en service correspondiente + acción en `AppContext.tsx` o llamada directa. NO usar localStorage para datos compartidos.
Aplicar siempre la paleta Foodint en componentes nuevos: granate `#7C1A1A`, crema `#F5E9D9`. Verde solo para estados de éxito (jornada abierta, fichaje correcto). Rojo solo para errores y "salida".
---
9. Última versión del código clave (referencia en GitHub `source`)
Páginas
`src/pages/ZonasPedidoPage.tsx` — v17 (Coste Rider en lugar de Jelp)
`src/pages/KioskoFichajePage.tsx` — v4 (con paleta Foodint)
`src/pages/SolicitudesPendientesPage.tsx` — nuevo
`src/pages/StaffPage.tsx` — v4 (con DocumentosTab y VacacionesTab nuevos)
`src/pages/trabajador/*` — todos v2 con paleta Foodint
`src/App.tsx` — v4 (con solicitudes, modo trabajador y branding Foodint)
Componentes
`src/components/Logo.tsx` — Logo + LogoSquare
`src/components/personal/DocumentosTab.tsx`
`src/components/personal/VacacionesTab.tsx`
Servicios
`src/services/supabaseSync.ts` — v3 (con logs realtime)
`src/services/documentsService.ts`
`src/services/vacationsService.ts`
`src/services/fichajeKiosko.ts`
Tipos
`src/types/index.ts` — v3 (con `solicitudes_pendientes`)
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
Decisión de seguir con documentos y vacaciones
2026-05-08 — Sesión Foodint (Documentos, Vacaciones, Branding)
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
Página SolicitudesPendientesPage con tabs y aprobación
Badge en sidebar con conteo de pendientes
Alertas: antelación corta, mínimo de plantilla
Modal de aprobación con cálculo de plantilla restante
Política de RLS arreglada para Storage
Probado y funcionando end-to-end:
Trabajador solicita vacaciones → gestor las ve al instante → aprueba → trabajador ve aprobación al instante
Trabajador sube documento → gestor lo ve al instante en ficha
Gestor sube nómina → trabajador la ve al instante
---
Última actualización: 2026-05-08 (Fases 1A, 1B, 2 completas + branding Foodint)
