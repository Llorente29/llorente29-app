# Folvy Team — ESTADO tras la sesión del 07/08/2026
> Añadir a `folvy_team_estado.md`. Verificado contra BBDD viva, no contra el relato.
> **Todo lo de abajo está EN PRODUCCIÓN**: BBDD aplicada por MCP + frontend mergeado a `main` (b7957e4).

## Mapa de las 12 fases — estado real
| Fase | Estado | Qué hay |
|---|---|---|
| F0 Seguridad/multi-tenencia | ✅ | account_id en 15 tablas, RLS sin joins, DEFINER sin anon (322→258), search_path |
| F1 Saneado del dato | ✅ | dobles fichajes, real_datetime, jornada anclada, **pausas + nocturnidad** |
| F2 Cableado | 🟡 motor | `compute_employee_balance`, `close_month_balance` (por cuenta). Falta F2.2 casar fichaje↔turno y F2.6 sala |
| F3 Contrato y festivos | 🟡 | `holiday_calendar` + 2026 Madrid capital ✅. Extras/complementarias BLOQUEADO por contract_type sucio |
| F4 Pantallas gestión | ✅ | Plantilla, Ficha, Centro de Mando, Ahora mismo (Code, verificadas en vivo) |
| F5 Artefactos legales | ✅ | PDF registro jornada (RD 8/2019) + cierre de mes/gestoría con incidencias |
| F6 Cumplimiento | 🟡 motor | `team_compliance_scan` (4 de 7 reglas, dentro de la función). **Falta pantalla** |
| F7 Cuadrante | 🟡 | backstop vacaciones ✅ + comparador de cobertura ✅. Faltan F7.2/7.3/7.5/7.6 |
| F8 Portal empleado | 🟡 | visibilidad (4 flags + resolutor único) ✅. **Falta la PWA** |
| F9 Kiosko | 🟡 backend | guard de pausas ✅. **Falta el BOTÓN de pausa** y el QR dinámico |
| F10 Generador | ✅ motor | disponibilidad inferida + `propose_schedule` + pantallas (Code) |
| F11 Armonización | ⬜ | sin empezar |

## Funciones nuevas en producción (todas verificadas)
`night_minutes_in_span` · `compute_employee_balance` · `close_month_balance` · `team_compliance_scan` ·
`team_hours_summary` · `employee_daily_detail` · `worker_portal_visibility` · `schedule_coverage_gap` ·
`registro_jornada_mensual` · `registro_jornada_totales` · `export_gestoria_mensual` ·
`infer_employee_availability` · `apply_inferred_availability` · `propose_schedule` ·
`refresh_sales_hourly_agg`
Tablas: `break_policy` · `holiday_calendar` · `sales_hourly_agg`
Triggers: `trg_clock_entry_pause_order` · `trg_sales_hourly_agg_sync` · `trg_schedule_no_vacation_conflict`
Reescritas (afectan a lo que ya existía): `team_worked_shifts` · `team_demand_profile` · `training_is_clocked_in`

## Datos que cambiaron
- `employee_availability`: de **0 a 75 filas** (inferidas, marcadas `Inferido del historial`, reversibles).
- `holiday_calendar`: 14 festivos 2026 de Madrid capital.
- `break_policy`: 1 política (convenio Hostelería Madrid).
- `sales_hourly_agg`: ~1.929 filas, se mantiene sola por trigger.
- `monthly_balance_closures`: julio 2026 cerrado para 6 empleados (antes daba ceros).

## HALLAZGOS de la sesión (verificados, corrigen docs anteriores)
1. **Nocturnidad real: 29 % de las horas** (422,8 h en 120 d), 195/259 jornadas con nocturnidad,
   142 superan el tercio del art. 36.1 ET. El hallazgo 12 ("94 % nocturnas") era una definición floja
   ("termina de noche") pero apuntaba a algo REAL. Se computa por SOLAPAMIENTO, nunca por hora de salida.
2. **`schedules.cells` usa día 0 = LUNES** (fecha = week_start + día, sin −1). Verificado por Code:
   solo existen claves '0'..'6', nunca '7'. Los docs que decían 1=lunes estaban MAL y ya se corrigieron.
3. **Los 3 locales están en Madrid capital** (`city='Madrid'`). "Foodint Alcalá" es la CALLE Alcalá,
   NO Alcalá de Henares. Festivos locales correctos: San Isidro 15/05 y La Almudena 09/11.
4. **`app_settings` es una fila GLOBAL** (scope='global', account_id NULL), no una fila por cuenta.
5. **`assigned_locations` está VACÍO** en los 6 empleados. El roster real se deduce de los fichajes:
   Marlón es polivalente (28 fichajes en Alcalá, 38 en Carabanchel); Keilymar y Mirlenys solo Carabanchel.
6. **Alcalá solo tiene 3 empleados propios.** Con uno de vacaciones quedan 2 para 7 turnos/día.

## BUGS DE PRODUCCIÓN cazados (ninguno era del trabajo de hoy; todos habrían explotado después)
1. `app_settings_read`: la fila global era invisible para todos — `NULL = ANY(...)` nunca es cierto.
2. `app_settings_write`: solo un admin de plataforma podía escribir; el admin real de Foodint nunca
   podía guardar aunque el PATCH devolviera 204 "éxito".
3. `MiBolsaHoras` miraba solo el flag individual e ignoraba el global (el interruptor del manager no
   bloqueaba nada). Además se montaba en dos sitios y uno no tenía gate.
4. Entrada huérfana del 08/07 (dos entradas sin salida) que inventaba **11,4 h** en el cómputo.
5. **Bomba de rendimiento**: 5 funciones repetían la misma agregación de ventas (520 ms/llamada,
   ~25 llamadas al montar Calendario → 500 intermitentes). Empeoraba con cada venta.
   Resuelto: 520 ms → **122 ms** (4,3×) con `sales_hourly_agg` + trigger. Verificado idéntico fila a fila.
6. `setUnavailable` no mandaba `account_id` (NOT NULL) — habría roto en el primer uso real.
7. `propose_schedule` proponía empleados de otro local (bug mío, cazado por Code en verificación).
8. PDF de cierre: celda de incidencias se pisaba con la fila siguiente (cazado por Code generando el
   PDF de verdad en Node).

## Verificación contra el benchmark (07/08)
Las 9 capacidades que en julio estaban 🔴/🟡 tienen motor en BBDD, verificado contra `pg_proc`.
**Ventaja estructural confirmada con datos vivos**: 6.579 ventas + 10.601 € de coste laboral REAL de
nóminas + 1.459 h fichadas + 221 escandallos, todo en una BBDD. Sesame/Bizneo no ven ventas;
Combo/Skello lo estiman. **Nocturnidad y convenio: Sesame los cobra como add-on desde 13 €/empleado/mes
(~1.836 €/año para 8 personas); en Folvy son nativos.**
**Disponibilidad (F10)**: los líderes (7shifts, Shiftbase, ZoomShift, Shifton) resuelven dónde GUARDARLA,
no cómo CONSEGUIRLA — sus guías admiten que "un formulario de marzo está mal en junio". Folvy la
INFIERE del historial y la recalcula: el dato nace lleno y no envejece. Ese es el foso.
