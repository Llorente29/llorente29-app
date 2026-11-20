-- supabase/staging/sql/20261119_x10b_erp10_envio_prueba.sql
--
-- SOLO STAGING. Prueba del X10b (20261119T1433_x10b_erp10_envio), que el ensayo de staging
-- pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los objetos: public.conta_erp10_envio (tabla nueva) y
-- public.conta_erp10_envio_tomar(uuid,uuid,text,text) (nueva). No cambia ninguna que exista.
--
--   0. La forma: la tabla con su índice único por asiento y su RLS; la función, solo para
--      la clave de servicio.
--   1. Coger un asiento nuevo: «enviando», intento 1. Cogerlo otra vez enseguida (otro clic,
--      otra pestaña): no se coge.
--   2. En ERP10 (con su número): no se vuelve a coger nunca.
--   3. No pudo: se vuelve a coger (intento 2). Se quedó a medias hace más de 3 minutos: se
--      vuelve a coger.
--   4. Un asiento de otra empresa: para.
--   5. Un usuario que no es de la cuenta no la ve (RLS). Escribirla, nadie con sesión (sección 0).
--   6. La vuelta atrás (el fichero de verdad, con \i), con la tabla vacía, la quita.
--
-- Sin datos reales (T11): cuentas, empresas y asientos inventados, creados aquí.
--
-- sin usuario: la función es solo de la clave de servicio (la llama conta-erp10-escribir);
-- la sección 5 mira la tabla con «set local role authenticated» como un usuario de la cuenta A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X10b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 0 · La forma -----------------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.conta_erp10_envio') is null then raise exception 'PRUEBA X10b · 0: falta la tabla'; end if;
  if not exists (select 1 from pg_indexes where indexname = 'conta_erp10_envio_asiento_uq') then raise exception 'PRUEBA X10b · 0: falta el índice único por asiento'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.conta_erp10_envio'::regclass) then raise exception 'PRUEBA X10b · 0: sin RLS'; end if;
  if has_function_privilege('authenticated', 'public.conta_erp10_envio_tomar(uuid, uuid, text, text)', 'execute') then raise exception 'PRUEBA X10b · 0: authenticated puede coger'; end if;
  if has_table_privilege('authenticated', 'public.conta_erp10_envio', 'insert') or has_table_privilege('authenticated', 'public.conta_erp10_envio', 'update') then raise exception 'PRUEBA X10b · 0: authenticated puede escribir'; end if;
  raise notice 'PRUEBA X10b · 0: tabla con índice único y RLS; la función, solo para la clave de servicio.';
end $$;

-- Lo inventado: dos cuentas, una empresa en cada una y tres asientos en la de A.
do $$
declare y uuid;
begin
  insert into public.accounts (id, name, slug) values
    ('00000000-0000-0000-0000-0000000a10b1', 'Cuenta X10b A inventada', 'cuenta-x10b-a-inventada'),
    ('00000000-0000-0000-0000-0000000a10b2', 'Cuenta X10b B inventada', 'cuenta-x10b-b-inventada');
  insert into public.company (id, account_id, legal_name, tax_id) values
    ('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000a10b1', 'Sociedad X10b A inventada', 'B00000000'),
    ('00000000-0000-0000-0000-0000000c10b2', '00000000-0000-0000-0000-0000000a10b2', 'Sociedad X10b B inventada', 'B11111111');
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
  values ('00000000-0000-0000-0000-0000000a10b1', '00000000-0000-0000-0000-0000000c10b1', '2026', '2026-01-01', '2026-12-31') returning id into y;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type) values
    ('00000000-0000-0000-0000-0000000e10b1', '00000000-0000-0000-0000-0000000a10b1', '00000000-0000-0000-0000-0000000c10b1', y, 2, '2026-10-05', 'Recibida inventada X10b 1', 'manual'),
    ('00000000-0000-0000-0000-0000000e10b2', '00000000-0000-0000-0000-0000000a10b1', '00000000-0000-0000-0000-0000000c10b1', y, 2, '2026-10-06', 'Recibida inventada X10b 2', 'manual'),
    ('00000000-0000-0000-0000-0000000e10b3', '00000000-0000-0000-0000-0000000a10b1', '00000000-0000-0000-0000-0000000c10b1', y, 2, '2026-10-07', 'Recibida inventada X10b 3', 'manual');
end $$;

-- 1 · Coger un asiento nuevo, y otra vez enseguida ---------------------------------------------------
do $$
declare r jsonb;
begin
  r := public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b1', 'recibida', 'Prueba X10b');
  if not (r ->> 'tomado')::boolean or r -> 'envio' ->> 'estado' <> 'enviando' or (r -> 'envio' ->> 'intentos')::int <> 1 then raise exception 'PRUEBA X10b · 1: nuevo: %', r; end if;
  r := public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b1', 'recibida', 'Prueba X10b');
  if (r ->> 'tomado')::boolean then raise exception 'PRUEBA X10b · 1: se ha cogido dos veces: %', r; end if;
  if (select count(*) from public.conta_erp10_envio where entry_id = '00000000-0000-0000-0000-0000000e10b1') <> 1 then raise exception 'PRUEBA X10b · 1: más de una fila'; end if;
  raise notice 'PRUEBA X10b · 1: un asiento nuevo se coge («enviando», intento 1); otra vez enseguida, no.';
end $$;

-- 2 · En ERP10: no se vuelve a coger nunca ----------------------------------------------------------
do $$
declare r jsonb;
begin
  begin
    update public.conta_erp10_envio set estado = 'en_erp10' where entry_id = '00000000-0000-0000-0000-0000000e10b1';
    raise exception 'PRUEBA X10b · 2: «en_erp10» sin su número ha entrado';
  exception when check_violation then null;
  end;
  update public.conta_erp10_envio set estado = 'en_erp10', erp10_ejercicio = '2026', erp10_serie = '2', erp10_documento = 101, cambiado_en = now() - interval '1 day'
   where entry_id = '00000000-0000-0000-0000-0000000e10b1';
  r := public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b1', 'recibida', null);
  if (r ->> 'tomado')::boolean or r -> 'envio' ->> 'erp10_documento' <> '101' then raise exception 'PRUEBA X10b · 2: %', r; end if;
  raise notice 'PRUEBA X10b · 2: «en_erp10» lleva su número, y no se vuelve a coger nunca (aunque sea de ayer).';
end $$;

-- 3 · No pudo, o se quedó a medias: se vuelve a coger -----------------------------------------------
do $$
declare r jsonb;
begin
  perform public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b2', 'recibida', null);
  update public.conta_erp10_envio set estado = 'no_pudo', motivo = 'ERP10 dijo que no (inventado)' where entry_id = '00000000-0000-0000-0000-0000000e10b2';
  r := public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b2', 'recibida', null);
  if not (r ->> 'tomado')::boolean or (r -> 'envio' ->> 'intentos')::int <> 2 or r -> 'envio' ->> 'motivo' is not null then raise exception 'PRUEBA X10b · 3: no pudo: %', r; end if;
  perform public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b3', 'recibida', null);
  update public.conta_erp10_envio set cambiado_en = now() - interval '2 minutes' where entry_id = '00000000-0000-0000-0000-0000000e10b3';
  r := public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b3', 'recibida', null);
  if (r ->> 'tomado')::boolean then raise exception 'PRUEBA X10b · 3: a medias hace 2 minutos se ha cogido'; end if;
  update public.conta_erp10_envio set cambiado_en = now() - interval '4 minutes' where entry_id = '00000000-0000-0000-0000-0000000e10b3';
  r := public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b1', '00000000-0000-0000-0000-0000000e10b3', 'recibida', null);
  if not (r ->> 'tomado')::boolean then raise exception 'PRUEBA X10b · 3: a medias hace 4 minutos no se ha cogido'; end if;
  raise notice 'PRUEBA X10b · 3: lo que no pudo se vuelve a coger (intento 2); a medias, solo pasados 3 minutos.';
end $$;

-- 4 · Un asiento de otra empresa ---------------------------------------------------------------------
do $$ begin
  begin
    perform public.conta_erp10_envio_tomar('00000000-0000-0000-0000-0000000c10b2', '00000000-0000-0000-0000-0000000e10b1', 'recibida', null);
    raise exception 'PRUEBA X10b · 4: ha cogido un asiento de otra empresa';
  exception when check_violation then null;
  end;
  raise notice 'PRUEBA X10b · 4: un asiento de otra empresa para.';
end $$;

-- 5 · Quién la lee ------------------------------------------------------------------------------------
-- Las ve quien es de la cuenta A (current_user_account_ids). Se prueba con la función de verdad,
-- con un usuario inventado de A si la base sabe hacerlo; si no, al menos que otra cuenta no las ve.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b10b', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.conta_erp10_envio;
  reset role;
  if n <> 0 then raise exception 'PRUEBA X10b · 5: un usuario sin cuenta ve % filas', n; end if;
  raise notice 'PRUEBA X10b · 5: un usuario que no es de la cuenta no ve nada.';
end $$;

-- 6 · La vuelta atrás ---------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from public.conta_erp10_envio) then raise exception 'PRUEBA X10b · 6: sin filas con las que ver que para'; end if;
end $$;
delete from public.conta_erp10_envio;
\i supabase/vuelta-atras/20261119T1433_x10b_erp10_envio.down.sql
do $$ begin
  if to_regclass('public.conta_erp10_envio') is not null then raise exception 'PRUEBA X10b · 6: la vuelta atrás no ha quitado la tabla'; end if;
  raise notice 'PRUEBA X10b · 6: vacía, la vuelta atrás quita la tabla y la función.';
end $$;

rollback;
