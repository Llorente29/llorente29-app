# ENCARGO CODE — F4 · Pantallas de gestión (extraído del encargo completo)

> Extraído de `ENCARGO_CODE_team_completo.md` (que se citaba pero no estaba en el repo) + del sistema
> visual `folvy_team_sistema_visual_y_mapa_pantallas.md`. Este fichero SÍ va al repo.
> Regla: NO re-litigar decisiones vigentes (ver `folvy_team_estado.md`). Verificar contra BBDD.

## Decisiones que este encargo NO revisa (con fecha)
- **schedules.cells: día 0 = LUNES** (fecha = week_start + día, sin −1). Verificado en vivo 07/08
  (solo existen claves '0'..'6', nunca '7'). Docs de área corregidos. NO volver a la convención 1=lunes.
- Paleta de marca: marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0`. NO paleta genérica.
- Turnos = Opción 2 (horas dinámicas pegadas a la demanda), semáforo reservado a COBERTURA, 12
  platos/cocinero-hora, clima apagado. (10/07)
- **Claro por defecto.** No se sustituye el estilo actual: se añade jerarquía y consecuencia.

## Sistema visual / componentes compartidos a crear
`TeamMetricBar`, `AlertCard` (4 severidades: good/warning/serious/critical, con tira de hechos + acción),
`StatusBand`, `HoursTable`, `DataQualityCard`, `PeriodFilter` (Diario/Semanal/Mensual/Anual/Rango),
`EmployeeSheet`, `VersusPanel`. Tokens en `folvy_team_sistema_visual_y_mapa_pantallas.md`.
Estados SIEMPRE con icono + etiqueta, nunca color solo. `tabular-nums` en columnas numéricas.

**Intensidad configurable por cuenta**: `alert_intensity` = `ejecutivo | operativo | silencioso`,
default `operativo`. **El portal del empleado NUNCA hereda la intensidad del manager.**

---

## F4.1 · Centro de Mando (sobre la pestaña Insights actual)
NO rehacer: mantener tarjetas, chips, cumpleaños y aniversarios existentes. Añadir:
- **UNA** franja de estado arriba (`StatusBand`): verde si no hay nada, o las N cosas a resolver. Una, no cinco.
- Cada línea: problema + por qué importa en una frase + botón de acción.
- Tira de dinero: **% personal/ventas, ventas por hora trabajada, coste laboral del mes** (datos reales,
  ya existen: nóminas + ventas + `team_worked_shifts`).
- Línea de consecuencia bajo cada número ("0 formaciones por renovar" → "2 caducan en septiembre").
- Huecos visibles: cobertura sin cubrir, contratos incompletos.

## F4.2 · Plantilla (`/[slug]/personal/plantilla`) — NO existe hoy
La tabla estilo Sesame/Bizneo. RPC nuevo `team_hours_summary(p_account_id, p_from, p_to, p_location_id)`
SECURITY INVOKER. Columnas: empleado, **balance con semáforo**, contratadas (prorrateadas), trabajadas,
vacaciones, nocturnas, coste real, % personal, estado. Clic → ficha del empleado.
→ El balance ya lo da `compute_employee_balance` (F2, hecho hoy): contratado/trabajado/ausencia/delta/nocturnas.
   Envolver en `team_hours_summary` para toda la plantilla de la cuenta (acotado por account_id).

## F4.3 · Ficha del empleado (parcial hoy)
RPC `employee_daily_detail`. Día a día con horario, entrada y salida REALES, total y balance.
**Jornada anclada a la entrada** (F1.4, ya en `team_worked_shifts`) — si se hace por día natural, cada
turno de noche se parte en dos y la pantalla sale llena de incidencias fantasma.
Sidebar: incidencias, ausencias, y bloque de ventas/coste del empleado.
Pestañas: horas, bolsa, documentos, formación, nóminas.

## F4.4 · Ahora mismo (existe, sin capa visual)
Quién está dentro, desde cuándo, jornada prevista, descanso desde ayer (usar el mín. de 12h de
`break_policy`), cobertura sin cubrir. Rail en vivo (lo que ni Bizneo ni Sesame tienen).

---

## Motores ya listos en BBDD para estas pantallas (verificados 07/08)
- `compute_employee_balance(employee_id, from, to)` → base de Plantilla y Ficha.
- `team_worked_shifts(account, from, to)` → minutes/presence/break, jornada anclada a entrada.
- `night_minutes_in_span(...)` → columna "nocturnas".
- `team_compliance_scan(account, from, to)` → alimenta el StatusBand del Centro de Mando y la pantalla F6.
- Ventas (`sale`) + coste laboral (`payroll_cost`, por period_year/period_month) → tira de dinero.
- Coste de plato en `recipe_item.fixed_cost` (NO en menu_item).
- `manager_permissions` (32 flags) → gatear cada pantalla; `show_salaries` gatea TODO lo que muestre € por persona.

## Verificación por pantalla
Build verde + en vivo con Llorente29. Cada número debe cuadrar con la BBDD (no "parece bien").
Gating de permisos comprobado con un usuario sin `show_salaries` (no debe ver dinero por persona).
