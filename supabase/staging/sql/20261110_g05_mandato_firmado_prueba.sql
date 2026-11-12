-- supabase/staging/sql/20261110_g05_mandato_firmado_prueba.sql
--
-- SOLO STAGING. La 1631 (G05 · nº 90: un mandato en pending_submission ya está
-- firmado), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 1631, dos veces.
--   2. Cuatro mandatos inventados en la cuenta A: uno por firmar
--      (pending_customer_approval), uno en pending_submission, uno en submitted y
--      uno activo.
--   3. Como la persona: «Mandatos por firmar» cuenta solo el que espera la
--      aprobación del cliente (antes, tres).
--   4. Con la de antes (la vuelta atrás) contaba tres; y otra vez la 1631.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 MANDATO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1631, dos veces.
\i supabase/migrations/20261110T1631_g05_mandato_firmado.sql
\i supabase/migrations/20261110T1631_g05_mandato_firmado.sql
do $$ begin raise notice 'G05 MANDATO · 1: la 1631 carga, y dos veces. OK'; end $$;

-- 2 · Lo de antes, inventado: los mandatos de la cuenta A, solo los de esta prueba.
create temp table _g (clave text primary key, v text) on commit drop;
grant select on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 MANDATO · 0: la cuenta A no tiene empresa.'; end if;
  delete from public.conta_gc_mandato where account_id = a;
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado) values
    (a, e, 'MD_PRUEBA_FIRMA_1', 'CU_PRUEBA_FIRMA_1', 'pending_customer_approval'),
    (a, e, 'MD_PRUEBA_FIRMA_2', 'CU_PRUEBA_FIRMA_2', 'pending_submission'),
    (a, e, 'MD_PRUEBA_FIRMA_3', 'CU_PRUEBA_FIRMA_3', 'submitted'),
    (a, e, 'MD_PRUEBA_FIRMA_4', 'CU_PRUEBA_FIRMA_4', 'active');
  insert into _g values ('e', e);
end $$;

-- 3 · Como la persona (administradora de la cuenta A).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare n bigint;
begin
  select x.n into n from public.conta_lista_que_hacer('c01a0000-0000-4000-8000-00000000000a') x
   where x.tipo = 'mandatos_por_firmar' and x.empresa_id = (select v::uuid from _g where clave = 'e');
  if n is distinct from 1 then raise exception 'G05 MANDATO · 3: «por firmar» cuenta % y tenía que contar 1.', n; end if;
  raise notice 'G05 MANDATO · 3: por firmar, solo el que espera la aprobación del cliente (1 de 4). OK';
end $$;
reset role;

-- 4 · La vuelta atrás (la de antes contaba 3), y otra vez la 1631.
\i supabase/vuelta-atras/20261110T1631_g05_mandato_firmado.down.sql
do $$
declare n bigint;
begin
  select x.n into n from public.conta_lista_que_hacer('c01a0000-0000-4000-8000-00000000000a') x
   where x.tipo = 'mandatos_por_firmar' and x.empresa_id = (select v::uuid from _g where clave = 'e');
  if n is distinct from 3 then raise exception 'G05 MANDATO · 4: la vuelta atrás no ha dejado la de antes (cuenta %).', n; end if;
end $$;
\i supabase/migrations/20261110T1631_g05_mandato_firmado.sql
do $$ begin raise notice 'G05 MANDATO · 4: vuelta atrás (la de antes, 3) y otra vez la 1631. OK'; end $$;

rollback;
