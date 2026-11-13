-- supabase/staging/sql/20261113_s01p_cierre_socio_prueba.sql
--
-- SOLO STAGING. Prueba de la 0015 (S01p·18 · punto 4: el correo del cierre del
-- mes del socio va a su liquidación, no a Compras), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la cuenta A.
--
--   1. Un cierre de cinco PDF en la bandeja (como los deja conta-facturas-entrada:
--      canal correo, clase «liquidación», sin liquidación) y una liquidación del
--      socio: compras_cierre_socio_usado los deja con ella y dice «Los 5 PDF…».
--      Un PDF de otro correo no se toca.
--   2. Otra vez: 0, y lo dice («ya estaban con una liquidación»).
--   3. Sin cuenta, no; sin correo, no.
--   4. La vuelta atrás: ni la función ni la columna.
--
-- Nombra lo que toca, para el analizador: document_inbox, licensed_settlement,
-- compras_cierre_socio_usado.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·18 · 4: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
set local lock_timeout = '30s';

select to_regprocedure('public.compras_cierre_socio_usado(uuid,text)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T0015_s01p_cierre_socio.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('liq', 'c18a0000-0000-4000-8000-000000001840'), ('correo', 'prueba-s01p18-4-cierre'), ('otro', 'prueba-s01p18-4-otro');
insert into _p select 'empresa', coalesce((select id from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
                                          (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1))::text;

-- La siembra: la liquidación del socio de octubre y lo que deja el correo (cinco PDF del cierre y uno de otro).
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if e is null then raise exception 'PRUEBA S01p·18 · 4 · siembra: la cuenta A no tiene empresa.'; end if;
  -- La función no mira cómo se calculó la liquidación: basta una de octubre de la empresa.
  insert into public.licensed_settlement (id, account_id, company_id, period_from, period_to, formula, source)
  values ((select v::uuid from _p where clave = 'liq'), a, e, '2026-10-01', '2026-10-31', 'anterior', 'documentos');
  insert into public.document_inbox (account_id, company_id, channel, status, email_id, email_to, email_subject, file_bucket, file_path, file_name, mime_type, doc_kind, doc_kind_by)
  select a, e, 'correo', 'recibido', (select v from _p where clave = 'correo'), 'facturas-prueba@entrada.folvy.app', 'Fwd: Cierre del mes de octubre',
         'receipt-uploads', a || '/_entrada/prueba/' || n, n, 'application/pdf', 'liquidacion', 'regla'
    from unnest(array['AutoFactura-oct.pdf', 'Factura-oct.pdf', 'Resumen-de-Transaccion-oct.pdf', 'Resumen-de-ventas-oct.pdf', 'Compras-y-Ventas-oct.pdf']) n;
  insert into public.document_inbox (account_id, company_id, channel, status, email_id, email_to, email_subject, file_bucket, file_path, file_name, mime_type, doc_kind, doc_kind_by)
  values (a, e, 'correo', 'recibido', (select v from _p where clave = 'otro'), 'facturas-prueba@entrada.folvy.app', 'Otro', 'receipt-uploads', a || '/_entrada/prueba/otro.pdf', 'otro.pdf', 'application/pdf', 'liquidacion', 'regla');
end $$;

-- ── 1 y 2 · Los PDF quedan con su liquidación, una sola vez ─────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare l uuid := (select v::uuid from _p where clave = 'liq'); r jsonb; v_n int; v_otro int;
begin
  r := public.compras_cierre_socio_usado(l, (select v from _p where clave = 'correo'));
  if (r->>'pdf')::int <> 5 or r->>'texto' <> 'Los 5 PDF del correo quedan con esta liquidación.' then
    raise exception 'PRUEBA S01p·18 · 4 · 1: dice % y son 5.', r;
  end if;
  raise notice '1 · %', r->>'texto';
  r := public.compras_cierre_socio_usado(l, (select v from _p where clave = 'correo'));
  if (r->>'pdf')::int <> 0 or r->>'texto' <> 'Los PDF del correo ya estaban con una liquidación.' then
    raise exception 'PRUEBA S01p·18 · 4 · 2: la segunda vez dice %.', r;
  end if;
  raise notice '2 · otra vez: %', r->>'texto';
end $$;
reset role;
do $$
declare v_n int; v_otro int;
begin
  select count(*) filter (where email_id = (select v from _p where clave = 'correo') and licensed_settlement_id = (select v::uuid from _p where clave = 'liq')),
         count(*) filter (where email_id = (select v from _p where clave = 'otro') and licensed_settlement_id is not null)
    into v_n, v_otro from public.document_inbox where account_id = 'c01a0000-0000-4000-8000-00000000000a';
  if v_n <> 5 or v_otro <> 0 then raise exception 'PRUEBA S01p·18 · 4 · 1: % del cierre con su liquidación (5) y % del otro correo (0).', v_n, v_otro; end if;
  raise notice '1 · los 5 del cierre, con su liquidación; el del otro correo, sin tocar';
end $$;

-- ── 3 · Sin cuenta, no; sin correo, no ──────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.compras_cierre_socio_usado((select v::uuid from _p where clave = 'liq'), (select v from _p where clave = 'otro'));
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01p·18 · 4 · 3: alguien sin cuenta marca los PDF.'; end if;
  raise notice '3 · sin cuenta, no («%»)', v_err;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin perform public.compras_cierre_socio_usado((select v::uuid from _p where clave = 'liq'), ' '); raise exception 'PRUEBA S01p·18 · 4 · 3: acepta un correo vacío.';
  exception when sqlstate '22023' then null; end;
  raise notice '3 · sin correo, no';
end $$;
reset role;

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261113T0015_s01p_cierre_socio.down.sql
do $$ begin
  if to_regprocedure('public.compras_cierre_socio_usado(uuid,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_inbox' and column_name = 'licensed_settlement_id') then
    raise exception 'PRUEBA S01p·18 · 4 · 4: la vuelta atrás deja cosas de la 0015.';
  end if;
  raise notice '4 · la vuelta atrás: ni la función ni la columna';
end $$;
\i supabase/migrations/20261113T0015_s01p_cierre_socio.sql

rollback;
