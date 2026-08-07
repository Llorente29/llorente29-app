# F1.5 — Descansos y cumplimiento de convenio (diseño)

## El problema, medido (Llorente29, 90 días)
257 jornadas. **64 pasan de 6 h**, y **52 de ellas pasan de 9 h** (máx. 12,5 h). **633 h** en jornadas
largas, **ninguna con descanso registrado**. Doble consecuencia:
- **Coste inflado**: si esas 64 llevan pausa no computable, se están contando horas que no se pagan.
- **Riesgo legal**: 52 jornadas de +9 h seguidas sin descanso registrado. El propio registro horario es la
  prueba del incumplimiento ante Inspección.

## Por qué NO puede ser un valor fijo en el código
El descanso lo fija el **convenio provincial**, y cambia por territorio:
- **Madrid**: jornada continuada → 15 min **retribuidos**. Partida → mínimo 1,5 h entre tramos. Tope: no
  más de 5 h seguidas sin pausa.
- **Valencia**: jornada > 6 h → 30 min, de los que **solo 15 computan** como trabajo efectivo. Jornada
  < 6 h → 15 min **no retribuidos**. Partida: mín. 1 h entre tramos (2 h si se come fuera), máx. 4 h, y
  máx. 12 h entre inicio y fin.
- **Estatal restauración colectiva**: jornada ≥ 6 h → 15 min **tiempo efectivo de trabajo**.
- **ET art. 34.4** (suelo legal): > 6 h continuadas → mín. 15 min; menores de 18: 30 min desde 4,5 h.

Una cadena Madrid + Valencia necesita **reglas distintas dentro de la misma cuenta**. De ahí el diseño.

> ⚠️ Nota para Llorente29: el convenio de Madrid marca los 15 min de jornada continuada como
> **retribuidos**. Descontarlos sería quitárselos al trabajador. A verificar con la asesoría laboral.

## Decisiones de diseño
1. **Política por CUENTA, anulable por LOCAL.** Sigue el patrón que ya usa `vacation_settings` (`scope`).
   Cubre el grupo multiprovincia, que es el cliente objetivo.
2. **Capa 1 = pausas (esto). Capa 2 = avisos de convenio (después).** La pausa sin avisos ya sirve; los
   avisos sin pausa, no.
3. **La pausa se ficha (salida+entrada), no se descuenta a ciegas.** Motivo: el registro horario debe
   reflejar la jornada real. El descuento automático es una ficción que no defiende en inspección.
   Se ofrece igualmente como modo para quien lo prefiera, pero marcado como "estimado".

## Lo que ya juega a favor (no hay que reinventar el motor)
`team_worked_shifts` empareja **entrada→salida** consecutivas. Consecuencia:
- **Turno partido ya sale bien**: dos pares = dos jornadas, el hueco no se cuenta. (4 h + 4 h = 8 h.)
- **Pausa fichada ya se descuenta sola**: 9–13:30 + 14–18 = 8 h 30. El motor no necesita cambios para el
  caso no computable.
- Lo único que hay que añadir al motor: cuando la pausa **sí computa** (Madrid), volver a sumar esos
  minutos como trabajo efectivo.

## Modelo de datos (propuesta)
**`break_policy`** (regla general por cuenta + anulación por local)
- `account_id`, `location_id` (NULL = regla de la cuenta; con valor = anulación de ese local)
- `mode`: `'fichado'` | `'automatico'`
- `register_as_worked_default`: si el descanso computa como trabajo efectivo
- Reglas en `rules` jsonb, lista ordenada por umbral:
  `[{min_shift_minutes: 360, break_minutes: 30, paid_minutes: 15, label: 'Comida'}, ...]`
  (cubre Valencia: 30 min de los que 15 computan; y Madrid: 15/15.)
- `max_continuous_minutes` (Madrid: 300 → aviso a las 5 h sin pausa)
- `split_min_gap_minutes` / `split_max_gap_minutes` (partida: 90/240 según convenio)
- `min_rest_between_shifts_minutes` (12 h = 720)

**Registro de la pausa**: `clock_entries.type` hoy solo admite `'entrada'|'salida'`. Dos vías:
- (a) Ampliar el CHECK con `'pausa_inicio'|'pausa_fin'` → explícito, mejor para informes e Inspección.
- (b) Reusar salida+entrada con una marca `is_break` → cero cambios en el motor.
**Recomendación: (a)**, con el motor tratándolos como salida/entrada a efectos de cálculo. Es más honesto
en el informe ("descanso" ≠ "fin de jornada") y es lo que un inspector espera ver.

**Atestación** (lo que hace 7shifts y es su mejor idea): al fichar salida, el trabajador confirma si
disfrutó su descanso. Es la defensa documental ante un "nunca me dieron mi descanso".
→ `clock_entries.break_attested` (bool) + motivo si dice que no.

## UX
- **Kiosko**: botón grande **Pausa** / **Volver de pausa**. El trabajador no piensa en fichar salida.
- **Encargado**: aviso cuando una jornada supera el umbral sin pausa registrada.
- **Informe**: por jornada → presencia, descanso, trabajado, y si el descanso computa o no.

## Dónde ganamos a 7shifts (el líder)
7shifts tiene descansos configurables pagado/no pagado, umbral por duración y atestación — pero está hecho
para EE.UU. **No cubre**: convenios provinciales españoles, reglas de **jornada partida** (mín./máx. entre
tramos), tope de horas seguidas sin pausa, descanso mínimo de 12 h entre jornadas, ni el registro horario
español (conservación 4 años, accesible a plantilla e Inspección).
**Folvy = descansos configurables + motor de convenio español.** Ese es el margen decisivo.

## Capa 2 (después): motor de avisos de convenio
Detectar y avisar: jornada > umbral sin descanso · más de X h seguidas sin pausa · menos de 12 h entre
jornadas · tramos de partida fuera de rango · jornada diaria > 9 h. Cada aviso, con el artículo que lo
respalda. Es lo que convierte el registro horario de "obligación" en "escudo".
