-- supabase/staging/sql/20261113_s01p_documento_sin_leer_prueba.sql
--
-- SOLO STAGING. Prueba de la 1015 (S01p·18.2 · 3: el documento sin leer de «Por aclarar»),
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A.
--
--   1. «No es una factura» sin nombre (p_quien_nombre vacío): ya no da error
--      (document_activity_check); su actividad lleva el de la sesión o «una persona».
--   2. Eliminar: pasa a «descartado», con su actividad y su frase («Eliminado:
--      «EMPRESARIAL-PRUEBA.pdf»…»); otra vez, «ya estaba eliminado».
--   3. Lo que ya es una factura no se elimina desde aquí; quien no es de la cuenta, no.
--   4. La vuelta atrás: conta_puerta_dime_que_es con la huella de producción y nada nuevo.
--
-- Nombra lo que toca, para el analizador: conta_puerta_dime_que_es, conta_llegada_eliminar,
-- document_inbox, document_activity, supplier_invoice.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·18.2 · 3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
set local lock_timeout = '30s';

select to_regprocedure('public.conta_llegada_eliminar(uuid,text)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T1015_s01p_documento_sin_leer.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('uno', 'c18a0000-0000-4000-8000-000000001851'), ('dos', 'c18a0000-0000-4000-8000-000000001852'), ('fac', 'c18a0000-0000-4000-8000-000000001853');
insert into _p select 'empresa', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)::text;

-- La siembra: dos documentos sin leer, como los deja la puerta del correo (en error de lectura), y uno que ya es factura.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _p where clave = 'empresa'); f uuid;
begin
  insert into public.document_inbox (id, account_id, company_id, channel, status, email_id, file_bucket, file_path, file_name, mime_type, reason)
  values ((select v::uuid from _p where clave = 'uno'), a, e, 'correo', 'error', 'prueba-s01p182-3-a', 'receipt-uploads', a || '/_correo/prueba/01-Compras-y-Ventas-prueba.pdf', 'Compras-y-Ventas-prueba.pdf', 'application/pdf', 'No se ha podido leer: prueba'),
         ((select v::uuid from _p where clave = 'dos'), a, e, 'correo', 'error', 'prueba-s01p182-3-b', 'receipt-uploads', a || '/_correo/prueba/01-EMPRESARIAL-PRUEBA.pdf', 'EMPRESARIAL-PRUEBA.pdf', 'application/pdf', 'No se ha podido leer: prueba');
  select id into f from public.supplier_invoice where account_id = a order by created_at limit 1;
  if f is not null then
    insert into public.document_inbox (id, account_id, company_id, channel, status, email_id, file_bucket, file_path, file_name, mime_type, supplier_invoice_id)
    values ((select v::uuid from _p where clave = 'fac'), a, e, 'correo', 'factura', 'prueba-s01p182-3-c', 'receipt-uploads', a || '/_correo/prueba/01-F.pdf', 'F-prueba.pdf', 'application/pdf', f);
  end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  -- 1. «No es una factura» sin nombre.
  r := public.conta_puerta_dime_que_es((select v::uuid from _p where clave = 'uno'), 'otro', false, null);
  if coalesce(r->>'texto', '') !~ '^Apuntado: es otra cosa' then raise exception 'PRUEBA S01p·18.2 · 3 · 1: dice %.', r; end if;
  r := public.conta_puerta_dime_que_es((select v::uuid from _p where clave = 'uno'), 'otro', false, '  ');
  raise notice '1 · «No es una factura» sin nombre: %', r->>'texto';
  -- 2. Eliminar, y otra vez.
  r := public.conta_llegada_eliminar((select v::uuid from _p where clave = 'dos'), null);
  if r->>'texto' <> 'Eliminado: «EMPRESARIAL-PRUEBA.pdf». Ya no sale en «Por aclarar»; queda en su historial.' then raise exception 'PRUEBA S01p·18.2 · 3 · 2: dice %.', r; end if;
  raise notice '2 · %', r->>'texto';
  r := public.conta_llegada_eliminar((select v::uuid from _p where clave = 'dos'), 'Administración de Prueba');
  if (r->>'ya_estaba')::boolean is not true then raise exception 'PRUEBA S01p·18.2 · 3 · 2: la segunda vez dice %.', r; end if;
  raise notice '2 · otra vez: %', r->>'texto';
  -- 3. Lo que ya es una factura, no.
  if exists (select 1 from _p where clave = 'fac') and exists (select 1 from public.document_inbox where id = (select v::uuid from _p where clave = 'fac')) then
    begin perform public.conta_llegada_eliminar((select v::uuid from _p where clave = 'fac'), null); raise exception 'PRUEBA S01p·18.2 · 3 · 3: elimina una factura.';
    exception when sqlstate '22023' then raise notice '3 · lo que ya es una factura, desde su ficha: %', sqlerrm; end;
  end if;
end $$;
reset role;
do $$
declare v_n int; v_sin int; v_st text;
begin
  select count(*), count(*) filter (where actor_name is null) into v_n, v_sin from public.document_activity
   where inbox_id in ((select v::uuid from _p where clave = 'uno'), (select v::uuid from _p where clave = 'dos')) and actor = 'persona';
  select status into v_st from public.document_inbox where id = (select v::uuid from _p where clave = 'dos');
  if v_n < 3 or v_sin <> 0 or v_st <> 'descartado' then raise exception 'PRUEBA S01p·18.2 · 3: % actividades de persona (% sin nombre) y el eliminado en «%».', v_n, v_sin, v_st; end if;
  raise notice '1-2 · % actividades de persona, todas con nombre; el eliminado, «descartado»', v_n;
end $$;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_llegada_eliminar((select v::uuid from _p where clave = 'uno'), null); exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01p·18.2 · 3 · 3: alguien sin cuenta elimina.'; end if;
  raise notice '3 · sin cuenta, no («%»)', v_err;
end $$;
reset role;

-- 4. La vuelta atrás.
\i supabase/vuelta-atras/20261113T1015_s01p_documento_sin_leer.down.sql
do $$
declare v_h text := md5(pg_get_functiondef('public.conta_puerta_dime_que_es(uuid,text,boolean,text)'::regprocedure));
begin
  if v_h <> '6804c4836cd94c276a888e40105df563' then raise exception 'PRUEBA S01p·18.2 · 3 · 4: la vuelta atrás deja conta_puerta_dime_que_es con % y la de producción es 6804c4836cd94c276a888e40105df563.', v_h; end if;
  if to_regprocedure('public.conta_llegada_eliminar(uuid,text)') is not null then raise exception 'PRUEBA S01p·18.2 · 3 · 4: la vuelta atrás deja conta_llegada_eliminar.'; end if;
  raise notice '4 · la vuelta atrás: conta_puerta_dime_que_es como en producción (%) y fuera conta_llegada_eliminar', v_h;
end $$;
\i supabase/migrations/20261113T1015_s01p_documento_sin_leer.sql

rollback;
