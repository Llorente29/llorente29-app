# Folvy Team — ESTADO (verdad viva del área)

> **Creado**: 06 ago 2026. Hasta hoy Team NO tenía doc de área — por eso se perdía contexto.
> **Fuente**: RECON contra BBDD viva (`xzmpnchlguibclvxyynt`) + capturas de producción de Julio.
> **Regla**: todo lo de aquí está verificado contra la BBDD o contra pantalla real. Lo no verificado va marcado.

---

## ⚠️ DECISIONES VIGENTES QUE NO SE RE-LITIGAN

Esta sesión propuso cosas que **contradecían decisiones ya tomadas**. Quedan registradas para que no vuelva a pasar:

| Decisión | Fecha | Doc | Qué NO hacer |
|---|---|---|---|
| **Turnos = Opción 2**: el sistema PROPONE turnos con horas de entrada/salida **dinámicas** pegadas a la curva de demanda (modelo Skello/Legion/Quinyx) | 10/07 | `folvy_team_autoscheduling_benchmark_diseno.md` | NO asumir bloques fijos de `shift_templates`. Las "plantillas duplicadas" de Alcalá pueden ser el intento de granularidad horaria — **no borrarlas sin preguntar** |
| **Semáforo verde/ámbar/rojo RESERVADO para COBERTURA**. Demanda = un solo tono **teal** secuencial (`DEMAND_STEP` en `CalendarioPage.tsx`) | 10/07 | ídem | NO pintar demanda con semáforo |
| **12 platos/cocinero-hora** como suelo del prior `dark_kitchen` (validado por 3 caminos) | 10/07 | ídem | NO recalcular ni proponer otro número |
| **Clima y eventos APAGADOS a propósito** hasta 20-30 locales (sin muestra con 1 operación) | 10/07 | ídem | NO proponerlos como capa del generador todavía |
| **Previsión**: tendencia acotada 0.85–1.15, neutra <21 días; base anual desestacionalizada; RPC server-side como única verdad | 10/07 | ídem | NO reimplementar en cliente |
| **Driver `cubiertos`** (restaurante de mesa) dejado como **hueco a propósito** | 10/07 | ídem | NO rellenarlo ni eliminarlo |
| **Tiempos por plato**: IA estima → Pamela revisa → auto-aprende. "Campo pequeño, no sistema nuevo", colgado del editor de escandallos | 10/07 | ídem | NO diseñar un módulo aparte |
| **Plantilla de cocina**: L-J partido (13-16 / 20-24), V-D continuo, Carabanchel cerrado lunes. Alcalá 2 fijos 40h + 2 parciales; Carabanchel 1 fijo + 2 parciales + comodín ~12h | 22/07 | `folvy_personal_cocina_estado.md` | NO rediseñar la plantilla |
| **Paleta de marca**: marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0` | — | `folvy-brand-spec.md` | Los prototipos de esta sesión usan azul genérico `#2a78d6` — **hay que reconvertirlos** |
| **Plan de fases auto-scheduling A→D** ya trazado | 10/07 | `folvy_team_autoscheduling_benchmark_diseno.md` | El diseño de esta sesión debe **alinearse**, no sustituirlo |

**Regla de no-destrucción**: nada se elimina, oculta ni renombra sin inventario previo y aprobación de Julio. Lo que parece suciedad suele ser una decisión.

---

## 🗺️ INVENTARIO REAL DEL MÓDULO (verificado 06/08)

Team es **mucho más grande** de lo que sugerían los docs. Quince entradas de menú y una app de trabajador transversal.

### Construido y funcionando
- **Fichajes**: kiosko + móvil + geofence en modo aviso. 574 fichajes (13/06 → 06/08), 540 con GPS.
- **Auditoría legal**: `clock_entry_audit` (before/after jsonb, actor, motivo) + trigger. `clock_correction_request` con flujo add/edit/void y `resolve_clock_correction`.
- **Recordatorio de olvido de salida**: `enqueue_clockout_reminders` + `clockout_reminder_log` por WhatsApp (9 enviados).
- **Ausencias**: `vacations` (7 tipos válidos) + `vacation_settings`. 10 registros aprobados.
- **Nóminas**: extractor IA con ancla por DNI, ingesta Gmail→Resend, `payroll_cost` (jul: 6 nóminas 10.601 €; jun: 7, 12.526 €), PDF adjunto a ficha.
- **Cuadrante**: `schedules` (33 semanas, 9 publicadas, 25/05→21/09), `shift_templates` (18 activas), `generateSchedule` en `scheduleGenerator.ts` (heurística voraz 3 pasadas; **ya respeta vacaciones, solapes y descanso 12h**).
- **Previsión**: `team_demand_forecast` ✅ **en producción y verificada**. Semana 10/08 Alcalá: 60/66/73/81/118/116/141 tickets, `idx_mes` 0,711, tendencia 1,150, 56 días de datos. Más `team_labor_requirement`, `team_demand_coefficients`, `team_demand_profile`, `team_demand_by_hour`, `team_labor_model`.
- **UI de CalendarioPage**: termómetro de carga, chips de tendencia y mes, panel "receta del número" (Base × Día × Mes × Tendencia).
- **Formación**: 40 cursos, `course_*` completo (secciones, preguntas, intentos, certificados, **firma con documento del firmante**), `training_path` con progreso, `training_notice` por WhatsApp (14), `training_compliance_matrix`, `training_gaps`, y **`generate_course_from_recipe`** (genera cursos desde el escandallo — no lo tiene nadie).
- **Bolsa de horas**: `monthly_balance_closures` (3 cierres) — estructura correcta, **cálculo a cero** (ver deuda).
- **Gestoría**: `account_gestoria_config` (3 cuentas configuradas).
- **Permisos**: `manager_permissions` con 32 flags.
- **App del trabajador (PWA)**: Inicio, Fichar, Tareas, Más. Mi Portal con: Mi horario, Turnos abiertos, Cambios de turno, Mis fichajes (+Reportar olvido, Corregir), Mi formación, Mis documentos, Mis vacaciones, Mis ajustes.
- **App del trabajador — transversal a módulos**: APPCC (controles del día), **Recepciones**, **autoinventario** (`inventory_count`: 135 conteos, 3.868 líneas; estados contando/en_revision/aprobado/anulado).
- **Notificaciones al empleado**: `employee_notifications` 52 avisos — `schedule_published` 36 (22 leídos), `shift_swap_request` 10, `period_closed` 3, `generic` 2, `clock_correction_resolved` 1.

### Existe y NO se usa
- `employee_availability`: **0 filas**. Bloquea cualquier generador.
- `open_shifts`: **0 filas**. `shift_swap_requests`: 2.
- `appcc_notifications`: **0**, con 49 `appcc_schedules` activas.
- `appcc_schedule_responsibles`: **0** — ningún control tiene dueño.
- 24 de 33 semanas de cuadrante en **borrador**.

### No existe
- Tabla de **festivos / calendario laboral** (obligatorio art. 34.6 ET). Ojo: `business_hours_exception` (92 filas) es apertura del local, ≠ festivo laboral.
- Distinción **completa/parcial** en `employees`. `shift_code`, `shift_period`, `rest_pattern` existen y están todos a null.
- Separación **horas extra vs complementarias**.
- Cómputo **anual** (los convenios de hostelería fijan jornada anual ~1.800 h).
- Registro de **pausas** (`clock_entries.type` solo admite `entrada`/`salida`).
- Motor de **cumplimiento de convenio**.

---

## 🔴 HALLAZGOS DE ESTA SESIÓN (06/08)

### Datos sucios
1. **16 dobles fichajes** salida→entrada en <30 s. Parten jornadas: `team_worked_shifts` devuelve **271 turnos donde hay 207 jornadas**. Caso: Natacha 29/06, salida 19:32:01 + entrada 19:32:05 → jornada real de 11h36 partida en 7h05 + 4h34. El guard "<30s" del spec V1 **nunca se implementó**.
2. **3 empleados duplicados activos** (Johanny, Natacha, Pamela) con 0 fichajes y 40h de contrato → saldrían a −177 h.
3. **`clock_entries.scheduled` poblado en 12 de 574**, y **uno de ellos mal**: a Pamela le asignó `scheduled='19:45'` a una entrada de las **12:32**. Empareja por proximidad ciega.
4. **Redondeo dormido pero armado**: solo 7 fichajes con `rounding_applied`, porque casi ninguno tiene `scheduled`. En cuanto se pueble, el 100% empieza a redondearse. `datetime` (redondeado) es hoy el valor de cómputo — **debe invertirse antes** (real como verdad legal).

### Cuadrante
5. **🔴 Marlón Mafla: vacaciones aprobadas 3–9 ago y 9 turnos en el cuadrante PUBLICADO de esa semana.** Dos casos más en borrador (Marlón 10–16 ago, Natacha 13–19 jul). **Matiz clave**: `generateSchedule` SÍ valida vacaciones; **la edición manual NO**. El fallo está en el guardado manual, no en el generador.
6. **Plantillas ambiguas en Alcalá**: `Mañana` 12:30–16:45 duplicada exacta; `Corrido1` y `Completo 1` ambas 14:45–00:15; `Tarde/Noche` con 19:45–00:15 **y** con 19:45–23:45. **No tocar sin preguntar** (ver decisión Opción 2).
7. **Cobertura es un número, no un rol** (`coverage_mon..sun` sin `role_kind`), teniendo `staff_role` construido.

### Cómputo
8. **`vacations` no está cableado a ninguna función de horas.** Sí lo está en `monthly_balance_closures` (campo `vacation_hours`), pero ese cierre da cero.
9. **`monthly_balance_closures`: 3 cierres, todos con horas a 0.** Causa: las horas programadas salen del cuadrante y el fichaje no está casado (hallazgo 3).
10. **109 de 271 turnos cruzan medianoche.** Cualquier agrupación por `date(datetime)` parte la jornada. Anclar a la entrada (offset −6 h).
11. **Contratado sin prorrateo**: Keilymar entró el 16/07 y sale a −70 h que no son reales.

### Legal
12. **194 de 207 jornadas (94%) terminan entre 22:00 y 06:00** → toda la plantilla es legalmente nocturna (art. 36 ET): plus, máx 8h de media en 15 días, y **horas extra prohibidas**. No se calcula nada de esto.
13. **Johanny: +60,9 h sobre contrato en julio** = 76% del tope anual de 80 h (art. 35.2 ET) en un mes. Y es trabajador nocturno, que no puede hacer extras.
14. **7 incumplimientos de descanso de 12 h** entre jornadas (art. 34.3 ET) — depurar falsos positivos de los dobles fichajes.
15. **3 jornadas > 12 h**. Máximas: Marlón 16h04 (12/07), Pamela 15h49.

### App del trabajador
16. **"Mi horario" y "Mis fichajes" no se hablan.** Pamela, jueves 6/08: horario solo 19:45–00:15; fichó además 12:32–16:47 (**4h15 no planificadas**). Lunes 3: salió 23 min antes. Domingo 2: 11h35 seguidas sin pausa. Nadie lo señala.
17. **"Total horas semana 40,5h"** es lo **previsto**, no lo trabajado, y no lo dice.
18. **Cuatro canales de aviso sin gobierno** (in-app, WhatsApp formación, WhatsApp fichaje, APPCC muerto) y **un solo interruptor** en Mis ajustes.
19. **36 avisos de cuadrante publicado, 22 leídos** → 39% no se entera.
20. Nóminas de ingesta automática con nombre de fichero UUID en vez de "Nómina julio 2026".
21. Menú con "Turnos abiertos" y "Cambios de turno" apuntando a tablas vacías.

### Seguridad / multi-tenencia (bloquea cliente 2)
22. **358 funciones `SECURITY DEFINER` ejecutables por `anon`** vía `/rest/v1/rpc/`. DEFINER salta RLS: la tenencia depende solo del guard interno. Incluye `internal_secret`, `get_auth_user_id_by_email`, `create_platform_admin_tx`, `onboard_account`, `set_account_discount`, y la familia `*_by_token`.
23. **77 funciones con `search_path` mutable**.
24. **19 tablas con RLS activa y CERO políticas** — incluye `employee_formations`, `platform_api_token`, `hubrise_writer_connection`, `customer_otp`, `customer_session` y 11 `_backup_*`.
25. **3 tablas sin RLS** (ERROR): `spatial_ref_sys`, `social_n2_usage`, `football_team_city`.
26. **10 tablas del núcleo de Team sin `account_id`** — tenencia por 3 saltos (empleado→local→cuenta). Y `employees.location_id` es un solo local existiendo `assigned_locations`.

---

## 📄 DOCUMENTOS PRODUCIDOS (06/08)

- `folvy_team_auditoria_datos_vivos_20260806.md` — auditoría RRHH sobre datos vivos.
- `folvy_team_sistema_visual_y_mapa_pantallas.md` — sistema visual + mapa de 9 pantallas + debilidades de Sesame/Bizneo.
- `folvy_team_control_horario_profesional_diseno.md` — diseño de las 5 piezas de control horario.
- `folvy_team_generador_cuadrantes_diseno.md` — generador con IA agéntica (⚠️ **alinear con el plan A→D existente**).
- `ENCARGO_CODE_team_completo.md` — **encargo vigente**, 12 fases (F0 seguridad → F11 armonización).
- `ENCARGO_CODE_team_v1_lanzamiento_septiembre.md` — *superado* por el anterior.
- `ENCARGO_CODE_team_control_horario_profesional.md` — *superado*.
- Prototipos HTML entregados a Julio: centro de mando (v1 sobria y v2 agresiva), sistema navegable de 6 pantallas, y comparativa antes/después sobre la pantalla Insights real. **Todos con paleta genérica — reconvertir a marca Folvy.**

---

## Actualización 07/08

- **Caso Marlón (hallazgo 5) RESUELTO en BBDD**: turnos quitados de la semana publicada 3-9 ago y del
  borrador 10-16 ago, verificado. Causa raíz confirmada: **el guardado manual del cuadrante no valida
  vacaciones** (el generador sí) -> tarea de F7.1. Falta operativo: Pamela rellena los 9 huecos de
  Carabanchel.
- **Estructura `schedules.cells` documentada** en `folvy_mapa_sistema.md`: `{template_id:{dia:[emp]}}`,
  día 1=lunes, con celdas índice "0" (domingo anterior al week_start). Afecta al generador y a cualquier
  cruce por fecha.
- **Tenencia verificada**: ancla en `locations.account_id`; el núcleo de Team sin `account_id` son **15
  tablas** (no 10). `shift_swap_requests` no tiene ni account ni location; `manager_permissions` cuelga
  de `user_profile_id`. Detalle en `mapa_sistema_areas_huerfanas_20260807.md`.
- **F0.1/F0.2 arrancados y aplicados**: 24 triggers + 11 search_path + 15 internas c1 aseguradas.
  anon-exec 361 -> 325. Guion del resto en `F0_1_inventario_definer_20260807.md`. Lección: el EXECUTE
  se hereda de PUBLIC.

---

## 🎯 ESTADO Y SIGUIENTE PASO

**Frente**: Team es el frente activo tras HubRise. Objetivo de negocio: salir al mercado (cliente 2).

**Antes de construir nada**:
1. **RECON de las 6 áreas huérfanas** y escribirlas en `folvy_mapa_sistema.md`: Team, app del trabajador, notificaciones, autoinventario, APPCC, recepciones. El mapa NO las cubre — esa es la causa raíz de la pérdida de contexto.
2. **Avisar del caso Marlón** (arreglo manual inmediato, no desarrollo).
3. **Reconvertir los prototipos a la paleta de marca.**
4. **Alinear el diseño del generador** con el plan A→D del 10/07.

**Luego**: `ENCARGO_CODE_team_completo.md` en orden. F0 y F1 son cimiento y no se paralelizan bien; F4 en adelante sí.

**Comprobación obligatoria al cruzar `clock_entries`**: filtrar siempre por `location_id_at_clock` (regla del 25/07). Varias consultas de esta sesión no lo hicieron — sus números pueden mezclar Alcalá y Carabanchel.
