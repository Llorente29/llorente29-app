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
