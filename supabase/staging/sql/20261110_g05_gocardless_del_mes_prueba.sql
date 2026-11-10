-- supabase/staging/sql/20261110_g05_gocardless_del_mes_prueba.sql
--
-- SOLO STAGING. La 1222 (G05 · nº 82: lo que GoCardless cobra a cada cliente EN un
-- mes), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 1222, dos veces.
--   2. Un cliente inventado como el de la ficha del nº 81: tres de laboral a 25 €
--      y la gestoría a 150 €, mensuales; un impuesto de 300 € al año que se cobra
--      en junio; una trimestral de 60 € desde enero; una semanal y una cancelada,
--      que no cuentan; y una mensual de 40 € que aún no es de ningún cliente.
--   3. Como la persona: noviembre 225 (no 250: la anual no se reparte); junio 525
--      (la anual entera); enero, abril y julio con la trimestral; la fila de la
--      empresa con lo del cliente y lo que no es de nadie; un mes mal escrito, no.
--   4. Otra cuenta no ve nada.
--   5. La vuelta atrás de la 1222, y otra vez la 1222.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 DEL MES: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1222, dos veces.
\i supabase/migrations/20261110T1222_g05_gocardless_del_mes.sql
\i supabase/migrations/20261110T1222_g05_gocardless_del_mes.sql
do $$ begin
  if to_regprocedure('public.conta_gocardless_del_mes(uuid,text)') is null then raise exception 'G05 DEL MES · 1: falta la función.'; end if;
  raise notice 'G05 DEL MES · 1: la 1222 carga, y dos veces. OK';
end $$;

-- 2 · Lo de antes, inventado.
create temp table _g (clave text primary key, v text) on commit drop;
grant select on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 DEL MES · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Talleres Prueba Del Mes, S.L.', 'B00000982') returning id into c;
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (a, e, c, 'gocardless', 'CU_PRUEBA_DEL_MES');
  insert into public.conta_gc_suscripcion (account_id, company_id, gc_id, gc_cliente_id, nombre, importe, intervalo, cada, estado, al_mes, inicio, proximo_cobro_fecha) values
    (a, e, 'SB_PRUEBA_DM_1', 'CU_PRUEBA_DEL_MES', 'Laboral 1', 25, 'monthly', 1, 'active', 25, '2026-01-05', '2026-12-05'),
    (a, e, 'SB_PRUEBA_DM_2', 'CU_PRUEBA_DEL_MES', 'Laboral 2', 25, 'monthly', 1, 'active', 25, '2026-01-05', '2026-12-05'),
    (a, e, 'SB_PRUEBA_DM_3', 'CU_PRUEBA_DEL_MES', 'Laboral 3', 25, 'monthly', 1, 'active', 25, '2026-01-05', '2026-12-05'),
    (a, e, 'SB_PRUEBA_DM_4', 'CU_PRUEBA_DEL_MES', 'Gestoría', 150, 'monthly', 1, 'active', 150, '2026-01-05', '2026-12-05'),
    (a, e, 'SB_PRUEBA_DM_5', 'CU_PRUEBA_DEL_MES', 'Impuesto de sociedades', 300, 'yearly', 1, 'active', 25, '2026-06-05', '2027-06-05'),
    (a, e, 'SB_PRUEBA_DM_6', 'CU_PRUEBA_DEL_MES', 'Trimestral', 60, 'monthly', 3, 'active', 20, '2026-01-05', null),
    (a, e, 'SB_PRUEBA_DM_7', 'CU_PRUEBA_DEL_MES', 'Semanal', 10, 'weekly', 1, 'active', 43.33, '2026-01-05', '2026-11-16'),
    (a, e, 'SB_PRUEBA_DM_8', 'CU_PRUEBA_DEL_MES', 'Cancelada', 99, 'monthly', 1, 'cancelled', 99, '2026-01-05', null),
    (a, e, 'SB_PRUEBA_DM_9', 'CU_PRUEBA_SIN_CLIENTE', 'Sin cliente', 40, 'monthly', 1, 'active', 40, '2026-01-05', null);
  insert into _g values ('e', e), ('c', c);
end $$;

-- 3 · Como la persona (administradora de la cuenta A).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); v numeric; m text; esperado numeric;
begin
  foreach m in array array['2026-11', '2026-12', '2027-01', '2027-04', '2027-06', '2027-07'] loop
    select x.gocardless_del_mes into v from public.conta_gocardless_del_mes('c01a0000-0000-4000-8000-00000000000a', m) x where x.que = 'cliente' and x.cliente_id = c and x.empresa_id = e;
    esperado := case m when '2026-11' then 225 when '2026-12' then 225 when '2027-01' then 285 when '2027-04' then 285 when '2027-06' then 525 when '2027-07' then 285 end;
    if v is distinct from esperado then raise exception 'G05 DEL MES · 3: en % sale % y tenía que salir %.', m, v, esperado; end if;
  end loop;
  -- La fila de la empresa: lo del cliente y lo que aún no está unido a nadie (una mensual de 40 € sin cliente).
  select x.gocardless_del_mes into v from public.conta_gocardless_del_mes('c01a0000-0000-4000-8000-00000000000a', '2026-11') x where x.que = 'empresa' and x.empresa_id = e;
  if v is null or v < 265 then raise exception 'G05 DEL MES · 3: la fila de la empresa no suma el cliente (225) y la de sin cliente (40): %.', v; end if;
  begin perform public.conta_gocardless_del_mes('c01a0000-0000-4000-8000-00000000000a', '2026-13'); raise exception 'G05 DEL MES · 3: un mes mal escrito ha pasado.';
  exception when sqlstate '22023' then null; end;
  raise notice 'G05 DEL MES · 3: noviembre 225 (no 250), junio 525, la trimestral en su mes, la semanal y la cancelada fuera. OK';
end $$;
reset role;

-- 4 · Otra cuenta no ve nada.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_gocardless_del_mes('c01a0000-0000-4000-8000-00000000000a', '2026-11')) then
    raise exception 'G05 DEL MES · 4: otra cuenta ve lo de la cuenta A.';
  end if;
  raise notice 'G05 DEL MES · 4: otra cuenta, nada. OK';
end $$;
reset role;

-- 5 · La vuelta atrás, y otra vez la 1222.
\i supabase/vuelta-atras/20261110T1222_g05_gocardless_del_mes.down.sql
do $$ begin
  if to_regprocedure('public.conta_gocardless_del_mes(uuid,text)') is not null then raise exception 'G05 DEL MES · 5: la vuelta atrás ha dejado la función.'; end if;
end $$;
\i supabase/migrations/20261110T1222_g05_gocardless_del_mes.sql
do $$ begin raise notice 'G05 DEL MES · 5: vuelta atrás y otra vez la 1222. OK'; end $$;

rollback;
