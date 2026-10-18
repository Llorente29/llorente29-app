-- supabase/staging/sql/20261122_i01b_presentados_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0210_i01b_presentados (la 0100 a la 0150 y
-- la 0190 ya están en staging de verdad), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. Como usuario de la empresa A y de la cuenta B.
-- El CSV es inventado (16 letras y números de prueba).
--
--   1. El 3T de 2026 de A, sin presentar: sale en «para apuntar».
--   2. Apuntado como presentado fuera (lo que hace conta-hacienda con la
--      clave de servicio): sale en «presentados», fuera y sin comprobar, con su
--      CSV, y ya no en «para apuntar».
--   3. B no ve los de A.
--   4. Su vuelta atrás quita la función, y se puede volver a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA presentados: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

select to_regprocedure('public.conta_impuesto_periodos(uuid, int)') is null as falta_0190 \gset
\if :falta_0190
\echo '>>> Staging aún no tiene la 0190 (el calendario): se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261122T0190_i01b_calendario.sql
\endif
\i supabase/migrations/20261122T0210_i01b_presentados.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated, service_role;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · Sin presentar ────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; c jsonb;
begin
  if not exists (select 1 from public.tax_obligation where company_id = v_a and valid_to is null and active and form_code = '303') then
    perform public.conta_impuesto_obligaciones_calcular(v_a);
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2026 and period = '3T'
                                               and status in ('filed', 'booked', 'paid', 'offset', 'refunded')) then
    raise exception 'PRUEBA presentados · 1: el 3T de A ya está presentado en staging; la prueba lo necesita sin presentar.';
  end if;
  c := public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  insert into _p values ('decl', c->>'declaracion');
  v := public.conta_impuesto_presentados(v_a);
  if not exists (select 1 from jsonb_array_elements(v->'para_apuntar') x where (x->>'ejercicio')::int = 2026 and x->>'periodo' = '3T' and x->>'declaracion' = c->>'declaracion') then
    raise exception 'PRUEBA presentados · 1: el 3T sin presentar no sale para apuntar (%).', v->'para_apuntar';
  end if;
  raise notice 'PRUEBA presentados · 1: % presentados, % para apuntar (el 3T entre ellos).', jsonb_array_length(v->'presentados'), jsonb_array_length(v->'para_apuntar');
end $$;

-- ── 2 · Apuntado como presentado fuera ───────────────────────────────────────
reset role;
set local role service_role;
do $$ begin
  perform public.conta_impuesto_fuera((select val::uuid from _p where k = 'decl'), 'c01a0000-0000-4000-8000-0000000000a1', 'PRUEBA0I01B00001', false, null, null, null);
end $$;
reset role;
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; x jsonb;
begin
  v := public.conta_impuesto_presentados(v_a);
  select y into x from jsonb_array_elements(v->'presentados') y where y->>'id' = (select val from _p where k = 'decl');
  if x is null or x->>'por' <> 'outside' or (x->>'comprobada')::boolean or x->>'csv' <> 'PRUEBA0I01B00001' or x->>'estado' <> 'filed' then
    raise exception 'PRUEBA presentados · 2: el presentado fuera sale %.', x;
  end if;
  if exists (select 1 from jsonb_array_elements(v->'para_apuntar') y where (y->>'ejercicio')::int = 2026 and y->>'periodo' = '3T') then
    raise exception 'PRUEBA presentados · 2: el 3T presentado sigue para apuntar.';
  end if;
  raise notice 'PRUEBA presentados · 2: el 3T, presentado fuera y sin comprobar, en la lista; ya no para apuntar.';
end $$;

-- ── 3 · B no ve los de A ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.conta_impuesto_presentados('3b34403a-a7d6-4a48-a8d7-737e8cababdc');
    raise exception 'PRUEBA presentados · 3: B ve los presentados de A.';
  exception when insufficient_privilege then
    raise notice 'PRUEBA presentados · 3: B no ve los presentados de A.';
  end;
end $$;

-- ── 4 · Su vuelta atrás ──────────────────────────────────────────────────────
reset role;
\i supabase/vuelta-atras/20261122T0210_i01b_presentados.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_presentados(uuid)') is not null then raise exception 'PRUEBA presentados · 4: la vuelta atrás deja la función.'; end if;
  raise notice 'PRUEBA presentados · 4: vuelta atrás, fuera la función.';
end $$;
\i supabase/migrations/20261122T0210_i01b_presentados.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_presentados(uuid)') is null then raise exception 'PRUEBA presentados · 4: no se vuelve a aplicar.'; end if;
  raise notice 'PRUEBA presentados · 4: y otra vez delante.';
end $$;

\echo '>>> Prueba de presentados (0210) en verde. ROLLBACK: no queda nada.'
rollback;
