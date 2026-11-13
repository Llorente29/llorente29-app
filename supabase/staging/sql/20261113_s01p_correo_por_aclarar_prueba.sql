-- supabase/staging/sql/20261113_s01p_correo_por_aclarar_prueba.sql
--
-- SOLO STAGING. Prueba de la 1504 (S01p·20 · 1: el lector de correos no descarta en
-- silencio), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A.
--
--   1. Un correo de plataforma del que no salió nada (su registro de entrada, como los 11
--      del 01/11): conta_entrada_sin_factura deja UNA fila, con el asunto del registro y el
--      porqué; sale en Documentos (conta_documentos_recibidos) «por aclarar», con su porqué.
--      Otra vez el mismo correo: la misma fila («ya_estaba»).
--   2. «Subir el PDF a mano»: el fichero va a la misma fila y queda recibido, para leerlo.
--      Una fila que no es un correo sin factura, no.
--   3. Volver a leer y entrar: conta_entrada_sin_factura_resuelta la saca de «Por aclarar»
--      (descartada, con su actividad) y deja de salir en Documentos.
--   4. Las dos de la función de entrada son solo de la clave de servicio: una persona, no.
--      Quien no es de la cuenta no sube el PDF.
--   5. La vuelta atrás: ninguna de las tres.
--
-- Nombra lo que toca, para el analizador: conta_entrada_sin_factura,
-- conta_entrada_sin_factura_resuelta, conta_correo_sin_factura_pdf, document_inbox,
-- document_activity, inbound_email_log, conta_documentos_recibidos.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·20 · 1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
set local lock_timeout = '30s';

select to_regprocedure('public.conta_entrada_sin_factura(jsonb)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T1504_s01p_correo_por_aclarar.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('correo', 'prueba-s01p20-1-correo-a'), ('correo2', 'prueba-s01p20-1-correo-b');
insert into _p select 'empresa', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)::text;

-- La siembra: dos correos de Just Eat en el registro de entrada, «sin_facturas» (como los del 01/11).
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if e is null then raise exception 'PRUEBA S01p·20 · 1 · siembra: la cuenta A no tiene empresa.'; end if;
  insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail, received_at)
  values ((select v from _p where clave = 'correo'), 'facturas-prueba@entrada.folvy.app', 'reenvio@prueba.test', 'Fwd: Just-eat invoice: 0000001', e, a, 'sin_facturas', '{"dejados": [], "tomados": 0}', now()),
         ((select v from _p where clave = 'correo2'), 'facturas-prueba@entrada.folvy.app', 'reenvio@prueba.test', 'Fwd: Just-eat invoice: 0000002', e, a, 'sin_facturas', '{"dejados": [], "tomados": 0}', now());
end $$;

-- 1. La fila, una sola; y sale en Documentos «por aclarar», con su porqué.
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; r2 jsonb; d public.document_inbox;
begin
  r := public.conta_entrada_sin_factura(jsonb_build_object('company_id', e, 'email_id', (select v from _p where clave = 'correo')));
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA S01p·20 · 1 · 1: la primera vez dice que ya estaba.'; end if;
  select * into d from public.document_inbox where id = (r->>'id')::uuid;
  if d.status <> 'error' or d.file_path is not null or d.link_url is not null or d.email_subject <> 'Fwd: Just-eat invoice: 0000001'
     or d.reason <> 'No he encontrado la factura en el correo.' or d.channel <> 'correo' then
    raise exception 'PRUEBA S01p·20 · 1 · 1: la fila es %.', row_to_json(d);
  end if;
  if not exists (select 1 from public.document_activity where inbox_id = d.id and action = 'recibida') then raise exception 'PRUEBA S01p·20 · 1 · 1: sin su actividad.'; end if;
  r2 := public.conta_entrada_sin_factura(jsonb_build_object('company_id', e, 'email_id', (select v from _p where clave = 'correo')));
  if r2->>'id' <> r->>'id' or not (r2->>'ya_estaba')::boolean then raise exception 'PRUEBA S01p·20 · 1 · 1: otra vez da %.', r2; end if;
  if (select count(*) from public.document_inbox where email_id = (select v from _p where clave = 'correo')) <> 1 then raise exception 'PRUEBA S01p·20 · 1 · 1: hay más de una fila.'; end if;
  insert into _p values ('fila', r->>'id');
  r := public.conta_entrada_sin_factura(jsonb_build_object('company_id', e, 'email_id', (select v from _p where clave = 'correo2'), 'porque', 'A la liquidación de Just Eat le faltan importes (neto, ventas, pedidos o su factura).'));
  insert into _p values ('fila2', r->>'id');
  raise notice '1 · una fila por correo, con el asunto y el porqué; otra vez, la misma';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; x jsonb; v_hoy date := (now() at time zone 'Europe/Madrid')::date; v_err text;
begin
  r := public.conta_documentos_recibidos(e, date_trunc('month', v_hoy)::date, v_hoy);
  select z into x from jsonb_array_elements(r->'filas') z where z->>'id' = (select v from _p where clave = 'fila');
  if x is null or x->>'tipo' <> 'llegada' or x->>'estado' <> 'por_aclarar' or x->>'porque' <> 'No he encontrado la factura en el correo.' or x->>'archivo' is not null then
    raise exception 'PRUEBA S01p·20 · 1 · 1: en Documentos sale %.', x;
  end if;
  raise notice '1 · en Documentos: % · %', x->>'estado', x->>'porque';
  -- 4. Una persona no llama a las de la función de entrada.
  begin perform public.conta_entrada_sin_factura(jsonb_build_object('company_id', e, 'email_id', 'x')); raise exception 'PRUEBA S01p·20 · 1 · 4: una persona crea la fila.';
  exception when insufficient_privilege then v_err := sqlerrm; end;
  begin perform public.conta_entrada_sin_factura_resuelta(e, 'x', null); raise exception 'PRUEBA S01p·20 · 1 · 4: una persona la resuelve.';
  exception when insufficient_privilege then null; end;
  raise notice '4 · una persona no llama a las de la entrada («%»)', v_err;
  -- 2. «Subir el PDF a mano».
  r := public.conta_correo_sin_factura_pdf((select v::uuid from _p where clave = 'fila'), 'c01a0000-0000-4000-8000-00000000000a/prueba-s01p20.pdf', 'factura.pdf', 'application/pdf', 1000, repeat('a', 64));
  if coalesce(r->>'mensaje', '') <> 'Subido «factura.pdf»: lo leo ahora.' then raise exception 'PRUEBA S01p·20 · 1 · 2: dice %.', r; end if;
  begin perform public.conta_correo_sin_factura_pdf((select v::uuid from _p where clave = 'fila'), 'c01a0000-0000-4000-8000-00000000000a/otra.pdf', 'otra.pdf', 'application/pdf', 1000, repeat('b', 64));
    raise exception 'PRUEBA S01p·20 · 1 · 2: sube dos veces.';
  exception when sqlstate '22023' then raise notice '2 · subido; una segunda vez, no («%»)', sqlerrm; end;
end $$;
reset role;
do $$
declare d public.document_inbox;
begin
  select * into d from public.document_inbox where id = (select v::uuid from _p where clave = 'fila');
  if d.status <> 'recibido' or d.file_name <> 'factura.pdf' or d.reason is not null then raise exception 'PRUEBA S01p·20 · 1 · 2: quedó %.', row_to_json(d); end if;
  raise notice '2 · en la base: recibida, con su fichero, para leerla';
end $$;

-- 3. Volver a leer y entrar: sale de «Por aclarar».
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); n integer;
begin
  n := public.conta_entrada_sin_factura_resuelta(e, (select v from _p where clave = 'correo2'), null);
  if n <> 1 or (select status from public.document_inbox where id = (select v::uuid from _p where clave = 'fila2')) <> 'descartado' then
    raise exception 'PRUEBA S01p·20 · 1 · 3: resuelve % y queda %.', n, (select status from public.document_inbox where id = (select v::uuid from _p where clave = 'fila2'));
  end if;
  if not exists (select 1 from public.document_activity where inbox_id = (select v::uuid from _p where clave = 'fila2') and action = 'descartada') then raise exception 'PRUEBA S01p·20 · 1 · 3: sin su actividad.'; end if;
  n := public.conta_entrada_sin_factura_resuelta(e, (select v from _p where clave = 'correo2'), null);
  if n <> 0 then raise exception 'PRUEBA S01p·20 · 1 · 3: la segunda vez resuelve %.', n; end if;
  raise notice '3 · resuelta: descartada, con su actividad; la segunda vez, nada';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  r := public.conta_documentos_recibidos(e, date_trunc('month', v_hoy)::date, v_hoy);
  if exists (select 1 from jsonb_array_elements(r->'filas') z where z->>'id' = (select v from _p where clave = 'fila2')) then raise exception 'PRUEBA S01p·20 · 1 · 3: sigue en Documentos.'; end if;
  raise notice '3 · ya no sale en Documentos';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
begin
  begin perform public.conta_correo_sin_factura_pdf((select v::uuid from _p where clave = 'fila2'), 'x/y.pdf', 'y.pdf', 'application/pdf', 1, repeat('c', 64)); raise exception 'PRUEBA S01p·20 · 1 · 4: sin cuenta sube.';
  exception when insufficient_privilege or sqlstate 'P0002' then raise notice '4 · sin cuenta, no («%»)', sqlerrm; end;
end $$;
reset role;

-- 5. La vuelta atrás.
\i supabase/vuelta-atras/20261113T1504_s01p_correo_por_aclarar.down.sql
do $$ begin
  if to_regprocedure('public.conta_entrada_sin_factura(jsonb)') is not null or to_regprocedure('public.conta_entrada_sin_factura_resuelta(uuid,text,text)') is not null
     or to_regprocedure('public.conta_correo_sin_factura_pdf(uuid,text,text,text,integer,text)') is not null then
    raise exception 'PRUEBA S01p·20 · 1 · 5: la vuelta atrás deja sus funciones.';
  end if;
  raise notice '5 · la vuelta atrás: fuera las tres';
end $$;
\i supabase/migrations/20261113T1504_s01p_correo_por_aclarar.sql

rollback;
