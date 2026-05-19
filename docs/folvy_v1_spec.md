# Folvy V1 — Spec funcional detallada

**Fecha de cierre:** 18 de mayo de 2026 (Sesión 1)
**Versión:** 1.0
**Estado:** spec funcional aprobada, lista para ejecución técnica de Fase 0 + Fase 1.
**Documento maestro complementario:** `folvy_arquitectura_reconciliada.md` (decisiones arquitectónicas Sesión 0).

---

## 0. Sobre este documento

Este documento es el **entregable principal de Sesión 1**: la spec funcional detallada de Folvy V1, módulo por módulo, con criterios de aceptación claros para implementación técnica.

**No es** una descripción de marketing ni un brief comercial. Es el documento operativo que ingenieros/Claude leerán antes de tocar código de cada feature. Cada sub-bloque tiene:

- Resumen del alcance.
- Comportamiento detallado.
- Validaciones y edge cases.
- Permisos relacionados.
- Tablas BBDD afectadas.
- Lo que NO entra en V1 (explícito para evitar deslizamiento de alcance).

**Reemplaza a:** ningún documento previo. Es el primero de su clase.

**Lectura obligatoria al implementar Fase 1:** este documento + `folvy_arquitectura_reconciliada.md` + `CONTEXTO_CLAUDE.md` versión P7-S0.

---

## 1. Alcance de V1

V1 es lo que Llorente29 recibirá al entrar a producción (finales junio / primera semana julio 2026).

**Módulos activos en V1:**

| Módulo | id técnico | Display | Alcance V1 |
|---|---|---|---|
| Auth | (Shell) | (transversal) | Email+password + welcome + reset + superadmin con 2FA |
| Folvy Team | `personal` | Folvy Team | Todo: empleados, fichajes, turnos, vacaciones, cambios, bolsa, portal, gestoría |
| Folvy Safety | `appcc` | Folvy Safety | APPCC 7 planes + plantillas + ejecución + incidencias + auditorías + carpeta |
| Folvy Sales | `ventas` | Folvy Sales | Backend Last.app sin UI visible |
| Configuración cuenta | (Shell) | Configuración | Marcas, locales, centros, canales, cuentas, usuarios, ~60 permisos |
| Panel superadmin Folvy | (separado) | Folvy Admin | CRUD cuentas, impersonation, 2FA |

**NO entra en V1:**

- Folvy Operations (V1.1+).
- Folvy Delivery (V3+ — Last.app cubre temporalmente).
- Folvy Procurement (V3-V4).
- Folvy Books (V3+).
- Folvy AI (V2+).
- Folvy Kitchen Vision (V3+).
- Folvy Reservations, Reputation, Marketing, Verifactu (V2+).

---

## 2. Decisiones arquitectónicas que afectan V1

Resumen de las decisiones de Sesión 0 que estructuran esta spec:

- **Shell + Module Contract + Adapters**: una sola codebase, módulos enchufables, integraciones via adapters de dominio.
- **Dos PWAs con manifests distintos**: Folvy Manager (admin/manager) + Folvy Empleados (worker).
- **TopBar + ModuleSidebar + Header** reemplaza al sidebar único actual (patrón "Microsoft 365").
- **Auth email + password** primario + magic link recuperación + panel superadmin separado con 2FA.
- **Permisos granulares con sets predefinidos** desde día uno (~60 flags catalogados).
- **Catálogo de dominios de adapter** reservado (14 dominios) para futuro sin reescribir Shell.
- **MRP II como visión V4-V5** que afecta cómo modelamos `articles`, `recipes`, `stock`, `purchase_orders` desde V1.1.
- **Suppliers como tabla del Shell** (entra V1.1 con Operations).
- **Sales-based scheduling**: Folvy Sales V1 alimenta cruce Sales↔Personal (decisión arquitectónica clave de T3).

---

## 3. Auth flows

### 3.1. Resumen

Cubre 4 flujos visibles + 1 sistema invisible:
1. Login (email + password).
2. Welcome onboarding (`/welcome?token=XXX`).
3. Reset password.
4. Logout.
5. Sistema: sesión persistente, refresh tokens, audit trail.

### 3.2. Login (`/login`)

**Campos:** email, contraseña, botón Entrar, link reset password.

**Comportamiento:**
- Si sesión activa → redirect a `/[slug]/personal`.
- Error login → mensaje genérico "Email o contraseña incorrectos" (nunca distinguir).
- Rate limit: 5 intentos / 15 min con bloqueo temporal.

**Validaciones:** email formato + longitud max 254, contraseña max 128.

**Edge cases:** cuenta suspendida, user sin profile activo, network error.

### 3.3. Welcome onboarding (`/welcome?token=XXX`)

Cuando admin crea usuario o platform admin crea cuenta → magic link Supabase de 7 días.

**Pantalla:** título "Bienvenido [Nombre]", email disabled, nueva contraseña + confirmar, indicador fortaleza, checkbox T&C, botón "Activar cuenta".

**Validaciones contraseña:** mínimo 8 caracteres, letra y número, distinta del email, no en lista contraseñas filtradas.

### 3.4. Reset password

3 pantallas: solicitar (email) → confirmación neutra → nueva contraseña tras click email.

**Token válido 24h, mensaje neutro siempre** (evita user enumeration).

### 3.5. Logout

Botón menú usuario → `signOut()` + limpia localStorage + redirect `/login` + audit log.

### 3.6. Panel superadmin Folvy — Auth especial (`/_admin/login`)

**Diferencias respecto login normal:**
- URL distinta.
- Sin enlace público.
- **2FA TOTP obligatorio** desde día uno con backup codes (10 códigos único uso).
- Tabla separada `platform_admins`.
- Sesión 4h máximo + cierre inactividad 15 min.

**Activación inicial 2FA:** sin opción "más tarde". QR + secret + verificación + códigos respaldo descargables.

**Recovery sin 2FA:** otro platform admin lo desbloquea. Si es el único → recovery manual via Supabase dashboard.

### 3.7. Audit trail completo

Eventos registrados en `security_audit_log`:
`login_success`, `login_failed`, `logout`, `password_reset_requested`, `password_reset_completed`, `welcome_completed`, `2fa_enabled`, `2fa_failed`, `impersonation_started`, `impersonation_ended`.

Retención mínima 12 meses.

### 3.8. Tablas BBDD nuevas necesarias

- `platform_admins`.
- `platform_admin_2fa`.
- `auth_rate_limits`.
- `impersonation_sessions`.

### 3.9. NO entra en V1

SSO, 2FA usuarios cuenta cliente, signup público, login social, biometría, cierre por inactividad, notificación email IP nueva, bloqueo permanente.

---

## 4. Folvy Team

Módulo más grande de V1. 8 sub-bloques: T1-T8.

### 4.1. T1 — Empleados

**Criterio firme:** creación de empleados/gestores SIEMPRE vía wizard guiado paso a paso. No hay formulario "todo en una pantalla".

**Bifurcación inicial:**
- "Crear empleado" (worker) — desde módulo Personal.
- "Crear gestor" (manager/admin) — redirige a Configuración Shell → Usuarios.

**Wizard worker — 5 pasos:**
1. **Datos personales**: nombre, apellidos (req); DNI (req con validación ES); email (req único); teléfono (rec); fecha nacimiento (rec); avatar (opt); dirección postal (opt); Nº SS (rec).
2. **Datos laborales**: puesto (req, catálogo: Encargado, Jefe cocina, Cocinero, Camarero, Ayudante, Office, Barman); fecha alta (req, default hoy); tipo contrato (req: Indefinido/Temporal/Por horas/Prácticas/Otro); horas semanales (req); salario bruto anual (rec, solo `can_see_salaries`); centro coste (req); cuenta análisis (opt); convenio (opt); IBAN (rec).
3. **Locales**: principal (req single), adicionales (opt multi).
4. **PIN kiosko**: 4-6 dígitos req + confirmar + checkbox "mostrar al cerrar".
5. **Confirmación**: resumen + botón "Crear empleado". Al crear: row `employees` + `auth.users` + `user_profile` (role=worker) + welcome email.

**Validaciones wizard:**
- Required = asterisco rojo, no avanza sin él.
- Recommended = warning visible "Recomendado para [feature]".
- Optional = libre.
- PIN único en local principal, no obvios (0000, 1234, 1111, 9999 con warning).
- DNI algoritmo letra ES.
- Email único cuenta + Supabase global.

**Edición:** mismo wizard, navegable libremente. Required sigue siéndolo.

**Lista empleados (`/[slug]/personal/empleados`):**
- Tabla con avatar, nombre, puesto, local, estado fichaje tiempo real.
- Filtros: local, puesto, estado, tipo contrato, búsqueda.
- Métricas: plantilla total, fichando ahora, de vacaciones.
- Botón "Nuevo empleado" (gating `can_manage_employees`).

**Bajas:**
- Suspender (reversible, no puede fichar).
- Dar de baja (archivado, mantiene histórico, deshabilita auth.users).
- Borrado RGPD (anonimización, solo platform admin).

### 4.2. T2 — Fichajes (Control horario)

**Kiosko fullscreen** (`/[slug]/kiosko/[location_id]`):
- Sin TopBar/Sidebar/Header.
- Teclado numérico grande + display puntos + reloj.
- Auto-bloqueo 30s.
- Botón "Salir kiosko" con PIN admin 8 dígitos.

**Flujo fichaje:**
1. Empleado introduce PIN.
2. Sistema busca en `employees` del local.
3. Pantalla bienvenida con foto + estado + botón "Fichar entrada/salida".
4. Confirmación 3s → vuelta inicial.

**Validaciones:**
- PIN no encontrado → "PIN incorrecto" 2s.
- Empleado suspendido → mensaje claro.
- Doble fichaje <30s → ignorar segundo.
- Fichar salida sin entrada del día → opción "Entrada y salida" (retroactivo).

**Eventos:** inicio descanso, fin descanso. (V1.1+ cambio puesto durante turno).

**Vista admin (`/[slug]/personal/fichajes`):**
- Tabla con empleado, local, tipo, timestamp, duración, estado, acciones.
- Filtros: fechas (default 7 días), empleado, local, tipo, solo incidencias.
- Métricas: horas totales, horas extra, sin fichar hoy.

**Edición fichajes** (permiso `can_edit_clock_entries`):
- Crear manual.
- Editar timestamp.
- Anular soft delete.
- **TODOS los cambios con motivo obligatorio + audit log** (crítico inspección laboral).

**Detección automática incidencias:**
- Entrada sin salida fin día.
- Salida sin entrada.
- Fichajes simultáneos en 2 locales.
- Muchas más horas que contratadas (warning).
- Sin fichar habiendo turno asignado (V1.1+).

**Export PDF/CSV** para gestoría e inspección.

### 4.3. T3 — Turnos y Calendario

**Alcance V1: L1 + L2 completo. L3 (auto-scheduling con IA) diferido a V3 Q1-Q2 2027 con compromiso firme.**

Decisión Sesión 1 tras auditoría mercado (7shifts, Mapal, Combo): L1 puro era desfasado. L3 requiere 6+ meses datos históricos reales que V1 no tendrá.

**Conceptos:**
- Turno = bloque trabajo asignado a empleado en día concreto.
- Plantilla turnos = patrón semanal recurrente.
- Cuadrante = vista calendario semanal con turnos del local.
- Cobertura = cuántos empleados programados por franja.

**Estados turno:** `planned`, `in_progress`, `completed`, `missed`, `cancelled`, `swapped`.

**Vista cuadrante (`/[slug]/personal/turnos`):**
- Tabla semanal: filas empleados, columnas días, celdas turnos.
- Click celda con turno → modal detalle/edición.
- Click vacía → modal asignar.
- Drag & drop horizontal (mover día) y vertical (cambiar empleado).
- Selector semana, vista (Semanal/Mensual/Diaria), botón "Aplicar plantilla", botón "Publicar cuadrante", indicador "sin publicar".

**Indicadores visuales:**
- Color del turno por puesto (semántico).
- Borde rojo si `missed`.
- Icono advertencia si solapa con vacaciones.
- Icono horas extra si supera contratadas.

**Métricas cobertura (panel lateral toggleable):**
- Horas planificadas totales semana.
- Coste salarial estimado (gating `can_see_salaries`).
- Empleados sin turnos warning.
- Empleados <horas contratadas warning.
- Empleados >horas contratadas + horas extra.

**Crear/editar turno — modal:**
- Empleado (req), fecha (req), inicio (req), fin (req), local (req), puesto (req), descanso (opt), notas (opt).
- Validaciones: solapamiento bloquea, conflicto vacación bloquea, horas extra warning, fuera horario local warning.

**Plantillas de turnos (`/[slug]/personal/turnos/plantillas`):**
- CRUD plantillas con cuadrante semanal sin fechas.
- Aplicar a semana destino con pre-visualización + detección conflictos.
- Aplicar a varias semanas consecutivas.

**Features L2 (diferencial inteligente — V1):**

- **Sales-based scheduling visual**: panel lateral del cuadrante muestra curva ventas histórica del mismo día semana (4 semanas previas) desde `sales` (Last.app via Folvy Sales V1).
- **Marketplace turnos abiertos**: manager publica turno disponible, empleados elegibles se postulan via Portal, manager aprueba uno.
- **Sugerencia candidatos al asignar**: al asignar manualmente, sistema muestra primero empleados disponibles + sin solapamiento + sin riesgo horas extra.
- **Real-time labor vs sales tracking**: durante el servicio, dashboard con coste personal vs ventas reales del día.
- **Alertas compliance básicas**: descanso mínimo 12h, horas semanales máximas, extras acumuladas.

**Roadmap futuro firme:**
- **V1.5 / V2 (oct 2026 – ene 2027)**: weather forecast, compliance por convenio compleja, modelo previsión ventas básico (regresión + estacionalidad), sugerencias inteligentes heurísticas.
- **V3 (Q1-Q2 2027)**: auto-scheduling con ML real sobre 6+ meses datos. Feature premium tier.

**Notificaciones cuadrante:**
- Si publicado → empleado afectado recibe email (V1.1+ push).
- Si NO publicado → cambios acumulan hasta publicación.

**Tablas BBDD nuevas:**
- `shifts` (id, account_id, location_id, employee_id, date, start_time, end_time, position, status, planned_break_minutes, notes, published_at, created_by, edited_by, edited_at).
- `shift_templates`.
- `shift_template_items`.
- `employee_availability` (disponibilidad declarada).
- `open_shifts` (marketplace).

### 4.4. T4 — Vacaciones

**Tipos ausencia:** Vacaciones (consume saldo), Día personal (saldo separado), Baja médica (no consume, manager registra), Permiso retribuido (no consume), Permiso no retribuido, Festivo trabajado (genera saldo compensatorio).

**Saldo:**
- Anual configurable (default España 22 + 2 personales).
- Devengados proporcionales según fecha alta.
- Saldo = devengados - consumidos.

**Vista detalle empleado (T1.E tab Vacaciones):** días devengados, consumidos, planificados, pendientes año anterior, saldo disponible.

**Flujo solicitud desde Portal:**
1. Empleado → tab Vacaciones → "Solicitar tiempo libre".
2. Modal: tipo, inicio, fin, días laborables (auto-calculados), comentario (opt).
3. Validaciones cliente: fechas válidas, no solapa aprobadas, días vs saldo (warning).
4. Enviar → estado `pending`, notificación managers.

**Flujo aprobación manager (`/[slug]/personal/vacaciones`):**
- Tabs: Pendientes, Aprobadas, Denegadas, Calendario consolidado.
- Tabla pendientes: empleado, tipo, fechas, días, saldo restante, conflictos detectados, comentario, botones.
- **Aprobar** → si conflicto turnos: modal "Cancelar automáticamente o gestionar manualmente".
- **Denegar** → motivo obligatorio.
- **Comentar** → pide más info, sigue pendiente.

**Calendario consolidado mensual:** filas empleados, columnas días, celdas coloreadas, indicador rojo cuando varios empleados mismo puesto ausentes mismo día.

**Detección conflictos automática:** turno asignado, cobertura mínima, compañero mismo puesto.

**Manager registra ausencias** (bajas médicas, festivos compensatorios) sin solicitud previa.

**Calendario laboral anual:** festivos nacionales (precargados), autonómicos (por CCAA del local), locales (manuales), cierres por reforma. Festivos NO descuentan saldo.

**Reportes:** empleados con saldo >X sin disfrutar, total días por puesto, picos por mes, export PDF/CSV.

### 4.5. T5 — Cambios de Turno

**3 mecanismos:**
1. **Swap** entre dos empleados (A↔B).
2. **Give up** al marketplace (cesión).
3. **Request** directo al manager.

**Estados:** `proposed`, `accepted_by_peer`, `rejected_by_peer`, `pending_manager`, `approved`, `denied`, `cancelled_by_requester`.

**Flujo 1 (Swap):**
1. Empleado A en su turno → "Cambiar este turno" → "Cambiar con compañero específico".
2. Sistema muestra elegibles: mismo puesto + disponibles + no solapan.
3. A elige B + selecciona turno B (opt) + comentario.
4. Confirmar → notificación B.
5. B acepta → `pending_manager`. Rechaza → cancelado. Ignora 48h → expira.
6. Manager aprueba con validaciones automáticas (mismo puesto, cobertura, horas extra, compliance 12h).

**Flujo 2 (Give up):**
1. A → "Cederlo al marketplace".
2. Selecciona motivo (opt).
3. Turno en marketplace como "Ofrecido por A".
4. Elegibles reciben notificación, se postulan.
5. Manager elige uno + notificaciones.
6. Si >24h sin candidatos → escalamiento alerta manager.

**Flujo 3 (Request):**
1. A → "Pedir al manager".
2. Motivo obligatorio.
3. Manager decide: reasignar manual, publicar al marketplace, denegar.

**Centro de cambios (`/[slug]/personal/turnos/cambios`):** tabs Pendientes/Aprobados 30d/Denegados 30d/Marketplace.

**Limitaciones configurables cuenta:**
- Antelación mínima (default 48h).
- Máximo cambios/mes/empleado.
- Auto-aprobación swaps seguros (default OFF).
- Cancelación tardía penaliza saldo (default OFF, según convenio).

**Permisos:** `can_request_shift_change`, `can_approve_shift_swaps`, `can_configure_swap_rules`, `can_disable_marketplace`.

**Tablas BBDD:**
- `shift_swaps` (existente `shiftSwapService.ts`, verificar Fase 0).
- `open_shifts`.
- `open_shift_applications`.

### 4.6. T6 — Plantilla y Bolsa de horas

**Plantilla** = empleados activos local con horas contratadas vs reales.
**Bolsa horas** = saldo individual horas extra/defecto.

**Vista plantilla (`/[slug]/personal/plantilla`):** listado con empleado, contrato, horas contratadas, medias 4 semanas, desviación %, saldo bolsa, estado.

**Métricas:** total contratado, total medio trabajado, desviación global, bolsa neta.

**Bolsa — cálculo automático:**
```
saldo_semana = horas_reales - horas_contratadas
saldo_acumulado = saldo_anterior + saldo_semana
```

**Tipos movimiento:**
- `work` (diferencia turno real vs contratado, automático).
- `compensation` (manager paga, baja saldo).
- `time_off` (empleado recupera).
- `manual_adjustment` (admin con motivo obligatorio).
- `expiration` (caducidad).
- `correction_from_clock_edit` (manager edita fichaje retroactivo).

**Configuración cuenta — toggles firmes:**

- **`hour_balance_enabled`** (default ON): si la cuenta usa bolsa o no.
- **`hour_balance_visible_to_worker`** (default ON): si worker ve su bolsa en Portal o solo es uso interno manager. **Refuerzo firme Sesión 1.**

Si OFF: cálculo sigue corriendo internamente, UI worker oculta sección, manager sigue viendo.

**Configuración adicional cuenta:**
- Periodo cierre (semanal/quincenal/mensual).
- Permitir saldo negativo (sí/no).
- Tope máximo positivo (default 40h).
- Tope máximo negativo (default -10h).
- Caducidad meses (default 6).

**Detalle empleado (T1.E tab Bolsa):** saldo actual destacado, histórico movimientos, gráfico evolución, botón ajuste manual (admin).

**Solicitud recuperación tiempo (worker en Portal):** flujo paralelo a vacaciones. Manager aprueba → genera turno tipo "Recuperación".

**Liquidación horas extra (manager):** "Liquidar horas" → cuántas + concepto → baja saldo + genera registro para nómina (alimenta T8).

**Alertas:** saldo > tope positivo (liquidar), saldo > tope negativo (recuperar), cerca de caducidad, sin disfrutar >3 meses.

**Tablas BBDD:**
- `hour_balance_movements`.
- `hour_balance_snapshots`.
- Campos config en `accounts` o tabla separada.

**NO V1:** recargo nocturno automático, recargo festivo automático, compensación cross-empleado, predicción saldo futuro, integración directa nóminas.

### 4.7. T7 — Portal del Empleado (App Folvy Empleados)

**PWA mobile-first** con manifest propio, icono propio (decisión Sesión 0 A3).

**URL:** `app.folvy.app/portal`. Worker tras login → redirect automático.

**Layout:**
- Header compacto: logo + selector local + avatar + notificaciones.
- Bottom tab bar dinámico:

| Tab | Cuándo aparece |
|---|---|
| Hoy | Siempre |
| Mis turnos | Siempre |
| **APPCC** | Si Folvy Safety activo + `appcc_visible_in_worker_portal=ON` |
| Vacaciones | Siempre |
| Bolsa de horas | Si `hour_balance_enabled` + `hour_balance_visible_to_worker` ON |
| Yo | Siempre |

**Pantalla Hoy:**
- Tarjeta fichaje en curso (cronómetro en vivo o "próximo turno") + botón fichar.
- Próximo turno (día, horas, local, puesto, compañeros si privacidad permite).
- Tareas APPCC del día (con icono semántico + título + hora límite).
- Notificaciones recientes (últimas 3-5).

**Mis turnos:** calendario mensual + tap día = detalle. Turno futuro → "Cambiar este turno" (T5). Turno hoy → "Fichar entrada/salida" (si móvil activo).

**Vacaciones:** tarjeta saldo + botón "Solicitar tiempo libre" + lista solicitudes pendientes/aprobadas/histórico.

**APPCC (dedicada):**
- Tab "Hoy": pendientes/en curso del día.
- Tab "Próximas": mañana o esta semana.
- Tab "Histórico": ejecutadas últimos 30 días.
- Botón "Reportar incidencia".

**Bolsa horas:** saldo + histórico + botón "Solicitar recuperación" si saldo positivo + gráfico evolución.

**Yo:**
- Perfil: foto, datos básicos (no editables) + datos editables (teléfono, email con re-verificación, dirección, IBAN con re-verificación + audit).
- Notificaciones: canales (in-app, email, push V2+), por tipo (cambios turno, aprobaciones, recordatorios, APPCC).
- Seguridad: cambiar contraseña, cerrar sesión otros dispositivos, 2FA (V1.1+).
- Documentos: placeholder V1.1+ ("contratos, prevención, formación").
- Ayuda: FAQ, contactar manager, soporte.

**Fichaje móvil — REFUERZO FIRME Sesión 1:**

Eliminado el modo "sin restricciones". Solo 2 modos:

1. **Modo 1 (default) — Kiosko exclusivamente**: worker no ficha desde móvil. Botón redirige a kiosko.
2. **Modo 2 — Fichaje móvil con geofencing OBLIGATORIO**: si se activa, geofencing es no opcional.

**Detalles geofencing:**
- Permiso GPS obligatorio al instalar PWA.
- Precisión mínima exigida: 50m (configurable cuenta, default 100m).
- Validación servidor: coord GPS vs `location_geofences`.
- Datos `clock_entries`: lat, long, accuracy, source ('kiosk' | 'mobile_geofenced'), device_info.
- Si SO detecta GPS spoofed → bloquear + alerta manager.
- Pantalla fichaje móvil siempre muestra mapa con posición + radio local.
- Si fuera del radio: mensaje con distancia exacta.

**Anti-fraude V1.1+:** foto selfie obligatoria. **V2+:** reconocimiento facial.

**Notificaciones (V1 email + in-app, V2+ push):**
Cuadrante publicado, swap aceptado, vacación aprobada, marketplace disponible, recordatorio 1h antes turno, tarea APPCC asignada, bolsa caducidad.

**Permisos cuenta:**
- `worker_can_clock_in_from_mobile` (default OFF).
- `worker_can_see_coworkers_in_shifts` (default ON).
- `worker_can_edit_personal_data` (default ON).
- `worker_can_edit_iban` (default OFF).

**Tablas:** `notification_preferences`, `location_geofences`.

**Comunicación interna mínima V1:**
- Botón "Contactar manager" → email.
- Notificaciones in-app.
- NO chat empleado-manager (V1.1+), NO chat grupal (V1.1+), NO broadcasts (V1.1+).

### 4.8. T8 — Export gestoría

**Cierre automático mensual:** última semana del mes → borrador → admin revisa + publica → envío.

**Disparo manual:** cualquier día, rango personalizado.

**Contenido por empleado en periodo:**
- Identificación: nombre, DNI, NSS, categoría, contrato, IBAN.
- Tiempos: horas contratadas, reales, desviación; ordinarias, extra, nocturnas (V1.1+), festivos trabajados; descansos.
- Ausencias: vacaciones, baja médica, retribuidos, no retribuidos.
- Bolsa: saldo inicio/fin periodo, liquidaciones.
- Eventos: alta nueva, baja, cambios contrato/horas/puesto/salario.
- Resumen local: plantilla fin periodo, horas totales, ratio trabajadas/contratadas.

**Formatos:** PDF estructurado, Excel (.xlsx), CSV.

**Envío automático:** email con adjuntos a gestoría configurada.

**Configuración cuenta — Settings → Gestoría:**
- Nombre, email principal, emails adicionales.
- Formato preferido.
- Periodicidad (mensual default).
- Día envío (default 1 del mes siguiente).

**Histórico envíos (`/[slug]/personal/gestoria`):** tabla con periodo, fecha, formatos, destinatarios, estado. Botones Descargar / Reenviar.

**Audit + integridad:** quién generó, revisó, publicó. Hash PDF/Excel.

**Modificaciones retroactivas:** detección + alerta "Generar cierre corregido". Original marca `superseded`.

**Tablas:**
- `payroll_exports`.
- `payroll_export_files`.
- `payroll_export_recipients`.
- `gestoria_settings`.

---

## 5. Folvy Safety

6 sub-bloques: S1-S6.

### 5.1. S1 — Catálogo planes APPCC

**7 planes legales precargados** (RD 3484/2000 + Reglamento CE 852/2004):
1. Limpieza y desinfección.
2. Control de plagas.
3. Mantenimiento de instalaciones.
4. Control de agua.
5. Trazabilidad.
6. Formación de manipuladores.
7. Control de alérgenos.

**Estado actual:** 7 planes globales + 26 plantillas seed + 2 auditorías ya replicadas via trigger (P6).

**REFUERZO FIRME Sesión 1 — Plantillas personalizables desde V1:**

- Plantillas globales seed son **inmutables y de solo lectura**.
- Admin/manager con permiso puede crear plantillas personalizadas desde V1:
  - Desde cero.
  - Por duplicación de plantilla seed (origen `copied_from_seed`).
  - Por duplicación de otra personalizada.
- Plantillas personalizadas viven a nivel cuenta.
- Plantillas globales **se pueden DESACTIVAR a nivel cuenta** pero nunca borrar ni modificar.

**Interpretación legal confirmada — Folvy es ejecutor, NO redactor:**

- Folvy entrega plantillas seed como base operativa.
- Cliente adapta a su realidad.
- Plan APPCC legal del local sigue siendo responsabilidad del técnico APPCC habitual del cliente.
- Folvy NO firma planes, NO los presenta a autoridades, NO asume responsabilidad de redacción legal.
- T&C Folvy deben dejarlo claro.

**Tablas BBDD:**
- `appcc_plan_templates` (seed inmutable).
- `account_plan_templates` (personalizadas, con `origin`, `seed_template_id`).
- `account_plan_template_checks`.

**Vista (`/[slug]/appcc/planes`):** lista 7 planes con estado (Activo/Inactivo cuenta), Nº plantillas asociadas, ejecuciones próximas 30 días, última revisión.

**Acciones cuenta:** activar/desactivar, editar documentación, asignar responsable.

**NO V1:** crear planes APPCC nuevos desde cero (V1.1+), adaptación CCAA, importación entre cuentas.

### 5.2. S2 — Plantillas y Schedules

**Plantilla = qué hay que hacer. Schedule = cuándo + quién + dónde.**

**Estructura plantilla:**
- Cabecera: nombre, plan APPCC asociado, categoría, descripción rich text, docs adjuntos, duración estimada, permite delegación.
- Checks ordenados con tipos: `check`, `temperature` (rango), `number`, `text`, `photo`, `signature`, `single_choice`, `multi_choice`.
- Por check: obligatorio sí/no, acción automática si falla, pista/ayuda.

**Schedule asocia plantilla + locales + frecuencia + ventana + responsable.**

**Frecuencias:** `daily`, `weekdays`, `weekly`, `biweekly`, `monthly_day`, `monthly_position`, `quarterly`, `semi_annual`, `annual`, `custom_cron` (V1.1+), `on_event` (V2+).

**Ventana ejecución:** hora inicio, hora límite, margen post-vencimiento.

**REFUERZO FIRME Sesión 1 — Asignación dinámica por turno activo:**

Tres modos:

| Modo | Comportamiento | Default |
|---|---|---|
| **1. Por turno activo** ⭐ DEFAULT | Sistema mira fichajes/turnos activos + filtra por puesto + excluye baja/vacaciones + asigna al primero con menor carga | DEFAULT |
| **2. Empleado fijo con fallback** | Empleado concreto. Si no disponible → fallback automático Modo 1 con su puesto | |
| **3. Rol/puesto sin filtro turno** | Cualquier persona del puesto X, esté o no en turno | |

**Lógica Modo 1 — algoritmo:**
1. Calcula empleados en turno en local en momento de generación.
2. Filtra puesto/rol requerido.
3. Excluye baja, vacaciones, ausencia.
4. Excluye empleados con N+ tareas APPCC pendientes (default 5).
5. Asigna por orden: (a) menor carga APPCC del día, (b) tiempo en turno más largo, (c) alfabético.

**Fallback cascada si Modo 1 no encuentra:**
- Plan A: puestos compatibles (configurable schedule).
- Plan B: otros locales del grupo asignados.
- Plan C: "Sin asignar" + notificación urgente manager.

**Pre-requisito firme:** Personal maduro (T1+T2+T3) antes de Safety en Fase 1. Event bus debe llevar `personal.clock_in`, `personal.clock_out`, `personal.shift_started`.

**Generación tareas:** schedules con Modo 1 generan ejecuciones con `assigned_to_user_id = NULL` a 00:00. Asignación real al entrar en ventana.

**Wizard creación schedule (6 pasos):** Plantilla → Locales → Frecuencia → Ventana → Responsable → Confirmación.

**Plantillas legales mínimas pre-configuradas** (schedules sugeridos al activar cuenta):
- Limpieza diaria cocina (diaria, 06:00–10:00, encargado cocina).
- Toma temperatura cámaras (3 veces/día, encargado cocina).
- Recepción mercancía (on demand).
- Control plagas (mensual día 1).
- Análisis agua red (semanal lunes).
- Formación manipuladores (anual + 2 años renovación).

**Tablas:** `appcc_schedules`, `appcc_executions`, `schedule_assignments`.

### 5.3. S3 — Ejecución diaria

**Worker accede desde:**
- Portal "Hoy" → "Tareas APPCC del día".
- Sección "APPCC" dedicada bottom tab (si activa).
- Kiosko del local con PIN.

**Aparecen al worker:** asignadas directamente + "Sin asignar de su puesto" en turno activo (puede tomarlas voluntariamente).

**Flujo ejecución (3 pantallas):**
1. **Vista general**: nombre + plan + descripción + docs + tiempo estimado + "Empezar".
2. **Paso a paso (wizard)**: cada check uno por uno con UI específica del tipo:
   - `check` → "Hecho ✓" / "N/A".
   - `temperature` → input numérico + rango. Fuera rango → incidencia automática.
   - `photo` → cámara nativa + preview + repetir/confirmar.
   - `signature` → canvas + borrar/confirmar.
   - `text` → textarea con min chars opcional.
   - `single_choice`/`multi_choice` → botones grandes. Opción "Mal/Fallo" → incidencia automática.
3. **Resumen**: lista respuestas + tiempo total + firma digital del ejecutor + "Firmar y enviar".

**Geolocalización en ejecución móvil:**
- Si geofencing activo: GPS + accuracy registrado en `appcc_executions`.
- Fuera radio: NO bloquea (a diferencia fichaje). Queda con flag `executed_outside_geofence=true`.
- Configurable por plantilla: "Solo ejecutable en local" → bloquea fuera radio.

**Estados:** `pending`, `in_progress`, `completed_on_time`, `completed_late`, `completed_with_incidents`, `missed`, `cancelled`.

**Pausar/reanudar:** worker pulsa "Pausar", checks completados se conservan. Otro compatible o el mismo continúa.

**Validación retroactiva (manager):**
- Tarea `missed` → justificar omisión (motivo) o marcar ejecutada retroactiva (PIN responsable + motivo + soft-warning).
- **NO valores numéricos retroactivos sin marca de estimación** (fraude documental).

**Notificaciones worker:** asignada al fichar, vence en 30 min, vencida, reasignada.

**Permisos:** `can_execute_appcc_tasks`, `can_take_unassigned_tasks`, `can_justify_missed_tasks`, `can_mark_retroactive_execution`.

**Modo offline básico:** PWA service worker cachea + sincroniza al reconectar.

### 5.4. S4 — Incidencias y acciones correctivas

**Tipos:**
- `out_of_range` (valor fuera de rango).
- `check_failed` (single/multi choice negativo).
- `task_missed` (no ejecutada en ventana).
- `task_late` (fuera ventana pero dentro margen).
- `manual_report` (registrada por worker/manager).
- `external_complaint` (cliente externo se queja).
- `audit_finding` (detectada en auditoría).
- `equipment_failure` (fallo equipo crítico).

**Generación automática:** sistema crea incidencia al detectar condición (temperatura fuera rango, schedule fin día sin ejecutar, check fallido).

**Registro manual — wizard 6 pasos:** tipo, plan afectado, local+zona, descripción (texto + foto + vídeo V2+), gravedad, acción inmediata.

**Workflow estados:** `open` → `assigned` → `in_action` → `pending_verification` → `resolved` → `closed` (`reopened` posible).

**Reglas escalamiento automático:**
- Sin asignar >4h → notificación manager local.
- Sin acción >24h → recordatorio.
- Sin completar >fecha límite → notificación admin cuenta.
- Crítica sin asignar >30 min → notificación inmediata admin + manager.
- Recurrente (3+ veces mismo tipo + local en 90 días) → "Patrón recurrente" → análisis raíz.

**Análisis causa raíz opcional:** 5 porqués encadenados + causa raíz + acción preventiva.

**Acciones correctivas preventivas:** registradas pero seguimiento posterior es Operations V2+.

**Vínculos:**
- Con Folvy Team: asignación consulta turnos activos.
- Con Auditorías: hallazgos negativos generan `audit_finding` automático.

**Vista admin (`/[slug]/appcc/incidencias`):** tabla con ID, fecha, tipo, plan, local+zona, descripción corta, gravedad, estado, responsable, fecha resolución prevista, días abiertas.

**Filtros:** fechas, tipo, plan, gravedad, estado, local, "Sin asignar"/"Vencidas"/"Críticas".

**Métricas:** total abiertas, vencidas, críticas activas, promedio días resolución.

**Reportes:** por plan, por local, tiempo medio resolución, recurrencia, coste estimado.

**Tablas:** `appcc_incidents`, `appcc_incident_actions`, `appcc_incident_verifications`, `appcc_incident_root_cause_analyses`, `appcc_incident_attachments`.

### 5.5. S5 — Auditorías internas y externas

**Internas:** las hace el cliente, recurrentes.
**Externas:** las hace autoridad sanitaria o auditor certificación, esporádicas.

**Plantillas seed:**
- Auto-auditoría APPCC mensual.
- Auto-auditoría APPCC trimestral.
- Inspección municipal (referencia).
- Certificación IFS Food (V1.1+).
- Certificación BRC (V1.1+).

**Plantillas personalizadas:** mismo patrón S1 (copia + edita o desde cero).

**Estructura plantilla auditoría:**
- Cabecera (nombre, descripción, plan asociado o "transversal").
- Secciones agrupadoras.
- Checks (mismos 8 tipos S2).
- Puntuación opcional (cada check vale X, total = suma).
- Umbrales: "Aprobada si >80%".

**Programación interna:** schedules en S2 (Auto-auditoría mensual, trimestral).

**Auditorías externas NO scheduled:** registro al ocurrir.

**Wizard registro externa:** tipo (Municipal/Autonómica/Sanidad Exterior/Certificación/Otro) + plantilla + fecha+hora + auditor (nombre+organismo+DNI) + locales + documentación recibida.

**Ejecución:**
- UI navegación por secciones plegables.
- Indicador progreso global.
- Botón "Guardar borrador".
- Worker interna: responsable definido.
- Inspector externa: dispositivo cliente. Cliente da acceso temporal via link único `/[slug]/auditoria/[uuid]` sin auth inspector.

**Captura especial:**
- Comentarios detallados por check.
- Múltiples fotos por check.
- Hallazgos negativos → incidencia `audit_finding` automática (S4).

**Cierre y resultado:**
- % cumplimiento.
- Lista incidencias generadas.
- Acciones correctivas pendientes definir.
- Firma digital responsable.
- Firma adicional inspector externo opcional.

**Modo "Inspección activa" — UX prioritaria:**

Accesible desde TopBar + atajo Portal manager.

**`/[slug]/appcc/inspeccion`:**
- Botón gigante **"Inspector presente — Preparar documentación"**.
- Al pulsar: genera PDF carpeta APPCC últimos 12 meses automáticamente.
- Indicador progreso.
- Cuando termina: QR (inspector escanea) + descargar + email al inspector.
- Cronómetro "Inspector lleva 0:23:14".
- Botón "Registrar nueva auditoría externa".
- Acceso rápido: plan vigente, últimas 5 incidencias resueltas, últimas auditorías, carnets manipulador empleados activos.

**Caso uso comercial fuerte:** "vino la inspección, abrí Folvy, en 30 segundos le di al inspector todo".

**Histórico (`/[slug]/appcc/auditorias`):** tabla fecha, tipo+auditor, plantilla, locales, resultado, incidencias generadas, estado acciones correctivas.

**Tablas:** `audit_templates`, `audit_template_sections`, `audit_template_checks`, `audits`, `audit_executions`, `audit_findings`, `audit_attachments`.

### 5.6. S6 — Reportes y Carpeta APPCC

**Carpeta APPCC del local — dossier consolidado bajo demanda:**

**Secciones:**
0. Portada + datos generales + hash integridad.
1. Plan APPCC vigente.
2. Plantillas y schedules activos.
3. Registros de ejecución.
4. Registros de incidencias.
5. Auditorías realizadas.
6. Formación del personal (carnets manipulador).
7. Control proveedores y trazabilidad (V1.1+ placeholder V1).
8. Análisis de agua.
9. Control de plagas.
Anexo: Audit log.

**Formatos:**
1. PDF maestro (estructurado, índice clickable, listo imprimir/enviar).
2. ZIP estructurado (carpetas con PDFs + fotos alta resolución).
3. Excel raw data.

**Generación (`/[slug]/appcc/carpeta`):** selector local + periodo + secciones + formato + botón generar.

**Tiempo:**
- Inmediato si periodo <3 meses.
- Asíncrono background si periodo >3 meses o >100 fotos.

**Histórico carpetas:** lista con fecha, usuario, periodo, formato, tamaño, link descarga firmado + regenerar.

**Dashboards (`/[slug]/appcc/dashboard`):**
- Métricas: % cumplimiento APPCC últimos 30d, incidencias abiertas por gravedad, próxima auditoría, carnets a vencer 30d.
- Gráficos: evolución mensual cumplimiento, distribución incidencias por plan, tiempo medio resolución, comparativa locales.
- Exportable a PDF.

**Alertas proactivas:**
- Carnet manipulador vence en 30 días.
- Análisis agua no realizado.
- Auditoría mensual sin completar pasados 5 días.
- 5+ incidencias mismo tipo en 30 días.
- 3 meses sin auditoría interna.

**Tablas:** `appcc_folder_exports`, `appcc_folder_files`.

**REFUERZO CROSS-MÓDULO Sesión 1 — Visibilidad APPCC en worker:**

- Pantalla "Hoy" del Portal muestra sección "Tareas APPCC del día" siempre que worker tiene tareas (no add-on opcional).
- Tareas APPCC aparecen en 3 lugares complementarios: Hoy + Sección APPCC dedicada + Notificaciones.
- Estados visuales: verde (sin urgencia), ámbar (vence <1h), rojo (vencida), gris (completada).
- Worker ve tareas "Sin asignar" elegibles con badge "Disponible para coger".
- Toggle config cuenta: `appcc_visible_in_worker_portal` (default ON).

---

## 6. Folvy Sales V1

**Backend silencioso. NO UI visible al cliente en V1.**

**Componentes:**
- Adapter Last.app: API key + sync cron (default cada 1h) + endpoints ventas/tickets/pagos/canales.
- Mapeo Last.app stores ↔ Folvy locations al activar.
- Tabla `sales`: id, account_id, location_id, brand_id, channel_id, sale_id_external, datetime, total_gross, total_net, items jsonb, payment_method, customer_id_external, raw_data jsonb, synced_at, adapter_version.
- Sync job (Edge Function Supabase): lee última fecha sync por location, llama Last.app, upsert, error handling, registra en `sales_sync_log`.

**Configuración cuenta (Settings → Integraciones → Last.app):**
- API key (encriptada).
- Mapeo stores ↔ locations.
- Estado conexión (verde/rojo).
- Última sync.
- Botones "Sincronizar ahora" + "Test conexión".

**Dato YA usado en V1 desde otros módulos:**
- T3 Turnos — sales-based scheduling visual.
- T3 — real-time labor vs sales tracking.

**Decisión arquitectónica:** dato Sales vive en Shell (no aislado en módulo Sales), accesible via hooks compartidos. Encaja con Sesión 0.

**Permisos:** `can_view_sales_data`, `can_configure_sales_adapter`. Worker NO ve datos ventas.

**Tablas:** `sales`, `sales_sync_log`, `sales_channel_mapping`.

**NO V1:** dashboards visibles, gráficos, comparativas, reportes, alertas, predicción, adapters TPVs distintos a Last.app, TPV propio, webhooks tiempo real, análisis items/margen, predicción ventas.

---

## 7. Configuración cuenta Shell

**No es módulo. Sección del Shell.** Ruta `/[slug]/configuracion/`.

### 7.1. Estructura

```
Configuración
├─ Mi cuenta
│  ├─ Datos fiscales
│  ├─ Logo y branding cliente
│  └─ Plan y facturación Folvy
├─ Estructura del negocio
│  ├─ Marcas
│  ├─ Locales
│  ├─ Centros de coste
│  ├─ Canales de venta
│  ├─ Cuentas de análisis
│  └─ Proveedores (placeholder V1.1+)
├─ Usuarios y permisos
│  ├─ Usuarios (managers/admins)
│  ├─ Sets de permisos predefinidos
│  └─ Logs de acceso
├─ Configuración por módulo
│  ├─ Folvy Team
│  ├─ Folvy Safety
│  ├─ Folvy Sales
│  └─ Folvy Operations (placeholder V1.1+)
├─ Integraciones
│  ├─ Last.app
│  └─ Adapters disponibles (placeholders V2+)
├─ Audit log
└─ Soporte
```

### 7.2. Mi cuenta

- Datos fiscales: razón social, CIF, dirección, email facturación, IBAN, país, moneda.
- Logo cliente (opt) — aparece en exports PDF, emails al equipo, carpeta APPCC. NO sustituye logo Folvy.
- Plan Folvy V1 + estado + próxima factura + histórico + método pago + cambiar plan (V2+) + cancelar cuenta (con retención 90 días RGPD).

### 7.3. Estructura del negocio

- **Marcas**: CRUD ya existente `brandsService.ts`.
- **Locales**: CRUD con nombre, slug, dirección, CCAA, horario apertura (V1.1+), **coordenadas geofence**, brand asociada(s), estado, responsable APPCC.
- **Centros de coste**: CRUD.
- **Canales de venta**: CRUD. Dimensión clasificadora ventas `sales.channel_id`.
- **Cuentas de análisis**: CRUD.
- **Proveedores**: placeholder "Disponible en V1.1+". Tabla `suppliers` creada Fase 0.

### 7.4. Usuarios y permisos

**CRUD usuarios (managers/admins)** — wizard 4 pasos: datos personales (sin PIN, sin datos laborales completos) → rol base → locales → set permisos + override.

Si persona también empleada: opción "Crear también su perfil de empleado" → redirige T1 pre-rellenando.

**Sets predefinidos** (Folvy precarga 4): `gerente_total`, `encargado_sala`, `encargado_appcc`, `gestor_rrhh`. CRUD con nombre + flags activados + locales asignados (opt).

### 7.5. Catálogo completo de ~60 permisos V1

**Folvy Team:**
`can_manage_employees`, `can_see_salaries`, `can_view_clock_entries`, `can_edit_clock_entries`, `can_export_clock_entries`, `can_view_schedule`, `can_edit_schedule`, `can_publish_schedule`, `can_create_schedule_template`, `can_approve_vacations`, `can_register_absences`, `can_configure_holidays`, `can_approve_shift_swaps`, `can_configure_swap_rules`, `can_disable_marketplace`, `can_view_balance_all`, `can_approve_time_recovery`, `can_pay_overtime`, `can_adjust_balance_manually`, `can_configure_balance_rules`, `can_generate_payroll_export`, `can_publish_payroll_export`, `can_configure_gestoria`.

**Folvy Safety:**
`can_view_appcc_plans`, `can_activate_deactivate_plans`, `can_edit_plan_documentation`, `can_assign_plan_responsible`, `can_view_templates`, `can_create_custom_templates`, `can_edit_custom_templates`, `can_archive_templates`, `can_manage_schedules`, `can_pause_schedules`, `can_execute_appcc_tasks`, `can_take_unassigned_tasks`, `can_justify_missed_tasks`, `can_mark_retroactive_execution`, `can_register_incident`, `can_assign_incident`, `can_resolve_incident`, `can_verify_incident_resolution`, `can_close_incident`, `can_reopen_incident`, `can_delete_incident`, `can_view_audits`, `can_execute_internal_audit`, `can_register_external_audit`, `can_close_audit`, `can_reopen_audit`, `can_export_audit`, `can_share_audit_link_external`, `can_generate_appcc_folder`, `can_access_inspection_mode`, `can_view_compliance_dashboard`, `can_configure_alerts`, `can_share_folder_externally`.

**Folvy Sales:**
`can_view_sales_data`, `can_configure_sales_adapter`.

**Shell transversales:**
`can_manage_brands`, `can_manage_locations`, `can_manage_users`, `can_configure_account_settings`, `can_view_audit_log`, `can_manage_billing`, `can_view_personal_data_sensitive`.

**Worker en Portal:**
`worker_can_clock_in_from_mobile`, `worker_can_see_coworkers_in_shifts`, `worker_can_edit_personal_data`, `worker_can_edit_iban`.

### 7.6. Configuración por módulo — toggles consolidados

**Folvy Team:**
- `hour_balance_enabled` (default ON).
- `hour_balance_visible_to_worker` (default ON).
- `worker_can_clock_in_from_mobile` (default OFF).
- `worker_can_see_coworkers_in_shifts` (default ON).
- `worker_can_edit_personal_data` (default ON).
- `worker_can_edit_iban` (default OFF).
- `marketplace_enabled` (default ON).
- `shift_swap_auto_approve` (default OFF).
- `vacation_days_per_year_default` (default 22).
- `personal_days_per_year_default` (default 2).
- `vacation_carryover_until_date` (default 31/03).
- `balance_period` (default "monthly").
- `balance_max_positive_hours` (default 40).
- `balance_max_negative_hours` (default -10).
- `balance_expiration_months` (default 6).

**Folvy Safety:**
- `appcc_visible_in_worker_portal` (default ON).
- `appcc_geofence_required_for_mobile_execution` (default OFF).
- `appcc_auto_assign_mode` (default "by_active_shift").

**Folvy Sales:**
- `sales_adapter_active` (default OFF).
- `sales_sync_frequency_hours` (default 1).

### 7.7. Integraciones

**Last.app:** API key encriptada, mapeo stores ↔ locations, estado, última sync, botones test/sync.

**Adapters disponibles (placeholders V2+):** Glovo, Uber Eats, Just Eat, Holded, Anfix, Bronze.vision, CoverManager. Badge "Próximamente". Genera expectativa comercial.

### 7.8. Audit log cuenta

Eventos sensibles: login/logout, cambios configuración, bajas empleados, borrados (soft) incidencias, generaciones carpeta APPCC con compartición, cambios permisos, impersonations recibidas.

Solo `role='admin'` con `can_view_audit_log`.

### 7.9. Soporte

FAQ, estado sistema (V1.1+ status page), contactar soporte → email, link documentación pública (V1.1+).

### 7.10. Tablas BBDD

- `accounts` (datos fiscales + feature flags jsonb o columnas).
- `user_profiles` + `manager_permissions`.
- `permission_sets` (nueva).
- `permission_set_assignments`.
- `audit_log` existente.
- `billing_history` (V1.1+ placeholder).

---

## 8. Panel superadmin Folvy

**Plano control interno Folvy. Sistema separado.**

URL `app.folvy.app/_admin`. Login `/_admin/login` con 2FA TOTP obligatorio. Sesión 4h max + cierre 15 min inactividad.

### 8.1. Estructura

```
Folvy Admin
├─ Dashboard
├─ Cuentas cliente
├─ Usuarios platform admin
├─ Soporte e impersonation
├─ Salud del sistema
├─ Audit log Folvy
├─ Configuración Folvy
└─ Cerrar sesión
```

### 8.2. Dashboard

Métricas globales: cuentas activas, trial (V1.1+), suspendidas, usuarios activos hoy, MRR (V1.1+), errores 24h.

Gráficos: evolución cuentas mensual, distribución por plan, geografía heatmap España.

Alertas urgentes top 5.

### 8.3. Cuentas cliente

**Listado:** tabla con slug (link impersonation), nombre, CIF, plan, estado, fecha alta, última actividad, Nº locales, Nº usuarios, acciones.

**Filtros:** estado, plan, antigüedad, Nº locales, búsqueda libre.

**Detalle cuenta — tabs:** Resumen, Locales, Usuarios, Módulos activos, Integraciones, Facturación (V1.1+), Soporte (V1.1+), Audit, Acciones avanzadas.

**Crear cuenta nueva (Modalidad 3) — wizard 5 pasos:**
1. Datos cuenta: razón social, CIF, slug auto-sugerido, dirección, email facturación, país.
2. Plan + módulos activos (default Personal + APPCC + Sales).
3. Primer admin del cliente: nombre, DNI, email, rol admin.
4. Configuración inicial: locales (min 1), marca default.
5. Confirmación → al crear: `accounts` + `auth.users` + `user_profile` + locales + brand + replica seed APPCC + welcome email.

**Edición cuenta:** datos fiscales/plan/módulos/locales editable con audit. **NO datos operativos directamente** — usar impersonation.

**Suspender:** motivo obligatorio → estado `suspended` → users no login → reversible.

**Archivar:** estado `archived` → lectura via impersonation sin escritura → no facturable.

**Baja definitiva RGPD:** triple confirmación + 30 días aviso + borrado/anonimización + conserva audit hash 5 años.

### 8.4. Usuarios platform admin

CRUD platform admins. Crear nuevo: datos + welcome email + activación 2FA obligatoria + códigos respaldo.

Suspender: inmediato, sesión invalida, audit estricto.

Recovery 2FA: otro platform admin desbloquea. Si único → manual via Supabase dashboard.

### 8.5. Soporte e impersonation

**Impersonation flow:**
1. Detalle cuenta → "Impersonar".
2. Modal con **motivo obligatorio**.
3. Confirmar → sesión paralela admin cuenta.
4. **Banner persistente** "Estás impersonando [Cuenta]. Cerrar".
5. Audit log con `impersonating_user_id` en todas acciones.
6. "Cerrar impersonation" → vuelta panel admin.

**Reglas firmes:**
- Banner siempre visible.
- TODO registrado (incluso ver datos).
- Máximo 4h continuas.
- NO impersonas workers.
- Notificación cliente (V1.1+ default ON) email "Técnico Folvy accedió tu cuenta [fecha]".

Tabla `impersonation_sessions`: id, platform_admin_id, target_user_id, target_account_id, reason, started_at, ended_at, ip, user_agent, actions_taken jsonb.

### 8.6. Salud del sistema

Estado adapters, errores recientes logs Supabase Edge Functions, latencia API (p50/p95/p99), uso Supabase, jobs programados, conexiones activas, alertas crítica/alta/media/baja.

V1 mínimo dashboard simple. V1.1+ Sentry/Datadog.

### 8.7. Audit log Folvy

Global plataforma (separado de audit cuentas cliente). Eventos platform admins + cambios config global + eventos críticos. Inmutable. Retención mínima 5 años.

### 8.8. Configuración Folvy

Settings globales: catálogo planes comerciales (V1.1+), catálogo módulos + adapters, plantillas APPCC seed (lectura), sets permisos default, email templates, catálogo festivos España, versión + changelog.

### 8.9. Permisos platform admin

`platform_can_create_accounts`, `platform_can_suspend_accounts`, `platform_can_archive_accounts`, `platform_can_delete_accounts` (solo CEO), `platform_can_impersonate`, `platform_can_manage_admins`, `platform_can_reset_2fa_of_others`, `platform_can_view_audit_log`, `platform_can_edit_seed_data` (solo CEO), `platform_can_view_system_health`, `platform_can_send_global_notifications` (V1.1+).

**V1 inicial:** 1 platform admin (Julio CEO). Todos los permisos. V1.1+/V2 contratación.

### 8.10. Tablas BBDD

`platform_admins`, `platform_admin_permissions`, `platform_admin_2fa`, `impersonation_sessions`, `platform_audit_log`, `platform_settings`.

---

## 9. Cruces inter-módulo (consolidado)

Lista de dependencias entre módulos que cruzan límites. Útil para implementar Fase 1 sin perder cobertura.

| Origen | Consumidor | Cómo |
|---|---|---|
| Folvy Sales (datos Last.app) | Folvy Team T3 (cuadrante) | Hook `useSalesData()` del Shell. Cruce visual ventas vs turnos planificados. |
| Folvy Sales | Folvy Team (real-time tracking) | Dashboard servicio con coste personal vs ventas día. |
| Folvy Team (turnos + fichajes) | Folvy Safety (asignación dinámica) | Event bus: `personal.clock_in`, `personal.clock_out`, `personal.shift_started` → Safety asigna tarea. |
| Folvy Team T1 (empleados) | Folvy Safety S3 (ejecución) | Worker en Portal ve tareas APPCC del día. |
| Folvy Team T6 (bolsa horas) | Folvy Team T8 (gestoría) | Liquidaciones bolsa alimentan export mensual. |
| Folvy Team T1 (cambio rol worker→manager) | Configuración cuenta (Usuarios) | Crea entradas `manager_locations` + `manager_permissions` automáticamente. |
| Folvy Safety S4 (incidencias) | Folvy Safety S5 (auditorías) | Hallazgos `audit_finding` generan incidencias automáticamente. |
| Folvy Safety S6 (carpeta) | Folvy Team (empleados) | Carpeta incluye carnets manipulador + formación empleados. |
| Panel superadmin | Cualquier cuenta cliente | Impersonation con audit cross-tenant. |
| Configuración cuenta | Todos los módulos | Feature flags toggle visibilidad y comportamiento. |

---

## 10. Tablas BBDD nuevas requeridas (consolidado)

Listado consolidado para que Fase 0/Fase 1 sepa qué construir.

**Auth y plataforma:**
- `platform_admins`.
- `platform_admin_2fa`.
- `platform_admin_permissions`.
- `auth_rate_limits`.
- `impersonation_sessions`.
- `platform_audit_log`.
- `platform_settings`.

**Permisos:**
- `permission_sets`.
- `permission_set_assignments`.

**Folvy Team:**
- `shifts`.
- `shift_templates`.
- `shift_template_items`.
- `employee_availability`.
- `open_shifts`.
- `open_shift_applications`.
- `hour_balance_movements`.
- `hour_balance_snapshots`.
- `notification_preferences`.
- `location_geofences`.
- `payroll_exports`.
- `payroll_export_files`.
- `payroll_export_recipients`.
- `gestoria_settings`.

**Folvy Safety:**
- `account_plan_templates` (personalizadas).
- `account_plan_template_checks`.
- `schedule_assignments`.
- `appcc_incidents` (verificar existencia).
- `appcc_incident_actions`.
- `appcc_incident_verifications`.
- `appcc_incident_root_cause_analyses`.
- `appcc_incident_attachments`.
- `audit_templates`.
- `audit_template_sections`.
- `audit_template_checks`.
- `audits`.
- `audit_executions`.
- `audit_findings`.
- `audit_attachments`.
- `appcc_folder_exports`.
- `appcc_folder_files`.

**Folvy Sales:**
- `sales`.
- `sales_sync_log`.
- `sales_channel_mapping`.

**Shell:**
- `suppliers` (creada Fase 0, UI gestión V1.1).

---

## 11. Decisiones explícitamente diferidas

Para evitar deslizamiento de alcance, lista de lo aplazado con compromiso firme de fecha.

| Feature | Fase | Trigger |
|---|---|---|
| Operations completo (artículos + escandallos + inventario + compras) | V1.1 - V2 | Tras Llorente29 estable |
| OCR de albaranes | V2.1 | Tras Operations Compras maduro |
| Auto-scheduling con IA (L3) | V3 Q1-Q2 2027 | 6+ meses datos histórico Llorente29 |
| MRP I (órdenes compra automáticas) | V3 | Tras Sales predicción + Operations Inventario |
| MRP II completo | V4-V5 | 5 años horizonte |
| Adapters directos delivery (Glovo, Uber, Just Eat) | V2+ | Tras TPV propio Folvy |
| Folvy Delivery propio (agregador) | V3+ | Migración Llorente29 fuera Last.app |
| Bronze.vision integration | V3+ | Adapter kitchen-vision |
| Folvy Books (contabilidad + adapters gestoría) | V3+ | Decisión naming + scope aún diferida |
| Verifactu adapter | V3 | Obligatorio España |
| Folvy AI distribución | V2+ | Decisión arquitectónica diferida |
| SSO empresarial | V2+ | Cuando llegue cliente enterprise |
| 2FA usuarios cuenta cliente | V1.1 - V2 | Tras producción estable |
| Signup público | V2+ | Modalidad 2 con invitación token |
| Capacitor wrapping nativo | V2 | Tras dos PWAs estables |

---

## 12. Próximos pasos tras esta spec

### CEO (Julio) — acciones inmediatas

1. Subir `folvy_v1_spec.md` al Project Knowledge.
2. Llamada Llorente29 confirmar espera + comunicar alcance V1 detallado.
3. Decisión PITR Supabase Pro (P-1 bloqueante Fase 1).
4. Hosting + dominios Folvy (P-2).
5. Provider email transaccional (P-3).

### Sesiones siguientes

- **Sesión 2 — Auth model detallado** (`folvy_auth_model.md`): pantallas, flows, catálogo permisos finos consolidado por UI, RLS policies, edge cases auth. Estimación 1-1.5h.
- **Sesión 3 — Roadmap inverso con sprints** (`folvy_roadmap.md`): partiendo Llorente29 prod hacia atrás, qué bloques en qué orden con dependencias. Estimación 1h.
- **Sesión 4+ — Ejecución técnica Fase 0**: empezando por Shell base.

---

## 13. Lo que esta spec NO resuelve

Por honestidad y para evitar expectativas erróneas:

1. **Modelo BBDD detallado** — cada tabla se modela cuando se construye. Aquí solo nombres y propósito.
2. **Wireframes/mockups visuales** — algunos existen como maquetas Sesión 0, otros se diseñan en implementación.
3. **Estrategia comercial/pricing** — Sesión propia.
4. **Stack pagos Stripe/Redsys** — decisión técnico-comercial pendiente.
5. **Testing/CI/CD/observabilidad detallado** — decisión técnica posterior.
6. **Equipo y cadencia construcción** — gestión CEO/COO.
7. **Catálogo convenios colectivos hostelería España** — V1.1+ requiere investigación legal.

---

**Documento cerrado 18 mayo 2026 al final de Sesión 1.**
**Próxima revisión:** al completar Fase 1 (Llorente29 producción).
**Lectura obligatoria al implementar:** este documento + `folvy_arquitectura_reconciliada.md` + `CONTEXTO_CLAUDE.md` versión P7-S0.

---

## 📝 Nota de revisión — 19 de mayo de 2026

Este documento se reviso el 19/05/2026 tras la ejecución del Sprint 1 (auth backend BBDD).

**Cambios aplicados:**
1. URLs actualizadas: `app.folvy.com` → `app.folvy.app` (dominio principal definitivo).

**NO modificado** (mantiene histórico de planificación):
- Especificación funcional de módulos T1-T8 (Team) y S1-S6 (Safety).
- Flows auth conceptuales (la implementación BBDD real está en CONTEXTO_CLAUDE + addendum).
- Arquitectura técnica.

**Para estado real implementado**, consultar:
- `CONTEXTO_CLAUDE.md` versión 19/05/2026 (post-Sprint 1).
- `folvy_addendum_sesion2_decisiones.md` (decisiones D1-D5 + 5 bugs SQL).

