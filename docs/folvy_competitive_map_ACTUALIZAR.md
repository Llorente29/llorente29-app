# Actualizar `folvy_competitive_map.md` — ÁREA 14 (Team)

> Sustituir el veredicto del 10/07 por este. Verificado contra BBDD el 07/08.

**Veredicto (07/08): 🟢 el módulo pasa de "mayormente por construir" a competir de tú a tú.**

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Editar fichajes con rastro legal | todos (RD 8/2019) | `edit_clock_entry` + `clock_entry_audit` | 🟡 paridad |
| Descansos / pausas | 7shifts (atestación) | `break_policy` + pausa explícita + guard de orden | 🟡 paridad (falta el BOTÓN en kiosko) |
| **Nocturnidad y convenio** | **Sesame: add-on desde 13 €/empleado/mes** | nativo (`night_minutes_in_span`, por solapamiento real) | 🟢 **golea: ~1.836 €/año de add-ons que Folvy no cobra** |
| Alertas de convenio | todos | `team_compliance_scan` (4 de 7 reglas) | 🟡 motor sí, pantalla no |
| Ausencias ↔ cuadrante | Factorial, Sesame | trigger backstop (imposible planificar sobre vacaciones) | 🟢 |
| Balance de horas real | Bizneo, Sesame | `compute_employee_balance` + cierre por cuenta | 🟡 paridad |
| Registro legal de jornada | todos (obligatorio) | PDF RD 8/2019 con horas reales | 🟡 paridad |
| **Export a gestoría** | tspoon, R365 | con **columna de incidencias** (avisa de datos sucios) | 🟢 golea: nadie declara la confianza del dato |
| **Cobertura: huecos y excesos con coste** | 7shifts (su núcleo real) | requerido en **PLATOS** vs asignado, con **coste de nómina REAL** | 🟢 golea: ellos usan euros de venta y coste estimado |
| **Disponibilidad del empleado** | 7shifts/Shiftbase/ZoomShift: app donde el empleado la rellena | **inferida del historial** (0→75 filas sin preguntar) | 🟢 **golea: sus propias guías admiten que el formulario envejece y nadie lo rellena** |
| Generador de cuadrantes | 7shifts auto-scheduler (copia cuadrantes pasados) | solver con preferencias BLANDAS + **motivo explicable** por asignación | 🟢 golea en explicabilidad; ⬜ falta medir ≥85 % aceptados |
| Portal del empleado | todos | solo capa de visibilidad | 🔴 falta la PWA |
| Anti-fraude de presencia | Sesame/Factorial (geofence duro, biometría) | paliativo (aviso + registro) | 🔴 falta QR dinámico firmado |

**El foso, en una frase**: ventas + coste laboral real de nóminas + horas fichadas + escandallo en UNA
BBDD (6.579 ventas · 10.601 € · 1.459 h · 221 escandallos verificados). Sesame/Bizneo **no ven ventas**;
Combo/Skello lo **estiman** por integración frágil. Y la disponibilidad **se infiere en vez de pedirse**.

**Dónde NO se les puede ganar (y no hay que intentarlo)**: amplitud de suite RRHH (reclutamiento,
desempeño, clima, firma electrónica), biometría, y benchmarking sectorial (UKG). Requieren escala.
