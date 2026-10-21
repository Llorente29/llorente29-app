-- supabase/staging/sql/20261130_p01_390_sin_sii_prueba.sql
--
-- SOLO STAGING. Prueba de 20261130T0380_p01_390_sin_sii, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Nombra lo que cambia en caliente:
-- public.conta_impuesto_reglas.
--
-- Con las empresas de la demo del P01 (semilla de staging) y TODAS las de
-- staging sin el SII:
--   0. Antes: la regla es la de la 0250 byte a byte (md5 8d6cce36…).
--   1. Importaciones de Prueba Levante (sociedad mensual con el SII): el 390
--      sale inactivo, con «Llevas el SII: no presentas el 390 (instrucciones
--      del modelo 390, AEAT).»
--   2. Hostal de Prueba Mayor (sin el SII): el 390 sale activo, como antes.
--   3. Al Hostal se le pone el SII dentro de la transacción: el 390 pasa a
--      inactivo; se le quita, y vuelve a activo.
--   4. Toda empresa de staging sin el SII: la regla da EXACTAMENTE las mismas
--      filas que antes (población entera, no ejemplos: regla 31).
--   5. Calcular los modelos de Levante (como Laura, su asesoría) no escribe el
--      390.
--   6. La vuelta atrás deja la regla de la 0250 byte a byte, y se vuelve a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 390 SII: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Antes: la regla de la 0250, y lo que dice para las empresas sin el SII ──
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_reglas(uuid)'::regprocedure) <> '8d6cce36753a63009a2a1a71cf4f99fa' then
    raise exception 'PRUEBA 390 SII · 0: la regla de staging no es la de la 0250 (md5 8d6cce36…): esta prueba no mide lo que cree.';
  end if;
  if not exists (select 1 from public.company c join public.company_tax_profile p on p.company_id = c.id
                  where c.id = 'd5ac0000-0000-4000-8000-00000000c05e' and p.sii) then
    raise exception 'PRUEBA 390 SII · 0: Levante no está en staging o no lleva el SII (¿falta la semilla del P01?).';
  end if;
  raise notice 'PRUEBA 390 SII · 0: la regla de la 0250 y Levante con el SII.';
end $$;
create temporary table _antes on commit drop as
select c.id as empresa, r.*
  from public.company c
  join public.company_tax_profile p on p.company_id = c.id and not coalesce(p.sii, false)
  cross join lateral public.conta_impuesto_reglas(c.id) r;

\i supabase/migrations/20261130T0380_p01_390_sin_sii.sql

-- ── 1 · Levante, con el SII: el 390, inactivo y con su porqué ───────────────
do $$ begin
  if not exists (select 1 from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c05e')
                  where form_code = '390' and not active and rule_key = 'anual_de_303'
                    and why = 'Llevas el SII: no presentas el 390 (instrucciones del modelo 390, AEAT).'
                    and rule_facts->>'sii' = 'true') then
    raise exception 'PRUEBA 390 SII · 1: con el SII, la regla no dice que el 390 no va (%).',
      (select jsonb_agg(to_jsonb(r)) from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c05e') r where r.form_code = '390');
  end if;
  raise notice 'PRUEBA 390 SII · 1: Levante, sin el 390 y con su porqué.';
end $$;

-- ── 2 · El Hostal, sin el SII: el 390, activo ───────────────────────────────
do $$ begin
  if not exists (select 1 from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c01e')
                  where form_code = '390' and active and why = 'Presentas el 303: en enero resumes el año en el 390.') then
    raise exception 'PRUEBA 390 SII · 2: sin el SII, el 390 ya no sale activo (%).',
      (select jsonb_agg(to_jsonb(r)) from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c01e') r where r.form_code = '390');
  end if;
  raise notice 'PRUEBA 390 SII · 2: el Hostal, con el 390.';
end $$;

-- ── 3 · Poner y quitar el SII al Hostal ────────────────────────────────────
update public.company_tax_profile set sii = true where company_id = 'd5ac0000-0000-4000-8000-00000000c01e';
do $$ begin
  if exists (select 1 from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c01e') where form_code = '390' and active) then
    raise exception 'PRUEBA 390 SII · 3: con el SII puesto, el 390 del Hostal sigue activo.';
  end if;
end $$;
update public.company_tax_profile set sii = false where company_id = 'd5ac0000-0000-4000-8000-00000000c01e';
do $$ begin
  if not exists (select 1 from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c01e') where form_code = '390' and active) then
    raise exception 'PRUEBA 390 SII · 3: quitado el SII, el 390 del Hostal no vuelve.';
  end if;
  raise notice 'PRUEBA 390 SII · 3: el SII manda: puesto, sin 390; quitado, con 390.';
end $$;

-- ── 4 · Sin el SII, todo igual: la población entera de staging ──────────────
do $$
declare n_antes int; n_distintas int;
begin
  select count(*) into n_antes from _antes;
  with despues as (
    select c.id as empresa, r.*
      from public.company c
      join public.company_tax_profile p on p.company_id = c.id and not coalesce(p.sii, false)
      cross join lateral public.conta_impuesto_reglas(c.id) r)
  select count(*) into n_distintas from (
    (select * from _antes except all select * from despues)
    union all
    (select * from despues except all select * from _antes)) x;
  if n_antes = 0 then raise exception 'PRUEBA 390 SII · 4: no hay empresas sin el SII en staging: no se mide nada.'; end if;
  if n_distintas <> 0 then
    raise exception 'PRUEBA 390 SII · 4: sin el SII, la regla cambia % filas de % (tienen que ser las mismas).', n_distintas, n_antes;
  end if;
  raise notice 'PRUEBA 390 SII · 4: % filas de las empresas sin el SII, idénticas antes y después.', n_antes;
end $$;

-- ── 5 · Calcular los modelos de Levante no escribe el 390 ───────────────────
select set_config('request.jwt.claims', '{"sub":"d5ac0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.conta_impuesto_obligaciones_calcular('d5ac0000-0000-4000-8000-00000000c05e');
  if (select x->>'hecho' from jsonb_array_elements(v) x where x->>'modelo' = '390') is distinct from 'no_toca' then
    raise exception 'PRUEBA 390 SII · 5: calcular hace algo con el 390 de Levante (%).', v;
  end if;
  raise notice 'PRUEBA 390 SII · 5: calcular, para el 390 de Levante: no_toca.';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.tax_obligation where company_id = 'd5ac0000-0000-4000-8000-00000000c05e' and form_code = '390' and valid_to is null) then
    raise exception 'PRUEBA 390 SII · 5: después de calcular, Levante tiene el 390.';
  end if;
end $$;

-- ── 6 · La vuelta atrás, y otra vez hacia delante ──────────────────────────
\i supabase/vuelta-atras/20261130T0380_p01_390_sin_sii.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_reglas(uuid)'::regprocedure) <> '8d6cce36753a63009a2a1a71cf4f99fa' then
    raise exception 'PRUEBA 390 SII · 6: la vuelta atrás no deja la regla de la 0250 byte a byte.';
  end if;
  raise notice 'PRUEBA 390 SII · 6: vuelta atrás hecha: la regla de la 0250, md5 8d6cce36….';
end $$;
\i supabase/migrations/20261130T0380_p01_390_sin_sii.sql
do $$ begin
  if exists (select 1 from public.conta_impuesto_reglas('d5ac0000-0000-4000-8000-00000000c05e') where form_code = '390' and active) then
    raise exception 'PRUEBA 390 SII · 6: no se vuelve a aplicar.';
  end if;
  raise notice 'PRUEBA 390 SII · 6: y se vuelve a aplicar.';
end $$;

rollback;
