# F10 — Verificación "Cubrir el resto" + arreglo de reparto (09/08/2026)

> Estado a fecha de este documento:
> - `T0940`, `T0945`, `T1530` (corregida) y **`T1600` (reparto v4) YA ESTÁN
>   APLICADAS en producción** — Julio las aplicó y midió en vivo (Alcalá
>   03/08, `contract_tolerance_pct=10`, ver §8 del encargo 2ª parte). Los
>   ficheros del repo se han sincronizado a posteriori con lo vivo.
> - `20260809T1700_generate_week_schedule_mix_de_turnos.sql` es la ÚNICA
>   migración pendiente de este encargo (3ª parte, §8: arregla CUÁNTOS
>   turnos largos de 9,5h propone el motor, no quién ni en qué orden — eso
>   ya funciona). Validada por MCP dos veces (encontró y corrigió dos
>   efectos en cadena antes de la versión final — ver cabecera de la
>   migración). Ver §9 más abajo.
> - `contract_tolerance_pct` sigue en **10 %** en producción — es una
>   decisión laboral (permite llegar a 44h en un contrato de 40),
>   **pendiente de confirmación explícita de Julio** (§0 del encargo).
>
> IDs reales de esta cuenta (Llorente29 / Foodint) — **no confundir con los
> duplicados de la cuenta demo "Folvy Interno"** `00000000-0000-0000-0000-000000000001`
> (esa cuenta es el inquilino de ensayo multi-tenant, no basura, pero no
> participa en este encargo):
>
> | | id |
> |---|---|
> | account_id | `51ad1792-6629-4ef7-833a-b57b09a86710` |
> | Foodint Alcalá (real) | `38158159-cd71-4056-950b-53425afac1ce` |
> | Foodint Carabanchel (real) | `92d7656e-082e-452a-8ebc-236b2d6ebf5f` |
> | Foodint Plaza Castilla (real, **cerrado** `active=false`) | `629f9154-b888-48ed-9b8c-ffae77620615` |
> | Mañana (`bac57b07…`) · Tarde/Noche F/S (`57e24dd0…`) · Corrido1/turno largo (`a362283f…`) · Corrido2 (`5d5ea69d…`) | plantillas reales de Alcalá |

Una sentencia por Run (regla del proyecto). No fiarse del "Success" — mirar
siempre el resultado.

---

## 1. Aplicar la migración pendiente

Aplicar `20260809T1600_generate_week_schedule_reparto_v4.sql` (una sola
sentencia `create or replace function` + su guard). **Validada por Claude
por MCP antes de entregar** (creada con nombre temporal, ejecutada contra
Alcalá 03/08 real, corregido un bug real que encontró esa ejecución — ver
cabecera de la migración —, y borrada). Julio la vuelve a verificar aquí de
todas formas: la validación de Claude no sustituye esta verificación, la
precede.

```sql
select pg_get_functiondef(p.oid) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'generate_week_schedule';
```

Comprobar a ojo:
- Contiene `v_assign_all` (fase de generación separada de la de asignación).
- Contiene `v_allow_long_repeat` (tope duro de turno largo con reintento).
- Contiene `dias_trabajados` (equilibrio de jornadas).
- Sigue conteniendo `o_shift_template_id` y el filtro de local cerrado (nada de v3 se ha perdido).

---

## 2. Local cerrado → 0 filas (sigue igual, no debería haber cambiado)

```sql
select count(*) from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '629f9154-b888-48ed-9b8c-ffae77620615'::uuid,
  '2026-08-10'::date
);
```

Debe dar **0**.

---

## 3. 🎯 Prueba de aceptación — reparto de Alcalá, semana 2026-08-03

```sql
select o_dow, o_shift_template_id, o_ini, o_fin, o_horas, o_employee, o_hueco, o_motivo
from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '38158159-cd71-4056-950b-53425afac1ce'::uuid,
  '2026-08-03'::date
)
order by o_dow, o_ini;
```

Comparar contra el cuadrante real publicado esa semana:

```sql
select jsonb_pretty(cells)
from public.schedules
where location_id = '38158159-cd71-4056-950b-53425afac1ce'
  and week_start = '2026-08-03';
```

**Resultado que obtuvo Claude en la validación por MCP (0% de tolerancia,
igual que producción hoy) — anotado aquí para que Julio compare, no para
que se dé por bueno sin mirar:**

| | Cuadrante real | v4 validado por Claude |
|---|---|---|
| Horas totales | 124,25 | **110,0** (peor que las 114,25 de v3 sin arreglar) |
| Johanny · Natacha · Pamela | 40,3 · 43,5 · 40,5 | 36,5 · 37,0 · 36,5 |
| Días trabajados | 6 · 6 · 6 | **6 · 5 · 6** (v3 sin arreglar daba 4·6·4) |
| Huecos | 0 | **2, el lunes** (v3 sin arreglar los daba el domingo) |
| Turno largo repetido en la misma persona | nunca | sigue pasando 1-2 veces por persona, pero ahora **declarado**: `'Segundo turno largo — no había alternativa'`, nunca camuflado como reparto normal |

Esto **no es una regresión escondida**: es la contracara exacta de arreglar
el orden de asignación (Cambio A). Al servir primero el día fuerte, el lunes
(el más flojo) es el que se queda sin margen de contrato — antes pasaba al
revés (el domingo se quedaba sin margen). Con 0% de tolerancia, tapar el
lunes entero exige horas que ninguno de los 3 tiene ya libres.

**⚠️ Antes de decidir si esto es aceptable, repetir la prueba con
`contract_tolerance_pct` en 10% (la cifra que ya usa el generador cliente
`scheduleGenerator.ts`)**:

```sql
update public.break_policy
   set contract_tolerance_pct = 10, updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and location_id is null;
```

...volver a correr la consulta de arriba, y comparar. El hallazgo de la 1ª
parte de este encargo ("subir la tolerancia a 10% no cambiaba nada") se
midió contra la v3 con el bug del orden cronológico — con ese bug ya
corregido, la dinámica es distinta y merece una oportunidad real antes de
descartar la tolerancia otra vez. **Si tras la prueba se deja en 10%,
declararlo explícitamente — si se vuelve a 0%, también.**

```sql
-- para devolver a 0% si no se adopta:
update public.break_policy
   set contract_tolerance_pct = 0, updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and location_id is null;
```

Criterios del encargo (§4), en orden de importancia — marcar cada uno con el
resultado real observado, no con lo esperado:
- [ ] Cero huecos el domingo (o, si los hay, con motivo específico y justificado).
- [ ] Máximo un corrido de 9,5h por persona (⚠️ ver tabla arriba — probable que no se cumpla al 100% con 3 personas y 2 corridos concurrentes en días pico; comprobar si el motivo sale como "Segundo turno largo" en vez de silencioso).
- [ ] Días trabajados parecidos entre los tres (6·6·6, no 4·6·4).
- [ ] Horas por persona entre 38 y 43,5.
- [ ] Las formas de turno siguen siendo las reales (si esto se rompe, parar y revisar — sería indicio de que algo de v3 se dañó).

---

## 4. Huecos con motivo específico (Cambio D)

En la salida de la prueba anterior, cualquier fila con `o_hueco=true` debe
traer un `o_motivo` que empiece por `'SIN CUBRIR — '` seguido de al menos
una razón concreta (`tope de horas contratadas (N)`, `descanso de 12h (N)`,
`descanso semanal (N)`, `jornada máxima diaria (N)`, `ya tienen turno
solapado (N)`, `hueco de turno partido insuficiente (N)`), NUNCA el genérico
viejo "nadie puede sin incumplir convenio" a secas.

---

## 5. `team_compliance_scan` sigue en 54 — no se ha silenciado nada

```sql
select count(*) from public.team_compliance_scan(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  now() - interval '90 days',
  now()
)
where issue_code = 'EXCESO_JORNADA_DIARIA';
```

Debe seguir dando **54**. Si baja, parar y avisar — este encargo no toca
`team_compliance_scan` ni debería poder afectarlo (motor de planificación,
no de cumplimiento).

---

## 6. Carabanchel — sin huecos por debajo del mínimo, sin romper nada

```sql
select o_shift_template_id, o_ini, o_fin, o_horas, o_employee, o_hueco, o_motivo
from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid,
  '2026-08-10'::date
)
order by o_fecha, o_ini;
```

Ningún `o_horas < 3` fuera de un hueco declarado.

---

## 7. Guardar una propuesta y comprobar que aparece en `schedules.cells`

Sigue siendo el **rodaje real** pendiente: nunca se ha guardado ninguna
propuesta de este motor en producción. Desde la app (Calendario → Alcalá →
semana que sea → "Proponer cuadrante" → revisar → "Guardar"), y luego:

```sql
select id, status, jsonb_pretty(cells)
from public.schedules
where location_id = '38158159-cd71-4056-950b-53425afac1ce'
order by updated_at desc
limit 1;
```

Confirmar que las claves de `cells` son ids reales de `shift_templates` (no
`gen-*` salvo que hubiera refuerzo excepcional ese día).

---

## 8. Build

```
npm run build
```

Ya verificado en verde por Claude antes de este commit (`tsc -b && vite
build`, sin errores). Repetir tras aplicar la migración si se toca algo más.

---

## 10. Solver exacto (encargo final) — sustituye al greedy en "Proponer cuadrante"

**No hace falta ninguna migración para esta parte** — el motor pasa a ser
`src/services/scheduleSolver.ts` (TypeScript, cliente), puerto de
`docs/solver_prototipo.py`. `generate_week_schedule` (plpgsql) queda vivo
sin tocar — lo sigue usando "Cubrir el resto", fuera de alcance de esta
parte del encargo.

**Verificación ya hecha por Claude, automatizada** (§4.6 del encargo):

```
npm test -- tests/unit/services/scheduleSolver.test.ts
```

5 tests, todos en verde. Reproducen las DOS semanas del oráculo
(`docs/solver_prototipo.py`) **día por día, asiento por asiento** — no solo
el total: 0 huecos, días libres escalonados y rotando (`{Johanny:L,
Natacha:M, Pamela:X}` semana 03/08 → `{Johanny:M, Natacha:X, Pamela:L}`
semana 10/08), 39,25h cada una, spread 0,0, un Corrido1 máximo por persona,
y el **lunes de la semana 10/08 con gente trabajando** (la regresión #1 que
motivó abandonar la línea greedy).

⚠️ **Lo que Claude NO ha podido verificar** (sin credenciales de Julio en
este entorno): la app en vivo — abrir Calendario, pulsar "Proponer
cuadrante" con datos reales de producción, revisar la propuesta en pantalla,
Guardar y Publicar. Es el mismo "rodaje" que llevaba pendiente desde la 1ª
parte de este encargo (nunca se ha guardado una propuesta de ningún motor
de F10 en producción) — sigue pendiente, ahora con el solver.

Pasos para Julio:
1. `git pull` en `feat/f10-cubrir-el-resto` (o mergear la rama).
2. Calendario → Alcalá → semana 03/08 (la real) → "Proponer cuadrante".
3. Comparar contra `schedules.cells` de esa semana (§4 del encargo).
4. Semana 10/08 → confirmar que el lunes NO sale vacío.
5. Guardar y Publicar una vez — el rodaje pendiente desde el principio.
6. `team_compliance_scan` 90 días sigue en 54 (no debería cambiar: el
   solver no toca cumplimiento, solo genera la propuesta).

---

## 11. Fix — plantillas sin asiento declarado (rodaje 09/08, commit sobre `a5e6a1b`)

El rodaje del punto 10 encontró un defecto real: en Alcalá semana 10/08, el
set-cover sentaba a Natacha/Pamela en "Mañana1" (12:30–16:00, `coverage=0`,
0 uso histórico — gemela sin depurar, F7.2) en vez de "Mañana"
(12:30–16:45, `coverage=1` los 7 días, 59 semanas de uso real), dejando 4
huecos declarados sobre el asiento que sí existía. Causa: el objetivo del
set-cover (`unc, count, tot`) no miraba ni `coverage_<dia>` ni `uso` —
Mañana1, al ser más corta, ganaba por horas.

Arreglo: nuevo criterio `tier` en el objetivo (`unc, tier, count, tot`) —
nivel 0 = asiento declarado (`coverage_<dia}>0`), nivel 1 = sin declarar
pero con uso histórico real (los corridos: `coverage=0` en Alcalá pero SÍ
se usan), nivel 2 = ni una cosa ni la otra (Mañana1). Se compara antes que
horas/nº de asientos — nunca se ocupa un nivel peor por ser más barato.

2 tests nuevos (`tests/unit/services/scheduleSolver.test.ts`, describe
"nivel de plantilla"): Mañana gana a Mañana1 aunque sea más cara; un corrido
con `coverage=0` sigue siendo elegible (no se filtra solo por coverage — eso
mataría los corridos de verdad). Los 5 tests del oráculo siguen en verde
(en esos fixtures todas las plantillas tienen coverage>0, así que el nuevo
criterio no las distingue — comportamiento sin cambios frente al oráculo).

**Pendiente**: repetir el rodaje de Alcalá 10/08 con este fix — el encargo
espera que los 4 huecos bajen a 0 y las horas colocadas suban ~3h. Sin
credenciales de Julio en este entorno, Claude no lo ha podido comprobar en
vivo — solo por test.

---

## 9. Mix de turnos (3ª parte, T1700) — cuántos corridos, no quién ni cuándo

Aplicar `20260809T1700_generate_week_schedule_mix_de_turnos.sql` (una sola
sentencia `create or replace function` + su guard). Validada por Claude por
MCP **dos veces** antes de escribirse — la 1ª validación del orden propuesto
literal (`neto desc, uso desc...`) resucitó plantillas duplicadas sin uso
real; la 2ª (con `uso desc` primero) dejó el turno largo garantizado sin
sitio y lo convirtió en huecos. La versión final mueve el turno largo
garantizado a ANTES del greedy — ver cabecera de la migración para el
detalle completo, no maquillado.

```sql
select o_dow, o_shift_template_id, o_ini, o_fin, o_horas, o_employee, o_hueco, o_motivo
from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '38158159-cd71-4056-950b-53425afac1ce'::uuid,
  '2026-08-03'::date
)
order by o_dow, o_ini;
```

**Resultado que obtuvo Claude en la validación por MCP** (con
`contract_tolerance_pct=10`, el valor ya en producción):

| | Cuadrante real | v4 (antes de T1700) | T1700 validado |
|---|---|---|---|
| Corridos de 9,5h | 3 | 8 | **3** ✅ |
| Uno por persona | sí | no (4·3·0) | **sí** ✅ |
| Avisos "Segundo turno largo" | — | 5 | **0** ✅ |
| Días trabajados | 6·6·6 | 6·6·6 | **6·6·6** ✅ |
| Huecos | 0 | 2 | **2** (no sube) ✅ |
| Plantillas usadas | las 4 reales | las 4 reales | **las 4 reales** ✅ |
| Horas totales | 124,25 | 119,5 | **97,5** 🔴 |

Criterios del encargo (§8.4), marcar con el resultado real:
- [ ] Corridos de 9,5h: máximo 3-4 (el real son 3).
- [ ] Avisos "Segundo turno largo — no había alternativa": 0-1.
- [ ] Días trabajados siguen en 6·6·6, huecos no suben de 2.
- [ ] **Horas totales no bajan de 115** — ⚠️ en la validación de Claude
      dieron **97,5**. Este criterio, tal como está la migración propuesta,
      **no se cumple**. Es la contracara de quitar el desperdicio: al no
      sobredotar con turnos largos que tapan de más, el total baja. Decisión
      pendiente de Julio: ¿aceptar un cuadrante más ajustado a la demanda
      pura con el patrón estructural correcto (3 corridos, 1 por persona),
      cerrando la distancia hasta 124h con "Cubrir el resto" (§8.5, todavía
      sin probar nunca) — o pedir una 4ª vuelta de ajuste del greedy?
      **No se ha intentado una 4ª vuelta a ciegas**: cada ajuste adicional en
      esta sesión ha encontrado un efecto en cadena nuevo: seguir requiere
      criterio de negocio explícito antes de seguir tocando el solver.
- [ ] Las formas de turno siguen siendo las 4 reales (si esto se rompe, parar y revisar).
- [ ] `team_compliance_scan` 90 días sigue en 54 (repetir consulta de §5).

---

## 12. Reparto justo de partidos y descanso semanal (encargo 5º, 09/08 noche)

**⚠️ Hallazgo prioritario, independiente del reparto de partidos — leer
antes que el resto de esta sección.** El encargo pedía comprobar si el
solver mira más allá del lunes de la semana que resuelve al calcular el
descanso semanal. **No lo hace.** `solveWeekSchedule()` no recibe ni lee
nunca el cuadrante de la semana anterior/siguiente — `lastShiftEndAbs` (el
fin del último turno de cada persona) arranca vacío en cada llamada, y
`minWeeklyRestNow()` calcula el descanso semanal **solo dentro de la
semana que se resuelve**, con el propio lunes 00:00/domingo 24:00 como
límite si no hay turno pegado al borde. Es el mismo límite que ya tiene
`has_weekly_rest` en plpgsql (v3/v4/T1700) — no es una regresión de este
encargo, es una limitación que ya existía y que este encargo hereda sin
tocar. Consecuencia práctica: el caso real que motivó este encargo (Pamela
con 36,25h de descanso semanal) solo es visible encadenando el cierre del
domingo de la semana anterior con la apertura del lunes de esta — **ni el
plpgsql ni el solver TypeScript lo detectan hoy**, ambos pueden reportar un
descanso semanal "correcto" (o "al límite") que en realidad incumple al
mirar la frontera real entre semanas. Tratarlo como encargo aparte, como
pedía el encargo si se confirmaba — **confirmado**.

**`break_policy.rest_safety_margin_minutes` (30 min, aplicada 08/08) — a
qué se aplica hoy:** a descanso **semanal**, no diario. Es el margen que usa
`propose_schedule_rest` (RPC, mismo fichero de migración
`20260808T1300_break_policy_margen_seguridad_descanso.sql`) para clasificar
cada persona en `'ok' | 'al_limite' | 'incumple'` comparando su descanso
semanal más corto contra `mínimo` y `mínimo + margen`. Es un umbral de
**aviso**, no una restricción dura (un cuadrante a 36h05 es legal). Y es
importante: **ni el solver TypeScript ni `generate_week_schedule` lo leen**
— es una función de diagnóstico aparte, llamada desde
`scheduleProposalService.ts` para pintar el semáforo en pantalla DESPUÉS de
generar la propuesta, no un parámetro que entre en el objetivo de ninguno
de los dos motores. Y, por el hallazgo de arriba, ese diagnóstico también
mira solo dentro de la semana — mismo punto ciego.

**Objetivo nuevo, implementado en `src/services/scheduleSolver.ts`:**
`maxSplitsPerEmployee` (criterio 4) y `−minWeeklyRestMinutes` (criterio 5),
añadidos al objetivo lexicográfico de `rec()`. **Orden final: `[dev,
splits_total, spread, maxSplits, −minRest]`** — spread (igualdad de horas)
sigue mandando antes que los dos criterios nuevos, **no** el orden literal
del encargo (que los pedía entre splits_total y spread). Decisión tomada
tras comprobarlo empíricamente (regla del proyecto: validar antes de
entregar, no solo leer):

| Orden probado | Partidos (semana 10/08 real) | Horas |
|---|---|---|
| Literal del encargo (4/5 antes de spread) | 2-2-1 ✅ | 39,25 / 38,5 / 40 ❌ |
| **Elegido** (spread antes de 4/5) | 3-1-1 (sin cambio de patrón) | **39,25 × 3** ✅ |

Para la demanda real de Alcalá, **2-2-1 exacto y 39,25h×3 exactas no son
alcanzables a la vez** — es un trade-off de negocio real, no un bug.
Con el orden elegido las horas nunca se tocan; el descanso semanal mejora
mucho de todas formas: **43,5h** el peor caso (frente a 36,25h en el
cuadrante real sin este criterio) — ver el segundo test de §12.1. Si Julio
prefiere el otro orden (2-2-1 exacto, aceptando que las horas dejen de ser
iguales), es una decisión suya, no una corrección de un error.

### 12.1 Tests (`tests/unit/services/scheduleSolver.test.ts`)

9 tests, todos en verde (`npm test -- tests/unit/services/scheduleSolver.test.ts`):
- Los 5 tests del oráculo (§10) y los 2 de nivel de plantilla (§11) siguen
  en verde. Los 2 tests de la semana 03/08 y 10/08 se ajustaron: dejaron de
  exigir la fila exacta persona-por-turno del oráculo (el propio oráculo
  tiene la misma asimetría 3-1-1 que este encargo corrige, así que un
  reparto más justo elige, entre soluciones empatadas en horas/huecos/
  partidos totales, una fila distinta a la de python) — lo que sigue
  vinculante (huecos=0, días libres, horas 39,25×3, total 117,75, partidos=5,
  desvío 2,25, spread 0,0, máx. 1 corrido/persona) se mantiene intacto.
- 2 tests nuevos:
  1. Fixture sintético (2 plantillas de igual duración, 3 personas, 3 días
     abiertos): 2 partidos forzados por aritmética, con una sola persona
     disponible ambos días forzados (podría llevarse los 2). El solver
     reparte 1 a cada una de dos personas distintas — `maxSplitsPerEmployee
     ≤ 1`, nunca 2.
  2. Semana 10/08 real: horas siguen en 39,25×3 (spread 0,0) con el
     criterio nuevo activo; `maxSplitsPerEmployee=3` (no baja de 3-1-1 para
     esta demanda, número exacto verificado) y `minWeeklyRestMinutes=2610`
     (43,5h, verificado, frente a las 36,25h del cuadrante real).

`npx tsc -b` y `npm run build` en verde. `npx eslint` en verde sobre los dos
ficheros tocados. El resto de la suite (`npx vitest run`) tiene 3 ficheros
en rojo (`routes.test.ts`, `brandsService.mappers`, `salesChannelsService.mappers`)
— **preexistentes, no tocados en esta rama, sin relación con
`scheduleSolver.ts`** (multitenancy/rutas, módulos que este encargo no toca).

### 12.2 Pendiente

- Rodaje real en Alcalá 10/08 con "Proponer cuadrante": confirmar en vivo
  que splits/horas/huecos/corridos/días libres coinciden con lo que
  predicen los tests (sin credenciales de Julio en este entorno, solo
  verificado por test).
- El cuadrante draft guardado en `schedules` (`1e95fdbc-93b2-4ae2-a8a1-38dfbda9b8d8`,
  `status='draft'`) sigue sin publicarse — decisión explícita de Julio hasta
  que el reparto de partidos sea justo. Con este fix, el peor descanso pasa
  de 36,25h a 43,5h; el patrón de partidos queda en 3-1-1 (no 2-2-1) salvo
  que Julio prefiera el orden literal del encargo y ceda la igualdad de horas.
- El punto ciego de fin de semana (arriba) queda **fuera de este encargo**,
  declarado como posible encargo aparte, prioritario según el propio
  encargo si se confirmaba — y se ha confirmado.

---

## 13. El descanso semanal cruza la frontera de semana (encargo 6º, 09/08 noche)

### 13.1 RECON contra BBDD real (MCP, antes de tocar código)

Confirmado el caso exacto que reportaba Julio, letra por letra, contra las
filas reales de `schedules`:

- Semana **03/08 publicada** (`schedules.status='published'`, Alcalá):
  Johanny, Natacha y Pamela tienen las tres su último turno del domingo
  (día 6) en la plantilla `Tarde/Noche F/S` (`19:45–00:15`) o en un partido
  que termina en ella — **las tres terminan a las 00:15 del lunes**.
- Borrador semana **10/08** (`schedules` id `1e95fdbc-93b2-4ae2-a8a1-38dfbda9b8d8`,
  `status='draft'`): el primer turno de Pamela es el **martes (día 1) a las
  12:30** (plantilla `Mañana`).
- Descanso real de Pamela: 00:15 lunes → 12:30 martes = **36h15min**
  exactos. `break_policy` real de la cuenta: `weekly_rest_minutes=2160`
  (36h), `rest_safety_margin_minutes=30`. 2175min ≥ 2160 (cumple la ley por
  15 min) pero < 2190 (2160+30, el margen) → **al_limite**, nunca visible
  hasta ahora porque ningún motor miraba la frontera.

Confirma exactamente lo que decía el encargo: **ni `scheduleSolver.ts` ni
`generate_week_schedule` comprueban esto.** En plpgsql, `has_weekly_rest`
(T1240) usa literalmente `p_week_start::timestamp` como pared de apertura
(`(min turno) - p_week_start`) — el mismo límite, confirmado leyendo la
función, no solo por analogía.

### 13.2 Arreglo implementado en `src/services/scheduleSolver.ts`

**`SolverInput`** gana 3 campos:
- `weeklyRestMinutesMin` (antes no existía — el descanso semanal NUNCA se
  comparaba contra ningún mínimo, solo se minimizaba como preferencia).
- `restSafetyMarginMinutes`.
- `previousWeekLastShiftEndByEmployee?: Map<string, number>` — minutos del
  fin del último turno de la semana anterior, relativos al lunes 00:00 de
  esta semana (puede ser negativo). Persona ausente del mapa, o mapa
  entero ausente = "no lo sé".

**Sembrado**: `lastShiftEndAbs` se inicializa con el valor del mapa cuando
existe — esto alimenta DOS cosas a la vez: (a) el descanso de apertura
(`first − weekOpenSeed`, sustituye al `first − 0` de antes) y (b) el
chequeo duro de `restBetweenShiftsMinutes` (12h entre turnos), que ahora
también protege el primer turno de la semana, no solo los internos. La
lógica de deshacer en el backtracking (`rec()`) ya era genérica — no
distinguía "valor sembrado" de "turno real anterior" — así que no hizo
falta tocarla, solo la inicialización.

**Restricción de generación** (no solo diagnóstico, como pedía el
encargo): nuevo criterio, EL PRIMERO del objetivo lexicográfico (por
delante incluso de horas) — nº de personas por debajo del mínimo LEGAL.
Igual que `has_weekly_rest` es un filtro duro en plpgsql, aquí cualquier
semana sin violaciones legales gana SIEMPRE a cualquier semana con alguna,
sin importar horas/partidos/spread. Si de verdad no hay forma de evitarlo
(todas las semanas completas violan el mínimo), el motor sigue devolviendo
la mejor encontrada — declarada, no oculta (`hasWeeklyRestViolation:
true`), mismo principio que el resto del proyecto.

El margen (30min) no se convierte en restricción dura (un cuadrante a
mínimo+5min es legal) — sigue el patrón ya usado en plpgsql (T1310): se
reporta como diagnóstico de 3 estados (`weeklyRestStatusByEmployee`:
`ok`/`al_limite`/`incumple`, igual que `propose_schedule_rest`), y la
preferencia por MÁS descanso (ya existente, criterio 5 del objetivo) ya
empuja hacia superarlo cuando es alcanzable sin coste en otros criterios.

**Nuevos campos de salida**: `weeklyRestByEmployee` (antes solo se veía el
peor, ahora cada persona), `weeklyRestStatusByEmployee`,
`crossWeekRestCheckedByEmployee` (declara honestamente qué personas
tuvieron dato real de frontera), `hasWeeklyRestViolation`.

**Alcance — solo el solver TS, como pedía el encargo**: `generate_week_schedule`
NO se ha tocado. `runScheduleSolver()` (el adaptador que llama al RPC real)
gana un parámetro opcional `previousWeekLastShiftEndByEmployee` que HOY
nadie pasa desde `CalendarioPage.tsx` — sin el fetch real (§13.3, bloqueado
en decisión de Julio), el comportamiento no cambia frente a antes de este
encargo: sigue cayendo a "no lo sé" con la pared del lunes 00:00 como
límite, declarado vía `crossWeekRestCheckedByEmployee=false`.

### 13.3 Decisión pendiente de Julio — de dónde sale el "último turno anterior"

**No la he tomado yo.** Propuesta, con el caso "no existe" resuelto:

**Prioridad: `clock_entries` (si existen Y son posteriores al fin de turno
planeado) → `schedules.cells` con `status='published'` → "no lo sé".**

- **`clock_entries`** cuando existan: es lo que de verdad pasó. Si alguien
  fichó salida más tarde de lo planeado (cierre alargado, motivo real de
  este proyecto — ver `rest_safety_margin_minutes`: "30min = lo que
  realmente se alarga un cierre de cocina"), el descanso real es MÁS CORTO
  que el plan, y es precisamente el caso que puede convertir un "al_limite"
  en "incumple" sin que el plan lo vea nunca.
- **`schedules.cells` publicado** cuando no hay fichaje todavía (se
  planifica con antelación, antes de que ocurra la semana anterior): es el
  contrato con el empleado, estable — nunca cambia bajo los pies de la
  propuesta de esta semana. **Explícitamente NO el borrador** (`draft`):
  puede editarse en cualquier momento, y sembrar desde algo mutable
  significa que la propuesta de esta semana queda huérfana en cuanto
  alguien edita el borrador de la anterior — contaminación circular que el
  propio encargo señala como el riesgo real (huecos falsos, motivos que
  dejan de ser fiables).
- **Ninguna de las dos existe** (semana anterior sin publicar todavía, o
  cuenta nueva sin historial): "no lo sé" — `crossWeekRestCheckedByEmployee=false`,
  nunca un 0 inventado ni una violación fabricada. Ya implementado y
  probado (§13.4).

Pendiente de que Julio confirme o corrija esta prioridad antes de construir
el fetch real dentro de `runScheduleSolver()`.

### 13.4 Tests (`tests/unit/services/scheduleSolver.test.ts`, 12 en total, 3 nuevos)

1. **Re-medición de `d7964ca` con la frontera real** (mismo describe que el
   reparto justo): sembrando los 3 valores reales de RECON (Johanny,
   Natacha, Pamela → 15 min cada una) sobre `DEMAND_1008`, la elección
   PROPIA del solver actual sigue en **43,5h, `ok` para las tres,
   `hasWeeklyRestViolation:false`** — el 43,5h de `d7964ca` NO era un
   espejismo del instrumento ciego, se sostiene con el instrumento
   arreglado. (El 36h15min real de Pamela viene del borrador `1e95fdbc…`
   YA GUARDADO, generado por una versión anterior a este reparto justo, no
   de la elección propia de este solver para esta demanda — de ahí el test
   siguiente, que aísla y reproduce ese caso exacto de forma determinista.)
2. **Caso real de Pamela, aislado**: fixture de 1 persona/1 plantilla real
   (Mañana) que reproduce EXACTAMENTE su patrón (libra el lunes, primer
   turno el martes 12:30, sembrado con el fin real del domingo anterior,
   00:15) → `minWeeklyRestMinutes` **exactos 36h15min** (no un umbral,
   el número literal), estado `al_limite` (cumple ley, no margen).
3. **Semana anterior inexistente o vacía**: mismo fixture sin sembrar (mapa
   ausente Y mapa vacío, los dos casos) → no revienta, `feasible:true`,
   `crossWeekRestCheckedByEmployee:false`, y el número que sale (36h30min,
   `ok`) es explícitamente MAYOR que el real (36h15min, `al_limite`) — el
   "número mayor" que describía el encargo, reproducido y confirmado.

Los 9 tests anteriores siguen en verde sin cambios de comportamiento (los 2
inline de "nivel de plantilla" y `baseInput()` ganaron los 2 campos nuevos
obligatorios con los valores reales de la cuenta, 2160/30 — no afecta a
ninguna aserción existente). `tsc -b`, `npm run build`, `eslint` en verde.
Los 3 ficheros en rojo preexistentes (multitenancy/rutas) siguen igual, sin
empeorar (165 tests pasan en total en la suite completa, antes 162 — sube
justo por los 3 nuevos de este encargo).

### 13.5 `generate_week_schedule` (plpgsql) — recomendación, sin tocar

Confirmado el mismo defecto (§13.1: `has_weekly_rest` usa la misma pared de
`p_week_start`). **Recomendación**: no invertir en arreglarlo todavía. El
backport en sí sería barato (`has_weekly_rest` ya acepta `p_turnos` como un
array de intervalos — bastaría con que el CALLER anteponga el intervalo del
último turno real de la semana anterior a ese mismo array, sin tocar la
firma de la función) — el coste no es técnico, es tocar un motor que quizá
se retire pronto. Mejor decidir primero si "Cubrir el resto" pasa al
solver TS (pendiente, declarado desde el sexto frente) y arreglar UNA vez,
en el motor que quede vivo, que arreglarlo dos veces por separado. No
tocado, regla de NO DESTRUCCIÓN.

---

## 14. Conectar la semilla de frontera (encargo 7º, 09/08 noche)

El parámetro `previousWeekLastShiftEndByEmployee` existía (encargo 6º) pero
nadie lo pasaba. Este encargo lo enchufa de verdad: `runScheduleSolver()`
ahora lo calcula solo, con la cascada que decidió Julio.

### 14.1 Cascada implementada

1. **`clock_entries`** (fichaje real) — el último par entrada→salida
   cerrado antes de la semana, **si supera el filtro de cordura**.
2. **`schedules.cells`** de la semana anterior, `status='published'`.
3. **"No lo sé"** — persona ausente del mapa. Nunca 0, nunca inventado.

**Nunca desde `draft`** — sin cambios respecto al encargo anterior.

### 14.2 El filtro de cordura — RECON real antes de fijar el umbral

RECON vía MCP, 60 días de fichajes de las 3 empleadas de Alcalá: **166
pares limpios, 0 entradas sin salida**, pero 4 jornadas por encima de 12h —
una de **23h51min** (Johanny, salida que se olvidó y se cerró tarde) y un
grupo de **3 personas la MISMA noche con salida idéntica de madrugada**
(18:06→06:38, huella de fallo de sistema, no de trabajo real en una cocina
que cierra a medianoche). "Posterior al plan" no basta como criterio — una
salida olvidada es SIEMPRE posterior al plan.

**Umbral**: `maxDailyMinutes + 3×restSafetyMarginMinutes`. Con los valores
reales de la cuenta (570 + 3×30 = **660 min = 11h**): deriva de política ya
configurada (el corrido más largo real llega a 9,5h; el margen de cierre
alargado, 30min, ya está establecido en el proyecto — triplicarlo da
margen generoso para un mal día sin dejar pasar un fichaje de 12h+ nunca
visto en un turno real). Confirmación posterior, no ajuste a mano: la
distribución real de duraciones tiene un hueco limpio entre 584 y 674
minutos — el umbral de 660 cae justo en ese hueco, separando lo legítimo
de lo anómalo sin haber sido calibrado contra estos datos.

### 14.3 Implementación (`src/services/scheduleSolver.ts`)

Dos funciones puras, exportadas y testeadas directamente (sin mock de
Supabase, mismo patrón que el resto del fichero):
- `resolveSeedFromClockEntries(rows, weekStartMs, sanityThresholdMinutes)`
  — empareja entrada→salida, se queda con el ÚLTIMO par cerrado, aplica el
  filtro. Si falla, no prueba uno anterior — cae al escalón 2 tal cual
  (regla explícita del encargo).
- `resolveSeedFromPublishedCells(prevCells, tplTimes, employeeId)` — igual
  cálculo que el RECON manual del encargo anterior (fin del último turno de
  la semana, `absEnd − WEEK_END_ABS`), ahora reutilizable.

`fetchPreviousWeekBoundary()` (async, toca BBDD) las envuelve: consulta
`clock_entries` (sin filtrar por local — el descanso es de la persona, no
del sitio) y, para quien no resolvió por fichaje, `schedules` publicado +
`shift_templates` de esa semana. Devuelve `seedByEmployee` y
`sourceByEmployee` (`'fichaje' | 'publicado' | 'ninguno'`, registrado por
persona — auditable).

`runScheduleSolver()` la llama automáticamente si nadie pasa un mapa
manual (el parámetro anterior pasa a llamarse
`previousWeekLastShiftEndByEmployeeOverride`, para tests/casos especiales
— sustituye entero, no se fusiona). Devuelve un tercer campo,
`crossWeekRestSourceByEmployee`, junto a `rows`/`outcome`.

### 14.4 "Avisar y seguir" — visible en pantalla (`CalendarioPage.tsx`)

Nuevo estado `proposalWeeklyRest` (por persona: minutos, estado, fuente),
poblado en `doPropose()`. En el desglose por persona, una píldora junto a
cada fila:
- **Sin comprobar** (`source==='ninguno'`): píldora neutra (gris, con
  icono de aviso) "Descanso semanal: no comprobado" — **nunca se pinta en
  verde** algo que no se ha podido verificar cruzando con la semana
  anterior (regla explícita §3 del encargo).
- **Comprobado**: píldora verde/ámbar/roja (`ok`/`al_limite`/`incumple`,
  mismos tokens de color que el resto de la app) con las horas exactas y,
  al pasar el ratón, la fuente (fichaje real / cuadrante publicado).

Nunca bloquea la generación — la propuesta se genera igual, el aviso es
solo informativo, tal como pedía §3 ("avisar y seguir").

### 14.5 Tests (`tests/unit/services/scheduleSolver.test.ts`, 17 en total, 5 nuevos)

1. Descarta el fichaje real de 23h51min (RECON exacto).
2. Descarta el grupo de 12h31min con 3 personas la misma madrugada (RECON
   exacto) — el caso que demuestra por qué "posterior al plan" no basta.
3. Acepta un fichaje normal (9h, por debajo del umbral) como semilla.
4. **Cascada completa** (el test que pedía §5.2 del encargo): fichaje
   anómalo de Johanny descartado → cae al cuadrante publicado (mismo caso
   real, Tarde/Noche 19:45-00:15, seed=15) → con esa semilla el motor NO
   declara ningún incumplimiento (`hasWeeklyRestViolation:false`,
   `weeklyRestStatusByEmployee` distinto de `'incumple'`).
5. Sin fichajes válidos y sin cuadrante publicado: no revienta, `"no lo
   sé"` (`crossWeekRestCheckedByEmployee:false`), propuesta generada igual.

Los 12 tests anteriores siguen en verde sin cambios. `tsc -b`, `npm run
build`, `eslint` en verde (los 15 problemas preexistentes de
`CalendarioPage.tsx` — 8 errores `react-hooks/set-state-in-effect` + 7
avisos `no-restricted-syntax` de `.toFixed()` — están en líneas que este
encargo no toca; confirmado comparando `eslint` con y sin los cambios de
esta sesión, exactamente los mismos 15). Suite completa: **170 tests
pasan** (antes 165), mismos 3 ficheros preexistentes en rojo sin relación
(multitenancy/rutas, 6 tests).

### 14.6 Pendiente

Rodaje real en Alcalá con "Proponer cuadrante": confirmar en pantalla que
la píldora de descanso semanal aparece por persona y que, con la semana
03/08 publicada real, la de Johanny/Natacha/Pamela sale como "comprobado"
(fuente: fichaje o publicado, según qué dato exista en ese momento) — sin
credenciales de Julio en este entorno, solo verificado por test.
