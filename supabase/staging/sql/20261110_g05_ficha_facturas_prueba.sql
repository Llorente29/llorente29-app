-- supabase/staging/sql/20261110_g05_ficha_facturas_prueba.sql
--
-- SOLO STAGING. La 1342 (G05 · nº 84: la factura de cada cobro en la ficha), con
-- datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 1342, dos veces.
--   2. Un cliente inventado con dos recibos cobrados por GoCardless: uno con su
--      factura y otro aún sin ella; y un recibo sin cobro de GoCardless.
--   3. Como la persona: salen los dos cobros, el primero con su factura y su
--      número y el segundo sin factura; el recibo sin cobro no sale.
--   4. Otra cuenta no ve nada.
--   5. La vuelta atrás de la 1342, y otra vez la 1342.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 FACTURAS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1342, dos veces.
\i supabase/migrations/20261110T1342_g05_ficha_facturas.sql
\i supabase/migrations/20261110T1342_g05_ficha_facturas.sql
do $$ begin
  if to_regprocedure('public.conta_ficha_facturas(uuid,uuid)') is null then raise exception 'G05 FACTURAS · 1: falta la función.'; end if;
  raise notice 'G05 FACTURAS · 1: la 1342 carga, y dos veces. OK';
end $$;

-- 2 · Lo de antes, inventado.
create temp table _g (clave text primary key, v text) on commit drop;
grant select on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid; f uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 FACTURAS · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Talleres Prueba Facturas, S.L.', 'B00000984') returning id into c;
  insert into public.customer_invoice (account_id, company_id, party_id, status, number_text) values (a, e, c, 'borrador', 'PRUEBA/1') returning id into f;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado, gc_cobro_id, invoice_id) values
    (a, e, c, '2026-11', 'recibo:' || e || ':' || c || ':2026-11', 22500, 'facturado', 'PM_PRUEBA_FACT_1', f),
    (a, e, c, '2026-12', 'recibo:' || e || ':' || c || ':2026-12', 22500, 'en_el_banco', 'PM_PRUEBA_FACT_2', null),
    (a, e, c, '2027-01', 'recibo:' || e || ':' || c || ':2027-01', 22500, 'preparado', null, null);
  insert into _g values ('e', e), ('c', c), ('f', f);
end $$;

-- 3 · Como la persona (administradora de la cuenta A).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare c uuid := (select v::uuid from _g where clave = 'c'); f uuid := (select v::uuid from _g where clave = 'f'); n int; x record;
begin
  select count(*) into n from public.conta_ficha_facturas('c01a0000-0000-4000-8000-00000000000a', c);
  if n <> 2 then raise exception 'G05 FACTURAS · 3: tenían que salir 2 cobros y salen %.', n; end if;
  select * into x from public.conta_ficha_facturas('c01a0000-0000-4000-8000-00000000000a', c) where cobro_gc_id = 'PM_PRUEBA_FACT_1';
  if x.factura_id is distinct from f or x.factura is distinct from 'PRUEBA/1' or x.recibo_estado <> 'facturado' or x.mes <> '2026-11' then
    raise exception 'G05 FACTURAS · 3: el cobro con factura sale mal: %.', row_to_json(x);
  end if;
  select * into x from public.conta_ficha_facturas('c01a0000-0000-4000-8000-00000000000a', c) where cobro_gc_id = 'PM_PRUEBA_FACT_2';
  if x.factura_id is not null or x.recibo_estado <> 'en_el_banco' then raise exception 'G05 FACTURAS · 3: el cobro sin factura sale mal: %.', row_to_json(x); end if;
  raise notice 'G05 FACTURAS · 3: el cobro con su factura, el de sin factura y el recibo sin cobro fuera. OK';
end $$;
reset role;

-- 4 · Otra cuenta no ve nada.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_ficha_facturas('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _g where clave = 'c'))) then
    raise exception 'G05 FACTURAS · 4: otra cuenta ve las facturas de la cuenta A.';
  end if;
  raise notice 'G05 FACTURAS · 4: otra cuenta, nada. OK';
end $$;
reset role;

-- 5 · La vuelta atrás, y otra vez la 1342.
\i supabase/vuelta-atras/20261110T1342_g05_ficha_facturas.down.sql
do $$ begin
  if to_regprocedure('public.conta_ficha_facturas(uuid,uuid)') is not null then raise exception 'G05 FACTURAS · 5: la vuelta atrás ha dejado la función.'; end if;
end $$;
\i supabase/migrations/20261110T1342_g05_ficha_facturas.sql
do $$ begin raise notice 'G05 FACTURAS · 5: vuelta atrás y otra vez la 1342. OK'; end $$;

rollback;
