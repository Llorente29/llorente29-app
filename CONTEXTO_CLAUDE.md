ANDY APP — Contexto para Claude
> **Propósito:** este documento es el "salvavidas" del proyecto. Si una conversación con Claude se queda sin contexto, abre una nueva conversación, pega el contenido de este archivo y dile: *"Continúa el desarrollo de Andy App. Lee este contexto y dime el estado actual antes de proseguir."*
>
> **Cómo mantenerlo:** al final de cada sesión productiva, pídele a Claude: *"Actualiza el CONTEXTO_CLAUDE.md con lo que hemos hecho hoy."*
---
1. Identidad del proyecto
Andy App — software de gestión de hostelería para 3 locales en Madrid.
Locales: Foodint Alcalá, Foodint Carabanchel, Foodint Pza Castilla
Empleados totales: ~20 entre los 3 locales
Stack: React + TypeScript + Vite + Tailwind CSS + Supabase (Postgres + Realtime)
Modo: PWA en GitHub Pages (no app nativa por ahora)
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
Supabase (NUEVO — sesión 2026-05-07)
Project URL: `https://xzmpnchlguibclvxyynt.supabase.co`
Region: West EU (Ireland)
Plan: Free
Publishable key (segura para frontend): `sb_publishable_PyzPVoi69TlRLWcfsEMPlA_pxMU8S9-`
Secret key: NO está en el código, en los secretos de GitHub. No usar.
Tablas creadas: `locations`, `employees`, `clock_entries`
Realtime: activado para las 3 tablas
RLS: activado, policy `anon_all_*` que permite todo (a refinar en sub-fases siguientes con autenticación)
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
Personal — FASE 1A COMPLETA + Supabase ✅
Estado: funcional con sincronización en tiempo real entre dispositivos.
Implementado en sesión 2026-05-07:
Modo Kiosko (selección empleado → PIN → fichaje)
Detección automática de entrada/salida según último fichaje
Geofencing 200m con bloqueo (configurable)
Multi-local por empleado (un empleado puede fichar en varios locales)
Modo pantalla completa + manifest PWA + iconos para "instalar como app"
Banner de instalación con instrucciones específicas iOS/Android
Backend Supabase completo: locations, employees, clock_entries
Realtime funcional: fichaje en tablet → aparece al instante en ordenador del gestor
Probado y funcionando:
Crear empleado en ordenador → aparece en móvil al instante
Editar empleado en móvil → aparece en ordenador al instante
Fichar en kiosko (móvil) → aparece en Control Horario del ordenador al instante
Falta (Fase 1B y siguientes):
Modo móvil personal del trabajador (ahora sólo kiosko)
App móvil del trabajador para autoservicio
Notificaciones push
Intercambio de turnos entre empleados
Bolsa de horas automática
Turnos abiertos para cobertura rápida
Zonas de Pedido (FUNCIONAL)
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
Coordenadas locales (fijas en código)
Foodint Alcalá: `40.4346, -3.6528` (C/Florencio Llorente 29)
Foodint Carabanchel: `40.3912, -3.7399` (C/Camichi 4)
Foodint Pza Castilla: `40.4698, -3.6928` (C/Cañaveral 75)
Decisiones del Kiosko
Identificación: selección de nombre + PIN de 4 dígitos
Tipos de fichaje: solo entrada/salida (no pausa). En turno partido se hacen 2 entradas y 2 salidas.
Detección automática del próximo tipo (Opción A): si hay jornada abierta, ofrece SALIDA; si no, ENTRADA
Geofencing: 200m configurable, bloqueo total fuera de zona
Foto al fichar: campo en BD pero desactivado por defecto (futura activación)
---
6. Convenciones del código
Estructura de carpetas
```
src/
  pages/             ← una página por ruta (ZonasPedidoPage.tsx, KioskoFichajePage.tsx, etc.)
  components/ui/     ← Button, Card, Input, Select…
  context/           ← AppContext.tsx (estado global con sync Supabase)
  services/          ← lógica de negocio (deliveryZones.ts, fichajeKiosko.ts, supabaseSync.ts)
  lib/               ← clientes (supabase.ts)
  types/             ← tipos compartidos (DeliveryRecord, Employee, etc.)
```
Patrón de uso del contexto con Supabase
Para leer estado: usar `staff`, `locations`, `tasks`, etc. del `useApp()`
Para escribir empleados: usar `saveEmployee(emp)` o `removeEmployee(id)` (NO `setStaff`)
Para escribir fichajes: usar `addClockEntry(employeeId, entry)`
Para escribir locales: usar `saveLocation(l)` o `removeLocation(id)`
Lo demás (tasks, incidents, etc.) sigue en localStorage hasta que migremos cada módulo
Claves de localStorage activas
`andy-app-v4` → cache local de TODO el estado (incluso los datos que vienen de Supabase)
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
Fase 1B — Fichaje desde móvil personal del empleado (SIGUIENTE)
[ ] Login del empleado con PIN desde su propio móvil
[ ] PWA instalable en el móvil del empleado
[ ] Pantalla "Mi horario de la semana"
[ ] Botón fichar entrada/salida
[ ] Recordatorio si no ficha al inicio de turno
Fase 2 — Autoservicio del trabajador
[ ] Mis vacaciones
[ ] Mis documentos
[ ] Intercambio de turnos
[ ] Notificaciones push
Fase 3 — Operativa del encargado
[ ] Panel "ahora mismo" en tiempo real
[ ] Bolsa de horas automática
[ ] Turnos abiertos publicables
[ ] Aprobaciones unificadas
Fase 4 — Migrar el resto de módulos a Supabase
[ ] Tasks, Incidents, Audits, Schedules, Templates, etc.
[ ] Zonas de Pedido (delivery_records, delivery_zones)
---
8. Cómo trabajar con Claude (instrucciones para el próximo Claude)
Lee este archivo completo antes de hacer nada.
Pregunta al usuario el estado antes de empezar (ej: "¿En qué punto de la Fase 1B estamos?").
No reinventes lo ya construido. Si algo está en este documento como "funcional", se usa, no se rehace.
Edición de archivos en GitHub:
El usuario edita en la rama `source` desde la web de GitHub
Tu rol es generar el código completo del archivo y dárselo en `/mnt/user-data/outputs/`
El usuario hace: lápiz ✏️ → Ctrl+A → borra → pega contenido → commit a `source`
Cuando un build falle: suele ser por TypeScript estricto. Eliminar variables no usadas, no marcarlas con `_`. Para narrowing de null en closures, asignar a const local.
Versionar los archivos que generes con sufijo `_vN.tsx` para que sea fácil rastrear.
Al terminar una sesión productiva: ofrece actualizar este `CONTEXTO_CLAUDE.md` con los cambios.
Para cualquier dato nuevo que necesite persistir entre dispositivos: crear tabla en Supabase + funciones en `supabaseSync.ts` + acción en `AppContext.tsx`. NO usar localStorage para datos compartidos.
---
9. Última versión del código clave (referencia en GitHub `source`)
`src/pages/ZonasPedidoPage.tsx` — v17 (Coste Rider en lugar de Jelp, todos los IVAs sin IVA)
`src/pages/KioskoFichajePage.tsx` — v3 (con realtime + pantalla completa + banner instalación)
`src/pages/StaffPage.tsx` — v3 (con `saveEmployee`/`removeEmployee` y campo PIN/multi-local)
`src/services/supabaseSync.ts` — v3 (con logs de debug en realtime)
`src/services/fichajeKiosko.ts` — funciones del kiosko (PIN, geofencing, etc.)
`src/context/AppContext.tsx` — con sincronización Supabase y acciones nuevas
`src/lib/supabase.ts` — cliente Supabase
`public/manifest.json` — manifest PWA
`public/icon-192.png` y `public/icon-512.png` — iconos PWA (cuadrado verde con "A")
---
10. Bitácora de sesiones
2026-05-07 (sesión larga)
Construcción inicial Zonas de Pedido (5 pestañas, 17 versiones)
Análisis de mercado para módulo Personal (Combo, Sesame, Shiftbase, Workant)
Plan de fases para Personal
Fase 1A — Kiosko completo:
Tipos extendidos (PIN, multi-local, KioskoConfig)
Servicio fichajeKiosko con geolocalización Haversine
Página KioskoFichajePage con flujo completo
PWA manifest + iconos
Modo pantalla completa + banner instalación
Migración a Supabase:
Decidido Supabase como backend (gratis, realtime, 20 empleados sobra)
Cuenta y proyecto creados
3 tablas creadas con RLS y realtime
Cliente Supabase + servicio sync + AppContext con sincronización
StaffPage migrado a `saveEmployee`/`removeEmployee`
KioskoFichajePage migrado a `addClockEntry`
Realtime funcionando: fichaje en tablet → aparece al instante en gestor
---
Última actualización: 2026-05-07 (Fase 1A completa con Supabase realtime)
