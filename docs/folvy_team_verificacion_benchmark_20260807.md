# Team vs los líderes — verificación contra la BBDD (07/08/2026)

> No es de memoria: cada línea está comprobada contra `pg_proc` / `information_schema` / datos vivos.
> Compara con el tablero del 06-10/07 (`folvy_competitive_map.md` área 14), donde casi todo estaba 🔴.

## Capacidades que estaban 🔴/🟡 y HOY tienen motor en BBDD (verificado)
| Capacidad (benchmark) | Mejor del mercado | Estado verificado hoy |
|---|---|---|
| Editar/corregir fichajes con rastro legal | todos (RD 8/2019) | ✅ `edit_clock_entry` + tabla `clock_entry_audit` |
| Descansos / pausas (registro) | 7shifts, Combo | ✅ `break_policy` + `pausa_inicio/fin` en `clock_entries` (hoy) |
| Nocturnidad (art. 36 ET) | Sesame (add-on 13€/emp/mes) | ✅ `night_minutes_in_span`, validado 7 casos frontera (hoy) |
| Alertas de convenio (descansos, topes, 12h) | todos | ✅ `team_compliance_scan`, 4 reglas con base legal (hoy) |
| Ausencias conectadas al cuadrante | Factorial, Sesame | ✅ trigger backstop F7.1 (imposible planificar sobre vacaciones) |
| Balance de horas real (bolsa) | Bizneo, Sesame | ✅ `compute_employee_balance` + `close_month_balance` (hoy) |
| Calendario laboral de festivos | todos | ✅ `holiday_calendar` + Madrid capital 2026 (hoy) |
| Previsión de demanda para dotar | Workforce.com (líder) | ✅ `team_demand_forecast` en producción |

## La ventaja estructural (lo que NADIE del benchmark tiene) — verificada con datos vivos
Las 4 patas coexisten en una sola BBDD (cuenta Llorente29, comprobado):
- **6.579 ventas** (90 d) · **10.601 €** coste laboral REAL de nóminas (jul) · **1.459 h** fichadas (120 d) · **221 escandallos con coste**.
→ Permite **% personal/ventas real, ventas/hora trabajada y margen real** cruzando escandallo+coste+ventas.
Sesame/Bizneo **no ven ventas**. Combo/Skello lo **estiman** por integración frágil de TPV. Aquí es dato.

## Lectura honesta
- **El MOTOR de datos de Team ya iguala o supera a los líderes** en las capacidades comparadas. Lo que en
  julio era 🔴 "por construir" hoy está construido y verificado en la base.
- **Lo que falta es la CARA**: las pantallas (F4-F9) que exponen estos motores al usuario. Un motor sin
  pantalla no se vende aunque exista. Eso es trabajo de Code, ya encargado y en marcha.
- **Dónde NO se intenta ganar** (y está bien así): amplitud de suite RRHH (reclutamiento, desempeño, clima,
  documental, firma), biometría y benchmarking sectorial (UKG). Requieren escala que Folvy no tiene aún.

## Conclusión
Contra el benchmark que se fijó, **Team ya tiene en la BBDD todo lo necesario para al menos igualar a los
mejores en su terreno (hostelería), y golea en el cruce ventas×personal×margen que ellos no pueden hacer.**
El riesgo ya no es "¿lo tenemos?" (lo tenemos), es "¿lo enseñamos bien?" — y eso depende de las pantallas.
