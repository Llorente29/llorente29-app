-- ══════════════════════════════════════════════════════════════════════════
-- Cerrar a `anon` DE VERDAD: revocando también de PUBLIC
-- ══════════════════════════════════════════════════════════════════════════
--
-- ✅ APLICADA el 09/09/2026 por MCP. La base la registró como 20260909085337
-- y el fichero lleva ese nombre (regla 17).
--
-- ⚠️ RECONSTRUCCIÓN. Julio aplicó esta corrección; yo no tengo su texto literal.
-- Este fichero reproduce las sentencias que llevan la base al estado que se ha
-- MEDIDO después, y es idempotente: volver a pasarlo no cambia nada. Si algún
-- día no coincidiera con lo aplicado, manda la base, no este papel.
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────────────────
--
-- La migración anterior (20260909085142) revocaba de `anon` y `authenticated`
-- y NO CERRÓ NADA: 18 de las 21 seguían siendo ejecutables por `anon`.
--
-- El ACL de esta base es `{=X/postgres, postgres=X/postgres, …}`. Esa primera
-- entrada, con el concedido VACÍO, es **PUBLIC**, y PUBLIC incluye a `anon`. En
-- la mayoría de las 21 no había entrada `anon=` que revocar: el permiso venía
-- entero de PUBLIC.
--
-- Es el espejo exacto del fallo de esa misma mañana: entonces se revocó de
-- PUBLIC creyendo que bastaba y hacían falta los nombres; aquí se revocó de los
-- nombres creyendo que bastaba y hacía falta PUBLIC. **Hay que revocar de los
-- tres.**
--
-- ── LO QUE SE MIDIÓ ANTES DE ESCRIBIRLA ───────────────────────────────────
--
-- Que nadie dependa de PUBLIC para llegar a estas funciones:
--   · los 6 del cron ....... `postgres` explícito
--   · los 11 de las edge ... `service_role` explícito
--   · los 3 de pantalla .... `authenticated` explícito
--
-- ── Y UNA CORRECCIÓN DE MI TRIAJE, que habría roto algo ───────────────────
--
-- `claim_promo_push_jobs`, `report_platform_floor` y `report_promo_push_job`
-- NO son «sin llamador conocido». Sus firmas empiezan por `p_secret` y
-- autentican contra `offers_agent_config.push_agent_secret`: son categoría
-- TOKEN, y su llamador está FUERA del repositorio (el agente de promociones,
-- con su llave). **Revocarlas habría roto el agente.** La prueba estaba en la
-- firma —`claim_promo_push_jobs(text, text, integer)`— y no la miré: busqué el
-- llamador en `src/` y en las edge, no lo encontré, y concluí «no lo llama
-- nadie» en vez de «no lo llama nada de lo que he mirado».
--
-- ── LO QUE SIGUE ABIERTO A PROPÓSITO ──────────────────────────────────────
--
--   place_shop_order, register_shop_consent .... la tienda funciona sin login
--                                                (decisión de Julio)
--   las 3 del agente de promos ................. camino externo con llave
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── GRUPO 1 · sólo cron (postgres conserva su EXECUTE explícito) ──────────
revoke execute on function public.db_health_connection_guard()            from public, anon, authenticated;
revoke execute on function public.dispatch_watchdog_scan(integer)         from public, anon, authenticated;
revoke execute on function public.reparto_award_quests()                  from public, anon, authenticated;
revoke execute on function public.reparto_reoffer()                       from public, anon, authenticated;
revoke execute on function public.reparto_weather_apply()                 from public, anon, authenticated;
revoke execute on function public.reparto_weather_poll()                  from public, anon, authenticated;

-- ── GRUPO 2 · sólo edge functions (service_role conserva su EXECUTE) ──────
revoke execute on function public.adapt_hubrise_order(uuid)               from public, anon, authenticated;
revoke execute on function public.adapt_lastapp_order(uuid)               from public, anon, authenticated;
revoke execute on function public.cancel_sale(uuid, text)                 from public, anon, authenticated;
revoke execute on function public.close_sale(uuid)                        from public, anon, authenticated;
revoke execute on function public.compliance_doc_mark_expired()           from public, anon, authenticated;
revoke execute on function public.create_platform_admin_tx(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.customer_request_login(text, text)      from public, anon, authenticated;
revoke execute on function public.customer_verify_login(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.enqueue_clockout_reminders()            from public, anon, authenticated;
revoke execute on function public.reprocess_sale(uuid)                    from public, anon, authenticated;
revoke execute on function public.retire_stale_agent_shop_offers(uuid)    from public, anon, authenticated;

-- ── GRUPO 3 · sólo otras funciones SQL ────────────────────────────────────
revoke execute on function public.auto_link_goods_receipt_to_order(uuid)  from public, anon, authenticated;

-- ── GRUPO 4 · pantalla de gestión: fuera PUBLIC y anon, se queda authenticated ─
revoke execute on function public.apply_invoice_costs(uuid)               from public, anon;
revoke execute on function public.compute_sale_line_cost(uuid)            from public, anon;
revoke execute on function public.run_invoice_match(uuid)                 from public, anon;
grant  execute on function public.apply_invoice_costs(uuid)               to authenticated;
grant  execute on function public.compute_sale_line_cost(uuid)            to authenticated;
grant  execute on function public.run_invoice_match(uuid)                 to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN CON LA VARA BUENA: has_function_privilege, no el texto del ACL
-- ══════════════════════════════════════════════════════════════════════════
do $verif$
declare
  r record; v_mal text := '';
begin
  -- 1) Ninguna de las 21 alcanzable por anon.
  for r in
    select p.oid, p.oid::regprocedure::text firma
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any (array[
       'db_health_connection_guard','dispatch_watchdog_scan','reparto_award_quests',
       'reparto_reoffer','reparto_weather_apply','reparto_weather_poll',
       'adapt_hubrise_order','adapt_lastapp_order','cancel_sale','close_sale',
       'compliance_doc_mark_expired','create_platform_admin_tx','customer_request_login',
       'customer_verify_login','enqueue_clockout_reminders','reprocess_sale',
       'retire_stale_agent_shop_offers','auto_link_goods_receipt_to_order',
       'apply_invoice_costs','compute_sale_line_cost','run_invoice_match'])
  loop
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      v_mal := v_mal || r.firma || ' ';
    end if;
  end loop;
  if v_mal <> '' then
    raise exception 'ABORTA: anon SIGUE pudiendo ejecutar: %', v_mal;
  end if;

  -- 2) Y no se ha cerrado de mas: los que las usan siguen pudiendo.
  for r in
    select p.oid, p.oid::regprocedure::text firma, p.proname
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any (array[
       'adapt_hubrise_order','adapt_lastapp_order','cancel_sale','close_sale',
       'create_platform_admin_tx','customer_request_login','customer_verify_login',
       'reprocess_sale','retire_stale_agent_shop_offers','compliance_doc_mark_expired',
       'enqueue_clockout_reminders'])
  loop
    if not has_function_privilege('service_role', r.oid, 'EXECUTE') then
      raise exception 'ABORTA: % se ha quedado sin service_role y su edge function dejaria de funcionar.', r.firma;
    end if;
  end loop;

  for r in
    select p.oid, p.oid::regprocedure::text firma
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any (array[
       'apply_invoice_costs','compute_sale_line_cost','run_invoice_match'])
  loop
    if not has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'ABORTA: % se ha quedado sin authenticated y su pantalla dejaria de funcionar.', r.firma;
    end if;
  end loop;

  -- 3) Y lo que debe seguir abierto, sigue abierto.
  for r in
    select p.oid, p.oid::regprocedure::text firma
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any (array[
       'place_shop_order','register_shop_consent',
       'claim_promo_push_jobs','report_platform_floor','report_promo_push_job'])
  loop
    if not has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'ABORTA: % era camino publico a proposito y se ha cerrado.', r.firma;
    end if;
  end loop;

  raise notice 'OK: 21 cerradas a anon (medido con has_function_privilege), y los caminos publicos intactos.';
end
$verif$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- MEDIDO DESPUÉS DE APLICAR (regla 5)
-- ══════════════════════════════════════════════════════════════════════════
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') as srole
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in (…);
--
--   · de las 21: 0 ejecutables por anon
--   · las 26 (21 + las 5 abiertas a proposito): service_role puede las 26
--   · SECURITY DEFINER que escriben y alcanza anon: 138 -> 121
-- ══════════════════════════════════════════════════════════════════════════
