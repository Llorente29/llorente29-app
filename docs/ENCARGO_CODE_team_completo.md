<!-- ESTADO 07/08/2026 (añadido al llevar el fichero al repo; el cuerpo original NO se toca):
     F0 ✅ HECHA (main) · F1 ✅ HECHA incl. F1.5 (rama) · F2 🟡 motor hecho (compute_employee_balance,
     close_month_balance) · F3 🟡 festivos hechos (holiday_calendar, Madrid capital) · F6 🟡 motor hecho
     (team_compliance_scan, night_minutes_in_span) · F7.1 ✅ backstop validado · F9 🟡 backend pausas.
     Detalle vivo en docs/ENCARGO_CODE_team_estado_fases_20260807.md y docs/ENCARGO_CODE_team_F4_pantallas_gestion.md.
     CORRECCIÓN VERIFICADA 07/08: schedules.cells usa día 0=LUNES (fecha = week_start + día, sin −1).
     Solo existen claves '0'..'6'. Las menciones a "1=lunes" en docs viejos son ERRÓNEAS. -->

# ENCARGO CODE — Folvy Team · módulo completo

> **Sustituye** a `ENCARGO_CODE_team_v1_lanzamiento_septiembre.md`, que solo cubría el subconjunto
> que bloqueaba la salida al mercado. Este documento cubre el módulo entero.
> **Sin plazos**: Julio gestiona el calendario y el refuerzo de equipo. Aquí solo hay secuencia y
> dependencias.
>
> **Contexto**: Folvy (`C:\dev\llorente29-app`, React 19/Vite/TS/Supabase). Cuenta Llorente29
> `51ad1792-6629-4ef7-833a-b57b09a86710`. Supabase `xzmpnchlguibclvxyynt`. Reglas en `CONTEXTO_CLAUDE.md`.
> **Diseños**: `folvy_team_auditoria_datos_vivos_20260806.md`,
> `folvy_team_sistema_visual_y_mapa_pantallas.md`, `folvy_team_generador_cuadrantes_diseno.md`.

---

## REGLAS (no negociables)

- NO `supabase db push`. Migraciones por `apply_migration` de MCP o SQL Editor.
- NO fiarse del "Success" del SQL Editor — verificar CADA objeto con query independiente.
- ANTES de aplicar cualquier migración del repo, comparar la versión VIVA con la del fichero.
- `supabase functions deploy` ENCIENDE `verify_jwt` por defecto. Revisar siempre.
- Funciones `SECURITY DEFINER` con `p_account_id` llevan guard `belongs_to_account`. Preferir INVOKER.
- NUNCA guardar `rpc`/`from` en variable suelta — pierde el `this`.
- `database.ts` regenerado va en el MISMO commit que los tipos/services que lo usan.
- NO tocar `App.tsx` ni `notificationsService.ts` sin permiso explícito de Julio.
- Producción va por delante del repo. La BBDD es la verdad.
- Nada es HECHO hasta: commit → push → PR/merge → deploy → verificación en vivo.
- Rama por fase. Commits pequeños. Build verde antes de cada commit.

---

## MAPA DE FASES

| Fase | Nombre | Bloquea a |
|---|---|---|
| **F0** | Seguridad y multi-tenencia | todo lo demás si entra cliente 2 |
| **F1** | Saneado del dato | F2, F4, F5, F6 |
| **F2** | Cableado de lo que ya existe | F4, F5, F6 |
| **F3** | Modelo de contrato y calendario laboral | F5, F6, F10 |
| **F4** | Pantallas de gestión | — |
| **F5** | Artefactos legales y gestoría | — |
| **F6** | Motor de cumplimiento de convenio | — |
| **F7** | Cuadrante: validación, limpieza y rediseño | F10 |
| **F8** | Portal del empleado | — |
| **F9** | Kiosko y captura de fichaje | — |
| **F10** | Generador de cuadrantes con IA | F1, F3, F7 |
| **F11** | Armonización de lo que ya funciona | — |

**F0 y F1 son cimiento. Nada construido encima es fiable hasta que estén.**

---

# F0 · SEGURIDAD Y MULTI-TENENCIA

> Esta fase **no estaba** en el encargo anterior y es la que de verdad bloquea admitir cliente 2.
> Una fuga de datos entre inquilinos es existencial, no es un bug.

## F0.1 · 358 funciones SECURITY DEFINER ejecutables por `anon`

**Hallazgo del advisor de Supabase**: 361 avisos `anon_security_definer_function_executable` y 392
`authenticated_security_definer_function_executable`. `SECURITY DEFINER` **salta la RLS por completo**,
así que la tenencia depende solo de los guards internos de cada función. Y son invocables desde
`/rest/v1/rpc/<nombre>` sin autenticar.

Nombres de mayor preocupación: `internal_secret`, `get_auth_user_id_by_email`, `create_platform_admin_tx`,
`list_platform_admins`, `onboard_account`, `current_user_account_ids`, `belongs_to_account`,
`_require_manage_admins`, `_user_can_manage_admins`, `set_account_discount`, `set_location_status`,
y toda la familia `*_by_token` (courier, impresora, tablet) donde el token es la única frontera.

De Team: `_account_of_employee`, `current_user_is_employee`, `seed_staff_roles_for_account`,
`seed_vacation_settings_for_account`, `build_course_content_snapshot`.

**Hacer**:
1. Inventariar las 358 y clasificarlas: (a) deben ser invocables por `anon` a propósito
   —fichaje por token, portal público, webhooks—, (b) deben ser solo `authenticated`,
   (c) deben ser solo internas (trigger o llamada desde otra función).
2. Para (b) y (c): `REVOKE EXECUTE ... FROM anon` y, cuando proceda, `FROM authenticated`.
3. Para las que sigan siendo DEFINER: verificar que **todas** tienen guard de cuenta
   (`belongs_to_account` o equivalente) como primera sentencia. Las que no, añadirlo.
4. Para las que no necesiten DEFINER: pasarlas a `SECURITY INVOKER`.
5. Los triggers no necesitan EXECUTE público: revocar todos los `tg_*` y `trg_*`.

**Hacerlo por lotes pequeños y verificando en vivo tras cada lote.** Revocar de golpe puede romper
funcionalidad viva.

## F0.2 · 77 funciones con `search_path` mutable

Riesgo de *search_path hijacking* en funciones DEFINER. Añadir
`SET search_path = public, pg_temp` a todas las `SECURITY DEFINER`.

## F0.3 · Tablas con RLS activa y CERO políticas (19)

Devuelven vacío, pero son superficie expuesta y confunden. Incluye una de Team
(**`employee_formations`**) y varias sensibles: `customer_otp`, `customer_session`,
`hubrise_oauth_state`, `hubrise_writer_connection`, `platform_api_token`, `external_webhook_log`,
`weather_poll`, más 11 tablas `_backup_*`.

**Hacer**: dar política a las que se usan; **borrar las `_backup_*`** si ya no sirven (preguntar a Julio);
para las de servicio, dejar sin política pero documentado y sin `GRANT` a `anon`/`authenticated`.

## F0.4 · 3 tablas sin RLS (ERROR)

`spatial_ref_sys` (PostGIS, aceptable), `social_n2_usage`, `football_team_city`.
Comprobar si las dos últimas contienen dato de cuenta. Si no, dejarlas y documentar la excepción.

## F0.5 · Modelo de tenencia de Team — el problema de fondo

**10 tablas del núcleo de Team no tienen `account_id`.** La tenencia se resuelve por saltos:

| Tabla | account_id | location_id | Camino a la cuenta |
|---|---|---|---|
| `employees` | ✗ | ✓ | location → account |
| `clock_entries` | ✗ | ✗ | employee → location → account |
| `vacations` | ✗ | ✗ | employee → location → account |
| `shift_swap_requests` | ✗ | ✗ | employee → location → account |
| `employee_availability` | ✗ | ✗ | employee → location → account |
| `manager_permissions` | ✗ | ✗ | user_profile → ? |
| `schedules`, `shift_templates`, `open_shifts`, `monthly_balance_closures` | ✗ | ✓ | location → account |

Tres saltos para llegar a la cuenta. Cada salto es un sitio donde una política mal escrita filtra.
Y `employees.location_id` es **un solo local**, cuando hay `assigned_locations` (array) — o sea que
el camino canónico ya es ambiguo hoy.

**Hacer**:
1. Añadir `account_id` **denormalizado y no nulo** a las 10 tablas, con trigger de relleno en insert
   y backfill del histórico.
2. Reescribir las políticas RLS para filtrar por `account_id` directo, sin joins.
3. Índice por `account_id` en todas.
4. Test de aislamiento: crear cuenta de prueba, insertar datos, y verificar desde una sesión de la
   otra cuenta que **no** se ve nada. Repetir por cada tabla. Este test se queda en el repo.

## F0.6 · Permisos y roles

`manager_permissions` tiene 32 flags (`show_dashboard`, `show_fichajes_global`, `show_salaries`,
`show_bolsa_horas`, `can_manage_employees`…). Revisar que **todas** las pantallas nuevas de F4–F8
respetan su flag, y que `show_salaries` gatea de verdad todo lo que muestre dinero por persona.

---

# F1 · SANEADO DEL DATO

Sin esto, todo número que se enseñe es falso.

## F1.1 · Guard anti-doble-fichaje
**Vivo**: 16 pares `salida`→`entrada` a menos de 30 s. Caso Natacha 29/06: salida 19:32:01,
entrada 19:32:05 → jornada real de 11 h 36 partida en 7 h 05 + 4 h 34.
`team_worked_shifts` devuelve 271 turnos donde hay 207 jornadas.

Guard en la escritura (no solo en el frontend): si el último fichaje es de tipo contrario y han pasado
< 60 s, ignorar el segundo con aviso. Migración de saneado retroactivo de los 16 con `voided = true`,
motivo y rastro en `clock_entry_audit`. **Listar los 16 antes de tocarlos y guardar el listado en el commit.**

## F1.2 · Empleados duplicados
**Vivo**: Johanny, Natacha y Pamela tienen cada uno una fila activa fantasma con 0 fichajes y 40 h de
contrato. Saldrían a −177 h en cualquier vista. Verificar dependencias (nóminas, cursos, vacaciones,
cuadrantes) y desactivar o fusionar. **Preguntar a Julio antes de fusionar.**

## F1.3 · Invertir el redondeo
`clock_entries.datetime` guarda la hora redondeada y es el valor de cómputo. Hoy dormido
(12 de 574 con `scheduled`, 7 con `rounding_applied`), pero al poblar horarios se dispara al 100 %.
Corregirlo ahora cuesta 7 registros.

`real_datetime` pasa a ser la verdad legal e inmutable, nunca se sobrescribe. Backfill donde sea null.
El redondeo se calcula al vuelo para turno y nómina, reversible y auditable. Toda función de cómputo
lee `real_datetime`. Política de redondeo documentada en `app_settings`
(`rounding_tolerance_min = 8`), **simétrica**. El PDF legal muestra siempre la hora real.

## F1.4 · Jornada anclada a la entrada
109 de 271 turnos cruzan medianoche (turnos 14:45–00:15, 16:45–00:15, 19:45–00:15).
Definir la jornada como "de la primera entrada a la última salida, anclada al día de la entrada"
(offset −6 h). Aplicar en `team_worked_shifts` y en toda RPC nueva.
**Ninguna vista debe agrupar por `date(datetime)`.**

## F1.5 · Registro de pausas
`clock_entries.type` solo admite `entrada` y `salida`. Sin pausas no se distingue jornada partida de
continua, la columna "Descanso" del PDF sería inventada y la comprobación de descansos da falsos
positivos. Añadir `descanso_inicio` y `descanso_fin` al constraint y capturarlos en kiosko y móvil.

---

# F2 · CABLEADO DE LO QUE YA EXISTE

Casi todo está construido y desconectado. Esta fase es la de mejor relación valor/esfuerzo del encargo.

## F2.1 · `vacations` → cómputo de horas
10 registros aprobados (8 vacaciones + 2 bajas médicas, una del 13/04 al 01/07) y **ninguna función de
horas los consume**. Horas teóricas = contratadas − ausencias aprobadas × horas/día.
Tipos ya en constraint: `vacaciones`, `asuntos_propios`, `baja_medica`, `permiso_matrimonio`,
`permiso_fallecimiento`, `permiso_mudanza`, `otro`. Cada tipo con su tratamiento —confirmar con Julio
cuáles descuentan y cuáles no. Añadir los que faltan: fuerza mayor (4 días/año, RDL 5/2023), lactancia,
reducción por guarda legal.

## F2.2 · Casar fichaje con turno
`clock_entries.scheduled` poblado en 12 de 574. La información está en los dos lados y nadie los une.
De aquí cuelgan: retrasos, "no fichó teniendo turno", el redondeo, la cobertura real vs planificada y
**la bolsa de horas**. Al fichar, resolver el turno del cuadrante publicado
(`schedules.cells` = `{shift_template_id: {dia_idx: [employee_ids]}}`, `dia_idx` desde `week_start`)
y escribir `scheduled`. Backfill del histórico donde haya cuadrante publicado.

## F2.3 · Arreglar el cierre de bolsa de horas
`monthly_balance_closures` tiene 3 cierres **todos con horas a cero**. El cierre corre y no calcula.
Recalcular a partir de jornadas reales (F1.4) + contratado prorrateado (F3.1) + ausencias (F2.1).
Recerrar los 3 periodos existentes.

## F2.4 · Coste real por hora
`payroll_cost` está poblado (julio 6 nóminas 10.601 €; junio 7, 12.526 €). Exponer coste/hora por
empleado y periodo, y **marcar visiblemente cuando falten nóminas** — hoy 2 de 8 sin cargar, así que
el % personal real está en ~16,8 % y no en 15,2 %.

## F2.5 · Superficie de correcciones
`clock_correction_request` + `resolve_clock_correction` existen y no se ven. El empleado ve su mes,
valida o abre discrepancia; el manager resuelve con motivo. Cadena probatoria, no cosmética.

## F2.6 · Modelo de `sala` en `team_labor_model`
Hoy solo hay `cocina` (driver `platos`, 12/persona-hora, `min_on_open` 1) y `reparto`
(driver `tickets`, 13/persona-hora). Falta `sala`. Sin ella no hay cobertura por área.

---

# F3 · MODELO DE CONTRATO Y CALENDARIO LABORAL

## F3.1 · Periodos de contrato
`contract_type` null en 5 de 9. **No existe distinción completa/parcial.** `shift_code`,
`shift_period`, `rest_pattern` existen y están todos a null. Y `contracted_hours_week × semanas`
falla con altas a mitad de mes (Keilymar entró el 16/07 y sale a −70 h que no son reales).

- Campo `journey_type` (`completa` | `parcial`) en `employees`, obligatorio.
- Tabla `employee_contract_period` (`account_id`, `employee_id`, `valid_from`, `valid_to`,
  `hours_week`, `hours_year` nullable, `journey_type`) para cambios de contrato y prorrateo.
- **Separar horas extra de horas complementarias** en todo cómputo: un contrato parcial no puede hacer
  extras, solo complementarias, con su régimen propio (máx 30 % ordinario, hasta 60 % por convenio,
  preaviso, registro separado). Hoy `GREATEST(0, balance)` las mezcla y no vale ni para nómina ni para
  inspección.
- Soportar **cómputo anual** además de semanal: los convenios de hostelería fijan jornada anual
  (~1.800 h), no 40 × 52. Y el art. 34.2 ET permite 10 % de distribución irregular.

## F3.2 · Calendario laboral de festivos
No existe tabla. Obligatorio publicarlo (art. 34.6 ET) y necesario para cómputo, plus de festivo y
saldo de vacaciones. Hoy el 15 de agosto es un jueves normal.
**Ojo**: `business_hours_exception` (92 filas) es apertura del local, no festivo laboral. Son cosas
distintas y hoy se confunden.

Tabla `labor_holiday` (`account_id`, `location_id` nullable, `date`, `scope`
nacional/autonómico/local, `name`). Nacionales precargados, autonómicos por CCAA del local, locales a
mano. **Los festivos no descuentan saldo de vacaciones.**

---

# F4 · PANTALLAS DE GESTIÓN

**Sistema visual**: tokens en `folvy_team_sistema_visual_y_mapa_pantallas.md`. **Claro por defecto.**
No se sustituye el estilo actual: se añade jerarquía y consecuencia.

**Componentes compartidos**: `TeamMetricBar`, `AlertCard` (4 severidades, tira de hechos, acción),
`StatusBand`, `HoursTable`, `DataQualityCard`, `PeriodFilter`, `EmployeeSheet`, `VersusPanel`.

**Intensidad configurable por cuenta**: `alert_intensity` = `ejecutivo` | `operativo` | `silencioso`,
default `operativo`. **El portal del empleado NUNCA hereda la intensidad del manager.**

## F4.1 · Centro de mando (sobre la pestaña Insights actual)
Mantener tarjetas, chips, cumpleaños y aniversarios. Añadir **una** franja de estado arriba (verde si
no hay nada, o las N cosas a resolver — una franja, no cinco tarjetas), tira de dinero
(% personal/ventas, ventas por hora trabajada, coste laboral), línea de consecuencia bajo cada número
("0 formaciones por renovar" → "2 caducan en septiembre"), y huecos visibles.

## F4.2 · Plantilla
RPC `team_hours_summary(p_account_id, p_from, p_to, p_location_id)` SECURITY INVOKER.
Empleado, balance con semáforo, contratadas prorrateadas, trabajadas, vacaciones, nocturnas,
coste real, % personal, estado. Balance descuenta ausencias (F2.1) y prorratea (F3.1).

## F4.3 · Ficha del empleado
RPC `employee_daily_detail`. Día a día con horario, entrada y salida reales, total y balance.
**Jornada anclada a la entrada** (F1.4) — si se hace por día natural, cada turno de noche se parte en
dos y la pantalla sale llena de incidencias fantasma. Sidebar de incidencias, ausencias y el bloque de
ventas y coste del empleado. Pestañas: horas, bolsa, documentos, formación, nóminas.

## F4.4 · Ahora mismo
Quién está dentro, desde cuándo, jornada prevista, descanso desde ayer, cobertura sin cubrir.
Aviso **antes** de que ocurra: "Natacha llega a 8 h a las 00:45; si cierra más tarde de la 1, su
descanso hasta mañana baja de 12 h". Requiere F2.2 y F3.2.

## F4.5 · Control horario
Hora real siempre visible junto a la registrada, con `diff_minutes` en tooltip. Filtros por fecha,
empleado, local, tipo y solo-incidencias. Métricas de cabecera. Marcar visualmente los dobles fichajes
y los huérfanos. Edición con motivo obligatorio y rastro (ya existe el backend).

## F4.6 · Informes de Team
Ya existe `InformesTeamPage` con % personal/ventas y franjas horarias. Armonizar al sistema visual y
añadir: absentismo (% horas perdidas sobre teóricas, por causa y local), rotación (altas y bajas 12
meses, con coste de reposición) y puntualidad. Comparativa con periodo anterior en todo.

---

# F5 · ARTEFACTOS LEGALES Y GESTORÍA

## F5.1 · PDF de registro de jornada (RD 8/2019)
Por empleado y mes. Datos de empresa y empleado, tabla diaria con **horas reales** (nunca las
redondeadas), descanso, totales diarios/semanales/mensuales, horas extraordinarias, campos de firma y
nota de conservación 4 años. Botón en Plantilla (todos) y en Ficha (uno).

## F5.2 · Cierre de mes y export a gestoría
La pantalla que más se usa y la que hoy no existe bien. Por empleado y mes: ordinarias, extra,
complementarias, nocturnas, festivas, vacaciones, bajas, bolsa. Export CSV + PDF con formato
configurable (`account_gestoria_config` ya existe, 3 configuradas). Bloqueos visibles: qué impide
cerrar el mes y quién lo resuelve.

## F5.3 · Validación del trabajador
El borrador del RD de registro horario exige acceso del trabajador a su propio registro. Y en juicio,
un registro que el empleado confirmó cada mes vale mucho más que un PDF con una raya para firmar.
Flujo: el empleado ve su mes en el portal, valida o abre discrepancia, el manager resuelve con motivo,
queda el rastro. Reutiliza `clock_correction_request`.

---

# F6 · MOTOR DE CUMPLIMIENTO DE CONVENIO

Tabla `compliance_rule` **configurable por cuenta** (regla, artículo, umbral, severidad, activa) +
evaluador nocturno que escribe en `compliance_finding`. **Las reglas no van escritas en el código**:
el convenio cambia y hay que poder ajustarlo por cliente.

Siete reglas:
1. Descanso mínimo 12 h entre jornadas (art. 34.3 ET) — **7 incumplimientos hoy**
2. Descanso semanal día y medio (art. 37.1 ET)
3. Tope 80 h extraordinarias/año (art. 35.2 ET) — **Johanny al 76 % en un mes**
4. Extras prohibidas a trabajadores nocturnos (art. 36.1 ET) — **194 de 207 jornadas son nocturnas**
5. Jornada máxima diaria (convenio) — **3 jornadas > 12 h**
6. Registro inalterable y conservado 4 años (art. 34.9 ET) — cumplida
7. Descanso de 15 min en jornada > 6 h (art. 34.4 ET) — **no evaluable hasta F1.5**

Pantalla con estado por regla, artículo, umbral, incumplimientos y afectados. Las no evaluables se
muestran como **"falta el dato"**, nunca como cumplidas.

**Nocturnidad**: marcar la jornada como nocturna, contar horas nocturnas por empleado y mes y sacarlas
en el export de gestoría. Es el argumento comercial más fuerte del módulo — Sesame lo cobra como
complemento desde 13 €/empleado/mes.

---

# F7 · CUADRANTE

## F7.1 · Validación contra ausencias — **hay un caso vivo**
Marlón Mafla tiene vacaciones aprobadas del 3 al 9 de agosto y **9 turnos en el cuadrante PUBLICADO de
esa semana**. Dos casos más en borrador (Marlón 10–16 ago, Natacha 13–19 jul).

Query de detección de solapes; bloqueo al guardar; badge rojo en las celdas de cuadrantes ya
publicados; y aviso al aprobador cuando una ausencia pise cuadrantes futuros.

## F7.2 · Limpiar `shift_templates`
18 activas. Alcalá tiene 10 para ~4 turnos reales: `Mañana` 12:30–16:45 duplicada exacta;
`Corrido1` y `Completo 1` ambas 14:45–00:15; `Tarde/Noche` con 19:45–00:15 **y** con 19:45–23:45
(mismo nombre, distinta hora); `Tarde/Noche F/S` idéntica a `Tarde/Noche`.

Informe de duplicados → **decide Julio cuáles conservar**. Hay `schedules.cells` apuntando a estos IDs:
al desactivar, reasignar sus celdas a la superviviente.

## F7.3 · Cobertura por área, no por número
`coverage_mon..sun` dice "2 personas" pero no "1 de cocina y 1 de sala". Con `staff_role` ya construido
es desperdiciar el dato. Cobertura por `role_kind`.

## F7.4 · Disponibilidad del empleado
`employee_availability` está **vacía** (0 filas). Pantalla para que el empleado la declare desde el
portal y el manager la vea al planificar. Sin esto no hay generador posible.

## F7.5 · Publicación y validez
24 de 33 semanas siguen en borrador, con huecos entre las publicadas. Publicar es lo que da valor legal
y lo que ve el empleado. Estado visible, aviso de semanas sin publicar, y notificación al empleado
cuando se publica o cambia su turno.

## F7.6 · Turnos abiertos y cambios de turno
`open_shifts` vacía y solo 2 `shift_swap_requests` en todo el histórico. Los módulos existen y no se
usan. **Preguntar al encargado por qué** antes de rediseñar: puede que con 8 personas no hagan falta,
o que estén mal puestos. No deducirlo.

---

# F8 · PORTAL DEL EMPLEADO

> No estaba en el encargo anterior y es la mitad del producto que ve el usuario final.

PWA mobile-first, `app.folvy.app/portal`, con manifest e icono propios. Worker tras login → redirect.

**Regla de intensidad**: el portal se muestra **siempre en tono suave**. Nunca semáforos de culpa,
nunca "eres un riesgo legal". Enseñarle a alguien su exceso de horas en rojo es tóxico y genera
conflicto laboral. Él ve sus horas, su bolsa, sus cursos, sus vacaciones y sus nóminas.

Pantallas: Hoy (fichaje en curso, próximo turno, tareas APPCC, avisos), Mis turnos, Mis horas
(con validación mensual — F5.3), Vacaciones (solicitud y saldo), Bolsa de horas (gateada por
`hour_balance_visible_to_worker`), Formación (cursos pendientes, certificados), Yo (datos, documentos,
nóminas). Tab bar dinámico según módulos activos y permisos.

---

# F9 · KIOSKO Y CAPTURA DE FICHAJE

Kiosko fullscreen sin shell, teclado numérico grande, reloj, autobloqueo 30 s, salida con PIN admin.
Aplicar F1.1 (guard) y F1.5 (pausas). Pantalla de bienvenida con foto y estado.

**Anti-fraude**: hoy hay geofence en modo aviso y 540 de 574 fichajes con GPS, pero el GPS del navegador
miente sistemáticamente (Natacha marca 670 m fijos estando dentro). Bloquear por GPS es inviable.
La solución de raíz es **QR dinámico firmado** (location_id + tiempo) en pantalla fija del local, más
sesión personal en el móvil: presencia × identidad no compartible. La biometría queda descartada — el
borrador del RD la restringe salvo que no exista alternativa menos invasiva.

`clockout_reminder_log` y `enqueue_clockout_reminders` ya funcionan por WhatsApp. Extender el escalado:
aviso al empleado, recordatorio, y aviso al encargado si persiste.

---

# F10 · GENERADOR DE CUADRANTES CON IA

Diseño completo en `folvy_team_generador_cuadrantes_diseno.md`.

**Lo que ya funciona y no hay que rehacer**: `team_demand_forecast` (verificado: semana del 10/08 da
60/66/73/81/118/116/141 tickets con índice de día, índice de mes 0,711, tendencia 1,150 y 56 días de
datos), `team_labor_requirement`, `team_demand_coefficients`, `team_demand_by_hour`, `team_labor_model`.

**Lo que falta**: `employee_availability` poblada (F7.4), modelo de `sala` (F2.6), restricciones duras
(F3 + F6), solver determinista, presentación en tres montones, modificadores externos con agente
(festivos, clima, fútbol, eventos) y negociación en lenguaje natural.

**Principio**: el LLM **no asigna**. Asigna un solver; el agente busca contexto externo, explica cada
decisión y traduce lenguaje natural a restricciones persistentes.

**Métrica de éxito**: % de turnos propuestos aceptados sin tocar. Por debajo del 85 % a las seis
semanas, el sistema no vale y hay que decirlo.

**No prometer**: generación automática sin revisión, ni datos de venta de la competencia.

---

# F11 · ARMONIZACIÓN DE LO QUE YA FUNCIONA

No rediseñar, solo aplicar el sistema visual y los componentes compartidos:

- **Formación** — módulo completo y bueno: 40 cursos, certificados con firma y documento del firmante,
  avisos por WhatsApp, matriz de cumplimiento, rutas con progreso, y `generate_course_from_recipe`
  (genera cursos desde el escandallo — no lo tiene nadie). Solo falta darle política a
  `employee_formations` (F0.3) y armonizar.
- **Nóminas** — extractor por IA con ancla legal por DNI, ingesta por Gmail vía Resend, bandeja sin
  silencios, PDF adjunto a la ficha. Funciona.
- **Solicitudes**, **Recordatorios de fichaje**, **Calendario**, **Plantilla turnos** — existen.
- **Informes Gestoría** — `account_gestoria_config` con 3 cuentas configuradas.

---

## CRITERIO DE HECHO POR FASE

**F0** · Test de aislamiento entre cuentas pasando para las 15 tablas de Team · 0 funciones DEFINER
sensibles ejecutables por `anon` · `search_path` fijado en todas las DEFINER · `account_id` directo y
no nulo en las 10 tablas · políticas RLS sin joins.

**F1** · `team_worked_shifts` devuelve jornadas reales, no turnos partidos · 0 duplicados activos ·
`real_datetime` fuente única · pausas capturándose.

**F2** · Balance descontando ausencias · `clock_entries.scheduled` poblado · `monthly_balance_closures`
calculando de verdad · coste/hora expuesto con aviso de nóminas faltantes.

**F3** · Tipo de jornada en todas las fichas · extras y complementarias separadas · calendario laboral
cargado · prorrateo de altas y bajas correcto.

**F4–F5** · Las seis pantallas operativas · PDF de jornada y export de gestoría generándose y
validados por el gestor real.

**F6** · Las 7 reglas evaluándose cada noche · horas nocturnas calculadas y exportadas.

**F7** · 0 solapes cuadrante↔ausencias con validación que lo impide · plantillas sin ambigüedad ·
disponibilidad poblada · cobertura por área.

**F8–F9** · Portal en producción con validación mensual · QR dinámico operativo.

**F10** · ≥85 % de turnos aceptados sin tocar a las seis semanas.

Todo, en cada fase: build verde y verificación en vivo con datos de Llorente29.
