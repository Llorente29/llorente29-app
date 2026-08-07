# ENCARGO CODE — F4 arranque · Pantallas de gestión (RPCs ya listos)

> Los motores de BBDD de F4 YA ESTÁN construidos y verificados en vivo (07/08). Este encargo es solo la
> CARA (frontend). Code no toca BBDD en F4: consume los RPCs de abajo.
> Lee también `docs/ENCARGO_CODE_team_F4_pantallas_gestion.md` (detalle de las 4 pantallas) y
> `docs/ENCARGO_CODE_team_completo.md` (plan de 12 fases).

## Reglas que este encargo NO revisa
- **schedules.cells: día 0 = LUNES** (fecha = week_start + día, SIN −1). Verificado en vivo. NO revertir.
- Paleta de marca: marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0`. Claro por defecto. NO genérica.
- NO tocar `App.tsx` ni `notificationsService.ts` sin permiso de Julio.
- `manager_permissions` (32 flags): `show_salaries` gatea TODO lo que muestre € por persona.
- NO fiarse del "Success". Build verde (tsc, no solo esbuild) antes de cada commit. Rama por fase.

## RPCs LISTOS para consumir (verificados hoy con datos de Llorente29)

### `team_hours_summary(p_account_id uuid, p_from date, p_to date, p_location_id uuid default null)`
La tabla de la pantalla **Plantilla** (F4.2). Una fila por empleado activo:
`employee_id, employee_name, location_id, contracted_hours, worked_hours, vacation_hours,
 night_hours, delta_hours, labor_cost, cost_is_partial`
- `delta_hours` = bolsa (verde ≥0 / rojo <0 / ámbar cerca de 0). `contracted_hours` ya prorrateado por alta/baja.
- `labor_cost` = coste real de nóminas de los meses del periodo. `cost_is_partial=true` → falta nómina, MARCARLO (no ocultar).
- SECURITY INVOKER: la RLS ya acota a la cuenta. Acotado por account_id; nunca mezcla sandbox.

### `employee_daily_detail(p_employee_id uuid, p_from date, p_to date)`
El día a día de la **Ficha** (F4.3). Una fila por jornada, anclada a la ENTRADA:
`work_date, started_at, ended_at, worked_minutes, presence_minutes, break_minutes,
 night_minutes, looks_like_forgotten_clockout`
- `looks_like_forgotten_clockout=true` → probable salida sin fichar (presencia >11h o salida de madrugada).
  Mostrar esa fila en ÁMBAR con "¿salida sin fichar?" y ofrecer corregir (RPC `edit_clock_entry` ya existe).
  NO contarla como jornada real en los totales sin avisar.
- `night_minutes` para la columna de nocturnidad.

### Otros ya existentes para F4
- `team_compliance_scan(account, from, to)` → alimenta la franja de estado (StatusBand) del Centro de Mando.
- Ventas (`sale`) + `payroll_cost` (por period_year/period_month) → tira de dinero (% personal/ventas del periodo).
- **% personal/ventas es agregado de local/cuenta, NO por empleado** (no se puede atribuir la venta a una
  persona sin inventar). Ponerlo en la cabecera, no como columna por fila.

## Qué construir (frontend, en orden)
1. **F4.2 Plantilla** (`/[slug]/personal/plantilla`, NO existe hoy) — la tabla estilo Sesame. Es la de mayor
   impacto de imagen y el RPC ya está. Componentes: `TeamMetricBar` (cabecera) + `HoursTable` + `PeriodFilter`.
   Semáforo SOLO en balance. Clic en fila → Ficha.
2. **F4.3 Ficha del empleado** (parcial hoy) — `employee_daily_detail` día a día + sidebar. Ámbar en olvidos.
3. **F4.1 Centro de Mando** — sobre la pestaña Insights actual (NO rehacer): añadir StatusBand
   (`team_compliance_scan`) + tira de dinero. Una franja, no cinco tarjetas.
4. **F4.4 Ahora mismo** — quién está dentro (últimas entradas sin salida), rail en vivo.

## Verificación
Cada número de la pantalla debe cuadrar con el RPC (probar con Llorente29, julio 2026: Natacha bolsa +23,68h,
Mirlenys −83,32h, coste Natacha 1.935,34€). Gating: un usuario sin `show_salaries` NO ve `labor_cost`.
Build verde con `tsc`. NO tocar el trigger de vacaciones (F7.1) ni ablandarlo.
