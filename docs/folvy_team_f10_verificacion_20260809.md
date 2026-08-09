# F10 — Verificación "Cubrir el resto" + arreglo de reparto (09/08/2026)

> Estado a fecha de este documento:
> - `T0940`, `T0945`, y una versión CORREGIDA de `T1530` (con las columnas de
>   `T1500`/`T1510`/`T1520` incluidas) **YA ESTÁN APLICADAS en producción**
>   (aplicadas directamente vía MCP durante la sesión, con el ERROR 42601 del
>   primer intento corregido en el sitio). Los ficheros del repo con esos
>   nombres se han sincronizado a posteriori con lo vivo — no hace falta
>   volver a aplicarlos, son idempotentes si se reaplican por error.
> - `20260809T1600_generate_week_schedule_reparto_v4.sql` es la ÚNICA
>   migración pendiente de aplicar de este encargo. Cambia el REPARTO
>   (quién hace cada turno), no el anclaje a plantillas (eso ya funciona).
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
