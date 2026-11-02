-- supabase/migrations/20261102T0202_w10_funciones_leen_su_proyecto.sql
--
-- W10 · Staging no llama a producción (rehecho el 02/11/2026 desde main; era
-- el #380 del 28/10). Segunda de dos: las 24 funciones que llevan escrita la
-- dirección de producción la leen del Vault de su propio proyecto
-- (public._project_url(), de la 20261102T0201). En producción la dirección es la misma
-- de antes: la guarda lo comprueba y, si no, para sin tocar nada. En staging
-- pasan a llamar a las funciones de staging.
--
-- Las 24 se reescriben enteras desde su definición en producción del 02/11,
-- cambiando SOLO la dirección (y, en los dos disparadores de sale, qué hacer
-- si falta: no llamar, avisar y dejar seguir el pedido). Respecto al #380:
-- trg_sale_push_status es la de después del W10a (el secreto ya del Vault), y
-- conta_banco_agregador_despertar es nueva (B01). Cada una se guarda antes
-- con _respaldar_funcion y su vuelta atrás la restaura byte a byte. Cinco
-- llevan CRLF en producción: el fichero va como binario (.gitattributes).
--
-- LA GUARDA, antes de tocar nada, según la base (por la huella de su
-- project_url, sin escribir ninguna dirección):
--   · PRODUCCIÓN: las 24 están como se midieron el 02/11 (su md5) y la
--     dirección escrita en cada una es la del Vault; si no, para;
--   · STAGING: se reescriben igual (quedan como producción) y se dice cuáles
--     tenía distintas;
--   · otra base: para.
--
-- cambia: public._set_brand_closure_core · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.conta_banco_agregador_despertar · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.conta_diez_despertar · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.conta_lote_releer_lanzar · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.conta_recibida_pdf_despertar · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.conta_recordatorios_despertar · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.db_health_connection_guard · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.last_catalog_import_dispatch · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.last_catalog_sync_dispatch · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.push_location_opening_hours · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.request_social_generation · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_location_status_by_token · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_location_status · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_modifier_option_availability_by_token · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_modifier_option_availability · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_product_availability_by_token · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_product_availability · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_products_availability_bulk_by_token · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.set_products_availability_bulk · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.system_alert_queue_drain · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.tg_auto_dispatch · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.trg_sale_push_status · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.verifactu_despertar_cuadre · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- cambia: public.verifactu_despertar · prueba: supabase/staging/sql/20261102_w10_funciones_leen_su_proyecto_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261102T0202_w10_funciones_leen_su_proyecto.down.sql

-- ── La guarda ───────────────────────────────────────────────────────────────
do $guarda$
declare
  v_url text := public._project_url();
  r record;
  v_distintas text := '';
begin
  if md5(v_url) = 'a07a3bc4f17fdd6fb4b41d0841a77f11' then
    for r in
      select x.firma, x.huella, md5(pg_get_functiondef(to_regprocedure(x.firma))) viva,
             (regexp_match(pg_get_functiondef(to_regprocedure(x.firma)), '''(https://[a-z0-9]{20}\.supabase\.co)/functions/v1/'))[1] escrita
        from (values
        ('public._set_brand_closure_core(uuid,uuid[],text,timestamp with time zone,text,text,uuid,uuid,text,text)', 'a34afe1aab131d50d91aff7c133d5c2d'),
        ('public.conta_banco_agregador_despertar()', '35869e4247d28d71780394621d85e816'),
        ('public.conta_diez_despertar()', '3228b050fd8992874cc7e4761d3e3d93'),
        ('public.conta_lote_releer_lanzar(uuid,text)', '2c12a7e4088d82e0b799c46062d89dc5'),
        ('public.conta_recibida_pdf_despertar()', '9e1d971cc9c7b5d5bf311e221dfa5474'),
        ('public.conta_recordatorios_despertar()', '973737eb64ef43f6ea5d24ffcaed15b1'),
        ('public.db_health_connection_guard()', '17e3453f97f6f35a22542bd447d02a23'),
        ('public.last_catalog_import_dispatch()', 'c43ef4d3c93b982d80b475c816b85592'),
        ('public.last_catalog_sync_dispatch()', '199b341f2f5c961fe15430486f641c0b'),
        ('public.push_location_opening_hours(uuid)', '018c593779e9a8bf9c5c9e933a7b25f2'),
        ('public.request_social_generation(uuid)', 'aa95bbd498149daff3a8c04876740a07'),
        ('public.set_location_status_by_token(text,text,timestamp with time zone,text,text)', 'fd1d1c86e11f506cacaa34857a720329'),
        ('public.set_location_status(uuid,text,timestamp with time zone,text,text)', 'c1fdc3426688f05533c89c0737c20f90'),
        ('public.set_modifier_option_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', 'c85019c03ddb7b31eecaaa805da47ddb'),
        ('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', '550e5ec34a55db84ef047263e5d65906'),
        ('public.set_product_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', 'db181a9ba634a55c9cd6e901d7b1d2f6'),
        ('public.set_product_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', 'e1da7f1981db3ad9a705acf9594caf3c'),
        ('public.set_products_availability_bulk_by_token(text,uuid[],boolean,text,timestamp with time zone,text)', 'ee4f02b2a3ed5cf6bee38b207d72b714'),
        ('public.set_products_availability_bulk(uuid[],boolean,uuid,text,timestamp with time zone,text)', '6ad474db9eede5135727f098cef5fa5d'),
        ('public.system_alert_queue_drain()', '8dcf38ef401f803ad7af6e9d2dc44502'),
        ('public.tg_auto_dispatch()', 'fc5659aacd7677a628166484343f7902'),
        ('public.trg_sale_push_status()', '385240cb080367a355ee3a0a5d693eb6'),
        ('public.verifactu_despertar_cuadre()', '732bad6954afda3b1885c5113cea1561'),
        ('public.verifactu_despertar()', 'a21091ac838838fb40d12ce079827bad')
      ) x(firma, huella)
    loop
      if r.viva is null then raise exception 'W10: no existe %', r.firma; end if;
      if r.viva <> r.huella then
        raise exception 'W10: % ha cambiado desde el 02/11 (md5 % y se midió %). No se toca nada.', r.firma, r.viva, r.huella;
      end if;
      if r.escrita is distinct from v_url then
        raise exception 'W10: en producción la dirección escrita en % no es la del Vault (project_url). No se toca nada.', r.firma;
      end if;
    end loop;
    raise notice 'W10 · producción: las 24 llevan escrita la dirección del Vault; pasan a leerla de él.';
  elsif md5(v_url) = '654f12af1a4f9ce6c22584effc71b8ad' then
    for r in
      select x.firma, x.huella, md5(pg_get_functiondef(to_regprocedure(x.firma))) viva
        from (values
        ('public._set_brand_closure_core(uuid,uuid[],text,timestamp with time zone,text,text,uuid,uuid,text,text)', 'a34afe1aab131d50d91aff7c133d5c2d'),
        ('public.conta_banco_agregador_despertar()', '35869e4247d28d71780394621d85e816'),
        ('public.conta_diez_despertar()', '3228b050fd8992874cc7e4761d3e3d93'),
        ('public.conta_lote_releer_lanzar(uuid,text)', '2c12a7e4088d82e0b799c46062d89dc5'),
        ('public.conta_recibida_pdf_despertar()', '9e1d971cc9c7b5d5bf311e221dfa5474'),
        ('public.conta_recordatorios_despertar()', '973737eb64ef43f6ea5d24ffcaed15b1'),
        ('public.db_health_connection_guard()', '17e3453f97f6f35a22542bd447d02a23'),
        ('public.last_catalog_import_dispatch()', 'c43ef4d3c93b982d80b475c816b85592'),
        ('public.last_catalog_sync_dispatch()', '199b341f2f5c961fe15430486f641c0b'),
        ('public.push_location_opening_hours(uuid)', '018c593779e9a8bf9c5c9e933a7b25f2'),
        ('public.request_social_generation(uuid)', 'aa95bbd498149daff3a8c04876740a07'),
        ('public.set_location_status_by_token(text,text,timestamp with time zone,text,text)', 'fd1d1c86e11f506cacaa34857a720329'),
        ('public.set_location_status(uuid,text,timestamp with time zone,text,text)', 'c1fdc3426688f05533c89c0737c20f90'),
        ('public.set_modifier_option_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', 'c85019c03ddb7b31eecaaa805da47ddb'),
        ('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', '550e5ec34a55db84ef047263e5d65906'),
        ('public.set_product_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', 'db181a9ba634a55c9cd6e901d7b1d2f6'),
        ('public.set_product_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', 'e1da7f1981db3ad9a705acf9594caf3c'),
        ('public.set_products_availability_bulk_by_token(text,uuid[],boolean,text,timestamp with time zone,text)', 'ee4f02b2a3ed5cf6bee38b207d72b714'),
        ('public.set_products_availability_bulk(uuid[],boolean,uuid,text,timestamp with time zone,text)', '6ad474db9eede5135727f098cef5fa5d'),
        ('public.system_alert_queue_drain()', '8dcf38ef401f803ad7af6e9d2dc44502'),
        ('public.tg_auto_dispatch()', 'fc5659aacd7677a628166484343f7902'),
        ('public.trg_sale_push_status()', '385240cb080367a355ee3a0a5d693eb6'),
        ('public.verifactu_despertar_cuadre()', '732bad6954afda3b1885c5113cea1561'),
        ('public.verifactu_despertar()', 'a21091ac838838fb40d12ce079827bad')
      ) x(firma, huella)
    loop
      if r.viva is null then raise exception 'W10: no existe %', r.firma; end if;
      if r.viva <> r.huella then v_distintas := v_distintas || ' ' || r.firma; end if;
    end loop;
    raise notice 'W10 · staging: las 24 pasan a llamar a las funciones de staging (y quedan como producción). Distintas de producción antes:%', coalesce(nullif(v_distintas, ''), ' ninguna');
  else
    raise exception 'W10: project_url no es ni el de producción ni el de staging. No se toca nada.';
  end if;
end
$guarda$;

select public._respaldar_funcion('public._set_brand_closure_core(uuid,uuid[],text,timestamp with time zone,text,text,uuid,uuid,text,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.conta_banco_agregador_despertar()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.conta_diez_despertar()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.conta_lote_releer_lanzar(uuid,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.conta_recibida_pdf_despertar()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.conta_recordatorios_despertar()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.db_health_connection_guard()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.last_catalog_import_dispatch()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.last_catalog_sync_dispatch()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.push_location_opening_hours(uuid)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.request_social_generation(uuid)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_location_status_by_token(text,text,timestamp with time zone,text,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_location_status(uuid,text,timestamp with time zone,text,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_modifier_option_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_product_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_product_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_products_availability_bulk_by_token(text,uuid[],boolean,text,timestamp with time zone,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.set_products_availability_bulk(uuid[],boolean,uuid,text,timestamp with time zone,text)', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.system_alert_queue_drain()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.tg_auto_dispatch()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.trg_sale_push_status()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.verifactu_despertar_cuadre()', '20261102T0202_w10_funciones_leen_su_proyecto');
select public._respaldar_funcion('public.verifactu_despertar()', '20261102T0202_w10_funciones_leen_su_proyecto');

CREATE OR REPLACE FUNCTION public._set_brand_closure_core(p_brand_id uuid, p_location_ids uuid[], p_mode text, p_resume_at timestamp with time zone, p_reason text, p_reason_code text, p_account_id uuid, p_actor uuid, p_origin text, p_surface text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_brand_name text;
  v_action     text;
  v_secret     text;
  v_log_id     uuid;
  v_loc        uuid;
  v_matriculas text[];
  v_ids        uuid[];
  v_count      int;
  v_total      int := 0;
  v_locales    int := 0;
begin
  if p_mode not in ('normal', 'paused') then
    raise exception '_set_brand_closure_core: mode no valido % (solo normal|paused)', p_mode;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception '_set_brand_closure_core: reason_code no valido %', p_reason_code;
  end if;
  if p_location_ids is null or array_length(p_location_ids, 1) is null then
    raise exception '_set_brand_closure_core: sin locales sobre los que actuar';
  end if;

  select name into v_brand_name from brand where id = p_brand_id;
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'availability_dispatch_secret';

  foreach v_loc in array p_location_ids loop
    v_locales := v_locales + 1;

    if p_mode = 'paused' then
      insert into brand_closure
        (account_id, brand_id, location_id, resume_at, reason, reason_code, set_at, set_by, surface)
      values
        (p_account_id, p_brand_id, v_loc, p_resume_at, p_reason, p_reason_code, now(), p_actor, p_surface)
      on conflict (brand_id, location_id) do update
        set resume_at   = excluded.resume_at,
            reason      = excluded.reason,
            reason_code = excluded.reason_code,
            set_at      = now(),
            set_by      = excluded.set_by,
            surface     = excluded.surface,
            updated_at  = now();
    else
      delete from brand_closure
       where brand_id = p_brand_id and location_id = v_loc;
    end if;

    select array_agg(distinct mi.external_id) filter (where mi.external_id is not null),
           array_agg(distinct mi.id),
           count(*)
      into v_matriculas, v_ids, v_count
    from menu_item mi
    where mi.account_id    = p_account_id
      and mi.brand_id      = p_brand_id
      and mi.stock_group_id is null
      and mi.external_id   is not null
      and mi.archived_at   is null
      and ( p_mode = 'paused'
            or not exists (
                 select 1 from product_availability pa
                  where pa.account_id = mi.account_id
                    and pa.is_available = false
                    and (pa.available_until is null or pa.available_until > now())
                    and (pa.location_id = v_loc or pa.location_id is null)
                    and ( (mi.external_id    is not null and pa.external_id    = mi.external_id)
                       or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) ) ) );

    v_total := v_total + coalesce(v_count, 0);

    insert into location_status_log
      (account_id, brand_id, location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
    values
      (p_account_id, p_brand_id, v_loc, 'brand_closure',
       jsonb_build_object('brand_id', p_brand_id, 'location_id', v_loc,
                          'mode', p_mode, 'items', coalesce(v_count, 0)),
       p_mode, p_resume_at, p_reason, p_surface, p_actor)
    returning id into v_log_id;

    begin
      insert into availability_event
        (account_id, scope, target_id, target_label, location_id, action, origin,
         reason_code, reason_note, actor_id, surface, resume_at)
      values
        (p_account_id, 'brand', p_brand_id, v_brand_name, v_loc, v_action, p_origin,
         case when v_action = 'close' then p_reason_code else null end,
         case when v_action = 'close' then p_reason      else null end,
         p_actor, p_surface,
         case when v_action = 'close' then p_resume_at   else null end);
    exception when others then
      raise warning '_set_brand_closure_core: fallo insertando availability_event: %', sqlerrm;
    end;

    if v_matriculas is null or array_length(v_matriculas, 1) = 0 then
      update location_status_log
         set ok = true,
             error = 'Sin productos por-marca que empujar en este local (todo compartido, sin matricula, o con 86 propio al reabrir)',
             resolved_at = now()
       where id = v_log_id;
    elsif v_secret is null then
      update location_status_log
         set ok = false, error = 'secret availability_dispatch_secret ausente en Vault', resolved_at = now()
       where id = v_log_id;
      raise warning '_set_brand_closure_core: secret ausente en Vault, no se empuja al despachador';
    else
      perform net.http_post(
        url     := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object(
          'Content-Type',                   'application/json',
          'x-availability-dispatch-secret', v_secret
        ),
        body    := jsonb_build_object(
          'account_id',              p_account_id,
          'matriculas',              to_jsonb(v_matriculas),
          'affected_menu_item_ids',  to_jsonb(coalesce(v_ids, array[]::uuid[])),
          'external_location_ids',   to_jsonb(array[]::text[]),
          'location_id',             v_loc,
          'available_until',         p_resume_at,
          'enable',                  (p_mode = 'normal'),
          'reason',                  'manual',
          'location_status_log_id',  v_log_id
        )
      );
    end if;
  end loop;

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode,
                            'locations', v_locales, 'items', v_total);
end;
$function$;

CREATE OR REPLACE FUNCTION public.conta_banco_agregador_despertar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_secreto text;
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 3 then return; end if;
  if not exists (select 1 from public.bank_aggregator_connection where enabled) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-banco-agregador.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-banco-agregador',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;

CREATE OR REPLACE FUNCTION public.conta_diez_despertar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secreto text;
begin
  if not exists (select 1 from public.conta_diez_por_enviar(1)) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-diez-cola.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-diez-cola',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;

CREATE OR REPLACE FUNCTION public.conta_lote_releer_lanzar(p_lote uuid, p_quien_nombre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_l public.supplier_batch; v_id uuid; v_secreto text;
begin
  select * into v_l from public.supplier_batch where id = p_lote;
  if v_l.id is null then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if nullif(trim(coalesce(p_quien_nombre, '')), '') is null then raise exception 'Hay que decir quién la pide.' using errcode = '22023'; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede llamar a conta-lote-releer.' using errcode = '55000';
  end if;
  insert into public.conta_lote_relectura (account_id, batch_id, pedida_por_nombre)
  values (v_l.account_id, v_l.id, trim(p_quien_nombre))
  returning id into v_id;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-lote-releer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := jsonb_build_object('lote', v_l.id, 'relectura', v_id), timeout_milliseconds := 150000);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.conta_recibida_pdf_despertar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secreto text;
begin
  if not exists (select 1 from public.conta_recibida_pdf_por_hacer(1))
     and not exists (select 1 from public.conta_recibida_pdf_por_enlazar(1)) then
    return;
  end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-recibida-pdf.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-recibida-pdf',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;

CREATE OR REPLACE FUNCTION public.conta_recordatorios_despertar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_secreto text;
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 9 then return; end if;
  if not exists (select 1 from public.conta_recordatorios_por_mandar(null, 1)) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-recordatorios.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-recordatorios',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;

CREATE OR REPLACE FUNCTION public.db_health_connection_guard()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_max        int;
  v_total      int;
  v_idle       int;
  v_quien      text;
  v_hace10     int;
  v_secret     text;
  v_killed     int := 0;
  v_lista      text;
begin
  -- Lectura BARATA (no pg_settings: esa vista fue la que tardó 10 s el 13/08).
  v_max := current_setting('max_connections')::int;

  select count(*) filter (where backend_type = 'client backend'),
         count(*) filter (where backend_type = 'client backend' and state = 'idle')
    into v_total, v_idle
  from pg_stat_activity;

  -- ── CAPA 3 · AUTODEFENSA (>90%) ────────────────────────────────────────────
  -- Mata SOLO conexiones ociosas de más de 5 min. NUNCA 'active' (trabajo en curso)
  -- ni 'idle in transaction' (transacción abierta: matarla perdería trabajo).
  -- El pool del cliente reabre solo — es comportamiento estándar de cualquier pool.
  if v_total > 0.90 * v_max then
    with muertas as (
      select pid, coalesce(nullif(application_name,''), '(sin nombre)') as app
      from pg_stat_activity
      where backend_type = 'client backend'
        and state = 'idle'
        and state_change < now() - interval '5 minutes'
        and pid <> pg_backend_pid()
        and coalesce(application_name,'') not in ('pg_cron scheduler','mgmt-api','postgres_exporter')
    ), ejecutado as (
      select app, pg_terminate_backend(pid) as ok from muertas
    )
    select count(*) filter (where ok),
           string_agg(distinct app, ', ')
      into v_killed, v_lista
    from ejecutado;

    if coalesce(v_killed,0) > 0 then
      perform public._queue_system_alert(
        'db-health',
        'AUTODEFENSA: liberadas ' || v_killed || ' conexiones ociosas (' || v_total || '/' || v_max || ')',
        'db_health_connection_guard cerró ' || v_killed || ' conexión(es) en estado idle de más de 5 min '
          || 'al superar el 90% del límite. Origen: ' || coalesce(v_lista,'?') || '.' || chr(10)
          || 'Ninguna conexión activa ni con transacción abierta fue tocada; los pools reabren solos.' || chr(10)
          || 'ESTO ES UN SÍNTOMA: revisar quién está abriendo tantas conexiones.',
        'db-health-autodefensa'
      );
    end if;
  end if;

  -- ── CAPA 1 · AVISO TEMPRANO (65%) o POR TENDENCIA (+10 en 10 min) ──────────
  select total_connections into v_hace10
  from public.db_health_snapshot_log
  where checked_at <= now() - interval '10 minutes'
  order by checked_at desc
  limit 1;

  if v_total > 0.65 * v_max
     or (v_hace10 is not null and v_total - v_hace10 >= 10) then

    -- Antiruido: 15 min, igual que el resto de avisos de db-health.
    if not exists (
      select 1 from public.db_health_alert_log
      where kind = 'db-health-conn-guard' and sent_at >= now() - interval '15 minutes'
    ) then

      -- QUIÉN las consume: sin esto el aviso dice "53/60" y hay que entrar a mirar…
      -- y el 13/08 NO SE PODÍA ENTRAR A MIRAR.
      select string_agg(linea, ' · ' order by n desc)
        into v_quien
      from (
        select coalesce(nullif(application_name,''),'(sin nombre)') || ': ' || count(*)
                 || ' (' || count(*) filter (where state='idle') || ' idle)' as linea,
               count(*) as n
        from pg_stat_activity
        where backend_type = 'client backend'
        group by 1
        order by n desc
        limit 3
      ) t;

      -- ENVÍO DIRECTO, sin pasar por system_alert_queue: el 13/08 el drain también
      -- estaba ahogado (250 fallos) — el aviso de "me quedo sin conexiones" NO puede
      -- depender de otro cron que se ahoga en el mismo momento.
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

      if v_secret is not null then
        perform net.http_post(
          url     := public._project_url() || '/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
          body    := jsonb_build_object(
                       'kind',    'db-health',
                       'subject', 'Conexiones subiendo — ' || v_total || '/' || v_max
                                    || case when v_hace10 is not null then ' (hace 10 min: ' || v_hace10 || ')' else '' end,
                       'message', 'Conexiones de cliente: ' || v_total || ' de ' || v_max
                                    || ' (' || v_idle || ' ociosas).' || chr(10)
                                    || 'Quién: ' || coalesce(v_quien,'?') || chr(10)
                                    || 'Autodefensa a partir de ' || ceil(0.90*v_max) || '. Aviso enviado DIRECTO.'
                     ),
          timeout_milliseconds := 5000
        );
        insert into public.db_health_alert_log (kind, detail)
          values ('db-health-conn-guard', v_total || '/' || v_max || ' — ' || coalesce(v_quien,'?'));
      else
        raise warning 'db_health_connection_guard: sin cron_secret, aviso no enviado (%/%)', v_total, v_max;
      end if;
    end if;
  end if;

exception when others then
  -- Nunca tumbar el cron por un fallo del vigía; dejar rastro (regla: nada de catch mudo).
  raise warning 'db_health_connection_guard: excepcion: %', sqlerrm;
end;
$function$;

CREATE OR REPLACE FUNCTION public.last_catalog_import_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_row    record;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'lastapp_internal_key';
  if v_secret is null then
    raise warning 'last_catalog_import_dispatch: secreto lastapp_internal_key ausente en Vault, no se dispara nada';
    return;
  end if;

  for v_row in
    select distinct ei.account_id, ei.external_org_id
      from public.external_integration ei
      join public.accounts a on a.id = ei.account_id
     where ei.source = 'lastapp'
       and ei.is_active = true
       and ei.ownership_type = 'licensed'
       and ei.external_org_id is not null
       and a.is_internal is not true
       and a.status = 'active'
       and a.suspended_at is null and a.archived_at is null and a.deleted_at is null
  loop
    perform net.http_post(
      url     := public._project_url() || '/functions/v1/lastapp-catalog-import',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_secret),
      body    := jsonb_build_object(
                   'account_id', v_row.account_id,
                   'lastapp_organization_id', v_row.external_org_id),
      timeout_milliseconds := 120000
    );
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.last_catalog_sync_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_row    record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lastapp_internal_key';
  if v_secret is null then
    raise warning 'last_catalog_sync_dispatch: secreto lastapp_internal_key ausente en Vault, no se dispara nada';
    return;
  end if;

  for v_row in
    select distinct account_id, external_org_id
    from public.external_integration
    where source = 'lastapp' and is_active = true
  loop
    perform net.http_post(
      url     := public._project_url() || '/functions/v1/last-catalog-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_secret),
      body    := jsonb_build_object('account_id', v_row.account_id, 'external_org_id', v_row.external_org_id),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.push_location_opening_hours(p_location_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_hours      jsonb;
  v_patch      jsonb;
begin
  select account_id into v_account_id from locations where id = p_location_id;
  if v_account_id is null then
    raise exception 'push_location_opening_hours: local % no encontrado', p_location_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'push_location_opening_hours: sin acceso a la cuenta %', v_account_id;
  end if;

  -- 7 días completos (nombre HubRise), SIEMPRE presentes aunque estén vacíos.
  -- weekday Folvy: 0=domingo..6=sabado (business_hours.weekday).
  with days(weekday, day_name) as (
    values (1, 'monday'), (2, 'tuesday'), (3, 'wednesday'), (4, 'thursday'),
           (5, 'friday'), (6, 'saturday'), (0, 'sunday')
  ),
  slots as (
    select bh.weekday,
           jsonb_agg(
             jsonb_build_object('from', to_char(bh.open_time, 'HH24:MI'), 'to', to_char(bh.close_time, 'HH24:MI'))
             order by bh.open_time
           ) as tramos
    from business_hours bh
    where bh.location_id = p_location_id and bh.brand_id is null
    group by bh.weekday
  )
  select jsonb_object_agg(d.day_name, coalesce(s.tramos, '[]'::jsonb))
    into v_hours
  from days d
  left join slots s on s.weekday = d.weekday;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = p_location_id
  limit 1;

  v_patch := jsonb_build_object('opening_hours', v_hours);

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, surface, set_by)
  values
    (v_account_id, p_location_id, v_ext_loc, 'opening_hours', v_patch, 'web', auth.uid())
  returning id into v_log_id;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: horario guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', p_location_id, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'push_location_opening_hours: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', p_location_id, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := public._project_url() || '/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', p_location_id, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_social_generation(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_secret text;
begin
  if not current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'no autorizado';
  end if;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'offers_agent_secret';
  if v_secret is null then raise exception 'secreto del agente no configurado'; end if;

  perform net.http_post(
    url := public._project_url() || '/functions/v1/social-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', v_secret
    ),
    body := jsonb_build_object('account_id', p_account_id, 'force', true),
    timeout_milliseconds := 20000
  );
end $function$;

CREATE OR REPLACE FUNCTION public.set_location_status_by_token(p_device_token text, p_mode text, p_resume_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device     kds_device;
  v_account_id uuid;
  v_location   uuid;
  v_loc_name   text;
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
  v_action     text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_location_status_by_token: token de dispositivo no válido';
  end if;
  v_account_id := v_device.account_id;
  v_location   := v_device.location_id;
  

  if p_mode not in ('normal', 'busy', 'paused') then
    raise exception 'set_location_status_by_token: mode no válido %', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_location_status_by_token: reason_code no válido %', p_reason_code;
  end if;

  select name into v_loc_name from locations where id = v_location;

  update locations
  set hubrise_status_mode      = p_mode,
      hubrise_status_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      hubrise_status_reason    = case when p_mode = 'normal' then null else p_reason end,
      hubrise_status_set_at    = now(),
      hubrise_status_set_by    = null
  where id = v_location;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = v_location
  limit 1;

  v_patch := jsonb_build_object('order_acceptance', jsonb_strip_nulls(jsonb_build_object(
    'mode', p_mode, 'resume_at', p_resume_at, 'reason', p_reason
  )));

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, v_location, v_ext_loc, 'order_acceptance', v_patch, p_mode, p_resume_at, p_reason, 'tablet', null)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre/apertura.
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'location', v_location, v_loc_name, v_location, v_action, 'cocina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       null, 'tablet',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_location_status_by_token: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: estado guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_location_status_by_token: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := public._project_url() || '/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_location_status(p_location_id uuid, p_mode text, p_resume_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_loc_name   text;
  v_user       uuid := auth.uid();
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
  v_action     text;
begin
  select account_id, name into v_account_id, v_loc_name from locations where id = p_location_id;
  if v_account_id is null then
    raise exception 'set_location_status: local % no encontrado', p_location_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_location_status: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_mode not in ('normal', 'busy', 'paused') then
    raise exception 'set_location_status: mode no válido %', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_location_status: reason_code no válido %', p_reason_code;
  end if;

  update locations
  set hubrise_status_mode      = p_mode,
      hubrise_status_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      hubrise_status_reason    = case when p_mode = 'normal' then null else p_reason end,
      hubrise_status_set_at    = now(),
      hubrise_status_set_by    = v_user
  where id = p_location_id;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = p_location_id
  limit 1;

  v_patch := jsonb_build_object('order_acceptance', jsonb_strip_nulls(jsonb_build_object(
    'mode', p_mode, 'resume_at', p_resume_at, 'reason', p_reason
  )));

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, p_location_id, v_ext_loc, 'order_acceptance', v_patch, p_mode, p_resume_at, p_reason, 'web', v_user)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre/apertura.
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'location', p_location_id, v_loc_name, p_location_id, v_action, 'oficina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       v_user, 'web',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_location_status: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: estado guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', p_location_id, 'mode', p_mode, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_location_status: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', p_location_id, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := public._project_url() || '/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', p_location_id, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_modifier_option_availability_by_token(p_device_token text, p_option_id uuid, p_is_available boolean, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_device kds_device; v_acct uuid; v_clave text; v_mo_acct uuid;
  v_refs text[] := '{}'; v_n int := 0; v_sin_ref int := 0;
  v_sec text; v_r record; v_core jsonb;
BEGIN
  v_device := public.kds_resolve_device(p_device_token);
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'set_modifier_option_availability_by_token: token de dispositivo no valido';
  END IF;
  v_acct := v_device.account_id;

  SELECT mo.account_id, lower(btrim(mo.name)) INTO v_mo_acct, v_clave
    FROM public.modifier_option mo WHERE mo.id = p_option_id;
  IF v_mo_acct IS NULL THEN
    RAISE EXCEPTION 'set_modifier_option_availability_by_token: extra % no encontrado', p_option_id;
  END IF;
  IF v_mo_acct <> v_acct THEN
    RAISE EXCEPTION 'set_modifier_option_availability_by_token: el extra no pertenece a la cuenta del dispositivo';
  END IF;

  -- TODAS LAS COPIAS DEL MISMO EXTRA, POR NOMBRE. Quien agota «Salsa Yogur»
  -- desde la cocina no sabe —ni tiene por que saber— que hay 13 copias
  -- repartidas por marcas y grupos: agotar una sola dejaria las otras doce
  -- vendiendose. Las que no tienen `external_id` no se pueden empujar al
  -- canal, y eso se DEVUELVE en `sin_ref` en vez de callarse (regla 7).
  FOR v_r IN SELECT * FROM public._extras_group_options(v_acct, v_clave)
  LOOP
    IF v_r.external_id IS NULL THEN
      v_sin_ref := v_sin_ref + 1;
      CONTINUE;
    END IF;
    v_core := public._set_modifier_option_availability_core(
      v_r.option_id, p_is_available, v_device.location_id, p_reason,
      p_available_until, p_reason_code, v_acct, NULL, 'cocina', 'tablet');
    v_refs := v_refs || array(SELECT jsonb_array_elements_text(v_core->'option_refs'));
    v_n := v_n + 1;
  END LOOP;

  IF array_length(v_refs, 1) > 0 THEN
    SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets
     WHERE name = 'availability_dispatch_secret';
    IF v_sec IS NOT NULL THEN
      -- UN solo empujon con todos los refs, no uno por copia.
      PERFORM net.http_post(
        url := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_sec),
        body := jsonb_build_object(
          'account_id', v_acct,
          'option_refs', to_jsonb(v_refs),
          'location_id', v_device.location_id,
          'available_until', p_available_until,
          'enable', p_is_available,
          'reason', p_reason));
    ELSE
      RAISE WARNING 'set_modifier_option_availability_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'opciones', v_n, 'refs', COALESCE(array_length(v_refs,1), 0),
    'sin_ref', v_sin_ref, 'location_id', v_device.location_id,
    'dispatched', v_sec IS NOT NULL AND COALESCE(array_length(v_refs,1),0) > 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_modifier_option_availability(p_option_id uuid, p_is_available boolean, p_location_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'stock_out'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_acct   uuid;
  v_clave  text;
  v_res    jsonb;
  v_refs   text[] := '{}';
  v_n      int := 0;
  v_sin    int := 0;
  v_label  text;
  v_r      record;
  v_secret text;
begin
  select account_id, lower(btrim(name)), name
    into v_acct, v_clave, v_label
    from modifier_option where id = p_option_id;
  if v_acct is null then
    raise exception 'set_modifier_option_availability: opcion % no encontrada', p_option_id;
  end if;
  if not (v_acct = any(public.current_user_account_ids())) then
    raise exception 'set_modifier_option_availability: sin acceso a la cuenta %', v_acct;
  end if;
  if p_location_id is not null and not exists (
      select 1 from locations l where l.id = p_location_id and l.account_id = v_acct) then
    raise exception 'set_modifier_option_availability: el local % no es de esta cuenta', p_location_id;
  end if;

  -- (02/09) ALCANCE POR LOCAL, ver current_user_location_ids().
  perform public._assert_location_in_scope(p_location_id, 'set_modifier_option_availability');

  -- TODAS LAS COPIAS DEL MISMO EXTRA, POR NOMBRE (11/09/2026). Las que no
  -- tienen `external_id` no se pueden empujar al canal: se saltan y se cuentan
  -- en `sin_ref` en vez de callarse (regla 7).
  for v_r in select * from public._extras_group_options(v_acct, v_clave)
  loop
    if v_r.external_id is null then
      v_sin := v_sin + 1;
      continue;
    end if;
    v_res := public._set_modifier_option_availability_core(
      v_r.option_id, p_is_available, p_location_id, p_reason, p_available_until,
      p_reason_code, v_acct, auth.uid(), 'oficina', 'web');
    v_refs := v_refs || array(select jsonb_array_elements_text(v_res->'option_refs'));
    v_n := v_n + 1;
  end loop;

  if array_length(v_refs, 1) > 0 then
    select decrypted_secret into v_secret from vault.decrypted_secrets
     where name = 'availability_dispatch_secret';
    if v_secret is not null then
      -- Se manda SOLO option_refs: sin `matriculas`, para que el despachador no
      -- confunda un ref de opcion con un sku de producto. expires_at lo pone el
      -- despachador desde available_until, igual que en los productos.
      perform net.http_post(
        url := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_acct,
          'option_refs', to_jsonb(v_refs),
          'location_id', p_location_id,
          'available_until', p_available_until,
          'enable', p_is_available,
          'reason', p_reason));
    else
      raise warning 'set_modifier_option_availability: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object(
    'label', coalesce(v_label, '(opcion)'),
    'opciones', v_n,
    'option_refs', coalesce(to_jsonb(v_refs), '[]'::jsonb),
    'sin_ref', v_sin,
    'available_until', p_available_until,
    'dispatched', v_secret is not null and coalesce(array_length(v_refs,1),0) > 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_availability_by_token(p_device_token text, p_menu_item_id uuid, p_is_available boolean, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device; v_account_id uuid; v_location_id uuid; v_mi_account uuid;
  v_core jsonb; v_matriculas text[]; v_affected_ids uuid[]; v_brands int;
  v_ext_locs text[]; v_channels int; v_secret text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_product_availability_by_token: token de dispositivo no valido';
  end if;
  v_account_id := v_device.account_id; v_location_id := v_device.location_id;
  

  select mi.account_id into v_mi_account from menu_item mi where mi.id = p_menu_item_id;
  if v_mi_account is null then
    raise exception 'set_product_availability_by_token: producto % no encontrado', p_menu_item_id;
  end if;
  if v_mi_account <> v_account_id then
    raise exception 'set_product_availability_by_token: el producto no pertenece a la cuenta del dispositivo';
  end if;

  v_core := public._set_product_availability_core(
    p_menu_item_id, p_is_available, v_location_id, p_reason, p_available_until, p_reason_code,
    v_account_id, null, 'cocina', 'tablet');
  v_matriculas := array(select jsonb_array_elements_text(v_core->'matriculas'));
  v_affected_ids := array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
  v_brands := coalesce((v_core->>'brands')::int, 0);

  select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel) into v_channels from external_catalog_product ecp
    where ecp.account_id = v_account_id and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'availability_dispatch_secret';
    if v_secret is not null then
      perform net.http_post(
        url := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_account_id, 'matriculas', to_jsonb(v_matriculas),
          'affected_menu_item_ids', to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id', v_location_id, 'available_until', p_available_until,
          'enable', p_is_available, 'reason', p_reason));
    else
      raise warning 'set_product_availability_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object('brands', v_brands, 'channels', coalesce(v_channels, 0),
    'matriculas', coalesce(array_length(v_matriculas, 1), 0), 'location_id', v_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_availability(p_menu_item_id uuid, p_is_available boolean, p_location_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid; v_user uuid := auth.uid(); v_core jsonb; v_matriculas text[];
  v_affected_ids uuid[]; v_brands int; v_ext_locs text[]; v_channels int; v_secret text;
begin
  select mi.account_id into v_account_id from menu_item mi where mi.id = p_menu_item_id;
  if v_account_id is null then
    raise exception 'set_product_availability: producto % no encontrado', p_menu_item_id;
  end if;
  if not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_product_availability: sin acceso a la cuenta %', v_account_id;
  end if;

  -- (02/09) ALCANCE POR LOCAL. Hasta hoy el local era un filtro, no una
  -- autorizacion: un admin acotado podia operar sobre cualquier local de
  -- su cuenta. El criterio sale de current_user_location_ids().
  perform public._assert_location_in_scope(p_location_id, 'set_product_availability');

  v_core := public._set_product_availability_core(
    p_menu_item_id, p_is_available, p_location_id, p_reason, p_available_until, p_reason_code,
    v_account_id, v_user, 'oficina', 'web');
  v_matriculas := array(select jsonb_array_elements_text(v_core->'matriculas'));
  v_affected_ids := array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
  v_brands := coalesce((v_core->>'brands')::int, 0);

  if p_location_id is null then
    select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active;
  else
    select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
      and elm.location_id = p_location_id;
  end if;

  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel) into v_channels from external_catalog_product ecp
    where ecp.account_id = v_account_id and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'availability_dispatch_secret';
    if v_secret is not null then
      perform net.http_post(
        url := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_account_id, 'matriculas', to_jsonb(v_matriculas),
          'affected_menu_item_ids', to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id', p_location_id, 'available_until', p_available_until,
          'enable', p_is_available, 'reason', p_reason));
    else
      raise warning 'set_product_availability: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object('brands', v_brands, 'channels', coalesce(v_channels, 0),
    'matriculas', coalesce(array_length(v_matriculas, 1), 0), 'location_id', p_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_products_availability_bulk_by_token(p_device_token text, p_menu_item_ids uuid[], p_is_available boolean, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device; v_account_id uuid; v_location_id uuid; v_n_found int;
  v_mi uuid; v_core jsonb; v_all_matr text[] := array[]::text[]; v_all_ids uuid[] := array[]::uuid[];
  v_failed jsonb := '[]'::jsonb; v_products_ok int := 0; v_ext_locs text[]; v_channels int; v_secret text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_products_availability_bulk_by_token: token de dispositivo no valido';
  end if;
  v_account_id := v_device.account_id; v_location_id := v_device.location_id;

  if p_menu_item_ids is null or array_length(p_menu_item_ids, 1) is null then
    raise exception 'set_products_availability_bulk_by_token: la seleccion esta vacia';
  end if;
  if array_length(p_menu_item_ids, 1) > 50 then
    raise exception 'set_products_availability_bulk_by_token: maximo 50 productos por operacion (recibidos %)', array_length(p_menu_item_ids, 1);
  end if;
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_products_availability_bulk_by_token: reason no valido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_products_availability_bulk_by_token: reason_code no valido %', p_reason_code;
  end if;

  select count(*) into v_n_found from menu_item
  where id = any(p_menu_item_ids) and account_id = v_account_id;
  if v_n_found <> array_length(p_menu_item_ids, 1) then
    raise exception 'set_products_availability_bulk_by_token: algun producto de la seleccion no existe en esta cuenta';
  end if;

  

  foreach v_mi in array p_menu_item_ids loop
    begin
      v_core := public._set_product_availability_core(
        v_mi, p_is_available, v_location_id, p_reason, p_available_until, p_reason_code,
        v_account_id, null, 'cocina', 'tablet');
      v_all_matr := v_all_matr || array(select jsonb_array_elements_text(v_core->'matriculas'));
      v_all_ids := v_all_ids || array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
      v_products_ok := v_products_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('menu_item_id', v_mi, 'error', sqlerrm);
    end;
  end loop;

  select array_agg(distinct x) into v_all_matr from unnest(v_all_matr) x;
  select array_agg(distinct x) into v_all_ids from unnest(v_all_ids) x;

  select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  if v_all_matr is not null and array_length(v_all_matr, 1) > 0 then
    select count(distinct ecp.external_channel) into v_channels from external_catalog_product ecp
    where ecp.account_id = v_account_id and ecp.organization_product_id::text = any(v_all_matr)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'availability_dispatch_secret';
    if v_secret is not null then
      perform net.http_post(
        url := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_account_id, 'matriculas', to_jsonb(v_all_matr),
          'affected_menu_item_ids', to_jsonb(coalesce(v_all_ids, array[]::uuid[])),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id', v_location_id, 'available_until', p_available_until,
          'enable', p_is_available, 'reason', p_reason));
    else
      raise warning 'set_products_availability_bulk_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object('products', v_products_ok,
    'brands', coalesce((select count(distinct brand_id) from menu_item
                        where id = any(v_all_ids) and account_id = v_account_id), 0),
    'channels', coalesce(v_channels, 0),
    'matriculas', coalesce(v_all_matr, array[]::text[]), 'failed', v_failed);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_products_availability_bulk(p_menu_item_ids uuid[], p_is_available boolean, p_location_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid(); v_account_id uuid; v_n_found int; v_n_mismatch int;
  v_mi uuid; v_core jsonb; v_all_matr text[] := array[]::text[]; v_all_ids uuid[] := array[]::uuid[];
  v_failed jsonb := '[]'::jsonb; v_products_ok int := 0; v_ext_locs text[]; v_channels int; v_secret text;
begin
  if p_menu_item_ids is null or array_length(p_menu_item_ids, 1) is null then
    raise exception 'set_products_availability_bulk: la seleccion esta vacia';
  end if;
  if array_length(p_menu_item_ids, 1) > 50 then
    raise exception 'set_products_availability_bulk: maximo 50 productos por operacion (recibidos %)', array_length(p_menu_item_ids, 1);
  end if;
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_products_availability_bulk: reason no valido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_products_availability_bulk: reason_code no valido %', p_reason_code;
  end if;

  select mi.account_id into v_account_id from menu_item mi where mi.id = p_menu_item_ids[1];
  if v_account_id is null then
    raise exception 'set_products_availability_bulk: producto % no encontrado', p_menu_item_ids[1];
  end if;

  select count(*), count(*) filter (where account_id <> v_account_id) into v_n_found, v_n_mismatch
  from menu_item where id = any(p_menu_item_ids);
  if v_n_found <> array_length(p_menu_item_ids, 1) then
    raise exception 'set_products_availability_bulk: algun producto de la seleccion no existe';
  end if;
  if v_n_mismatch > 0 then
    raise exception 'set_products_availability_bulk: todos los productos deben pertenecer a la misma cuenta';
  end if;

  if not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_products_availability_bulk: sin acceso a la cuenta %', v_account_id;
  end if;

  foreach v_mi in array p_menu_item_ids loop
    begin
      v_core := public._set_product_availability_core(
        v_mi, p_is_available, p_location_id, p_reason, p_available_until, p_reason_code,
        v_account_id, v_user, 'oficina', 'web');
      v_all_matr := v_all_matr || array(select jsonb_array_elements_text(v_core->'matriculas'));
      v_all_ids := v_all_ids || array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
      v_products_ok := v_products_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('menu_item_id', v_mi, 'error', sqlerrm);
    end;
  end loop;

  select array_agg(distinct x) into v_all_matr from unnest(v_all_matr) x;
  select array_agg(distinct x) into v_all_ids from unnest(v_all_ids) x;

  if p_location_id is null then
    select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active;
  else
    select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
      and elm.location_id = p_location_id;
  end if;

  if v_all_matr is not null and array_length(v_all_matr, 1) > 0 then
    select count(distinct ecp.external_channel) into v_channels from external_catalog_product ecp
    where ecp.account_id = v_account_id and ecp.organization_product_id::text = any(v_all_matr)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'availability_dispatch_secret';
    if v_secret is not null then
      perform net.http_post(
        url := public._project_url() || '/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_account_id, 'matriculas', to_jsonb(v_all_matr),
          'affected_menu_item_ids', to_jsonb(coalesce(v_all_ids, array[]::uuid[])),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id', p_location_id, 'available_until', p_available_until,
          'enable', p_is_available, 'reason', p_reason));
    else
      raise warning 'set_products_availability_bulk: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object('products', v_products_ok,
    'brands', coalesce((select count(distinct brand_id) from menu_item
                        where id = any(v_all_ids) and account_id = v_account_id), 0),
    'channels', coalesce(v_channels, 0),
    'matriculas', coalesce(v_all_matr, array[]::text[]), 'failed', v_failed);
end;
$function$;

CREATE OR REPLACE FUNCTION public.system_alert_queue_drain()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row         record;
  v_status_code int;
  v_error_msg   text;
  v_secret      text;
  v_new_request bigint;
  v_to_fire     int;
  v_degraded_n  int;
begin
  -- 3.1) Resolver peticiones en vuelo. FOR UPDATE SKIP LOCKED: si dos
  -- ejecuciones se solapan, la segunda salta las filas en curso.
  for v_row in
    select * from public.system_alert_queue
    where status = 'pending' and request_id is not null
    order by id
    for update skip locked
  loop
    select status_code, error_msg into v_status_code, v_error_msg
    from net._http_response where id = v_row.request_id;

    if found then
      if v_status_code = 200 then
        update public.system_alert_queue
          set status = 'sent', sent_at = now(), request_id = null
          where id = v_row.id;
        -- El antiruido se consume AQUI, con la entrega confirmada.
        if v_row.debounce_kind is not null then
          insert into public.db_health_alert_log (kind, detail)
            values (v_row.debounce_kind, 'entregado por la cola, intento ' || v_row.attempts);
        end if;
      else
        update public.system_alert_queue set
          status     = case when v_row.attempts >= 3 then 'failed' else 'pending' end,
          request_id = null,
          last_error = coalesce('http ' || v_status_code, v_error_msg, 'fallo desconocido')
        where id = v_row.id;
      end if;
    elsif v_row.last_attempt_at < now() - interval '2 minutes' then
      -- pg_net no ha respondido tras 2min. Mismo case: si era el 3er intento,
      -- 'failed' — sin esto se quedaria en limbo permanente.
      update public.system_alert_queue set
        status     = case when v_row.attempts >= 3 then 'failed' else 'pending' end,
        request_id = null,
        last_error = 'sin respuesta de pg_net tras 2min'
      where id = v_row.id;
    end if;
  end loop;

  -- 3.2) Disparar
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  select count(*) into v_to_fire
  from public.system_alert_queue
  where status = 'pending' and request_id is null and attempts < 3;

  if v_secret is null then
    if v_to_fire > 0 then
      raise warning 'system_alert_queue_drain: secret cron_secret ausente en Vault, % aviso(s) sin poder dispararse', v_to_fire;
    end if;
  else
    for v_row in
      select * from public.system_alert_queue
      where status = 'pending' and request_id is null and attempts < 3
      order by id
      for update skip locked
    loop
      select net.http_post(
        url     := public._project_url() || '/functions/v1/system-alert',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body    := jsonb_build_object(
        'subject', v_row.subject, 'message', v_row.message, 'kind', v_row.kind,
        'severity', v_row.severity, 'alerta_id', v_row.id, 'creado_at', v_row.created_at,
        'negocio', (select a.name from public.accounts a where a.id = v_row.account_id),
        -- «Foodint Alcalá» dentro de la cuenta «Foodint» se manda como «Alcalá»,
        -- para que el asunto no diga «[Foodint · Foodint Alcalá]».
        'local', (select case when l.name like a2.name || ' %'
                              then substr(l.name, length(a2.name) + 2)
                              else l.name end
                    from public.locations l
                    left join public.accounts a2 on a2.id = l.account_id
                   where l.id = v_row.location_id),
        'marca', (select b.name from public.brand b where b.id = v_row.brand_id)),
        timeout_milliseconds := 10000
      ) into v_new_request;
      update public.system_alert_queue
        set request_id = v_new_request, attempts = attempts + 1, last_attempt_at = now()
        where id = v_row.id;
    end loop;
  end if;

  delete from public.system_alert_queue
    where status in ('sent', 'failed') and created_at < now() - interval '7 days';

  -- 3.3) Meta-aviso. "Degradado" = al menos un FALLO CONFIRMADO en la ultima
  -- hora (last_error solo se rellena al confirmar un fallo, nunca al disparar).
  select count(*) into v_degraded_n
  from public.system_alert_queue
  where last_error is not null and created_at >= now() - interval '60 minutes';

  if v_degraded_n > 0 then
    raise warning 'system_alert_queue_drain: % aviso(s) sin poder entregarse en la ultima hora — el canal de alertas puede estar caido', v_degraded_n;
    if not exists (
      select 1 from public.system_alert_queue
      where debounce_kind = 'db-health-alert-queue-degraded' and created_at >= now() - interval '60 minutes'
    ) then
      perform public._queue_system_alert(
        'db-health',
        'Canal de alertas degradado — ' || v_degraded_n || ' aviso(s) sin entregar en 1h',
        v_degraded_n || ' aviso(s) llevan en cola sin poder entregarse en la ultima hora (fallo de red/DNS o Resend). '
          || 'Revisa system_alert_queue y los logs de Postgres.',
        'db-health-alert-queue-degraded'
      );
    end if;
  end if;
exception when others then
  raise warning 'system_alert_queue_drain: excepcion no controlada: %', sqlerrm;
  raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_auto_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode     text;
  v_carrier  text;
  v_reason   text;
  v_strategy text;
  v_timeout  int;
  v_courier  uuid;
  v_secret   text;
  v_url      text;
  v_anon     text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bXBuY2hsZ3VpYmNsdnh5eW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzE1NTksImV4cCI6MjA5Mzc0NzU1OX0.v5GsOW5hxwzJZA0z5Le26E9vAWflG1XFZ7ec2hvMphY';
BEGIN
  IF new.service_type = 'own_delivery'
     AND new.order_status = 'accepted'
     AND new.carrier_order_id IS NULL
     AND (tg_op = 'INSERT' OR old.order_status IS DISTINCT FROM new.order_status)
  THEN
    IF EXISTS (SELECT 1 FROM public.delivery_assignment da
               WHERE da.sale_id = new.id AND da.state NOT IN ('failed','canceled')) THEN
      RETURN new;
    END IF;

    SELECT coalesce(l.dispatch_mode,'auto') INTO v_mode
      FROM public.locations l WHERE l.id = new.location_id;
    IF v_mode <> 'auto' THEN RETURN new; END IF;

    SELECT carrier, reason INTO v_carrier, v_reason FROM public.resolve_dispatch(new.id);

    IF v_carrier = 'own_fleet' THEN
      SELECT coalesce(l.assignment_strategy,'broadcast'), coalesce(l.offer_timeout_s,60)
        INTO v_strategy, v_timeout FROM public.locations l WHERE l.id = new.location_id;

      IF v_strategy = 'nearest' THEN
        SELECT c.id INTO v_courier
          FROM public.courier c, public.locations l
         WHERE l.id = new.location_id AND c.account_id = new.account_id AND c.active AND c.on_shift
           AND (c.assigned_locations = '{}'::uuid[] OR new.location_id = ANY(c.assigned_locations))
         ORDER BY (CASE WHEN c.last_lat IS NOT NULL AND c.last_lng IS NOT NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL
                        THEN 2*6371*asin(sqrt(power(sin(radians(c.last_lat - l.lat)/2),2)
                             + cos(radians(l.lat))*cos(radians(c.last_lat))*power(sin(radians(c.last_lng - l.lng)/2),2)))
                        ELSE NULL END) ASC NULLS LAST
         LIMIT 1;
        INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by, offered_to, offer_expires_at)
        VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto', v_courier,
                CASE WHEN v_courier IS NOT NULL THEN now() + make_interval(secs => v_timeout) ELSE NULL END);
      ELSE
        INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by)
        VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto');
      END IF;

    ELSIF v_carrier = 'catcher' THEN
      -- W10: la dirección del propio proyecto, del Vault (project_url). Si
      -- falta, no se llama a nadie y queda dicho en system_alert; el pedido
      -- sigue (este disparador está en el camino del pedido).
      v_url := public._project_url_si_hay();
      IF v_url IS NULL THEN
        PERFORM public._aviso_falta_en_vault('catcher-dispatch', new.id);
        RETURN new;
      END IF;
      v_url := v_url || '/functions/v1/catcher-dispatch';
      SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets WHERE name = 'catcher_dispatch_secret';
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json',
                                      'Authorization', 'Bearer ' || v_anon,
                                      'x-catcher-dispatch-secret', v_secret),
        body    := jsonb_build_object('sale_id', new.id, 'internal', true)
      );
    END IF;
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sale_push_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pushable text[] := array[
    'in_preparation','awaiting_collection','awaiting_shipment',
    'in_delivery','completed','rejected','cancelled','delivery_failed'
  ];
  v_url    text;
  v_secret text;
begin
  -- solo canales con empuje y estados empujables
  if new.source = 'lastapp' and new.order_status = any(v_pushable) then
    -- W10a: el secreto, del Vault (order_advance_secret); ya no va escrito.
    -- Si falta, no se llama a nadie y queda dicho; el pedido sigue.
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'order_advance_secret';
    if v_secret is null then
      begin
        perform public._queue_system_alert(
          'vault',
          'Sin llamar a order-advance: falta order_advance_secret en el Vault',
          format('El pedido %s (estado %s) no ha avisado a order-advance porque el Vault de este proyecto no tiene order_advance_secret. El pedido se ha guardado; el aviso a la plataforma no ha salido.', new.id, new.order_status),
          'vault-order-advance');
      exception when others then
        raise warning 'trg_sale_push_status: falta order_advance_secret y no se pudo avisar (venta %): %', new.id, sqlerrm;
      end;
      return new;
    end if;
    -- W10: la dirección del propio proyecto, del Vault (project_url). Si
    -- falta, no se llama a nadie y queda dicho; el pedido sigue.
    v_url := public._project_url_si_hay();
    if v_url is null then
      perform public._aviso_falta_en_vault('order-advance', new.id);
      return new;
    end if;
    perform net.http_post(
      url     := v_url || '/functions/v1/order-advance',
      headers := jsonb_build_object(
        'Content-Type',            'application/json',
        'x-order-advance-secret',  v_secret
      ),
      body    := jsonb_build_object(
        'sale_id',    new.id,
        'new_status', new.order_status,
        'internal',   true
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verifactu_despertar_cuadre()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_secreto text;
begin
  if not exists (select 1 from public.verifactu_cuadre where entorno = 'real'
                   and (estado = 'pedido' or (estado = 'consultando' and empezado_at < now() - interval '10 minutes'))) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-verifactu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"accion":"cuadre"}'::jsonb, timeout_milliseconds := 150000);
end $function$;

CREATE OR REPLACE FUNCTION public.verifactu_despertar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secreto text;
begin
  if not exists (
    select 1 from public.verifactu_registro r
      left join public.verifactu_flujo f on f.nif_emisor = r.nif_emisor and f.entorno = r.entorno
     where r.entorno = 'real' and r.estado = 'pendiente' and r.proximo_intento_at <= now()
       and (f.ultimo_envio_at is null or f.ultimo_envio_at + make_interval(secs => coalesce(f.tiempo_espera_s, 60)) <= now())
  ) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-verifactu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;

