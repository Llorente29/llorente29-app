-- supabase/staging/sql/20261113_s01p_pdf_del_correo_prueba.sql
--
-- SOLO STAGING. Prueba de la 1706 (S01p·20 · 1b: el PDF de las facturas de Just Eat, hecho de su
-- correo), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A.
--
--   1. conta_correo_papeles_que_faltan: la factura de un correo que entró como liquidación de Just
--      Eat y sin papel sale; la de un correo «sin_facturas» (como los 3 de octubre de Foodint), no;
--      la que ya tiene papel, no.
--   2. conta_factura_papel_del_correo: pone el PDF y lo dice; la segunda vez no lo cambia y lo dice;
--      un fichero de otra cuenta, no.
--   3. Después, ya no sale en la lista.
--   4. Una persona no llama a la que pone el papel; sin cuenta, no se lista nada.
--   5. La vuelta atrás: ninguna de las dos.
--
-- Nombra lo que toca, para el analizador: conta_factura_papel_del_correo,
-- conta_correo_papeles_que_faltan, supplier_invoice, inbound_email_log.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·20 · 1b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
set local lock_timeout = '30s';

select to_regprocedure('public.conta_correo_papeles_que_faltan(uuid)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T1706_s01p_pdf_del_correo.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('fac', 'c20b0000-0000-4000-8000-000000000001'), ('fac_con', 'c20b0000-0000-4000-8000-000000000002');
insert into _p select 'empresa', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)::text;
insert into _p select 'proveedor', (select id from public.supplier where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by name, id limit 1)::text;

-- La siembra: dos facturas de comisión de Just Eat (una sin papel y otra con él) y tres correos:
-- dos que entraron como liquidación y uno «sin_facturas».
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _p where clave = 'empresa');
  s uuid := (select v::uuid from _p where clave = 'proveedor');
begin
  if e is null or s is null then raise exception 'PRUEBA S01p·20 · 1b · siembra: la cuenta A no tiene empresa o proveedor.'; end if;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, status, raw_document_url)
  values ((select v::uuid from _p where clave = 'fac'), a, e, s, '0000001', '2026-10-15', 'en_revision', null),
         ((select v::uuid from _p where clave = 'fac_con'), a, e, s, '0000002', '2026-10-15', 'en_revision', a::text || '/ya/tenia.pdf');
  insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail, received_at)
  values ('prueba-s01p20-1b-a', 'facturas-prueba@entrada.folvy.app', 'reenvio@prueba.test', 'Fwd: Just-eat invoice: 0000001', e, a, 'liquidacion',
          jsonb_build_object('plataforma', 'justeat', 'factura_id', (select v from _p where clave = 'fac')), now()),
         ('prueba-s01p20-1b-b', 'facturas-prueba@entrada.folvy.app', 'reenvio@prueba.test', 'Fwd: Just-eat invoice: 0000002', e, a, 'liquidacion',
          jsonb_build_object('plataforma', 'justeat', 'factura_id', (select v from _p where clave = 'fac_con')), now()),
         ('prueba-s01p20-1b-c', 'facturas-prueba@entrada.folvy.app', 'reenvio@prueba.test', 'Fwd: Just-eat invoice: 0000003', e, a, 'sin_facturas',
          '{"dejados": [], "tomados": 0}', now());
end $$;

-- 1. La lista: solo la que entró como liquidación y sigue sin papel.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); v_ids text[]; v_err text;
begin
  select array_agg(email_id order by email_id) into v_ids from public.conta_correo_papeles_que_faltan(e) where email_id like 'prueba-s01p20-1b-%';
  if v_ids is distinct from array['prueba-s01p20-1b-a'] then raise exception 'PRUEBA S01p·20 · 1b · 1: salen %.', v_ids; end if;
  raise notice '1 · sin papel: la del correo que entró como liquidación (ni la que ya lo tiene ni la «sin_facturas»)';
  -- 4. Una persona no pone el papel (eso es de la función de entrada).
  begin perform public.conta_factura_papel_del_correo((select v::uuid from _p where clave = 'fac'), 'x/y.pdf'); raise exception 'PRUEBA S01p·20 · 1b · 4: una persona pone el papel.';
  exception when insufficient_privilege then v_err := sqlerrm; end;
  raise notice '4 · una persona no pone el papel («%»)', v_err;
end $$;
reset role;

-- 2. Poner el papel, y otra vez; y uno de otra cuenta.
do $$
declare r jsonb; f uuid := (select v::uuid from _p where clave = 'fac');
begin
  r := public.conta_factura_papel_del_correo(f, 'c01a0000-0000-4000-8000-00000000000a/_correo/prueba/just-eat-0000001.pdf');
  if not (r->>'puesto')::boolean or r->>'texto' <> 'La factura 0000001 tiene ya su PDF, hecho de su correo.' then raise exception 'PRUEBA S01p·20 · 1b · 2: dice %.', r; end if;
  if (select raw_document_url from public.supplier_invoice where id = f) <> 'c01a0000-0000-4000-8000-00000000000a/_correo/prueba/just-eat-0000001.pdf' then
    raise exception 'PRUEBA S01p·20 · 1b · 2: no quedó el papel.';
  end if;
  r := public.conta_factura_papel_del_correo(f, 'c01a0000-0000-4000-8000-00000000000a/_correo/prueba/otro.pdf');
  if (r->>'puesto')::boolean or r->>'texto' <> 'La factura 0000001 ya tenía su PDF: no lo cambio.' then raise exception 'PRUEBA S01p·20 · 1b · 2: la segunda vez dice %.', r; end if;
  begin perform public.conta_factura_papel_del_correo((select v::uuid from _p where clave = 'fac_con'), 'otra-cuenta/x.pdf'); raise exception 'PRUEBA S01p·20 · 1b · 2: acepta un fichero de otra cuenta.';
  exception when sqlstate '22023' then null; end;
  raise notice '2 · puesto y dicho; la segunda vez no lo cambia; de otra cuenta, no';
end $$;

-- 3. Ya no sale.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_correo_papeles_que_faltan((select v::uuid from _p where clave = 'empresa')) where email_id like 'prueba-s01p20-1b-%') then
    raise exception 'PRUEBA S01p·20 · 1b · 3: sigue saliendo.';
  end if;
  raise notice '3 · con su papel, ya no sale';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
begin
  begin perform public.conta_correo_papeles_que_faltan((select v::uuid from _p where clave = 'empresa')); raise exception 'PRUEBA S01p·20 · 1b · 4: sin cuenta lista.';
  exception when insufficient_privilege then raise notice '4 · sin cuenta, no («%»)', sqlerrm; end;
end $$;
reset role;

-- 5. La vuelta atrás.
\i supabase/vuelta-atras/20261113T1706_s01p_pdf_del_correo.down.sql
do $$ begin
  if to_regprocedure('public.conta_correo_papeles_que_faltan(uuid)') is not null or to_regprocedure('public.conta_factura_papel_del_correo(uuid,text)') is not null then
    raise exception 'PRUEBA S01p·20 · 1b · 5: la vuelta atrás deja sus funciones.';
  end if;
  raise notice '5 · la vuelta atrás: fuera las dos';
end $$;
\i supabase/migrations/20261113T1706_s01p_pdf_del_correo.sql

rollback;
