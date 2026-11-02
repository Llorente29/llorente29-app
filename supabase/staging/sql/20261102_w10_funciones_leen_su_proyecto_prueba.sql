-- supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
--
-- SOLO STAGING. Prueba de la 0201 y la 0202 del W10 (staging no llama a
-- producción), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Nada sale a la red: pg_net solo manda lo que se confirma, y esto acaba en
-- rollback.
--
--   0 · lo de antes: si ya están aplicadas, sus vueltas atrás; las huellas de
--       las 24 funciones que cambian, para compararlas al final.
--   1 · aplicar: la guarda dice «staging»; ninguna función lleva ya escrita la
--       dirección de un proyecto; las 24 la leen del Vault.
--   2 · el camino de verdad: una venta de Last que pasa a «en preparación».
--       a) sin order_advance_secret en el Vault (como está staging): no se
--          llama a nadie, queda el aviso y la venta se guarda;
--       b) con un secreto de prueba (solo dentro de esta transacción): la
--          llamada va a order-advance de ESTE proyecto, con ese secreto.
--   3 · tg_auto_dispatch lee la dirección del Vault y, si falta, no llama.
--   4 · una sola firma de cada función.
--   5 · la vuelta atrás: las 24 huellas de antes y nada de lo nuevo.
--
-- Las 24, una por línea:
--   public._set_brand_closure_core(uuid,uuid[],text,timestamp with time zone,text,text,uuid,uuid,text,text)
--   public.conta_banco_agregador_despertar()
--   public.conta_diez_despertar()
--   public.conta_lote_releer_lanzar(uuid,text)
--   public.conta_recibida_pdf_despertar()
--   public.conta_recordatorios_despertar()
--   public.db_health_connection_guard()
--   public.last_catalog_import_dispatch()
--   public.last_catalog_sync_dispatch()
--   public.push_location_opening_hours(uuid)
--   public.request_social_generation(uuid)
--   public.set_location_status_by_token(text,text,timestamp with time zone,text,text)
--   public.set_location_status(uuid,text,timestamp with time zone,text,text)
--   public.set_modifier_option_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)
--   public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamp with time zone,text)
--   public.set_product_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)
--   public.set_product_availability(uuid,boolean,uuid,text,timestamp with time zone,text)
--   public.set_products_availability_bulk_by_token(text,uuid[],boolean,text,timestamp with time zone,text)
--   public.set_products_availability_bulk(uuid[],boolean,uuid,text,timestamp with time zone,text)
--   public.system_alert_queue_drain()
--   public.tg_auto_dispatch()
--   public.trg_sale_push_status()
--   public.verifactu_despertar_cuadre()
--   public.verifactu_despertar()
--
-- sin usuario: las 24 son SECURITY DEFINER y corren como su dueño, sea quien
-- sea quien las llame (un disparador de sale, un cron, la app); lo único que
-- cambia es de dónde leen la dirección y el secreto (el Vault), y eso no
-- depende de quién llama. Las funciones nuevas no las puede llamar nadie de
-- fuera (revoke a public, anon y authenticated).

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA W10: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261102T0202_w10_funciones_leen_su_proyecto') as w10_b_aplicada \gset
\if :w10_b_aplicada
\i supabase/vuelta-atras/20261102T0202_w10_funciones_leen_su_proyecto.down.sql
\endif
select to_regprocedure('public._project_url()') is not null as w10_a_aplicada \gset
\if :w10_a_aplicada
\i supabase/vuelta-atras/20261102T0201_w10_project_url.down.sql
\endif

create temp table _w10_antes on commit drop as
  select x.firma, md5(pg_get_functiondef(to_regprocedure(x.firma))) huella
    from (values
      ('public._set_brand_closure_core(uuid,uuid[],text,timestamp with time zone,text,text,uuid,uuid,text,text)'),
      ('public.conta_banco_agregador_despertar()'),
      ('public.conta_diez_despertar()'),
      ('public.conta_lote_releer_lanzar(uuid,text)'),
      ('public.conta_recibida_pdf_despertar()'),
      ('public.conta_recordatorios_despertar()'),
      ('public.db_health_connection_guard()'),
      ('public.last_catalog_import_dispatch()'),
      ('public.last_catalog_sync_dispatch()'),
      ('public.push_location_opening_hours(uuid)'),
      ('public.request_social_generation(uuid)'),
      ('public.set_location_status_by_token(text,text,timestamp with time zone,text,text)'),
      ('public.set_location_status(uuid,text,timestamp with time zone,text,text)'),
      ('public.set_modifier_option_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)'),
      ('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamp with time zone,text)'),
      ('public.set_product_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)'),
      ('public.set_product_availability(uuid,boolean,uuid,text,timestamp with time zone,text)'),
      ('public.set_products_availability_bulk_by_token(text,uuid[],boolean,text,timestamp with time zone,text)'),
      ('public.set_products_availability_bulk(uuid[],boolean,uuid,text,timestamp with time zone,text)'),
      ('public.system_alert_queue_drain()'),
      ('public.tg_auto_dispatch()'),
      ('public.trg_sale_push_status()'),
      ('public.verifactu_despertar_cuadre()'),
      ('public.verifactu_despertar()')
    ) x(firma);
do $$
declare v_otras text;
begin
  if exists (select 1 from _w10_antes where huella is null) then
    raise exception 'PRUEBA W10 · 0: falta alguna de las 24: %.', (select string_agg(firma, ', ') from _w10_antes where huella is null);
  end if;
  if (select count(*) from _w10_antes a where pg_get_functiondef(to_regprocedure(a.firma)) !~ 'https://[a-z0-9]{20}\.supabase\.co/functions/v1/') > 0 then
    raise exception 'PRUEBA W10 · 0: alguna de las 24 ya no lleva la dirección escrita: la prueba no mediría nada.';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_otras from pg_proc p
   where p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'https://[a-z0-9]{20}\.supabase\.co/functions/v1/'
     and p.oid::regprocedure::text not in (select replace(firma, 'public.', '') from _w10_antes);
  raise notice '0 · lo de antes: las 24 llevan una dirección escrita (rojo a propósito). Otras de esta base, no de producción: %', coalesce(v_otras, 'ninguna');
end $$;

-- ── 1 · Aplicar ─────────────────────────────────────────────────────────────
\i supabase/migrations/20261102T0201_w10_project_url.sql
\i supabase/migrations/20261102T0202_w10_funciones_leen_su_proyecto.sql
do $$
declare v_mal text;
begin
  if public._project_url() !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'PRUEBA W10 · 1: _project_url() no tiene forma de dirección de proyecto.';
  end if;
  select string_agg(a.firma, ', ') into v_mal from _w10_antes a
   where pg_get_functiondef(to_regprocedure(a.firma)) ~ 'https://[a-z0-9]{20}\.supabase\.co';
  if v_mal is not null then raise exception 'PRUEBA W10 · 1: siguen con una dirección escrita: %.', v_mal; end if;
  -- Las 24, por su nombre: cada una lee la dirección del Vault.
  select string_agg(x.firma, ', ') into v_mal from _w10_antes x
   where to_regprocedure(x.firma) is null or pg_get_functiondef(to_regprocedure(x.firma)) !~ '_project_url';
  if v_mal is not null then raise exception 'PRUEBA W10 · 1: no leen la dirección del Vault: %.', v_mal; end if;
  if (select count(*) from _w10_antes a where pg_get_functiondef(to_regprocedure(a.firma)) !~ '_project_url') > 0 then
    raise exception 'PRUEBA W10 · 1: alguna de las medidas en el paso 0 no lee del Vault.';
  end if;
  if pg_get_functiondef('public.trg_sale_push_status()'::regprocedure) ~ 'fv_[A-Za-z0-9]+_[A-Za-z0-9]{16,}' then
    raise exception 'PRUEBA W10 · 1: trg_sale_push_status sigue con el secreto escrito.';
  end if;
  raise notice '1 · aplicar: ninguna dirección ni secreto escritos; las 24 leen del Vault';
end $$;

-- ── 2 · El camino de verdad: una venta de Last que cambia de estado ─────────
-- (psql no sustituye :variables dentro de $$: van con set_config.)
select set_config('w10.cola', coalesce(max(id), 0)::text, true) from net.http_request_queue;
select set_config('w10.venta', id::text, true) from public.sale where source = 'lastapp' order by created_at limit 1;
do $$ begin
  if current_setting('w10.venta', true) is null or current_setting('w10.venta', true) = '' then
    raise exception 'PRUEBA W10 · 2: staging no tiene ninguna venta de Last.';
  end if;
end $$;
select exists (select 1 from vault.decrypted_secrets where name = 'order_advance_secret') as w10_hay_secreto \gset
\if :w10_hay_secreto
do $$ begin raise notice '2a · staging ya tiene order_advance_secret: se prueba con el suyo (2b).'; end $$;
\else
select set_config('w10.desde', clock_timestamp()::text, true);
update public.sale set order_status = 'in_preparation' where id = current_setting('w10.venta')::uuid;
do $$
declare v_llamadas int; v_avisos int;
begin
  select count(*) into v_llamadas from net.http_request_queue where id > current_setting('w10.cola')::bigint;
  select count(*) into v_avisos from public.system_alert_queue
   where subject = 'Sin llamar a order-advance: falta order_advance_secret en el Vault';
  if v_llamadas <> 0 then raise exception 'PRUEBA W10 · 2a: sin secreto no tiene que salir ninguna llamada y salen %.', v_llamadas; end if;
  if v_avisos < 1 then raise exception 'PRUEBA W10 · 2a: no ha quedado el aviso en system_alert_queue.'; end if;
  if not exists (select 1 from public.sale where id = current_setting('w10.venta')::uuid and order_status = 'in_preparation') then
    raise exception 'PRUEBA W10 · 2a: la venta no se ha guardado.';
  end if;
  raise notice '2a · sin secreto en el Vault: ninguna llamada, el aviso y la venta guardada';
end $$;
select vault.create_secret('secreto-de-prueba-w10', 'order_advance_secret') is not null as w10_secreto;
\endif
select set_config('w10.secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'order_advance_secret'), true);
update public.sale set order_status = 'awaiting_collection' where id = current_setting('w10.venta')::uuid;
do $$
declare r record; v_n int;
begin
  select count(*) into v_n from net.http_request_queue
   where id > current_setting('w10.cola')::bigint and url not like public._project_url() || '/%';
  if v_n <> 0 then raise exception 'PRUEBA W10 · 2b: % llamadas salen hacia otro proyecto.', v_n; end if;
  select count(*) into v_n from net.http_request_queue
   where id > current_setting('w10.cola')::bigint and url like '%/functions/v1/order-advance';
  if v_n <> 1 then raise exception 'PRUEBA W10 · 2b: esperaba 1 llamada a order-advance y hay %.', v_n; end if;
  select url, headers into r from net.http_request_queue
   where id > current_setting('w10.cola')::bigint and url like '%/functions/v1/order-advance';
  if r.url <> public._project_url() || '/functions/v1/order-advance' then
    raise exception 'PRUEBA W10 · 2b: la llamada no va a order-advance de este proyecto.';
  end if;
  if r.headers->>'x-order-advance-secret' is distinct from current_setting('w10.secreto') then
    raise exception 'PRUEBA W10 · 2b: la llamada no lleva el secreto del Vault.';
  end if;
  raise notice '2b · con secreto: una llamada, a order-advance de este proyecto y con el secreto del Vault; ninguna hacia otro proyecto';
end $$;

-- ── 3 · tg_auto_dispatch ────────────────────────────────────────────────────
do $$
declare v_def text := pg_get_functiondef('public.tg_auto_dispatch()'::regprocedure);
begin
  if v_def !~ 'v_url := public\._project_url_si_hay\(\);' or v_def !~ '_aviso_falta_en_vault\(''catcher-dispatch'', new\.id\)'
     or v_def !~ 'v_url := v_url \|\| ''/functions/v1/catcher-dispatch'';' then
    raise exception 'PRUEBA W10 · 3: tg_auto_dispatch no lee la dirección del Vault como se espera.';
  end if;
  raise notice '3 · tg_auto_dispatch: la dirección, del Vault; si falta, aviso y sin llamar';
end $$;

-- ── 4 · Una sola firma de cada función ──────────────────────────────────────
do $$
declare v_mal text;
begin
  select string_agg(proname || ' (' || n || ')', ', ') into v_mal from (
    select p.proname, count(*) n from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (select split_part(firma, '(', 1) from _w10_antes union all select '_project_url' union all select '_project_url_si_hay' union all select '_aviso_falta_en_vault')
     group by p.proname having count(*) > 1) x;
  if v_mal is not null then raise exception 'PRUEBA W10 · 4: hay sobrecargas: %.', v_mal; end if;
  raise notice '4 · una sola firma de cada función';
end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261102T0202_w10_funciones_leen_su_proyecto.down.sql
\i supabase/vuelta-atras/20261102T0201_w10_project_url.down.sql
do $$
declare v_mal text;
begin
  select string_agg(a.firma, ', ') into v_mal from _w10_antes a
   where md5(pg_get_functiondef(to_regprocedure(a.firma))) is distinct from a.huella;
  if v_mal is not null then raise exception 'PRUEBA W10 · 5: la vuelta atrás no deja como estaban: %.', v_mal; end if;
  if to_regprocedure('public._project_url()') is not null or to_regprocedure('public._project_url_si_hay()') is not null
     or to_regprocedure('public._aviso_falta_en_vault(text,uuid)') is not null then
    raise exception 'PRUEBA W10 · 5: la vuelta atrás deja funciones de la 0201.';
  end if;
  raise notice '5 · la vuelta atrás: las 24 como estaban y nada de lo nuevo';
end $$;

rollback;
