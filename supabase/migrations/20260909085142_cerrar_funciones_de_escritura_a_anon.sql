-- ══════════════════════════════════════════════════════════════════════════
-- Cerrar a `anon` las funciones que escriben y no son camino público
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ APLICADA el 09/09/2026 como 20260909085142 — Y NO CERRÓ NADA.
--
-- Este fichero se queda TAL CUAL, con su error dentro. Lo arregla el siguiente
-- (20260909085337), no se reescribe aquí: corregirlo en el sitio dejaría el repo
-- diciendo que salió bien.
--
-- ── LO QUE FALLÓ, Y ES EL ESPEJO DEL FALLO DE ESTA MAÑANA ─────────────────
--
-- El ACL de esta base es `{=X/postgres, postgres=X/postgres, service_role=X/postgres}`.
-- Esa primera entrada, con el concedido VACÍO, es **PUBLIC** — y PUBLIC incluye
-- a `anon`. En la mayoría de las 21 NO HABÍA ninguna entrada `anon=` que
-- revocar: el acceso venía entero de PUBLIC. Así que estos `REVOKE … FROM anon`
-- no quitaron nada, y 18 de las 21 seguían siendo ejecutables por `anon`.
--
-- ── Y POR QUÉ MI VERIFICACIÓN DIJO OK ─────────────────────────────────────
--
-- Porque miraba `proacl::text like '%anon=%'`. **Un ACL sin `anon=` no dice que
-- anon no pueda; dice que no tiene entrada propia.** Comprobé la forma del
-- texto en vez del permiso efectivo, que es lo único que decide.
--
-- Esta mañana escribí `REVOKE … FROM public` creyendo que bastaba, y hacía
-- falta nombrar a anon y authenticated. Aquí nombré a anon y authenticated
-- creyendo que bastaba, y hacía falta PUBLIC. La misma suposición, del revés,
-- el mismo día. Lo cazó Julio comprobando el permiso efectivo después de
-- aplicar.
--
-- ── LA RECETA, para que no haya tercera vez ───────────────────────────────
--
--   revoke execute on function public.<fn>(<firma>) from public, anon, authenticated;
--
--   y verificar SIEMPRE con has_function_privilege('anon', oid, 'EXECUTE'),
--   NUNCA con el texto del ACL.
--
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────
--
-- De las 560 funciones `SECURITY DEFINER` nuestras, 301 las puede llamar `anon`
-- y **138 de ésas ESCRIBEN**. Clasificadas por cerrojo (resolviendo los
-- ayudantes a DOS niveles, que es lo que hay en esta base):
--
--   86  cerrojo de SESIÓN (acaban en auth.uid()) ....... bien, no se tocan aquí
--   26  token en la firma (tablet/repartidor/cliente) .. camino público con llave
--   26  ninguna de las dos ............................. las de este fichero
--
-- Las 26 se triaron por QUIÉN LAS LLAMA, medido en `cron.job`, en `src/` y en
-- `supabase/functions/`. Esta migración cierra las que no admiten discusión.
--
-- ── LO QUE ESTE FICHERO REVOCA, Y POR QUÉ CADA GRUPO ──────────────────────
--
-- GRUPO 1 · Las llama un CRON y nadie más (6). El cron corre como `postgres`,
-- que conserva su EXECUTE. Ninguna pantalla las toca.
--
-- GRUPO 2 · Las llama una EDGE FUNCTION y nadie más (11). Las edge usan la
-- clave `service_role`, que conserva su EXECUTE. Aquí entran las dos del login
-- de la tienda: `customer_request_login` y `customer_verify_login` NO las llama
-- el navegador — las llama `shop-customer-auth`. El cliente habla con la edge,
-- no con la RPC.
--
-- GRUPO 3 · Sólo la llaman otras funciones SQL (1). Nadie desde fuera.
--
-- GRUPO 4 · Las llama una PANTALLA de gestión (3). Se revoca `anon` y se
-- CONSERVA `authenticated`: quien las usa está identificado.
--
-- ── LO QUE NO TOCA, Y ES DELIBERADO ───────────────────────────────────────
--
-- `place_shop_order` y `register_shop_consent` las llama el navegador en la
-- tienda pública, sin sesión. **Son decisión de negocio de Julio**, no de esta
-- migración: si la tienda debe seguir funcionando sin login, `anon` se queda.
--
-- Y tres sin llamador conocido —`claim_promo_push_jobs`, `report_platform_floor`,
-- `report_promo_push_job`—: no aparecen en cron, ni en `src/`, ni en las edge.
-- No puedo demostrar que NADIE las llame (podría hacerlo algo de fuera del
-- repositorio), así que van en un bloque aparte, comentado. Descomentarlo es
-- decisión de quien sepa si se usan.
--
-- ── EL CASO QUE MERECE PÁRRAFO PROPIO ─────────────────────────────────────
--
-- `create_platform_admin_tx` es la única cuyo cerrojo mira un PARÁMETRO y no la
-- sesión: comprueba `_user_can_manage_admins(p_created_by)`, o sea sobre el
-- usuario que el llamador DICE ser. Y **no se puede cambiar a cerrojo de
-- sesión**: la llama la edge `create-platform-admin` con `service_role`, donde
-- `auth.uid()` es NULL; el `p_created_by` lo extrae la edge del JWT de quien
-- llama, y ahí es donde está la autenticación de verdad.
--
-- O sea que el diseño es correcto **a condición de que sólo la edge pueda
-- llamarla**. Hoy puede llamarla `anon`, y entonces el cerrojo es «dime el uuid
-- de alguien que pueda gestionar admins». Su arreglo es esta revocación, no
-- tocar la función. Va en el GRUPO 2.
--
-- ── REVERSIBLE ────────────────────────────────────────────────────────────
--
--   grant execute on function public.<la que sea>(...) to anon, authenticated;
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── Guarda: que sigan siendo las que se midieron ──────────────────────────
do $guarda$
declare
  v_falta text;
begin
  select string_agg(f, ', ') into v_falta
  from unnest(array[
    'db_health_connection_guard','dispatch_watchdog_scan','reparto_award_quests',
    'reparto_reoffer','reparto_weather_apply','reparto_weather_poll',
    'adapt_hubrise_order','adapt_lastapp_order','cancel_sale','close_sale',
    'compliance_doc_mark_expired','create_platform_admin_tx','customer_request_login',
    'customer_verify_login','enqueue_clockout_reminders','reprocess_sale',
    'retire_stale_agent_shop_offers','auto_link_goods_receipt_to_order',
    'apply_invoice_costs','compute_sale_line_cost','run_invoice_match']) f
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = f);
  if v_falta is not null then
    raise exception 'ABORTA: estas funciones ya no existen: %. La base ha cambiado desde la medicion.', v_falta;
  end if;
end
$guarda$;

-- ── GRUPO 1 · sólo cron ───────────────────────────────────────────────────
revoke execute on function public.db_health_connection_guard()  from anon, authenticated;
revoke execute on function public.dispatch_watchdog_scan(p_grace_minutes integer)      from anon, authenticated;
revoke execute on function public.reparto_award_quests()        from anon, authenticated;
revoke execute on function public.reparto_reoffer()             from anon, authenticated;
revoke execute on function public.reparto_weather_apply()       from anon, authenticated;
revoke execute on function public.reparto_weather_poll()        from anon, authenticated;

-- ── GRUPO 2 · sólo edge functions (service_role conserva EXECUTE) ─────────
revoke execute on function public.adapt_hubrise_order(p_sale_id uuid)            from anon, authenticated;
revoke execute on function public.adapt_lastapp_order(p_sale_id uuid)            from anon, authenticated;
revoke execute on function public.cancel_sale(p_sale_id uuid, p_reason text)              from anon, authenticated;
revoke execute on function public.close_sale(p_sale_id uuid)                     from anon, authenticated;
revoke execute on function public.compliance_doc_mark_expired()        from anon, authenticated;
revoke execute on function public.create_platform_admin_tx(p_user_id uuid, p_full_name text, p_role text, p_created_by uuid) from anon, authenticated;
revoke execute on function public.customer_request_login(p_slug text, p_email text)   from anon, authenticated;
revoke execute on function public.customer_verify_login(p_slug text, p_email text, p_code text, p_ttl_days integer) from anon, authenticated;
revoke execute on function public.enqueue_clockout_reminders()         from anon, authenticated;
revoke execute on function public.reprocess_sale(p_sale_id uuid)                 from anon, authenticated;
revoke execute on function public.retire_stale_agent_shop_offers(p_account_id uuid)     from anon, authenticated;

-- ── GRUPO 3 · sólo la llaman otras funciones SQL ──────────────────────────
revoke execute on function public.auto_link_goods_receipt_to_order(p_receipt_id uuid) from anon, authenticated;

-- ── GRUPO 4 · pantalla de gestión: fuera anon, se queda authenticated ─────
revoke execute on function public.apply_invoice_costs(p_invoice_id uuid)      from anon;
revoke execute on function public.compute_sale_line_cost(p_sale_line_id uuid)         from anon;
revoke execute on function public.run_invoice_match(p_invoice_id uuid)        from anon;

-- ── SIN LLAMADOR CONOCIDO — descomentar sólo si se confirma que no se usan ─
-- revoke execute on function public.claim_promo_push_jobs(integer)  from anon, authenticated;
-- revoke execute on function public.report_platform_floor(...)      from anon, authenticated;
-- revoke execute on function public.report_promo_push_job(...)      from anon, authenticated;

-- ── Verificación: el estado FINAL, no que los REVOKE se ejecutaran ────────
do $verif$
declare
  r record; v_mal text := '';
begin
  for r in
    select p.proname, p.proacl::text acl
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
    if r.acl like '%anon=%' then
      v_mal := v_mal || r.proname || ' (' || r.acl || ') ';
    end if;
  end loop;
  if v_mal <> '' then
    raise exception 'ABORTA: siguen con permisos para anon: %', v_mal;
  end if;

  -- Y que no se haya cerrado de mas: service_role tiene que poder seguir.
  for r in
    select p.proname, p.proacl::text acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any (array[
       'adapt_hubrise_order','adapt_lastapp_order','cancel_sale','close_sale',
       'create_platform_admin_tx','customer_request_login','customer_verify_login',
       'reprocess_sale','retire_stale_agent_shop_offers'])
  loop
    if r.acl not like '%service_role=X%' then
      raise exception 'ABORTA: % se ha quedado sin service_role y su edge function dejaria de funcionar. ACL: %', r.proname, r.acl;
    end if;
  end loop;

  raise notice 'OK: 21 funciones cerradas a anon, y las 9 que usan las edge conservan service_role.';
end
$verif$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- QUÉ MIRAR DESPUÉS — y qué se rompería si me he equivocado
-- ══════════════════════════════════════════════════════════════════════════
--
-- Si alguna de estas 21 la llamaba algo que no encontré, fallará con
-- «permission denied for function …», que es un error ruidoso y localizado, no
-- un dato mal escrito. Y se deshace con un GRANT de una línea.
--
--   select proname, proacl::text from pg_proc p
--     join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and proname in (...)
--    order by 1;
--
-- Lo que NO cierra este fichero, y espera decisión:
--   · place_shop_order, register_shop_consent  → ¿la tienda sin login?
--   · claim_promo_push_jobs, report_platform_floor, report_promo_push_job
--     → ¿se usan desde algo fuera del repositorio?
-- ══════════════════════════════════════════════════════════════════════════
