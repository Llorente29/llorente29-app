# F10 — Verificación tras aplicar las migraciones "Cubrir el resto" (09/08/2026)

> Orden de aplicación: `20260809T0940` y `T0945` YA están en producción (drift
> rescatado en este mismo commit). Aplicar en orden estas 4, una detrás de otra:
>
> 1. `20260809T1500_shift_templates_kind.sql`
> 2. `20260809T1510_team_labor_model_peak_margins.sql`
> 3. `20260809T1520_break_policy_contract_tolerance.sql`
> 4. `20260809T1530_generate_week_schedule_v3_ancla_plantillas.sql`
>
> ⚠️ La migración 4 cambia la forma de salida de `generate_week_schedule`
> (o_ini/o_fin pasan de hora entera a texto "HH:MM", se añade
> o_shift_template_id). **Debe ir junto al deploy del frontend** (mismo
> commit ya incluye `scheduleProposalService.ts` y `CalendarioPage.tsx`
> actualizados). Ver cabecera de la migración 4 para el detalle del riesgo si
> se aplica una cosa sin la otra.
>
> IDs reales de esta cuenta (Llorente29 / Foodint), para pegar en las
> consultas de abajo — **no confundir con los duplicados de la cuenta demo**
> `00000000-0000-0000-0000-000000000001`, que no participan en este encargo:
>
> | | id |
> |---|---|
> | account_id | `51ad1792-6629-4ef7-833a-b57b09a86710` |
> | Foodint Alcalá (real) | `38158159-cd71-4056-950b-53425afac1ce` |
> | Foodint Carabanchel (real) | `92d7656e-082e-452a-8ebc-236b2d6ebf5f` |
> | Foodint Plaza Castilla (real, **cerrado** `active=false`) | `629f9154-b888-48ed-9b8c-ffae77620615` |

Una sentencia por Run (regla del proyecto). No fiarse del "Success" — mirar
siempre el resultado.

---

## 1. La función ya no tiene el filtro viejo, y sí los nuevos

```sql
select pg_get_functiondef(p.oid) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'generate_week_schedule';
```

Comprobar a ojo en el resultado:
- Contiene `locations l where l.id = p_location and l.active` (filtro de local cerrado).
- Contiene `o_shift_template_id` en el `RETURNS TABLE`.
- Contiene `contract_tolerance_pct`.
- **NO** contiene ya `where (fin.hf3-fin.hi3) >= 1` (el hardcodeado viejo — ese bloque entero desaparece en v3).

---

## 2. Local cerrado → 0 filas (hallazgo #5)

```sql
select count(*) from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '629f9154-b888-48ed-9b8c-ffae77620615'::uuid,
  '2026-08-10'::date
);
```

Debe dar **0**. Si da más de 0, la migración 4 no se aplicó bien o el guard no abortó cuando debía — parar y avisar.

---

## 3. Alcalá y Carabanchel, semana 10/08 — sin huecos por debajo del mínimo

```sql
select o_shift_template_id, o_ini, o_fin, o_horas, o_employee, o_hueco, o_motivo
from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '38158159-cd71-4056-950b-53425afac1ce'::uuid,
  '2026-08-10'::date
)
order by o_fecha, o_ini;
```

```sql
select o_shift_template_id, o_ini, o_fin, o_horas, o_employee, o_hueco, o_motivo
from public.generate_week_schedule(
  '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
  '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid,
  '2026-08-10'::date
)
order by o_fecha, o_ini;
```

Revisar en los dos resultados:
- **Ningún** `o_horas < 3` fuera de un `o_motivo` de hueco declarado (nunca un turno suelto por debajo del mínimo).
- La mayoría de filas trae `o_shift_template_id` no nulo (ancladas a plantillas reales) — como mucho una por día con `o_shift_template_id` nulo (el refuerzo excepcional).
- `o_ini`/`o_fin` en formato "HH:MM" con cuartos de hora reales (12:30, 14:45, 19:45…), no horas enteras sintéticas.

---

## 4. 🎯 Prueba de aceptación principal — reproducir el cuadrante real de Alcalá

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

Criterios del encargo (§5) — anotar el resultado real, **no maquillar si no llega**:
- [ ] Propone las 4 plantillas reales (`bac57b07…` Mañana, `57e24dd0…` Tarde/Noche F/S, `a362283f…` Corrido1, `5d5ea69d…` Corrido2), no bloques sintéticos sueltos.
- [ ] Coloca **~124 h** en total (no 69h como la v2 vieja), cada persona entre 40 y 43,5 h.
- [ ] Cada una de las 3 personas tiene **un día completo libre**.
- [ ] Cada una tiene **un Corrido1** (turno largo) en un día de alta demanda.
- [ ] **Cero turnos por debajo de 3 h.**

⚠️ Límite declarado: la rotación de "quién libra qué día" y "quién tiene el
turno largo qué día" es **por fórmula** (varía cada semana según
`week_start`), no lee el cuadrante de la semana anterior. Puede no coincidir
exactamente persona-por-persona con el cuadrante real de esa semana concreta
— lo que importa aquí es que la FORMA se reproduzca (3 turnos reales, ~124h,
un día libre y un largo por persona), no que Natacha caiga justo en viernes.
Si la forma general no se acerca, decirlo tal cual — no maquillarlo.

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

Debe seguir dando **54** (mismo número que antes del 09/08). Si baja, algo
está silenciando una alarma legal real — parar y avisar, no seguir.

*(Firma verificada por RECON el 09/08: `team_compliance_scan(p_account uuid,
p_from timestamptz, p_to timestamptz)`, columna `issue_code`.)*

---

## 6. Guardar una propuesta y comprobar que aparece en `schedules.cells`

Esto es el **rodaje real**: nunca se ha guardado ninguna propuesta de este
motor todavía. Desde la app (Calendario → Alcalá → semana que sea →
"Proponer cuadrante" → revisar → "Guardar"), y luego:

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

## 7. Build

```
npm run build
```

Ya verificado en verde por Claude antes de este commit (tsc -b + vite build,
sin errores). Repetir tras aplicar las migraciones si se toca algo más.
