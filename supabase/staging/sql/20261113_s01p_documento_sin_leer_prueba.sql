-- supabase/staging/sql/20261113_s01p_documento_sin_leer_prueba.sql
--
-- SOLO STAGING. Prueba de la 1015 (S01p·18.2 · 3: el documento sin leer de «Por aclarar»),
-- con \i dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A.
--
--   1. «No es una factura» sin nombre (p_quien_nombre vacío): ya no da error
--      (document_activity_check); su actividad lleva el de la sesión o «una persona».
--   2. Eliminar BORRA: un documento sin leer, con su actividad y su lectura de la
--      IA, sin nada que lo nombre: se puede (conta_llegada_eliminable dice su
--      fichero), y al eliminarlo no queda ni la fila, ni su actividad, ni su lectura.
--   3. No se puede, y se dice por qué: el que ya es una factura; el que leyó una
--      recepción; el que comparte fichero con una factura (dos llegadas no pueden:
--      document_inbox_fichero_uq). Quien no es de la cuenta, no.
--   4. La vuelta atrás: conta_puerta_dime_que_es con la huella de producción y nada nuevo.
--
-- Nombra lo que toca, para el analizador: conta_puerta_dime_que_es, conta_llegada_eliminar,
-- conta_llegada_eliminable, document_inbox, document_activity, supplier_invoice,
-- goods_receipt_ai_session, goods_receipt.

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
  ('uno', 'c18a0000-0000-4000-8000-000000001851'), ('dos', 'c18a0000-0000-4000-8000-000000001852'), ('fac', 'c18a0000-0000-4000-8000-000000001853'),
  ('rec', 'c18a0000-0000-4000-8000-000000001854'), ('par', 'c18a0000-0000-4000-8000-000000001855'), ('lec', 'c18a0000-0000-4000-8000-000000001856'), ('lec2', 'c18a0000-0000-4000-8000-000000001857');
insert into _p select 'empresa', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)::text;

-- La siembra: dos documentos sin leer, como los deja la puerta del correo (en error de lectura), y uno que ya es factura.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _p where clave = 'empresa'); f uuid;
begin
  insert into public.document_inbox (id, account_id, company_id, channel, status, email_id, file_bucket, file_path, file_name, mime_type, reason)
  values ((select v::uuid from _p where clave = 'uno'), a, e, 'correo', 'error', 'prueba-s01p182-3-a', 'receipt-uploads', a || '/_correo/prueba/01-Compras-y-Ventas-prueba.pdf', 'Compras-y-Ventas-prueba.pdf', 'application/pdf', 'No se ha podido leer: prueba'),
         ((select v::uuid from _p where clave = 'dos'), a, e, 'correo', 'error', 'prueba-s01p182-3-b', 'receipt-uploads', a || '/_correo/prueba/01-EMPRESARIAL-PRUEBA.pdf', 'EMPRESARIAL-PRUEBA.pdf', 'application/pdf', 'No se ha podido leer: prueba');
  -- Lo que leyó la IA de «dos» (sin recepción) y de «rec» (con una recepción que la usa).
  insert into public.goods_receipt_ai_session (id, account_id) values ((select v::uuid from _p where clave = 'lec'), a), ((select v::uuid from _p where clave = 'lec2'), a);
  update public.document_inbox set ai_session_id = (select v::uuid from _p where clave = 'lec') where id = (select v::uuid from _p where clave = 'dos');
  insert into public.document_inbox (id, account_id, company_id, channel, status, email_id, file_bucket, file_path, file_name, mime_type, ai_session_id)
  values ((select v::uuid from _p where clave = 'rec'), a, e, 'correo', 'leido', 'prueba-s01p182-3-d', 'receipt-uploads', a || '/_correo/prueba/01-ALB-prueba.pdf', 'ALB-prueba.pdf', 'application/pdf', (select v::uuid from _p where clave = 'lec2')),
         ((select v::uuid from _p where clave = 'par'), a, e, 'correo', 'error', 'prueba-s01p182-3-e', 'receipt-uploads', a || '/_correo/prueba/01-Compras-y-Ventas-copia.pdf', 'Compras-y-Ventas-copia.pdf', 'application/pdf', null);
  insert into public.goods_receipt (account_id, location_id, ai_session_id)
  select a, (select id from public.locations where account_id = a order by name limit 1), (select v::uuid from _p where clave = 'lec2');
  insert into public.document_activity (account_id, company_id, inbox_id, actor, action, text) values (a, e, (select v::uuid from _p where clave = 'dos'), 'folvy', 'recibida', 'PRUEBA: llegó');
  select id into f from public.supplier_invoice where account_id = a order by created_at limit 1;
  -- Dos llegadas no pueden compartir fichero (document_inbox_fichero_uq): «par» lo comparte con una factura.
  if f is not null then
    update public.supplier_invoice set raw_document_url = a || '/_correo/prueba/01-Compras-y-Ventas-copia.pdf' where id = f;
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
  -- 2. «dos»: sin nada que lo nombre, se puede; y se borra entero.
  r := public.conta_llegada_eliminable((select v::uuid from _p where clave = 'dos'));
  if (r->>'puede')::boolean is not true or r->>'ruta' not like '%01-EMPRESARIAL-PRUEBA.pdf' or r->>'bucket' <> 'receipt-uploads' then raise exception 'PRUEBA S01p·18.2 · 3 · 2: dice %.', r; end if;
  r := public.conta_llegada_eliminar((select v::uuid from _p where clave = 'dos'), null);
  if r->>'texto' <> 'Eliminado: «EMPRESARIAL-PRUEBA.pdf». Borrados la fila de la bandeja, 1 apunte de su actividad, lo que leyó la IA y el fichero del almacén.'
     or r->>'ruta' not like '%01-EMPRESARIAL-PRUEBA.pdf' then raise exception 'PRUEBA S01p·18.2 · 3 · 2: dice %.', r; end if;
  raise notice '2 · %', r->>'texto';
  -- 3. No se puede, y por qué.
  r := public.conta_llegada_eliminable((select v::uuid from _p where clave = 'rec'));
  if (r->>'puede')::boolean or coalesce(r->>'porque', '') !~ 'recepción' then raise exception 'PRUEBA S01p·18.2 · 3 · 3: la de la recepción dice %.', r; end if;
  raise notice '3 · %', r->>'porque';
  if exists (select 1 from public.supplier_invoice where raw_document_url like '%/_correo/prueba/01-Compras-y-Ventas-copia.pdf') then
    r := public.conta_llegada_eliminable((select v::uuid from _p where clave = 'par'));
    if (r->>'puede')::boolean or coalesce(r->>'porque', '') !~ 'comparte su fichero' then raise exception 'PRUEBA S01p·18.2 · 3 · 3: la del mismo fichero dice %.', r; end if;
    raise notice '3 · %', r->>'porque';
    begin perform public.conta_llegada_eliminar((select v::uuid from _p where clave = 'par'), null); raise exception 'PRUEBA S01p·18.2 · 3 · 3: borra la del mismo fichero.';
    exception when sqlstate '22023' then null; end;
  end if;
  if exists (select 1 from _p where clave = 'fac') and exists (select 1 from public.document_inbox where id = (select v::uuid from _p where clave = 'fac')) then
    r := public.conta_llegada_eliminable((select v::uuid from _p where clave = 'fac'));
    if (r->>'puede')::boolean or coalesce(r->>'porque', '') !~ 'ya es la factura' then raise exception 'PRUEBA S01p·18.2 · 3 · 3: la factura dice %.', r; end if;
    begin perform public.conta_llegada_eliminar((select v::uuid from _p where clave = 'fac'), null); raise exception 'PRUEBA S01p·18.2 · 3 · 3: borra una factura.';
    exception when sqlstate '22023' then raise notice '3 · %', sqlerrm; end;
  end if;
end $$;
reset role;
do $$
declare v_fila int; v_act int; v_lec int; v_sin int; v_otros int;
begin
  select count(*) into v_fila from public.document_inbox where id = (select v::uuid from _p where clave = 'dos');
  select count(*) into v_act from public.document_activity where inbox_id = (select v::uuid from _p where clave = 'dos');
  select count(*) into v_lec from public.goods_receipt_ai_session where id = (select v::uuid from _p where clave = 'lec');
  select count(*) filter (where actor_name is null) into v_sin from public.document_activity where inbox_id = (select v::uuid from _p where clave = 'uno') and actor = 'persona';
  select count(*) into v_otros from public.document_inbox where id in ((select v::uuid from _p where clave = 'uno'), (select v::uuid from _p where clave = 'rec'), (select v::uuid from _p where clave = 'par'));
  if v_fila + v_act + v_lec <> 0 or v_sin <> 0 or v_otros <> 3 then
    raise exception 'PRUEBA S01p·18.2 · 3: quedan % fila, % actividad y % lectura del eliminado; % actividades sin nombre; % de los otros tres.', v_fila, v_act, v_lec, v_sin, v_otros;
  end if;
  raise notice '1-3 · del eliminado no queda nada; los otros tres siguen; la actividad de una persona, con nombre';
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
  if to_regprocedure('public.conta_llegada_eliminar(uuid,text)') is not null or to_regprocedure('public.conta_llegada_eliminable(uuid)') is not null then raise exception 'PRUEBA S01p·18.2 · 3 · 4: la vuelta atrás deja sus funciones.'; end if;
  raise notice '4 · la vuelta atrás: conta_puerta_dime_que_es como en producción (%) y fuera conta_llegada_eliminar y conta_llegada_eliminable', v_h;
end $$;
\i supabase/migrations/20261113T1015_s01p_documento_sin_leer.sql

rollback;
