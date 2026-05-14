# Módulo de operaciones — CONTEXTO v11

## INSTRUCCIONES DE USO PARA CLAUDE

Cuando empieces una nueva conversación con este archivo:
1. Lee el archivo entero antes de responder al usuario.
2. **No** preguntes datos que ya están aquí.
3. Confirma brevemente al usuario en qué punto estás retomando.
4. Estilo de comunicación: el usuario prefiere **paso a paso muy detallado**, con confirmaciones frecuentes, comandos uno a uno, y **substituir bloques enteros** vs editar línea por línea. Tiene buena tolerancia a errores y aprende rápido.
5. El usuario no tenía experiencia previa con Git/terminal antes del 12/05/2026. Hoy ya sabe lo básico.

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
- Hoy 14/05/2026: los empleados NO tienen cuenta en la app todavía. Pendiente Sprint "Foodint Live".

### Admins (los únicos con acceso hoy)
- jgcolon@idasal.com
- llorente29food@gmail.com

---

## 2. STACK TÉCNICO

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Supabase (xzmpnchlguibclvxyynt.supabase.co, **eu-west-1 = Irlanda**, GDPR-compliant)
- **Branding:** Granate `#7C1A1A`, Beige `#F5E9D9`, fuente Instrument Serif para titulares
- **Repo:** github.com/Llorente29/llorente29-app
  - Rama producción: `source` (NO se toca)
  - Rama de trabajo: `platform-v2` (genérica de la plataforma)
  - **Rama activa actual: `feat/sprint2-appcc-frontend`**
  - Salvaguarda: rama `safety/pre-platform-v2` + tag `pre-platform-v2-2026-05-12` (commit 75ee743)
- **Entorno local:** Windows, Node v24.15.0, npm 11.12.1, Git 2.54.0, VS Code en `C:\dev\llorente29-app`
- App corre en `http://localhost:5173/llorente29-app/` con `npm run dev`
- **NO desplegada en producción todavía** (solo localhost). Pendiente Sprint "Foodint Live".

### Cuenta interna Foodint
- **UUID account:** `00000000-0000-0000-0000-000000000001`
- Constante usada en código: `ACCOUNT_ID_FOODINT`
- **47 feature flags activos** (toda la plataforma activa, sin pagar nada)

---

## 3. DECISIONES ESTRATÉGICAS CONFIRMADAS

- **Plataforma 360º** modular y vendible a otros restaurantes.
- Cuenta interna "Grupo Foodint" con todos los flags activos sin suscripción.
- Clientes externos comprarán planes (Starter/Pro/Enterprise) que activan submódulos.
- **Stripe** como pasarela (Sprint 6, oct-nov 2026).

### Catálogo de módulos
- **Personal** (base obligatoria, ya existe)
- **APPCC** (Sprint 2-3, dividido en Esencial/Pro/Multi-local + add-ons IoT e IA)
- **Stock & Recetario** (Sprint 4-5)
- **Ventas** (parcialmente existe)
- **Delivery, TPV, Reservas, Fidelización** (coming_soon)

### Planes comerciales (precios modificables)
- **Starter** (29€/mes + 10€/local) — 1 local, 20 empleados, Personal Esencial + APPCC Esencial
- **Professional** (59€/mes + 15€/local) — 5 locales, 100 empleados, Personal Pro + APPCC Pro + Stock Esencial + Ventas Esencial
- **Enterprise** (149€/mes + 20€/local) — ilimitado, todos en Multi-local

### Sistema de Feature Flags (CRÍTICO PARA COMERCIALIZACIÓN)
**Ya implementado** — columna vertebral del pivot a plataforma:
- Tabla `account_features` en Supabase determina qué módulos ve cada cuenta
- `gate.load()` en frontend lee los flags activos al hacer login
- Al vender a un cliente Starter, su cuenta nacerá con 12 flags activos (subset del Starter)
- El cliente NUNCA verá módulos no pagados — no aparecen en sidebar

**Lo que falta para comercializar bien**:
- Auditar que TODOS los componentes respetan los flags (algunos quizás no)
- Pantalla admin para gestionar planes/flags sin tocar Supabase (Sprint 6)
- Integración con Stripe → activación automática (Sprint 6)

---

## 4. ESTADO DEL CÓDIGO AL CIERRE 14/05/2026

### Branch activa
```
feat/sprint2-appcc-frontend
HEAD: 6000c1a — Sprint 2 frontend B1b: wizard onboarding APPCC + lazy generation diaria
```

### Últimos commits del Sprint 2
```
6000c1a Sprint 2 frontend B1b: wizard onboarding APPCC + lazy generation diaria
f301c0e Sprint 2: drawer hamburguesa móvil sustituye BottomNav (accesibilidad: inert + focus return)
f85a5a0 Sprint 2 frontend: IncidentsPage + mejoras visuales fase 1 (tamaños mayores + responsive móvil + touch targets 44px+)
69e145c Sprint 2 frontend: ciclo APPCC completo - FieldRenderer + auto-save + completar/firmar
4c5e6e5 Sprint 2 frontend: navegación TodayPage <-> ExecutionPage funcional con esqueleto de items
```

### Working tree
```
Clean. Sincronizado con origin.
```

---

## 5. ARQUITECTURA DEL MÓDULO APPCC

### Estructura de archivos
```
src/modules/appcc/
├── components/
│   └── FieldRenderer.tsx       — renderiza inputs según field_type (numeric, boolean, select, photo...)
├── pages/
│   ├── TodayPage.tsx           — Checklists del día + lazy generation
│   ├── ExecutionPage.tsx       — Rellenar un checklist con auto-save
│   ├── IncidentsPage.tsx       — Gestión de incidencias (auto + manuales)
│   └── OnboardingPage.tsx      — Wizard 3 pasos para configurar APPCC en un local
├── services/
│   ├── templatesService.ts     — Catálogo (plans + templates)
│   ├── schedulesService.ts     — Schedules + factory de 8 esenciales + recurrencia
│   ├── executionsService.ts    — CRUD de executions + listExecutionsForDate
│   └── incidentsService.ts     — Incidencias auto y manuales
└── types.ts                    — Tipos TS reflejando esquema SQL
```

### Tablas Supabase APPCC (14 totales)
- **Catálogo (sembradas)**: `appcc_plans` (15), `appcc_templates` (30), `appcc_template_items` (149), `appcc_template_item_options`
- **Programación**: `appcc_schedules` (**24 activos**: 3 locales × 8 esenciales), `appcc_schedule_responsibles` (vacía, futuro)
- **Ejecución**: `appcc_executions`, `appcc_execution_responses`, **`appcc_execution_photos` (tabla existe pero NO funcional)**
- **Incidencias**: `appcc_incidents`, `appcc_incident_actions`, **`appcc_incident_photos` (tabla existe pero NO funcional)**
- **Auditoría**: `appcc_signatures`, `appcc_audit_log`

### Datos en BBDD al cierre
- **24 schedules** activos (3 locales × 8 plantillas, todos diarios)
- **N executions** pending del día generadas vía lazy generation (8 por local cuando se abre TodayPage)
- 0 incidencias (limpieza completa antes del wizard)
- 0 firmas (limpieza completa)
- 0 ejecuciones de test residuales

---

## 6. FLUJO COMPLETO APPCC OPERATIVO (HOY)

```
1. Admin entra a "APPCC: Configurar" desde sidebar (solo admin)
2. Wizard 3 pasos:
   - Paso 1: elige local + horario apertura/cierre
   - Paso 2: 8 esenciales preseleccionadas, desmarcables
   - Paso 3: revisa horas calculadas, ajusta si quiere
   - Pulsa "Guardar y activar" → bulkCreateSchedules
3. Admin va a "APPCC: Hoy"
4. TodayPage hace lazy generation automática:
   - Lee schedules del día
   - Lee executions ya existentes
   - Crea las pending que faltan (filtradas por schedule_id, sin duplicar)
5. Equipo (manager/trabajador) ve los 8 checklists del día ordenados por hora
6. Pulsa "Abrir" en uno → ExecutionPage
   - startExecution() marca status='in_progress' + started_by + started_at
   - Rellena items con auto-save (cada cambio dispara saveResponse)
   - Si un valor está fuera de rango (ej. temperatura), trigger SQL crea incidencia automática
7. Al completar: completeExecution()
   - status='completed' + completed_by + completed_at + notes
   - Genera firma SHA-256 en appcc_signatures (eIDAS simple)
8. Equipo va a "APPCC: Incidencias" para gestionar las que se hayan abierto
   - Marcar en curso (registrando acción)
   - Añadir acciones intermedias
   - Resolver con resolución final
```

### Las 8 plantillas esenciales (factory)
| # | Template code | Plantilla | Momento | Hora típica con apertura=12:30/cierre=23:30 |
|---|---|---|---|---|
| 1 | `hygiene_daily` | Checklist higiene personal | opening | 12:30 |
| 2 | `temp_cameras_am` | Temperaturas cámaras (mañana) | opening +30min | 13:00 |
| 3 | `oil_check_daily` | Control diario aceite | anytime | NULL |
| 4 | `expiry_cameras_daily` | Revisión caducidades cámara | anytime | NULL |
| 5 | `temp_cameras_pm` | Temperaturas cámaras (tarde/noche) | closing -60min | 22:30 |
| 6 | `clean_kitchen_daily` | Limpieza diaria cocina | closing | 23:30 |
| 7 | `clean_diningroom_daily` | Limpieza diaria sala | closing | 23:30 |
| 8 | `clean_toilets_daily` | Limpieza diaria aseos | closing | 23:30 |

---

## 7. DECISIONES TOMADAS HOY (14/05/2026)

### Navegación móvil
- **BottomNav eliminada** — solo daba acceso a 5 de las ~17 páginas
- **Drawer hamburguesa lateral** — patrón estándar Notion/Linear/Asana
- Breakpoint `lg` (1024px): debajo es móvil, arriba desktop
- Detección con `window.innerWidth < 1024` + listener resize
- Drawer 280px con animación `translate-x`, overlay `bg-black/40`
- **Accesibilidad**: atributo `inert` cuando oculto + focus return al hamburguesa al cerrar
- KioskoFichajePage sigue sin sidebar (es modo full screen)

### Wizard de onboarding APPCC
- **Acceso: D — Ambas vías** (sidebar "APPCC: Configurar" solo admin + futuro botón en TodayPage cuando no hay schedules)
- **Plantillas: A — 8 esenciales preseleccionadas**, desmarcables, lista completa visible
- **Horas: B — Apertura/cierre del local deduce horas**, ajustables individualmente
- **Permisos: A — Solo admin** (managers NO ven onboarding)
- Tipo de propiedad nueva en NAV: `roleRequired?: 'admin'`
- Sin protección anti-duplicación todavía — pendiente B1c

### Sobre asignación al trabajador fichado
- **NO implementado hoy**. Es Sprint 3 (Modelo Z).
- Hoy: cualquiera con acceso a APPCC: Hoy ve TODOS los checklists del local. Quien abre se queda registrado en `started_by`, quien completa en `completed_by`. Auditoría funciona, asignación previa no existe.
- La tabla `appcc_schedule_responsibles` ya está creada en SQL pero vacía. Lista para Sprint 3.

### Sobre la hora del schedule
- Después de discutir 3 opciones (sin hora / hora fija arbitraria / preguntar al cliente)
- **Decisión: Opción 3 — preguntar al cliente** vía wizard (es lo profesional)
- La factory NO impone horas arbitrarias del programador
- El wizard pregunta apertura/cierre y deduce horas; el admin las puede modificar
- Hay 2 plantillas con `dayPeriod='anytime'` que NO tienen hora sugerida (oil_check, expiry_cameras)

### Sobre los datos de prueba antes del Sprint B1b
- Decisión: **Opción A — borrado limpio total** de executions/incidents/signatures de prueba
- SQL ejecutado: BEGIN/COMMIT borrando en orden inverso a FKs
- Catálogo (plans/templates/items/options) intacto
- Después del wizard inicial hubo bug de duplicación (16 schedules en vez de 8 al guardar 2 veces)
- Tras limpieza, configuración manual cuidadosa de los 3 locales → 24 schedules correctos

### Sobre fotos/evidencias en APPCC
- **Conversación final de la sesión**: el usuario preguntó si se podían registrar fotos
- **Estado real**: las tablas SQL (`appcc_execution_photos`, `appcc_incident_photos`) **existen pero NO son funcionales todavía**
- `FieldRenderer` reconoce `field_type='photo'` pero no está probado end-to-end
- **Falta**: Supabase Storage bucket + componente "tomar foto cámara móvil" + compresión + visor
- **Crítico para vender APPCC a externos**: las inspecciones de Sanidad piden fotos de termómetros, caducidades, albaranes, etc.

### Sobre comercialización (decisiones de la conversación final)
- **Demo del producto**: apuntado genérico al roadmap, el usuario quiere pensarlo más
- **Despliegue a producción**: pendiente, los 3 locales **NO usan la app todavía**
- **Dominio propio**: el usuario quiere dominio propio (sugerido `foodint.es` o `foodint.app`)
- **Riesgos del alojamiento**: discutidos los principales (límites planes gratuitos, caídas, pérdida de datos, costes, 2FA, dependencia extranjera). Acciones inmediatas apuntadas en sección 10
- **Activación por módulos**: ya funciona vía feature flags (sistema ya implementado)
- **Empezar piloto con**: Fichaje + APPCC (decisión del usuario, NO todos los módulos de golpe)

---

## 8. PENDIENTES (ROADMAP COMPLETO)

### Inmediato — Sprint B1c (~1h, próxima sesión corta)
- [ ] **Bug anti-duplicación del wizard**: si admin reabre el wizard de un local ya configurado, detectar y avisar inline (caja beige): "Foodint Alcalá ya tiene N controles activos. ¿Reemplazar configuración / Volver / Cancelar?"
- [ ] **Botón "Configurar APPCC" en TodayPage** cuando un local NO tiene schedules — usando `countActiveSchedules` + callback `openOnboarding`
- [ ] **SchedulesPage admin**: pantalla para editar/desactivar/añadir schedules existentes (sin reabrir wizard completo)

### CRÍTICO — Sprint "Foodint Live" (~6-10h, repartido en 4-5 sesiones)
**Objetivo: que los 3 locales propios empiecen a usar Fichaje + APPCC en producción**
- [ ] **Sesión A (~1.5h)**: Comprar dominio (sugerido `foodint.es` en Cloudflare ~7€) + crear cuenta Vercel + conectar GitHub + desplegar app → `app.foodint.es`
- [ ] **Sesión B (~1.5h)**: Crear 8 cuentas de empleados + configurar permisos manager + invitarles por email/WhatsApp con instrucciones
- [ ] **Sesión C (~1h)**: Documento "Guía rápida para Yohanny/Natacha/Pamela": cómo fichar desde móvil, cómo rellenar APPCC, qué hacer si falla
- [ ] **Sesión D (~2h)**: Pilotaje en Foodint Alcalá — observar a un empleado real fichando + rellenando APPCC, apuntar fricciones
- [ ] **Sesión E (~2h)**: Pilotaje en Carabanchel + Pza Castilla — iterar con feedback real

### CRÍTICO — Sub-sprint "APPCC Fotos" (~7h)
**Necesario antes de vender APPCC a clientes externos. Bloqueante para inspecciones de Sanidad reales.**
- [ ] **Pieza A (3-4h)**: Subida de fotos en respuestas de checklists
  - Configurar bucket Supabase Storage `appcc-photos`
  - Políticas RLS para aislamiento entre cuentas
  - Componente "tomar foto" (cámara móvil + galería)
  - Compresión cliente con `browser-image-compression` (~150KB por foto)
  - Vista previa + borrar antes de guardar
  - Guardar en `appcc_execution_photos`
- [ ] **Pieza B (1-2h)**: Subida de fotos en incidencias (reutilizar componente)
- [ ] **Pieza C (2h)**: Visor de fotos asociadas con lightbox en ExecutionPage e IncidentsPage

### IMPORTANTE — Sprint 2.5 (~3-4h)
- [ ] **PDF descargable** — pieza muy vendible:
  - Certificado de checklist completado (con firma SHA-256)
  - Resumen diario por local
  - Informe inspección Sanidad (rango de fechas)
- [ ] **Limpiar bloque debug** en pie de ExecutionPage
- [ ] **Validación móvil real** de IncidentsPage (no solo DevTools)

### Comercialización — pendiente de pensar/decidir
- [ ] **Demo del producto** (apuntado, el usuario quiere pensarlo más antes de decidir formato)
  - Opción A: Guion en Markdown (~2h)
  - Opción B: Tour interactivo en la app + cuenta demo seed (~8h)
  - Compromiso de mantenimiento: actualizar al cierre de cada sprint
- [ ] **APPCC Adjuntos PDF** (~3-4h): nuevo `field_type='file'` para subir albaranes, certificados, etc.

### Largo plazo — Sprint 3+ (3-4h cada uno)
- [ ] **Modelo Z — Asignación inteligente APPCC**: schedule_responsibles + reparto al fichar + UI "MIS checklists"
- [ ] **Cron Supabase `pg_cron`** para marcar overdue + crear executions a las 00:00 (Patrón C híbrido completo)
- [ ] **Firma canvas** (plan Pro) — sustituye la firma SHA-256 simple por firma manuscrita
- [ ] **Columnas `show_appcc_*` en manager_permissions** (today, incidents, onboarding)
- [ ] **React Router** (Sprint 3) — actualmente refresh vuelve a Dashboard
- [ ] **Auditar feature flags**: verificar que TODOS los componentes filtran correctamente según los flags de la cuenta

### Sprint 6 (oct-nov 2026) — Comercialización completa
- [ ] **Stripe Checkout + Customer Portal**
- [ ] **Webhooks**: pago confirmado → activar flags del plan
- [ ] **Pantalla admin "Suscripción activa"**: el dueño ve qué tiene y qué le falta
- [ ] **Onboarding cliente externo**: signup + setup wizard para primer local + invitar empleados

### Legal — ANTES de cobrar a cliente externo
**No es código, pero es bloqueante para vender legalmente**:
- [ ] Términos y condiciones del servicio
- [ ] Política de privacidad + RGPD
- [ ] DPA (Data Processing Agreement) con clientes
- [ ] Inscripción RGPD ante la AEPD
- [ ] Factura electrónica (Verifactu desde 2025)
- [ ] **Coste estimado**: asesoría especializada SaaS ~500-1500€ una vez

---

## 9. ARCHIVOS CLAVE A CONOCER

### Para retomar el módulo APPCC
- `src/modules/appcc/services/schedulesService.ts` (336 líneas) — `ESSENTIAL_TEMPLATE_PRESETS` array con los 8 códigos + funciones `listActiveSchedules`, `getSchedulesForDate`, `bulkCreateSchedules`, `computeSuggestedTime`, `countActiveSchedules`
- `src/modules/appcc/pages/OnboardingPage.tsx` (~400 líneas) — wizard 3 pasos con stepper visual; props `initialLocationId` + `onFinish` callback
- `src/modules/appcc/pages/TodayPage.tsx` (~290 líneas) — useEffect principal hace lazy generation antes de listar
- `src/modules/appcc/services/executionsService.ts` — `createExecution` firma con 4º param `string | CreateExecutionOptions` (retrocompatible)

### Para navegación
- `src/App.tsx` (~683 líneas) — NAV con `roleRequired`, Sidebar reutilizado para desktop+móvil, hamburgerRef para accesibilidad, callbacks en RenderPageContext
- `src/types/index.ts` — tipo Page incluye 'appcc_onboarding'
- `src/modules/appcc/types.ts` — AppccSchedule, AppccScheduleResponsible, AppccOnboardingDraft, AppccEssentialPreset

---

## 10. NOTAS OPERATIVAS Y RIESGOS

### Horarios reales de los locales (configurados)
- **Foodint Alcalá**: 12:30 – 23:30
- **Foodint Carabanchel**: 12:30 – 23:30
- **Foodint Pza Castilla**: 12:30 – 23:30

### Cómo se actualizan los 3 locales cuando estén en producción
Después de desplegar a Vercel:
```
1. Tú trabajas en local (npm run dev en localhost:5173) — para desarrollar
2. Cuando algo está listo: git add + commit + push
3. Vercel detecta el push → builds automático → en 1-2 min está en producción
4. Tus 3 locales refrescan la página en sus tablets/móviles (Ctrl+F5 / pull down)
   → ya tienen la nueva versión
```

**Datos en Supabase**: una sola BBDD compartida entre dev y prod. Tú y los locales ven los MISMOS datos. Es aceptable para piloto interno; antes de vender a externos hay que separar entornos.

### Riesgos del alojamiento (acciones inmediatas a tomar)

**Acciones a hacer ANTES del Sprint Foodint Live**:
1. ✅ **Activar 2FA** en GitHub, Vercel y Supabase (15 min, ¡hacer ya!)
2. ⚠️ **Documentar "Plan B" si la app cae**: libreta de fichaje en papel, rellenar APPCC al recuperar conexión

**Acciones a hacer ANTES de vender a externos**:
3. ⚠️ **Pasar a Supabase Pro** (25$/mes) para Point-in-Time-Recovery (obligatorio por GDPR cuando hay datos de terceros)
4. ⚠️ **Asegurar región EU en Vercel** al desplegar

**Riesgos identificados**:
- Vercel Free: 100GB tráfico/mes, 100h build/mes (suficiente para 10K visitas/día)
- Supabase Free: 500MB BBDD, 1GB Storage, **pausa si NO hay actividad 7 días**
- Supabase Free NO tiene Point-in-Time-Recovery (peligro de pérdida de datos)
- Vercel y Supabase tienen ~99.9% uptime = ~8 horas caída/año
- No hay sorpresas de facturación: si excedes el plan, paran el servicio o avisan
- Datos legalmente protegidos (eu-west-1 en Irlanda, GDPR-compliant)

### Comandos de verificación rápida en Supabase
```sql
-- Cuántos schedules activos por local
SELECT l.name, COUNT(*) AS num_schedules
FROM appcc_schedules s
JOIN locations l ON l.id = s.location_id
WHERE s.is_active = true
GROUP BY l.name ORDER BY l.name;

-- Cuántas executions del día por local
SELECT l.name, e.status, COUNT(*)
FROM appcc_executions e
JOIN locations l ON l.id = e.location_id
WHERE e.scheduled_date = CURRENT_DATE
GROUP BY l.name, e.status ORDER BY l.name, e.status;

-- Limpiar todo lo de APPCC (datos de prueba — NO catálogo)
BEGIN;
DELETE FROM appcc_incident_photos;
DELETE FROM appcc_incident_actions;
DELETE FROM appcc_incidents;
DELETE FROM appcc_signatures;
DELETE FROM appcc_execution_photos;
DELETE FROM appcc_execution_responses;
DELETE FROM appcc_executions;
DELETE FROM appcc_audit_log;
COMMIT;
```

### Constantes hardcodeadas a saber
- `ACCOUNT_ID_FOODINT = '00000000-0000-0000-0000-000000000001'` aparece en OnboardingPage y TodayPage
- Granate `#7C1A1A` y Beige `#F5E9D9` — en todas las pages del módulo
- Breakpoint móvil/desktop: 1024px (Tailwind `lg`)

### Patrones de UI establecidos
- Botones touch-friendly: `min-h-[44px]` para botones secundarios, `min-h-[48px]` para principales
- Inputs touch-friendly: `min-h-[48px]` con padding `px-4 py-3`
- Tipografía: `text-base` (16px) para texto normal, `text-4xl` Instrument Serif para H1
- Tarjetas seleccionables: borde 2px granate + fondo beige cuando active
- Estados: pendiente (gris), in_progress (azul), completed (verde), overdue (rojo)

---

## 11. ¿CÓMO RETOMAR EN LA PRÓXIMA SESIÓN?

Al recibir un mensaje tipo "continuamos" o "seguimos":
1. **Confirmar contexto**: branch `feat/sprint2-appcc-frontend`, HEAD `6000c1a`, working tree limpio
2. **Verificar con `git status` + `git log --oneline -3`**
3. **Preguntar qué atacar**: si no lo dice el usuario, ofrecer las opciones del roadmap:
   - Sprint B1c (anti-duplicación + SchedulesPage admin, 1h)
   - Sprint Foodint Live (desplegar + 3 locales reales usando, 6-10h en sesiones)
   - Sub-sprint APPCC Fotos (subida de evidencias, 7h)
   - Sprint 2.5 PDF (3-4h)
4. Recordar el estilo: paso a paso, confirmaciones frecuentes, bloques enteros vs línea-por-línea, capturas para validar
5. NO ejecutar pg_cron sin avisar al usuario antes (requiere activación manual de extensión)
6. **Antes de empezar Foodint Live**: confirmar que el usuario tiene 2FA activado en GitHub/Vercel/Supabase

---

## 12. CAPTURAS Y VALIDACIONES DE LA SESIÓN 14/05/2026

Durante la sesión se validaron por capturas:
- ✅ Drawer hamburguesa móvil con todos los items navegables
- ✅ IncidentsPage en móvil con badges arriba + acordeón apilado
- ✅ Wizard paso 1: selección de local + horarios (12:30/23:30)
- ✅ Wizard paso 2: 8 esenciales preseleccionadas con badge "Esencial" granate
- ✅ Wizard paso 3: 8 plantillas con horas calculadas correctamente (12:30, 13:00, 22:30, 23:30×3, 2×NULL)
- ✅ TodayPage Alcalá con 8 checklists pending ordenados por hora
- ✅ Las queries SQL devuelven 8 schedules por local × 3 = 24 totales
- ✅ Status cambia a "in_progress" al abrir un checklist y volver

Console limpio sin warnings tras fix del `inert + focus return`.

---

## 13. CONVERSACIÓN FINAL (CONTEXTO ESTRATÉGICO)

La sesión cerró con una conversación estratégica sobre "cómo vender el producto a clientes". Decisiones:

1. **Para vender HOY**: no está listo para externos (faltan onboarding cliente, RLS verificado, PDF, legal). Sí está listo para **piloto con tus 3 locales propios**.
2. **Próximo gran hito**: Sprint "Foodint Live" — desplegar a producción con dominio propio + 3 locales reales usando Fichaje + APPCC.
3. **Demo de venta**: apuntada genérico al roadmap, el usuario lo piensa más antes de decidir formato.
4. **Fotos en APPCC**: críticas para vender, pero NO bloquean piloto interno. Sub-sprint "APPCC Fotos" planificado en 7h.
5. **Producción y desarrollo**: pueden convivir perfectamente. Tu PC sigue siendo desarrollo, Vercel será producción. Misma BBDD Supabase para ambos (aceptable para piloto, separar antes de vender externos).
6. **Activación por módulos**: ya funciona vía feature flags. La columna vertebral del pivot a plataforma está construida.

**El usuario dejó claro**: prefiere ir paso a paso, validar con clientes reales (sus 3 locales primero, después amigos hosteleros) antes de invertir en infraestructura de venta completa. Es el enfoque correcto.


---

## 14. SESIÓN 14/05/2026 (CONTINUACIÓN) — REBRANDING + REFACTOR VISUAL

Tras cerrar Sprint B1b APPCC, la sesión continuó con el trabajo de identidad visual del SaaS. Conviene leer esta sección entera antes de retomar trabajo de UI/branding.

### 14.1. Decisión estratégica de marca

**Separación definitiva:**
- **Foodint** = grupo restaurador del usuario (3 locales Madrid: Alcalá, Carabanchel, Pza Castilla). Permanece como cliente interno.
- **SaaS** = necesita OTRO nombre + dominio + logo + paleta moderna para venderlo a clientes externos.

### 14.2. Naming: 5 finalistas pendientes de maduración

**Estrategia final**: variantes de "Garbi" (limpio/puro en euskera, conexión perfecta con APPCC/higiene), pero con sufijo memorable.

**5 finalistas** (el usuario debe madurar varios días antes de decidir):
1. **GARBIM** (recomendación 1) — "gar-bím", 6 letras, "m" final memorable estilo IBM/Garmin
2. **GARBIS** — plural natural
3. **GARBIZ** — "z" final tech estilo Vercel
4. **GARBIN** — suave español-europeo
5. **GARBIE** — ortografía única anglosajona

**Test sugerido**: decir los 5 en voz alta 30 veces durante varios días. Preguntar a 3-4 personas de confianza. El que suene natural al día 5 → ese.

**Descartados verificados con web search** (NO volver a proponer):
- **Mise**: mise.jdx.dev devtools muy conocida + misenplace.ai competidor + mep-hospitality.com + miseinc.com
- **MEP**: sigla MUY consolidada en ingeniería Mechanical/Electrical/Plumbing. Categoría completa "MEP software"
- **MIPLA**: droga psicodélica análoga LSD + Minnesota IP Law Association + plagas Colombia
- **EMPLA**: Empla AG Chequia + Empla B.V. Holanda + Empla Group Kazajstán
- **Tellio**: empresa danesa VoIP + Tellio Technologies India
- **Restio**: competidor directo SaaS POS hostelero en Capterra
- **Crew**: categoría completa "crew scheduling software" (CrewHR, CrewSense)
- **Mensera**: empresa AI Utah desde 2011 (menseracorp.com)
- **Domus**: DOMUS Software AG Alemania (100+ empleados) + Domus Hospitality LLC Miami + DOMUS ST Idea España
- **Yumo**: app store saturado (Yumo Apps iOS, YumO Ucrania, Yumo Sudáfrica, Yumo Fitness, yumo.az, YUMO Business UK)
- **Garbio**: garb.io SaaS gestión residuos + jerga "basurero" Chicago años 60
- **Garbit**: Garbit GmbH Alemania (ERP Sage 100) + Garbit marca francesa William Saurin
- **Garbi**: garbi.com ocupado por Garbi Inc (smart recycling bin SF) + Garbí Virtual Cataluña + Hotel Garbi Ibiza + "garbí" viento sudoeste catalán

**Logo**: viene DESPUÉS del naming, no antes. Opciones cuando se decida nombre: Looka/Brandmark (~30€), Fiverr (~80€), diseñador freelance (~300€), Figma DIY.

### 14.3. Identidad visual DEFINITIVA

**Posicionamiento**: premium (60%) + tech moderno (30%) + cercano español (10%). Equivalente a Resy/Toast adaptado a mercado español.

**Paleta (8 colores definitivos)**:
| Token | Hex | Uso |
|---|---|---|
| `bgPage` | `#F5F4F0` | warm white fondo página |
| `bgCard` | `#FFFFFF` | tarjetas, modales |
| `border` | `#E0DDD6` | bordes warm |
| `accent` | `#1E3A5F` | azul tinta — botones primary, dots, focus |
| `accentHover` | `#162E4A` | hover accent |
| `accentBg` | `#EDECE6` | badges con texto accent |
| `textPrimary` | `#0C0A09` | carbón |
| `textSecondary` | `#6B6760` | warm gray |
| `success` / `successBg` | `#3F5C2F` / `#E2E8DA` | verde tierra completado |
| `danger` / `dangerBg` | `#A32D2D` / `#FAECEC` | rojo terroso |
| `warning` / `warningBg` | `#BA7517` / `#FAEEDA` | ámbar |

**Variantes descartadas en sesión** (NO volver a proponer):
- Granate-beige original (#7C1A1A + #F5E9D9): vintage, "mesón años 70"
- Dorado quemado (#A87E1F): muy joyería, demasiada personalidad para B2B serio
- Verde bosque profundo (#1A3D2E): muy ultra-premium tipo Hermès, estrecha mercado
- Terracota (#A24A1B): muy mediterránea, no internacionalizable

**Tipografía**: **Fraunces + Inter** (cargadas desde Google Fonts).
- Fraunces (variable, opsz+wght 400-500): títulos, h1, h2, números grandes
- Inter (pesos 400/500/600): UI, body, botones, labels
- Mono fallback: JetBrains Mono
- **Decisión clave**: tamaños base de Tailwind ESTÁNDAR (xs 12px, sm 14px, base 16px). Tras probar reducidos (11/12/14), se vieron muy apretados para hostelero medio (40-55 años, manos sucias, pantalla a 50cm). **Legibilidad > densidad**.

**Iconografía**: **Lucide React** (`lucide-react@1.14.0` ya instalada). 20 iconos seleccionados para el sidebar:
- Sidebar/menú: LayoutDashboard, Users, Activity, Clock, Smartphone, Inbox, Armchair, RefreshCw, Calendar, FolderOpen, FileText, Wallet, BarChart3, Brain, Bike, Leaf, AlertTriangle, Settings, MapPin, Bell
- Plegado: ChevronDown, ChevronRight
- Otros: X, type LucideIcon

**Reglas**: trazo 2px, sólo outline (nunca filled), tamaños 16/18/20px, color heredado del contexto vía `currentColor`. Sólo iconos semánticos llevan color propio (success/danger/warning).

**Modo oscuro**: **DESPUÉS del piloto**, no ahora. Arquitectura con CSS variables permite añadirlo sin reescribir.

### 14.4. Refactor ejecutado — branch `feat/branding-refactor`

**8 commits limpios pusheados a `origin/feat/branding-refactor`** (los 2 últimos pendientes de push según último check; verificar al retomar):

| Commit | Descripción | Archivos |
|---|---|---|
| `e169d1f` | Fase 1: sistema tokens + carga Fraunces + Inter | `branding.ts`, `tailwind.config.js`, `index.html`, `src/index.css` |
| `67df768` | Fase 2a.1: ui.tsx con nueva paleta (Button, Card, Modal, Badge, Tabs, Alert, Input, Select, Textarea, Label) | `src/components/ui.tsx` |
| `e9de239` | Fase 2a.2: Logo con bg-accent-bg (en lugar de #F5E9D9 beige) | `src/components/Logo.tsx` |
| `44835b3` | Fix tamaños texto a estándar Tailwind | `tailwind.config.js` |
| `266b9bd` | Fase 2a.3: Sidebar separado a componente propio con iconos Lucide y secciones colapsables (PERSONAL, VENTAS, APPCC, CONFIGURACIÓN). Persistencia en localStorage `sidebar:expanded_sections`. Auto-expand de sección con página activa | `src/components/Sidebar.tsx` (NUEVO), `src/App.tsx` |
| `cc77d9c` | Fase 2a.4: Header con paleta nueva, h1 con font-display Fraunces (en lugar de Instrument Serif inline). Sin emojis decorativos. Loading states con bg-page + text-accent | `src/App.tsx` |
| `9ca0c92` | chore: eliminar `App.css` zombie (era código TSX mal renombrado, 216 líneas de código muerto no procesado por Vite) | `src/App.css` borrado |

**Cambios estructurales clave**:
- `src/App.tsx`: pasó de 684 líneas a ~487. La constante `NAV` y la función `Sidebar` se extrajeron a `src/components/Sidebar.tsx`. La constante `NAV` se importa de vuelta desde Sidebar.tsx (`AuthenticatedApp` la usa para `perms` calculation).
- `src/branding.ts`: archivo central de marca con todos los tokens. Cambiar `BRAND.name` (actualmente `'TBD'`) cuando se decida nombre.
- `tailwind.config.js`: paleta nueva + fontFamily + fontSize + borderRadius + boxShadow + transitionDuration + minHeight. **Mantiene legacy.granate y legacy.beige** como red de seguridad. Eliminar en Fase 3.
- `src/index.css`: 19 variables CSS globales + carga Instrument Serif TEMPORALMENTE (como red de seguridad porque ~25 componentes aún la usan inline). **Eliminar import de Instrument Serif en Fase 3**.

### 14.5. Estado de Fase 2a — Layout y componentes base

✅ **COMPLETADA** (esperaba 1-1.5h, costó ~2h con verificaciones)
- ui.tsx refactorizado
- Logo refactorizado
- Sidebar separado a archivo propio + iconos Lucide + secciones colapsables
- Header refactorizado
- Loading states refactorizados
- App.css zombie eliminado

### 14.6. Plan pendiente — Fase 2b y Fase 3

**Fase 2b — Páginas en orden de visibilidad** (1.5h, próxima sesión):
1. **Dashboard / OtherPages DashboardPage** (visible al login, alta prioridad)
2. **APPCC TodayPage** (más usada)
3. **APPCC OnboardingPage** (wizard, primera impresión cliente externo)
4. **APPCC ExecutionPage** (uso diario)
5. **APPCC IncidentsPage**
6. **PersonalPage / StaffPage**
7. **LoginPage** (primera impresión)
8. **Settings y secundarias**

**Estrategia por página**:
- Buscar `#7C1A1A` (granate) → `bg-accent` o eliminar
- Buscar `#F5E9D9` (beige antiguo) → `bg-page`
- Sustituir emojis sueltos (`⚙️`, `📋`, `👥`, etc.) por iconos Lucide
- Aplicar `font-display` en h1/h2, `font-sans` en body
- Quitar `style={{ fontFamily: 'Instrument Serif, serif' }}` inline (queda en ~25 sitios)

**Fase 3 — Pulido y consistencia** (1-1.5h, posterior):
- Quitar Instrument Serif de `src/index.css` (cuando ningún componente la use)
- Eliminar `legacy.granate` y `legacy.beige` de `tailwind.config.js`
- Microajustes spacing (estandarizar gaps 6/10/16px)
- Mobile pass (drawer hamburguesa, touch targets ≥44px)
- Build + Lighthouse audit
- Arreglar warning `@ts-expect-error` línea 228 (inert ya soportado nativamente en React 19)
- Arreglar `manifest.json: Syntax error` (preexistente, error en `public/manifest.json` u origen similar)

### 14.7. Decisiones de UI pequeñas tomadas en sesión

- **Sidebar colapsable por sección**: implementado con `Set<string>` en localStorage. Por defecto sólo "Personal" abierta. Auto-expand de la sección con página activa.
- **Iconos del sidebar**: outline 2px stroke, size 18px en NAV, 14px en chevrons.
- **Tabs (en ui.tsx)**: bg-accent-bg con tab activo en bg-card (en lugar de bg-gray-100/bg-white).
- **Badge contador (NotificationDot en Sidebar)**: bg-danger con text-on-accent. Mínimo 16px ancho.
- **NO hacer modo oscuro hasta post-piloto**.
- **NO crear logo hasta tener nombre decidido**.
- **El sidebar largo es incómodo pero NO bloquea**: piloto puede empezar sin que esté pulido.

### 14.8. Cosas pendientes específicas heredadas de esta sesión

**Bugs/warnings preexistentes detectados durante refactor** (NO causados por nosotros):
- `App.tsx` línea 228: `Unused '@ts-expect-error' directive` — comentario inert es prop nativa de React 19, eliminar comentario
- `manifest.json: Syntax error` — error preexistente del PWA, revisar `public/manifest.json` o similar

**Componentes que aún usan Instrument Serif inline** (~25 sitios, lista heredada):
`src/components/ui.tsx` (ya migrado a font-display en Modal), `src/modules/appcc/pages/{ExecutionPage, IncidentsPage, OnboardingPage, TodayPage}.tsx`, `src/pages/trabajador/HomeEmpleado.tsx`, `src/pages/{CambiosPendientesPage, FichajesGlobalPage, InformesPage, LoginPage, OtherPages, PrediccionPersonalPage, StaffPage, TSpoonPage, UsuariosAccesosPage, VentasAnalisisPage}.tsx`, `src/platform/feature-gate/UpgradePrompt.tsx`.

**Patrón de migración para cada uno**: 
```tsx
// Antes
<h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Título</h1>
// Después
<h1 className="text-2xl font-display">Título</h1>
```

Si tiene color granate hardcoded (`color: '#7C1A1A'`):
```tsx
// Antes
<h1 style={{ fontFamily: '"Instrument Serif", serif', color: GRANATE }}>Título</h1>
// Después
<h1 className="font-display text-accent">Título</h1>
```

### 14.9. Cómo retomar el trabajo de branding en próxima sesión

1. Verificar: `git status` en branch `feat/branding-refactor`, working tree clean, HEAD en `9ca0c92` o posterior
2. Verificar push: `git log origin/feat/branding-refactor..HEAD` (si vacío, todo pusheado)
3. Decidir si:
   - **A)** Continuar Fase 2b (refactor páginas una a una). Empezar por **DashboardPage** (la más visible)
   - **B)** Atacar otro frente: Sprint Foodint Live (Vercel + dominio), Sub-sprint APPCC Fotos, Sprint 2.5 PDF
4. **NO** abrir PR del branch `feat/branding-refactor` hasta cerrar Fase 3 (acordado en sesión)
5. **NO** decidir nombre del SaaS en caliente — debe madurar varios días

### 14.10. Reflexión estratégica de cierre de sesión

El usuario ha tomado **decisiones de diseño maduras**: rechazó variantes vintage, joyería y ultra-premium en favor de una paleta sobria + tipografía elegante + iconos profesionales. El resultado es una app que **se ve coherente con lo que ya era técnicamente** (47 feature flags, módulo APPCC funcional). El refactor estaba reduciendo la disonancia entre "lo que el código vale" y "lo que la UI sugiere". Sigue siendo Foodint en logo, pendiente naming + logo final.

El cambio que más ROI tiene ahora mismo en credibilidad ante clientes potenciales NO es añadir features, sino **terminar Fase 2b (refactor de páginas)** + **decidir nombre/logo**.

---

## 15. SESIÓN 14/05/2026 (CONTINUACIÓN 2) — FASE 2B AVANZADA

Tras cerrar Fase 2a, la sesión continuó con 6 páginas más refactorizadas. Branch `feat/branding-refactor`, HEAD final `d3558c7`, todo pusheado a origin.

### 15.1. Commits realizados en esta tanda

| Commit | Página | Notas |
|---|---|---|
| `a407622` | Fase 2b.1: OtherPages | DashboardPage + LocationsPage. Eliminadas 9 PlaceholderPages zombie. ~280→220 líneas |
| `d6fb4cd` | Fase 2b.2: StaffPage | 1620 líneas refactorizadas. 7 sub-componentes (EmployeeModal, TerminationModal, EmployeeAvatar, PhotoUploader, EmployeeExpiryBanners, NewEmployeeModal, helpers). ~30 emojis → Lucide. EmployeeAvatar granate→accent |
| `fab9d03` | Fase 2b.3: LoginPage | bg-page, header bg-accent con Lock, MailCheck verde éxito, AlertCircle errores |
| `3e471a2` | Fase 2b.4: TodayPage | Status badges semánticos, empty state con ClipboardList, eliminadas constantes GRANATE/BEIGE |
| `f847d14` | Fase 2b.5: OnboardingPage | Stepper bg-accent, badge Esencial bg-warning-bg, iconos Check/Save/ArrowLeft/ArrowRight |
| `d3558c7` | Fase 2b.6: ExecutionPage | Progress bar bg-accent, CheckCircle2 éxito (size 64), items con Check/Circle, AlertTriangle warnings |

### 15.2. Patrón de migración consolidado y probado

Aplicado consistentemente en las 6 páginas. **Mantener exactamente este patrón en próximas páginas**:

| Antes (paleta vieja) | Después (paleta nueva) |
|---|---|
| `const GRANATE = '#7C1A1A'` | Eliminar constante |
| `const BEIGE = '#F5E9D9'` | Eliminar constante |
| `style={{ fontFamily: 'Instrument Serif, serif' }}` | className `font-display` |
| `style={{ color: GRANATE }}` o `color: '#7C1A1A'` | `text-accent` |
| `style={{ backgroundColor: GRANATE, color: BEIGE }}` | `bg-accent text-text-on-accent hover:bg-accent-hover` |
| `bg-[#7C1A1A]` / `bg-[#F5E9D9]` | `bg-accent` / `bg-accent-bg` |
| `border-[#7C1A1A]` | `border-accent` |
| `accent-[#7C1A1A]` | `accent-accent` |
| `bg-white` | `bg-card` |
| `border-gray-200` / `border-gray-300` | `border-border-default` |
| `text-gray-500` / `text-gray-600` | `text-text-secondary` |
| `text-gray-700` / `text-gray-900` | `text-text-primary` |
| `bg-gray-50` / `bg-gray-100` | `bg-page` / `bg-accent-bg` |
| `text-gray-400` (placeholder text) | `text-text-secondary` |
| `bg-emerald-*` / `bg-green-*` | `bg-success-bg` + `text-success` |
| `bg-red-*` (errores) | `bg-danger-bg` + `text-danger` (con `border-danger/30` en bordes) |
| `bg-amber-*` / `bg-orange-*` / `bg-yellow-*` | `bg-warning-bg` + `text-warning` (con `border-warning/30`) |
| `bg-blue-*` (info) | `bg-accent-bg` + `text-accent` |
| `rounded-2xl` | `rounded-xl` |
| `rounded-xl` (en cards pequeños) | `rounded-lg` |
| Bordes redondeados internos | `rounded-md` |
| `transition` (Tailwind genérico) | `transition-base` (token del sistema, 150ms) |
| `min-h-[44px]` (touch target) | `min-h-touch` (token del sistema) |
| Emojis decorativos sueltos | Eliminar (texto plano) |
| Emojis con valor semántico | Iconos Lucide outline 2px, size 14-18px |

### 15.3. Iconos Lucide usados (catálogo definitivo)

**Acciones/CTA**: Plus, X, Check, ArrowLeft, ArrowRight, Save, RefreshCw, LogOut, LogIn, Trash2, Camera, Mail, MailCheck, Lock

**Navegación/UI**: ChevronDown, ChevronRight, Search, Square

**Estado/Feedback**: Check, Circle, CheckCircle2, AlertCircle, AlertTriangle, ShieldCheck, Ban, Info

**Categorías**: BarChart3, Users, Calendar, ClipboardList, Briefcase, FileText, User, UserMinus, UserX, BookOpen, Clock, Bell, Wallet, MapPin, Leaf, Bike, Brain, LayoutDashboard, Activity, Smartphone, Inbox, Armchair, FolderOpen

**Otros**: Sun, Moon, Settings

**Reglas**: `size={14}` en texto inline, `size={16}` en botones, `size={18}` en cards/headers, `size={48-64}` en empty/success states. Trazo 2px (default Lucide). Outline only, nunca filled.

### 15.4. Sub-componentes auxiliares NO refactorizados aún

Detectados durante refactor de páginas pero pendientes de tocar (visibles en capturas con paleta vieja):

- `src/pages/InsightsPage.tsx` — visible en tab "Insights" de Personal, mantiene verde/naranja/azul en stats
- `src/components/personal/DocumentosTab.tsx` — visible en modal Empleado tab Docs, emojis 💰 y 📋
- `src/components/personal/VacacionesTab.tsx` — no inspeccionado
- `src/components/personal/FormacionesTab.tsx` — no inspeccionado

Refactor de estos NO bloquea las páginas principales, se hacen en sub-sprint posterior.

### 15.5. Errores preexistentes confirmados (NO causados por refactor)

- `manifest.json: Syntax error` (línea 1, col 1) — error de PWA preexistente
- Warning `Unused '@ts-expect-error' directive` en App.tsx línea 228 — comentario sobre `inert` ya soportado nativo en React 19, eliminar el `@ts-expect-error`

### 15.6. Decisión sobre Supabase Auth Magic Link email

Email de Magic Link **mantiene paleta vieja** (granate #7C1A1A + "Foodint" en serif vintage). Esto es una **plantilla configurada en el dashboard de Supabase**, no en código.

**Acción pendiente** (NO bloquea piloto):
1. Ir a Supabase → Authentication → Email Templates → Magic Link
2. Cambiar HTML para usar `#1E3A5F` (azul tinta)
3. Cambiar "Foodint" → nombre nuevo del SaaS cuando se decida

### 15.7. Plan de Fase 2b restante (en orden de prioridad)

**Siguiente página a atacar (próxima sesión)**: **APPCC IncidentsPage** (`src/modules/appcc/pages/IncidentsPage.tsx`)

Después, en orden:
1. ⬜ `IncidentsPage` (APPCC) — listado de incidencias, ~10 min
2. ⬜ `CambiosPendientesPage` — solo h1, ~5 min
3. ⬜ `FichajesGlobalPage` — solo h1, ~5 min
4. ⬜ `InformesPage` — solo h1, ~5 min
5. ⬜ `VentasAnalisisPage` — solo h1, ~5 min
6. ⬜ `PrediccionPersonalPage` — solo h1, ~5 min
7. ⬜ `TSpoonPage` — 2 h1 inline, ~5 min
8. ⬜ `UsuariosAccesosPage` — h1 con emoji, ~5 min
9. ⬜ `pages/trabajador/HomeEmpleado.tsx` — pantalla trabajador
10. ⬜ `platform/feature-gate/UpgradePrompt.tsx` — componente platform

**Estimación**: ~1h total para terminar Fase 2b (la mayoría son cambios triviales de h1).

### 15.8. Fase 3 — Pulido y limpieza final (sesión posterior)

Tras cerrar Fase 2b:
- Eliminar `@import` Instrument Serif de `src/index.css`
- Eliminar `legacy.granate` y `legacy.beige` de `tailwind.config.js`
- Eliminar import de Instrument Serif del `<link>` en `index.html` si existe
- Refactor de sub-componentes auxiliares (InsightsPage, DocumentosTab, VacacionesTab, FormacionesTab)
- Microajustes spacing
- Mobile pass
- Build + Lighthouse audit
- Arreglar `@ts-expect-error` en App.tsx línea 228
- Investigar `manifest.json: Syntax error` (revisar `public/manifest.json` o `vite-pwa.config`)

### 15.9. Estilo de trabajo confirmado y validado

Confirmado por el usuario durante la sesión: **"Intenta no darme explicaciones de cada paso que das"**.

Patrón aplicado con éxito:
1. Pedir archivo (subido por usuario o pegado por PowerShell)
2. Generar archivo refactorizado completo en outputs
3. `present_files` para descarga
4. Una sola línea: "Reemplaza X. Captura cuando esté."
5. Esperar captura del usuario
6. Una sola línea de comando git commit
7. Pedir siguiente archivo

NO hacer: explicar cada cambio, hacer balances motivacionales, sugerir parar la sesión salvo que el usuario lo pida.

### 15.10. CÓMO RETOMAR EN PRÓXIMA SESIÓN

**Prompt literal sugerido al usuario** (pegarlo tal cual):

> Continuamos con Foodint Fase 2b refactor branding. Branch `feat/branding-refactor`, HEAD `d3558c7`, todo pusheado. Llevamos 6 páginas refactorizadas: OtherPages, StaffPage, LoginPage, TodayPage, OnboardingPage, ExecutionPage.
>
> SÁLTATE las verificaciones de partida (no me pidas `git status`, no me preguntes por qué página atacar). Vamos directamente a **APPCC IncidentsPage**. Pídeme el archivo `src/modules/appcc/pages/IncidentsPage.tsx`.
>
> Después de IncidentsPage, el orden es: CambiosPendientesPage, FichajesGlobalPage, InformesPage, VentasAnalisisPage, PrediccionPersonalPage, TSpoonPage, UsuariosAccesosPage (todas con solo h1, ~5min cada una), después HomeEmpleado del trabajador, y por último UpgradePrompt.
>
> Estilo de trabajo: respuestas concisas sin explicaciones, archivo entero refactorizado en outputs, yo verifico con captura, commit + push.

**Si el usuario no pega ese prompt y solo dice "continuamos"**: leer este contexto sección 15, ir directo a pedir el archivo `IncidentsPage.tsx`, NO hacer verificaciones previas, NO preguntar qué página atacar (ya está decidido).

**Detección de descontextualización**: si el usuario pide algo que NO encaje con el plan (ej: horarios de un local con turno partido — esto pasó al inicio de esta sesión, era una idea anterior olvidada que el usuario decidió ignorar), preguntar amablemente antes de invertir esfuerzo en generar nada.

### 15.11. Estado emocional del usuario al cerrar

Tras ~6h de trabajo continuado (Sprint B1b APPCC + Fase 1 + Fase 2a + Fase 2b parcial), el usuario sigue lúcido y disciplinado. Ha hecho commits limpios, pushes regulares, verificaciones con captura entre cambios. Acepta de buen grado la sugerencia de seguir con páginas concretas pero rechaza propuestas de cerrar antes de tiempo cuando tiene energía.

El usuario tiene clara la decisión estratégica de fondo: lo importante no es añadir features, es terminar Fase 2b + decidir nombre/logo para empezar a vender. Madurez de fundador, no de programador.
