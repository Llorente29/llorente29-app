# Folvy V1 — Roadmap de ejecución

**Fecha de cierre:** 18 de mayo de 2026 (Sesión 3)
**Versión:** 1.0
**Estado:** roadmap aprobado, listo para arranque inmediato de Sesión 4 (ejecución técnica).
**Documentos complementarios:**
- `folvy_arquitectura_reconciliada.md` (Sesión 0).
- `folvy_v1_spec.md` (Sesión 1).
- `folvy_auth_model.md` (Sesión 2).
- `CONTEXTO_CLAUDE.md` versión P7-S0+.

---

## 0. Sobre este documento

Este documento es el **entregable de Sesión 3**: el plan de ejecución desde hoy hasta Llorente29 en producción con Folvy V1.

Es **roadmap inverso**: partimos del objetivo final (producción) y trabajamos hacia atrás identificando bloques de trabajo y dependencias. Esto evita el error clásico de planificar lo fácil primero y descubrir tarde que falta algo crítico.

**Las fechas marcan límites máximos, no objetivos.** El equipo tiene capacidad para cumplir antes. Si los sprints se completan más rápido, se acelera el calendario completo.

---

## 1. Decisiones de partida registradas en Sesión 3

### 1.1 — Capacidad de trabajo CEO

Julio dedica **40+ horas/semana** full-time a Folvy hasta producción. Prioridad absoluta sobre día a día CEO.

### 1.2 — Camino arquitectónico

**Camino A puro** confirmado (sin atajos). Decisión consciente del CEO de mantener calidad técnica incluso ante riesgo competitivo con Llorente29.

Implicación: NO se hacen atajos sobre código viejo. Folvy V1 se construye limpio desde Fase 0. Si Llorente29 se va a competencia durante el desarrollo, se acepta como riesgo asumido.

### 1.3 — Estructura del equipo de ejecución

- **Julio Gascón (CEO)** — interlocutor principal. Decisiones de arquitectura, producto, validaciones, despliegues. Cabeza estratégica.
- **Refuerzo técnico contratado** — ya activo. Operador técnico principal en código. Cuando opere en lugar de Julio, **se identificará explícitamente al inicio de su turno** ante Claude. **Tiene autoridad delegada por Julio para tomar todas las decisiones técnicas necesarias**, incluyendo aprobación de SQL antes de ejecutar, decisiones arquitectónicas dentro de su turno, y modificaciones de código en cualquier archivo (incluido App.tsx).
- **Claude** — propuestas, generación de código completo de archivos, audit técnico, debugging. No ejecuta nada.

### 1.4 — Reglas no negociables actualizadas

Las 10 reglas del proyecto (CONTEXTO_CLAUDE.md) se mantienen vigentes con las siguientes precisiones:

- **Regla 3** ("NO modificar App.tsx sin permiso explícito mío"): "mío" significa Julio O refuerzo identificado.
- **Regla 7** ("SQL revisable ANTES de ejecutar. Tú propones, yo ejecuto y verifico"): "yo" significa el humano operando en el momento.
- **Identificación obligatoria del refuerzo**: cuando entra a operar, primera línea de la conversación debe ser declaración explícita (ej: "Soy [Nombre], el refuerzo técnico de Julio"). Si Claude no sabe quién está al teclado, asume Julio por defecto.
- **Onboarding obligatorio del refuerzo**: al incorporarse, refuerzo lee `CONTEXTO_CLAUDE.md` + Sesiones 0-1-2-3 completas antes de tocar código.

### 1.5 — Escenario Llorente29

Cliente al límite. Puede irse a competencia si se retrasa. CEO acepta el riesgo manteniendo Camino A puro.

**Plan B comercial paralelo recomendado** (responsabilidad CEO, no técnica):
1. Llamada honesta con Llorente29 explicando calendario realista.
2. Activar prospección Cliente 2 + Cliente 3 durante las 12-16 semanas.
3. Considerar incentivos de retención (descuento primer año, soporte premium, garantía de migración asistida).
4. Tener narrativa lista para futuros clientes ("¿quién es vuestro cliente actual?") por si Llorente29 cae.

---

## 2. Objetivo final

**Llorente29 en producción con Folvy V1 estable.**

Definición concreta:
- Llorente29 deja de usar Foodint y opera 100% en Folvy V1.
- 3 locales activos: Alcalá, Pza Castilla, Carabanchel.
- Pamela y empleados fichando desde kiosko o móvil (con geofencing).
- APPCC ejecutándose diariamente con 7 planes + 26 plantillas seed.
- Cuadrante de turnos planificado semanalmente con cruce de ventas Last.app.
- Vacaciones y cambios de turno fluyendo via Portal del Empleado.
- Auditorías internas mensuales + capacidad de recibir inspección externa con modo inspector activo.
- Sin bugs críticos pendientes.
- Sin atajos técnicos heredados.

**Fecha objetivo máxima:** 7 septiembre 2026 (16 semanas desde hoy).
**Fecha objetivo ambiciosa:** julio 2026 si capacidad del equipo lo permite.

---

## 3. Pre-requisitos bloqueantes del CEO

Trabajos del CEO **antes** de que el código pueda moverse. Sin estos resueltos, no hay forma de ejecutar Fase 0.

| Pre-requisito | Decisor | Plazo | Bloquea a |
|---|---|---|---|
| Llamada Llorente29 + comunicar calendario realista | Julio | Semana 1 | Plan B comercial |
| PITR Supabase Pro activado | Julio | Semana 1 | Sprint 1 (no se puede tocar BBDD sin backup robusto) |
| Hosting Vercel cuenta + dominio apuntado | Julio | Semana 1 | Sprint 3 (deploy del Shell) |
| Provider email transaccional (Resend recomendado) | Julio | Semana 1 | Sprint 2 (welcome emails) |
| Dominios Folvy confirmados (`folvy.app`, `app.folvy.app`) | Julio | Semana 1 | Sprint 3 |
| Subir documentos Sesiones 0-1-2-3 al Project Knowledge | Julio | Semana 1 | Refuerzo técnico onboarding |

Sin estos resueltos antes del Sprint 1, todo el calendario se desliza.

---

## 4. Estructura general del plan

```
HOY (18 mayo 2026)
  ↓
Pre-Fase 0 (Semanas 1-2): preparación CEO + setup proyecto
  ↓
Fase 0 (Semanas 3-9): Shell + auth + panel admin + rebrand + permission sets + maestros
  ↓
Fase 1 (Semanas 10-15): módulos funcionales V1 (Team + Safety + Sales backend)
  ↓
Fase 2 (Semana 16): migración Llorente29 + producción
  ↓
PRODUCCIÓN (Septiembre 2026): Llorente29 vivo en Folvy V1
```

**Total: 16 semanas = 4 meses.** Producción objetivo: domingo 7 septiembre 2026.

---

## 5. Pre-Fase 0 — Preparación

### Sprint 0.1 — Esta semana (19-23 mayo 2026)

**Objetivos CEO:**
- Llamada Llorente29 confirmar calendario realista (septiembre 2026). Decisión sobre incentivos retención si Julio quiere.
- Decidir hosting (Vercel recomendado) + activar cuenta.
- Decidir provider email transaccional (Resend recomendado) + activar.
- Activar PITR Supabase Pro.
- Confirmar dominios `folvy.app` + `app.folvy.app` registrados y apuntando.
- Subir documentos Sesiones 0-1-2-3 al Project Knowledge.
- Briefing al refuerzo técnico ya contratado: lectura de Sesiones 0-1-2-3.

**Objetivos técnicos:** NINGUNO. No se toca código hasta tener infraestructura y onboarding completados.

**Hito verificable viernes 23 mayo:**
- Llorente29 informado.
- Vercel + Resend + PITR activos.
- Refuerzo técnico ha terminado lectura de las 3 sesiones documentales.

### Sprint 0.2 — Próxima semana (26-30 mayo 2026)

**Objetivos CEO + refuerzo:**
- Setup técnico completo: refuerzo tiene acceso GitHub repo, Supabase project, herramientas dev.
- Comprar dominios secundarios si no los hay (`folvy.es`, `folvy.app`).
- Sesión de arquitectura entre Julio + refuerzo + Claude para alinear visión.

**Objetivos técnicos:**
- Limpiar repo actual: borrar branches viejas, documentar README.
- Crear branch `folvy-v1` desde `main` actual.
- Preparar SQL de migraciones auth (sin ejecutar todavía): borrador completo de las 16 migrations del orden de Sesión 2 §10.6.
- Tests baseline del código actual para detectar regresiones futuras.

**Hito verificable viernes 30 mayo:**
- Repo limpio, branch `folvy-v1` lista.
- SQL de migración auth revisado por Julio (regla 7), pendiente de ejecutar.
- Refuerzo familiarizado con el codebase actual.

---

## 6. Fase 0 — Construcción de la base técnica

Construcción de todo lo que NO es funcionalidad de cliente final pero ES indispensable: Shell, auth, panel admin, rebrand, permission sets, maestros.

**Durante toda Fase 0, Llorente29 sigue en Foodint actual.** El nuevo código se construye en paralelo, sin tocar producción.

### Sprint 1 — BBDD auth + onboarding completo (Semana 3, 2-6 junio 2026)

**Objetivos:**
- Ejecutar las 16 migrations auth de Sesión 2 §10.6 en BBDD.
- Crear funciones auxiliares RLS (`is_account_admin_or_manager`, `is_platform_admin`, `has_permission`, `belongs_to_account`).
- Crear políticas RLS auth (`platform_admins`, `permission_sets`, `impersonation_sessions`, `auth_rate_limits`, `platform_audit_log`).
- Seed inicial: 4 `permission_sets` system globales + Julio CEO como primer `platform_admin` + `platform_admin_2fa` activado.
- Verificar `flowType: 'implicit'` actual: decidir migración a `signInWithPassword`.

**Hito verificable viernes 6 junio:**
- BBDD tiene todas las tablas auth nuevas con constraints + índices.
- RLS funciona: query SELECT de prueba con usuario distinto devuelve solo sus datos.
- Julio CEO puede consultar su `platform_admin` en Supabase dashboard.

**Riesgos:**
- Migración del `flowType` actual rompe usuarios existentes (mitigación: script de migración de usuarios + tests baseline).
- RLS funciones recursivas causan bucles (mitigación: review intensivo + tests con datos reales).

### Sprint 2 — Auth email+password + flows + Edge Functions (Semana 4, 9-13 junio 2026)

**Objetivos:**
- Cambiar `flowType` a `signInWithPassword`.
- Construir pantallas `/login`, `/welcome?token`, `/reset-password`, `/reset-password/confirm` según Sesión 2 capa C.
- Implementar Edge Function `custom-access-token-hook` con claims Folvy (Sesión 2 §3.2).
- Implementar Edge Function `check-account-status`.
- Hooks del Shell: `useAuth()`, `useAccount()`, `useMembership()`, `usePermission()`.
- Audit log de eventos auth funcionando.

**Hito verificable viernes 13 junio:**
- Cualquier user con `auth.users` activo puede hacer login con email+password.
- Welcome flow funciona end-to-end con magic link.
- Reset password flow funciona end-to-end.
- Audit log registra cada evento de auth.
- Claims JWT correctos al loguearse.

**Riesgos:**
- Edge Functions con bugs de claims (mitigación: tests integration desde día uno con casos límite).
- Cambio de flowType rompe flujos magic link actuales (mitigación: migrar usuarios con script en Sprint 1).

### Sprint 3 — Shell layout + Rebrand Folvy completo (Semana 5, 16-20 junio 2026)

**Objetivos:**
- Construir el Shell nuevo:
  - **TopBar**: módulos disponibles (Personal/APPCC/Sales placeholders).
  - **ModuleSidebar**: navegación específica del módulo activo.
  - **Header transversal**: selector cuenta, selector local, avatar, notificaciones.
- Reemplazar sidebar único actual.
- Rebranding visual completo:
  - Paleta: `page #F5F4F0`, `accent #1E3A5F`, `brand-accent #D67442`.
  - Tipografía: Fraunces 700 para titulares, Inter 400/500 UI, JetBrains Mono cifras.
  - Logos Folvy aplicados (Manager logo, isotipo Empleados).
- PWA básico configurado con manifest para Folvy Manager.

**Hito verificable viernes 20 junio:**
- App actual Foodint navegable con UI nueva Folvy.
- Cambio entre módulos visible (módulos vacíos por dentro).
- Selector de cuenta funciona (multi-cuenta).
- Selector de local del Header funciona.
- App instalable como PWA Folvy Manager.

**Riesgos:**
- Romper navegación actual durante refactor (mitigación: feature flag `use_new_shell` para alternar mientras se valida).

### Sprint 4 — Panel superadmin Folvy `/_admin` (Semana 6, 23-27 junio 2026)

**Objetivos:**
- Construir `/_admin/login` + `/_admin/2fa` + activación inicial 2FA.
- Construir `/_admin/dashboard` con métricas básicas (cuentas activas, errores 24h).
- Construir `/_admin/cuentas` con listado + filtros + búsqueda.
- Construir wizard `/_admin/cuentas/nueva` (5 pasos de Sesión 1 §8.3).
- Implementar Edge Function `start-impersonation` + `end-impersonation`.
- Banner persistente impersonation en TopBar.
- Tabla `impersonation_sessions` con trigger de cleanup automático >4h.

**Hito verificable viernes 27 junio:**
- Julio puede hacer login en `/_admin` con 2FA + backup codes.
- Puede crear una cuenta cliente desde el wizard.
- Puede impersonar a la cuenta recién creada.
- Audit log registra todas las operaciones de panel admin.
- Cleanup automático funciona si impersonation no se cierra.

**Riesgos:**
- 2FA setup complejo (mitigación: usar librería `otplib` probada).
- Impersonation con doble JWT puede tener bugs sutiles (mitigación: tests exhaustivos de RLS bajo impersonation).

### Sprint 5 — Configuración cuenta + Permission Sets UI (Semana 7, 30 junio - 4 julio 2026)

**Objetivos:**
- Construir sección Configuración del Shell completa (Sesión 1 §7).
- Implementar editor de `permission_sets` con accordion agrupado (Sesión 2 capa D).
- Implementar wizard "Crear gestor" (Sesión 2 §6.7).
- Implementar listado de usuarios con tabla + filtros.
- Resolución cascada de permisos: override > set > default DENY.
- Subscripción Realtime para invalidación automática de sesiones al cambiar permisos.

**Hito verificable viernes 4 julio:**
- Admin de cuenta puede crear gestores nuevos con permission sets.
- 4 permission sets system precargados visibles y editables.
- Admin puede crear sets custom desde cero o por duplicación.
- Resolución de permisos funciona correctamente (test: override gana sobre set).
- Usuario suspendido pierde acceso inmediatamente vía Realtime.

**Riesgos:**
- Resolución de permisos compleja con override + set + flags (mitigación: tests exhaustivos de `has_permission()` con casos límite).

### Sprint 6 — Migración maestros al Shell + Feature flags (Semana 8, 7-11 julio 2026)

**Objetivos:**
- Mover CRUD de marcas, locales, centros de coste, canales de venta, cuentas de análisis a Configuración Shell.
- Crear tabla `suppliers` (stub para V1.1+).
- Crear tabla `location_geofences` con coordenadas + radio para fichaje móvil futuro.
- Migrar feature flags a `accounts.feature_flags jsonb` (los ~20 toggles consolidados de Sesión 1).
- Implementar UI de feature flags en Configuración por módulo (Sesión 1 §7.6).
- Hooks útiles del Shell: `useFeatureFlag()`, `useFiscalData()`.

**Hito verificable viernes 11 julio:**
- Toda la configuración de cuenta accesible desde un lugar.
- Feature flags funcionan: cambiar uno afecta inmediatamente la UI.
- Maestros sincronizados con BBDD.
- Geofence configurable por local (lat, long, radio).

### Sprint 7 — Pulido Fase 0 + Testing intensivo + Staging (Semana 9, 14-18 julio 2026)

**Objetivos:**
- Testing integration completo de auth flows.
- Testing RLS policies con datos reales (worker no ve datos otra cuenta, etc.).
- Testing impersonation con casos límite.
- Limpiar bugs acumulados durante Fase 0.
- Documentación interna actualizada para refuerzo y futuros desarrolladores.
- Deploy a entorno staging permanente con dominio propio.
- Backup completo de BBDD pre-Fase 1.

**Hito verificable viernes 18 julio: FIN DE FASE 0.**
- Shell completo funcional.
- Auth completo + panel admin operativo con 2FA.
- Multi-tenancy + RLS blindado en todas las tablas.
- Permission sets operativos.
- Rebrand Folvy completo.
- Lista para empezar a construir módulos funcionales.

**Demo viable de Fase 0:** Julio puede mostrar Folvy a inversores / clientes potenciales / Llorente29 con producto vacío de funcionalidad pero estructura completa y profesional. Argumento comercial: "esto es la base sólida; ahora construimos los módulos rápido".

---

## 7. Fase 1 — Módulos funcionales V1

Construcción de la funcionalidad real que el cliente final usa. Cada sprint = un grupo coherente de funcionalidad.

### Sprint 8 — Folvy Team T1 + T2 (Semana 10, 21-25 julio 2026)

**Objetivos:**
- **T1 Empleados**:
  - Wizard 5 pasos (datos personales, laborales, locales, PIN kiosko, confirmación).
  - Listado con filtros + métricas (plantilla total, fichando ahora, vacaciones).
  - Detalle + edición libre con validación required/recommended.
  - Bajas: suspender (reversible), dar de baja (archivado), borrado RGPD.
- **T2 Fichajes**:
  - Kiosko fullscreen `/[slug]/kiosko/[location_id]` con PIN.
  - Admin view con tabla + filtros.
  - Edición con motivo obligatorio + audit log.
  - Detección automática de incidencias (entrada sin salida, doble fichaje, etc.).
  - Export PDF/CSV.

**Hito verificable viernes 25 julio:**
- Crear empleado de prueba con wizard.
- Empleado ficha desde kiosko (entrada/salida/descansos).
- Admin edita un fichaje retroactivo con motivo, queda en audit.
- Exportar fichajes de la semana a PDF.

### Sprint 9 — Folvy Team T3 + T4 + T5 (Semana 11, 28 julio - 1 agosto 2026)

**El sprint más cargado.** T3 con L2 completo es el bloque más grande de Folvy Team.

**Objetivos:**
- **T3 Turnos y Calendario L1+L2**:
  - Cuadrante semanal/mensual con drag & drop.
  - Plantillas reutilizables (CRUD + aplicar a semana).
  - Métricas cobertura (panel lateral toggleable).
  - **Sales-based scheduling visual**: cruce ventas histórico mismo día semana (de tabla `sales` poblada por adapter Last.app — preparado para Sprint 13).
  - **Marketplace turnos abiertos**: manager publica turno, empleados elegibles se postulan.
  - **Sugerencia candidatos** al asignar turno (disponibilidad + sin solapamiento + sin extras).
  - **Real-time labor vs sales tracking** durante el servicio.
  - **Alertas compliance básicas**: descanso 12h, horas semanales máximas.
- **T4 Vacaciones**:
  - Tipos ausencia (vacaciones, día personal, baja, retribuido, no retribuido, festivo trabajado).
  - Saldo configurable + cálculo proporcional.
  - Flujo solicitud worker → aprobación manager.
  - Calendario consolidado mensual.
  - Festivos por CCAA precargados España.
- **T5 Cambios de Turno**:
  - 3 mecanismos: swap (A↔B), give up (marketplace), request (al manager).
  - 7 estados.
  - Validaciones automáticas al manager aprobar.

**Hito verificable viernes 1 agosto:**
- Manager planifica cuadrante semanal con cruce ventas histórico visible.
- Worker solicita vacaciones desde Portal mockup.
- Worker propone swap a compañero, swap fluye hasta aprobación manager.
- Sistema detecta conflictos automáticamente.

**Riesgos:**
- Sprint denso. Si T3 L2 completo no llega → priorizar L1+sales-based scheduling primero; marketplace + sugerencias pasan al Sprint 10 si no da tiempo.

### Sprint 10 — Folvy Team T6 + T7 + T8 (Semana 12, 4-8 agosto 2026)

**Objetivos:**
- **T6 Plantilla y Bolsa de horas**:
  - Vista plantilla con desviaciones contratadas vs reales.
  - Bolsa: cálculo automático + 6 tipos movimiento.
  - **Doble toggle config cuenta**: `hour_balance_enabled` + `hour_balance_visible_to_worker`.
  - Solicitud recuperación (worker) + liquidación horas extra (manager).
  - Alertas (saldo > tope, cerca caducidad, sin disfrutar 3 meses).
- **T7 Portal del Empleado (App Folvy Empleados)**:
  - PWA mobile-first con manifest propio + isotipo Empleados.
  - Bottom tab dinámico (Hoy / Mis turnos / APPCC / Vacaciones / Bolsa / Yo).
  - Pantalla Hoy con tarjeta fichaje + próximo turno + tareas APPCC.
  - **Fichaje móvil con geofencing OBLIGATORIO** (refuerzo Sesión 1): mapa con posición + radio local + validación servidor.
  - Sección APPCC dedicada con tabs (Hoy / Próximas / Histórico).
  - Tab Yo: perfil editable + notificaciones + seguridad + ayuda.
- **T8 Export gestoría**:
  - Cierre automático mensual (última semana del mes) + manual.
  - 3 formatos: PDF + Excel + CSV.
  - Configuración cuenta de destinatarios.
  - Envío email + hash integridad.
  - Histórico envíos + modificaciones retroactivas marca `superseded`.

**Hito verificable viernes 8 agosto:**
- Worker accede a su Portal desde móvil (PWA instalada con icono Folvy Empleados).
- Worker ficha desde móvil con geofencing activo (validación distancia al local).
- Bolsa de horas calculada correctamente con movimientos automáticos.
- Cierre gestoría generado y enviado por email a gestoría configurada.
- **Fin de Folvy Team completo.**

### Sprint 11 — Folvy Safety S1 + S2 + S3 (Semana 13, 11-15 agosto 2026)

**Objetivos:**
- **S1 Catálogo planes APPCC**:
  - 7 planes legales precargados (ya en BBDD desde P6).
  - Activación/desactivación por cuenta.
  - **Plantillas personalizables desde V1** (refuerzo Sesión 1): tabla `account_plan_templates` separada de seed inmutable. Crear desde cero o por duplicación.
  - Asignación responsable APPCC por local.
- **S2 Plantillas y Schedules**:
  - 8 tipos de check (check, temperature, number, text, photo, signature, single_choice, multi_choice).
  - 11 tipos de frecuencia.
  - Ventana ejecución (inicio + límite + margen).
  - **Asignación dinámica por turno activo** (refuerzo Sesión 1): default Modo 1. Sistema mira fichajes/turnos activos + filtra puesto + excluye baja/vacaciones + asigna al primero con menor carga.
  - Fallback cascada si no encuentra.
  - 26 plantillas seed disponibles.
- **S3 Ejecución diaria**:
  - Worker accede desde Portal "Hoy" + Sección APPCC + Kiosko.
  - Wizard ejecución paso a paso con UI específica por tipo check.
  - Geolocalización en ejecución móvil (no bloqueante a diferencia fichaje).
  - 7 estados ejecución.
  - Pausar/reanudar (otro worker puede continuar).
  - Validación retroactiva con prohibición valores numéricos inventados.

**Hito verificable viernes 15 agosto:**
- 26 plantillas seed disponibles + plantilla personalizada creada desde duplicación.
- Schedules generan tareas automáticamente a 00:00.
- Worker ejecuta tarea APPCC desde Portal con todos los 8 tipos de check.
- Tarea pausada por worker A, continuada por worker B compatible.

### Sprint 12 — Folvy Safety S4 + S5 + S6 (Semana 14, 18-22 agosto 2026)

**Objetivos:**
- **S4 Incidencias y acciones correctivas**:
  - 8 tipos de incidencia (out_of_range, check_failed, task_missed, manual_report, audit_finding, etc.).
  - Workflow 7 estados (open → assigned → in_action → pending_verification → resolved → closed → reopened).
  - Reglas escalamiento automático (sin asignar >4h, etc.).
  - 5 porqués opcional para análisis causa raíz.
  - Acciones correctivas + preventivas.
- **S5 Auditorías internas y externas**:
  - Plantillas auditoría seed + personalizadas.
  - Auditorías internas scheduled (mensual, trimestral).
  - Auditorías externas registradas al ocurrir (wizard).
  - Ejecución con secciones plegables + comentarios detallados + múltiples fotos.
  - **Modo "Inspector presente"**: pantalla 1-click + QR + email al inspector.
  - Hallazgos negativos generan incidencias automáticamente.
- **S6 Carpeta APPCC y reportes**:
  - Dossier consolidado bajo demanda con 10 secciones.
  - 3 formatos (PDF maestro / ZIP / Excel).
  - Dashboards online con métricas + gráficos + comparativa locales.
  - Alertas proactivas (carnet manipulador vence, análisis agua pendiente, etc.).

**Hito verificable viernes 22 agosto:**
- Incidencia automática al fallar check de temperatura.
- Auditoría interna mensual ejecutable end-to-end.
- Auditoría externa registrada con datos inspector.
- **Modo inspector 1-click**: en <30 segundos genera PDF carpeta APPCC últimos 12 meses + QR + envío email.
- Alertas proactivas funcionan (carnet manipulador a vencer en 30 días).
- **Fin de Folvy Safety completo.**

### Sprint 13 — Folvy Sales V1 backend + Rehearsal migración + Pulido (Semana 15, 25-29 agosto 2026)

**Objetivos:**
- **Folvy Sales V1**:
  - Adapter Last.app conectado vía Edge Function.
  - Sync cron programado (default cada 1h).
  - Tabla `sales` acumulando datos reales de Llorente29 (importación histórica si Last.app expone).
  - Mapeo Last.app stores ↔ Folvy locations.
  - Cruce funcional en T3 cuadrante (sales-based scheduling visual).
  - Real-time labor vs sales tracking durante servicio.
  - Configuración cuenta: API key encriptada, estado conexión, sync manual, test conexión.
- **Rehearsal migración Llorente29 en staging**:
  - Día completo (jueves típicamente) dedicado.
  - Clonar BBDD producción Foodint a entorno staging.
  - Ejecutar migración completa: cuenta + locales + empleados + APPCC histórico + brand.
  - Validar todos los datos con Pamela como tester.
  - Identificar bugs / problemas.
- **Pulido final**:
  - Testing intensivo end-to-end de los 11 flujos de Sesión 2 capa E.
  - Fixes acumulados durante Fase 1.
  - Performance testing (cuadrante con 50 empleados debe cargar <1s).
  - Verificación performance budgets (Sesión 2 §10.2).
  - Backup completo BBDD staging.

**Hito verificable viernes 29 agosto:**
- 1 semana de ventas Last.app sincronizadas correctamente.
- Manager ve cuadrante con cruce ventas histórico.
- Rehearsal de migración Llorente29 ejecutado en staging sin bugs críticos.
- Sistema estable, performance budgets cumplidos.

---

## 8. Fase 2 — Migración Llorente29 a producción

### Sprint 14 — Migración + Producción (Semana 16, 1-7 septiembre 2026)

**Lunes-jueves: migración técnica.**

**Objetivos:**
- Crear cuenta Llorente29 en Folvy V1 PRODUCCIÓN (Modalidad 3 desde panel admin).
- Migrar empleados, locales, brands de Foodint a Folvy.
- Migrar APPCC ejecuciones históricas (si Llorente29 quiere conservarlas).
- Configurar Last.app adapter para Llorente29 producción.
- Generar accesos para todos los empleados de Llorente29.
- Enviar welcome emails a admin Llorente29 + managers.
- Configurar PINs kiosko para empleados.
- Subir geofence coords de los 3 locales (Alcalá, Pza Castilla, Carabanchel).
- Validación final con Julio Llorente29 (admin del cliente).

**Viernes-domingo: formación + producción real.**

**Objetivos:**
- 2-3 sesiones formación presenciales con managers Llorente29.
- 1 sesión grupal con empleados clave (Pamela y otros encargados).
- **Domingo 7 septiembre: DAY 1 PRODUCCIÓN REAL.**
- Llorente29 deja Foodint. Toda operativa pasa a Folvy V1.
- Julio + refuerzo on-call durante el fin de semana.

**Hito verificable domingo 7 septiembre 2026: LLORENTE29 EN FOLVY V1 PRODUCCIÓN.**

**Riesgos:**
- Migración de datos compleja (mitigación: rehearsal Sprint 13 detecta problemas con tiempo).
- Resistencia al cambio del equipo Llorente29 (mitigación: formación + Pamela como evangelista interna).
- Bugs descubiertos en producción (mitigación: tú + refuerzo on-call 2 semanas post-launch).
- Last.app cambia algo a último momento (mitigación: hooks defensivos en adapter).

### Semanas 17-18 — Estabilización post-launch (8-19 septiembre 2026)

**No es sprint formal**, es período de estabilización con cliente en producción.

**Objetivos:**
- Julio + refuerzo on-call durante 2 semanas con respuesta <2h.
- Recoger feedback Llorente29 + ajustar.
- Fix bugs descubiertos en producción real.
- Documentar lecciones aprendidas para Cliente 2.

**Hito verificable viernes 19 septiembre 2026:** Llorente29 estable. Sistema en operación normal. Listo para captar Cliente 2.

---

## 9. Tabla resumen del calendario

| Sprint | Semana | Fechas | Objetivo principal |
|---|---|---|---|
| 0.1 | 1 | 19-23 mayo | Preparación CEO + lectura refuerzo |
| 0.2 | 2 | 26-30 mayo | Setup proyecto + SQL preparado |
| 1 | 3 | 2-6 junio | BBDD auth + funciones RLS |
| 2 | 4 | 9-13 junio | Auth flows + Edge Functions |
| 3 | 5 | 16-20 junio | Shell + Rebrand Folvy |
| 4 | 6 | 23-27 junio | Panel admin + Impersonation |
| 5 | 7 | 30 jun - 4 jul | Configuración + Permission sets UI |
| 6 | 8 | 7-11 julio | Maestros + Feature flags |
| 7 | 9 | 14-18 julio | **FIN FASE 0** — Testing y staging |
| 8 | 10 | 21-25 julio | Team T1 + T2 |
| 9 | 11 | 28 jul - 1 ago | Team T3 + T4 + T5 |
| 10 | 12 | 4-8 agosto | Team T6 + T7 + T8 |
| 11 | 13 | 11-15 agosto | Safety S1 + S2 + S3 |
| 12 | 14 | 18-22 agosto | Safety S4 + S5 + S6 |
| 13 | 15 | 25-29 agosto | Sales V1 + Rehearsal migración |
| 14 | 16 | 1-7 septiembre | **PRODUCCIÓN LLORENTE29** |
| Post | 17-18 | 8-19 septiembre | Estabilización post-launch |

---

## 10. Riesgos consolidados

### Riesgo 1 — Pérdida de Llorente29 antes de septiembre

**Probabilidad:** media-alta (CEO ya lo asume).
**Impacto:** pérdida del cliente fundador.
**Mitigación técnica:** ninguna (decisión arquitectónica firme).
**Mitigación comercial:** plan B comercial paralelo (§1.5).

### Riesgo 2 — Sprint 9 (T3+T4+T5) no entra en una semana

**Probabilidad:** media (sprint denso).
**Impacto:** desliza 1 semana el calendario.
**Mitigación:** priorización clara: L1 + sales-based scheduling primero. Marketplace + sugerencias pasan al Sprint 10 si no da tiempo.

### Riesgo 3 — Edge Function `custom-access-token-hook` con bugs sutiles

**Probabilidad:** alta (es código nuevo + crítico).
**Impacto:** auth roto = todo roto.
**Mitigación:** tests integration exhaustivos desde Sprint 2. Casos límite: user sin profiles, user con profiles en cuentas suspendidas, platform_admin + user cliente simultáneo.

### Riesgo 4 — Last.app cambia API a último momento

**Probabilidad:** baja-media.
**Impacto:** Folvy Sales V1 no funciona el día 1.
**Mitigación:** adapter con hooks defensivos. Mock data para desarrollo. Llamada técnica con Last.app antes de Sprint 13.

### Riesgo 5 — Performance: cuadrante con 50 empleados es lento

**Probabilidad:** media.
**Impacto:** UX inaceptable para clientes grandes (Cliente 2 podría ser 50+ empleados).
**Mitigación:** performance budgets explícitos (Sesión 2 §10.2). Testing carga en Sprint 13. Optimización paginación + lazy loading desde Sprint 9.

### Riesgo 6 — Refuerzo técnico se va o no cumple

**Probabilidad:** baja-media (ya contratado pero proyectos largos pueden cambiar circunstancias).
**Impacto:** capacidad cae 50%, calendario desliza.
**Mitigación:** plan B comercial + considerar backup freelance + Claude puede asumir más carga proponiendo código más completo.

### Riesgo 7 — RLS policies con bugs que comprometan multi-tenancy

**Probabilidad:** baja (con tests) pero impacto catastrófico.
**Impacto:** un cliente ve datos de otro = fin de Folvy + posible demanda legal RGPD.
**Mitigación:** tests exhaustivos en Sprint 1 + Sprint 7. Pentesting V2+. Por ahora: tests automatizados de RLS antes de cada deploy a producción.

---

## 11. Capacidad y dependencias del equipo

### Capacidad semanal total

- **Julio CEO**: 40+ h/semana.
- **Refuerzo técnico**: 40 h/semana asumido (full-time).
- **Claude**: disponibilidad ilimitada (no es recurso humano).

**Capacidad humana técnica: ~80h/semana.**

### Distribución típica de tiempo

- **Decisiones arquitectónicas y validaciones (Julio):** 15h/semana.
- **Generación código (refuerzo + Claude propone):** 40h refuerzo + tiempo Claude proporcional.
- **Code review (Julio):** 10h/semana.
- **Despliegues + BBDD (Julio):** 5h/semana.
- **Conversaciones de alineación + bloqueos:** 5h/semana.
- **Buffer y reuniones:** 5h Julio.

### Dependencias críticas para no romper el calendario

1. **Pre-Fase 0 (Semanas 1-2)** debe terminarse limpia. Si no:
   - Sin PITR: no se toca BBDD (regla 5).
   - Sin hosting: no se despliega nada.
   - Sin email transaccional: welcome flow no funciona.
   - Sin refuerzo onboardeado: empezar Sprint 1 es ineficiente.
2. **Sprint 1 (BBDD auth)** es bloqueador de TODO. Sin BBDD auth funcionando, Sprint 2 no puede empezar.
3. **Sprint 7 (Fin Fase 0)** es bloqueador de Fase 1. Sin Shell + auth + panel admin estables, los módulos funcionales no se construyen sobre nada.
4. **Sprint 13 (Rehearsal)** es bloqueador de producción. Si rehearsal detecta bugs críticos, Sprint 14 no se ejecuta.

---

## 12. Comunicación y rituales

### Daily rituals (recomendados)

- **9:00**: Julio + refuerzo + (si necesario) Claude consultar prioridades del día.
- **18:00**: Julio review código del día (PRs del refuerzo) antes de cerrar.

### Weekly rituals (obligatorios)

- **Viernes 17:00**: review del sprint que termina. Hito verificable cumplido o no. Decidir si se desliza o se ajusta.
- **Domingo 18:00 (opcional)**: Julio prepara prioridades semana siguiente para empezar lunes con claridad.

### Sesiones con Claude

- Antes de cada sprint: sesión técnica con Claude para spec detallada del sprint.
- A mitad de cada sprint: bloqueo importante → consulta con Claude.
- Final de cada sprint: revisión de qué se hizo + actualización de CONTEXTO_CLAUDE.md.

### Comunicación con Llorente29

- **Cada 2 semanas**: email a admin Llorente29 con avance y fecha estimada.
- **Semana 10**: invitar a Pamela y admin Llorente29 a sesión demo de Folvy Manager.
- **Semana 13**: confirmar fecha exacta migración (1 semana antes de Sprint 14).

---

## 13. Próximos pasos inmediatos

**Hoy mismo (18 mayo 2026):**

1. Julio confirma este roadmap.
2. Julio sube los 4 documentos (Sesiones 0-1-2-3) al Project Knowledge.
3. Julio publica oferta para refuerzo técnico **YA CUBIERTA** según decisión de Sesión 3.
4. Julio agenda llamada con Llorente29 para esta semana.

**Esta semana (Sprint 0.1, 19-23 mayo):**

1. Julio ejecuta lista de pre-requisitos CEO.
2. Refuerzo lee Sesiones 0-1-2-3 completas.
3. Empezar Sesión 4 (técnica) cuando refuerzo esté listo.

---

## 14. Resumen ejecutivo

Folvy V1 se construye en **16 semanas** (~4 meses) sin atajos, con base técnica sólida desde día uno. Estructura:

- **Pre-Fase 0** (2 semanas): preparación CEO + onboarding refuerzo.
- **Fase 0** (7 semanas): Shell + auth + panel admin + rebrand + permission sets + maestros.
- **Fase 1** (6 semanas): módulos funcionales (Team + Safety + Sales backend).
- **Fase 2** (1 semana): migración Llorente29 a producción.

**Producción objetivo:** domingo 7 septiembre 2026.

**Equipo:** Julio (40+h/semana decisiones) + refuerzo técnico (40h/semana código) + Claude (propuestas, audit, debugging).

**Decisión clave:** Camino A puro mantenido incluso ante riesgo de perder Llorente29. CEO acepta el riesgo arquitectónicamente.

**Plan B comercial necesario** (responsabilidad CEO): activar prospección Cliente 2 + Cliente 3 durante las 16 semanas.

**Lectura obligatoria al implementar Fase 0:** este documento + Sesiones 0-1-2 documentales + `CONTEXTO_CLAUDE.md`.

---

**Documento cerrado 18 mayo 2026 al final de Sesión 3.**
**Próxima revisión:** al completar Fase 0 (Sprint 7, viernes 18 julio 2026).

---

## 📝 Nota de revisión — 19 de mayo de 2026

Este documento se reviso el 19/05/2026 tras la ejecución del Sprint 1 (auth backend BBDD).

**Cambios aplicados:**
1. URLs actualizadas: `folvy.com` → `folvy.app` (dominio principal definitivo).
2. Mención `folvy.com` en lista pre-requisitos CEO actualizada a `folvy.app`.

**NO modificado** (mantiene histórico de planificación):
- Sprints 0.1-14 originales (planificación inicial conserva valor histórico).
- Estimaciones de tiempo originales.
- Hitos verificables originales.

**Estado real ejecutado a 19/05/2026:**

| Sprint planeado | Estado real |
|---|---|
| Sprint 0.1 (19-23 mayo) | ✅ Completado (Vercel, Resend, Supabase Pro, dominios, GitHub 2FA). ⚠️ PITR NO activado (Decisión D5, aceptar riesgo). 🟡 Llamada Llorente29 pendiente. |
| Sprint 0.2 (26-30 mayo) | 🟢 EN CURSO. SQL preparado completo + **EJECUTADO** 18-19/05 (ejecución adelantada vs roadmap). 19 migrations aplicadas en producción. Limpieza repo + branch `folvy-v1` pendiente. |
| Sprint 1 (2-6 junio) | ✅ **ADELANTADO**. 19 migrations BBDD auth ejecutadas en producción 18-19/05 (con 5 bugs corregidos en vivo). |
| Sprints 2-14 | Sin cambios respecto a planificación original. |

**Implicación del adelanto Sprint 1**: queda margen de tiempo en semanas 3-4 (originalmente Sprint 1) para acelerar Sprint 2 (Edge Functions auth) o para deuda documental/comercial.

**Para estado real implementado, consultar:**
- `CONTEXTO_CLAUDE.md` versión 19/05/2026 (post-Sprint 1).
- `folvy_addendum_sesion2_decisiones.md` (decisiones D1-D5 + 5 bugs SQL).

