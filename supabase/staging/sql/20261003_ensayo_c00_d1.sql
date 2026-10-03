-- SOLO STAGING-CONTA. ENSAYO de D1: vat_rate_for da lo mismo leyendo de
-- tax_rate (por el puente) que leyendo de vat_rate. SOLO LEE: no escribe nada.
--
-- La vara, la misma a los dos lados (regla 31): para cada una de las 5
-- categorías y CADA DÍA de 2024-01-01 a 2026-12-31 (5 × 1.096 = 5.480 pares),
--
--   antes   = la consulta de siempre de vat_rate_for, literal, sobre vat_rate
--   después = la consulta de la migración 0140, literal, sobre vat_category_rate
--   función = lo que devuelve hoy vat_rate_for(categoría, día)
--
-- y se exige antes = después y antes = función en el 100 % de los pares
-- (porcentaje y recargo comparados como NÚMEROS: 4 = 4.00; «sin tipo» también
-- cuenta como valor).
--
-- Va DOS veces en la tanda: antes de la 0140 (la función es la vieja: mide que
-- la vara cuadra consigo misma y que la consulta nueva ya da lo mismo) y
-- después (la función es la nueva). El resultado dice de dónde lee la función.

do $$
declare
  n_pares int; n_dif_nueva int; n_dif_funcion int; n_con_tipo int;
  lee text; tramos text; r text;
begin
  if (select count(*) from public.vat_category) <> 5 or (select count(*) from public.vat_rate) <> 6 then
    raise exception 'ENSAYO D1: falta el catálogo de IVA de Cocina (semilla seed_c00_catalogo_iva_cocina.sql).';
  end if;
  if not exists (select 1 from public.vat_category_tax) then
    raise exception 'ENSAYO D1: el puente vat_category_tax está vacío (falta la migración 0130).';
  end if;

  lee := case when pg_get_functiondef('public.vat_rate_for(uuid,date)'::regprocedure) like '%vat_category_rate%'
              then 'tax_rate (vista vat_category_rate) · DESPUÉS de la 0140'
              else 'vat_rate · ANTES de la 0140' end;

  with dias as (
    select d::date as dia from generate_series(date '2024-01-01', date '2026-12-31', interval '1 day') d
  ), pares as (
    select c.code, d.dia,
      (select row(v.rate, v.equivalence_surcharge) from public.vat_rate v
        where v.category_id = c.id and v.valid_from <= d.dia and (v.valid_to is null or v.valid_to >= d.dia)
        order by v.valid_from desc limit 1)                                   as antes,
      (select row(v.rate, v.equivalence_surcharge) from public.vat_category_rate v
        where v.category_id = c.id and v.valid_from <= d.dia and (v.valid_to is null or v.valid_to >= d.dia)
        order by v.valid_from desc limit 1)                                   as despues,
      (select row(f.rate, f.equivalence_surcharge) from public.vat_rate_for(c.id, d.dia) f) as funcion
    from public.vat_category c cross join dias d
  ), n as (
    select count(*) as pares,
           count(*) filter (where antes is distinct from despues
             and not (code = 'alimento_basico' and dia between date '2024-10-01' and date '2024-12-31'
                      and antes is null and despues = row(2.00::numeric, 0.26::numeric))) as dif_nueva,
           -- Respuesta 2 de Julio: el 2 % del 4.º trimestre de 2024 a todos los
           -- básicos es una diferencia DECIDIDA (vat_rate solo lo tenía para el
           -- aceite). No cuenta como fallo; cualquier otra, sí.
           count(*) filter (where antes is distinct from funcion
             and not (code = 'alimento_basico' and dia between date '2024-10-01' and date '2024-12-31'
                      and antes is null and funcion = row(2.00::numeric, 0.26::numeric))) as dif_funcion,
           count(*) filter (where antes is not null)              as con_tipo
      from pares
  ), segmentos as (
    select code, antes::text as antes, min(dia) as desde, max(dia) as hasta from pares group by code, antes::text
  )
  select n.pares, n.dif_nueva, n.dif_funcion, n.con_tipo,
         (select string_agg(format('   %s %s → %s: %s', s.code, s.desde, s.hasta, coalesce(s.antes, 'sin tipo')),
                            E'\n' order by s.code, s.desde) from segmentos s)
    into n_pares, n_dif_nueva, n_dif_funcion, n_con_tipo, tramos
    from n;

  r := format(E'\n vat_rate_for lee de: %s\n %s pares categoría × día, %s con tipo\n diferencias vat_rate ↔ consulta de la 0140: %s\n diferencias vat_rate ↔ vat_rate_for: %s\n tramos (según vat_rate):\n%s',
              lee, n_pares, n_con_tipo, n_dif_nueva, n_dif_funcion, tramos);

  if n_pares <> 5480 or n_dif_nueva <> 0 or n_dif_funcion <> 0 then
    raise exception E'ENSAYO D1 FALLA:%', r;
  end if;
  raise notice E'ENSAYO C00 · D1 (solo lectura):%', r;
end $$;
