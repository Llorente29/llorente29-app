# ENCARGO CODE — F1: (guard YA HECHO) UX de fichaje + verificar cómputo de Bolsa de horas

Contexto: el 07/08 se saneó en BBDD el histórico de fichajes de Team y se cerró la prevención:
- **F1.1**: anulados los dobles fichajes glitch (salida→entrada <60s) que partían jornadas. 18 pares.
- **F1.1c (GUARD YA APLICADO Y PROBADO en BBDD)**: trigger `trg_clock_debounce` BEFORE INSERT en
  `clock_entries` que rechaza un segundo fichaje de kiosko del mismo empleado a <60s
  (excepción `DOBLE_FICHAJE_MUY_RAPIDO`). Solo afecta a `source='kiosko'`; no toca altas/correcciones
  manuales. Probado: normal PASA, doble<60s RECHAZA, manual cercano PASA, kiosko lejos PASA.
- **F1.3**: corregido el bug de `real_datetime` en fichajes manuales; `team_worked_shifts` computa sobre
  `real_datetime` (verdad legal), no `datetime` (redondeado).

Quedan DOS cosas de repo/verificación:

---

## 1. UX del guard en el cliente del kiosko (el trigger ya bloquea en servidor)

El servidor ya impide el doble fichaje. Falta que el cliente lo viva bien:
- Capturar la excepción `DOBLE_FICHAJE_MUY_RAPIDO` al fichar y mostrar un mensaje suave
  ("Ya has fichado hace un momento") en lugar de un error genérico feo.
- Deshabilitar el botón de fichar ~3-5s tras un toque (debounce visual), para que ni siquiera se
  intente el segundo envío.

## 2. VERIFICAR QUE BOLSA DE HORAS USA `team_worked_shifts`

`team_worked_shifts` ya computa sobre `real_datetime`. Confirmar que la pantalla **Bolsa de horas**
(y los saldos de `monthly_balance_closures`) obtienen las horas trabajadas **llamando a
`team_worked_shifts`** (RPC) y NO calculando por su cuenta en TypeScript leyendo `clock_entries.datetime`.
- Grep en el repo: `team_worked_shifts`, `clock_entries`, `worked`, `trabajadas`, `datetime`.
- Si el front hace su propia cuenta con `datetime` → cambiarla a `team_worked_shifts` (o `real_datetime`).
- Si ya llama al RPC → confirmado, nada que hacer.

---

## Notas de estado (para no re-hacer)
- Ninguna otra función ni vista computa horas desde `datetime` (verificado). `team_worked_shifts` es la única.
- "Empleados duplicados" (Johanny/Natacha/Pamela): **NO era un bug**. Eran la copia real (Llorente29) y la
  del sandbox (Folvy Interno) — cuentas distintas, una fila por cuenta. No hay nada que fusionar.
