# Folvy Team — estado de las 12 fases tras la sesión del 07/08

> Complementa a `ENCARGO_CODE_team_completo.md`. NO lo sustituye: ahí están las 12 fases al detalle.
> Esto es la FOTO de qué está hecho hoy y qué toca, para que Code arranque por lo correcto sin re-litigar.
> Regla del proyecto: leer TODOS los docs del área antes de tocar; NO destrucción; verificar contra BBDD.

## Estado por fase

| Fase | Estado | Qué se cerró en BBDD (Claude) | Qué falta (Code, salvo aviso) |
|---|---|---|---|
| **F0** Seguridad/multi-tenencia | ✅ HECHA (en `main`) | account_id en 15 tablas, RLS sin joins, DEFINER sin anon (322→258), search_path, by_token auditado | — |
| **F1** Saneado del dato | ✅ HECHA (en rama) | dobles fichajes, real_datetime, jornada anclada, **pausas + nocturnidad** | botón de pausa en kiosko (F9) |
| **F2** Cableado | 🟡 motor hecho | `compute_employee_balance` + `close_month_balance` (por cuenta). Los cierres ya no dan cero | pantalla de bolsa de horas + botón "cerrar mes" (F4/F5) |
| **F3** Contrato y festivos | 🟡 festivos hechos | `holiday_calendar` (3 niveles) + 2026 Madrid capital sembrado | extras vs complementarias (necesita contract_type relleno — dato de Julio); valorar festivo trabajado en nómina |
| **F4** Pantallas de gestión | ⬜ | (motores listos) | **AQUÍ ARRANCA CODE**: Centro de Mando, Plantilla, Ficha, Ahora mismo |
| **F5** Artefactos legales/gestoría | ⬜ | — | PDF registro de jornada, export gestoría, validación mensual |
| **F6** Cumplimiento convenio | 🟡 motor hecho | `team_compliance_scan` (4 reglas con base legal, falsos positivos de partida ya filtrados) + `night_minutes_in_span` | **pantalla de Cumplimiento** (la que justifica el precio) |
| **F7** Cuadrante | 🟡 backstop hecho | trigger anti-vacaciones (F7.1) validado | disponibilidad poblada, cobertura por área, resto del rediseño |
| **F8** Portal empleado | ⬜ | — | PWA (tono suave, nunca semáforos de culpa) |
| **F9** Kiosko | 🟡 backend F1.5 | guard de orden de pausa | botón Pausa/Volver + QR dinámico anti-fraude |
| **F10** Generador IA | ⬜ | previsión ya existe (`team_demand_forecast`) | solver + disponibilidad |
| **F11** Armonización | ⬜ | — | aplicar paleta de marca (marino #1E3A5F, terracota #D67442, crema #F5F4F0) |

## Funciones nuevas listas para que las pantallas las consuman
- `compute_employee_balance(employee_id, from, to)` → contratado/trabajado/ausencia_pagada/efectivo/delta/nocturnas.
- `close_month_balance(account_id, label, from, to)` → cierra el mes en bloque (por cuenta). Devuelve nº empleados.
- `team_compliance_scan(account_id, from, to)` → infracciones de convenio con código, severidad, detalle y base legal.
- `night_minutes_in_span(from, to[, night_start, night_end, tz])` → minutos nocturnos por solapamiento real.
- `team_worked_shifts(account, from, to)` → ahora devuelve minutes / presence_minutes / break_minutes.
- `holiday_calendar` (tabla) → festivos por scope (nacional/autonomico/local/empresa).

## Orden recomendado para Code
1. **F4** (pantallas de gestión) — usa `compute_employee_balance`, `team_worked_shifts`, `manager_permissions`.
2. **F6 pantalla de Cumplimiento** — usa `team_compliance_scan`. Alto valor comercial (add-on que Sesame cobra).
3. **F5** (gestoría + PDF de jornada) — usa el balance y el registro real.
4. Luego F8 (portal), F9 (kiosko), F7 (cuadrante), F10 (generador), F11 (armonización).

## Avisos para Code (no repetir errores ya pagados)
- `schedules.cells` usa **día 0=lunes** (fecha = week_start + día). NO week_start + (día-1). Bug ya cazado.
- Al cruzar `business_hours.weekday` con fichajes: cuidado con dow (0=domingo en Postgres) vs cuadrante (0=lunes).
- El cierre de mes y cualquier cálculo en bloque va SIEMPRE acotado por account_id (copias sandbox con mismo nombre en Folvy Interno).
- Verificar `city` del local antes de asumir municipio (los 3 locales están en Madrid capital, no en Alcalá de Henares pese al nombre).
- `contract_type` está a medias (Indefinido/null). No construir extras/complementarias sobre él sin que Julio lo rellene.
