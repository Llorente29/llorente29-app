-- supabase/migrations/20261109T1707_gd_ingresos_gocardless.sql
--
-- GD · El ingreso de cada liquidación del sandbox de GoCardless en el banco de
-- la demo (Julio, nº 47 y nº 50). En QBO, GoCardless junta los cobros de un día
-- en un pago al banco (un «payout») y el banco lo apunta como «TRANSFER
-- INMEDIATA GOCARDLESS SAS». El sandbox no tiene banco: sin este movimiento, la
-- T4 de Code 1 (conta_gc_payout y abonoDeGocardless en lib/conciliacion.ts) no
-- tiene nada que casar en la demo.
--
--   demo_gestoria_ingresos_gocardless(cuenta): SOLO cuentas de demostración y
--   SOLO la plataforma. Por cada liquidación de la sociedad (conta_gc_payout)
--   pagada, en euros, con neto positivo y que ya ha llegado (llegada <= hoy en
--   Madrid), un extracto de un movimiento en su banco por defecto (el de la
--   57200000): el día de llegada, el neto y el concepto de QBO. Así Bancos la
--   casa sola (neto exacto, mismo día y el banco nombra a GoCardless).
--   Repetible: cada liquidación lleva su huella de fichero fija, y un fichero
--   repetido no cambia nada (bank_importar). Las nuevas entran; las de antes no
--   se duplican.
--
--   demo_gestoria_ingresos_gocardless_demos(): la misma, para cada cuenta de
--   demostración con liquidaciones. La llama el cron «gd-ingresos-gocardless»
--   cada 30 minutos (Julio, nº 50: solo en cuentas demo) y la llamará
--   «Volver a empezar». Una cuenta que no es demo no entra nunca: el bucle solo
--   mira is_demo y la función de una cuenta se niega (42501).
--
-- OJO, y va dicho en la tanda: las funciones no las ve el analizador por
-- dentro. Hoy la llamada para «Gestoría Demo» no crea nada (0 liquidaciones
-- leídas el 09/11 a las 16:05 UTC); lo que entre después lo crea el cron, solo
-- en la cuenta demo (regla 9). Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1707_gd_ingresos_gocardless.down.sql

create or replace function public.demo_gestoria_ingresos_gocardless(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_admin uuid; v_soc uuid; v_banco uuid; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_res jsonb; v_nuevos int := 0; v_ya int := 0; r record;
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'GD: % no es una cuenta de demostración: no se siembra nada.', p_cuenta using errcode = '42501';
  end if;
  select user_id into v_admin from public.user_profiles where account_id = p_cuenta and role = 'admin' and active order by created_at limit 1;
  if v_admin is null then return jsonb_build_object('nuevos', 0, 'frase', 'La cuenta demo no tiene administrador: no se apunta ningún ingreso.'); end if;
  select id into v_soc from public.company where account_id = p_cuenta and sector = 'gestoria' and entity_kind = 'company' order by created_at, id limit 1;
  if v_soc is null then return jsonb_build_object('nuevos', 0, 'frase', 'La cuenta demo no tiene una sociedad de Gestoría: no se apunta ningún ingreso.'); end if;
  select id into v_banco from public.treasury_account where account_id = p_cuenta and company_id = v_soc and kind = 'bank' and is_default order by created_at, id limit 1;
  if v_banco is null then return jsonb_build_object('nuevos', 0, 'frase', 'La sociedad demo no tiene banco: no se apunta ningún ingreso.'); end if;

  -- Como el administrador de la cuenta, en la cuenta abierta (DM1: «usuario:cuenta»).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || p_cuenta::text, true);

  for r in select p.gc_id, p.llegada, p.importe from public.conta_gc_payout p
            where p.account_id = p_cuenta and p.company_id = v_soc and p.estado = 'paid' and p.moneda = 'EUR'
              and p.importe > 0 and p.llegada is not null and p.llegada <= v_hoy
            order by p.llegada, p.gc_id loop
    v_res := public.bank_importar(v_banco, 'fichero', 'norma43', 'gd-gocardless-' || r.gc_id || '.n43',
      md5('gd-payout-' || r.gc_id) || md5('gd-payout-' || r.gc_id || '|n43'), r.llegada, r.llegada, null, null,
      'Siembra de la demo: el ingreso de una liquidación del sandbox de GoCardless, que no tiene banco.', null,
      jsonb_build_array(jsonb_build_object('fecha', r.llegada, 'importe', r.importe,
        'concepto_banco', 'TRANSFER INMEDIATA GOCARDLESS SAS', 'concepto_limpio', 'TRANSFER INMEDIATA GOCARDLESS SAS',
        'huella', md5('gd-payout|' || r.gc_id), 'huella_suave', md5('gd-payout-suave|' || r.gc_id))));
    if coalesce((v_res->>'repetido')::boolean, false) then v_ya := v_ya + 1; else v_nuevos := v_nuevos + coalesce((v_res->>'nuevos')::int, 0); end if;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return jsonb_build_object('nuevos', v_nuevos, 'ya_estaban', v_ya, 'frase', case
    when v_nuevos + v_ya = 0 then 'Ninguna liquidación de GoCardless llegada todavía: no hay ingreso que apuntar.'
    else format('Ingresos de GoCardless en el banco de la demo: %s nuevos y %s que ya estaban.', v_nuevos, v_ya) end);
end $$;
comment on function public.demo_gestoria_ingresos_gocardless(uuid) is
  'GD · Apunta en el banco de la sociedad de una cuenta demo de Gestoría el ingreso de cada liquidación de GoCardless ya llegada (día de llegada, neto, «TRANSFER INMEDIATA GOCARDLESS SAS»), una vez cada una. Solo cuentas demo; solo la plataforma.';
revoke all on function public.demo_gestoria_ingresos_gocardless(uuid) from public, anon, authenticated;
grant execute on function public.demo_gestoria_ingresos_gocardless(uuid) to service_role;

create or replace function public.demo_gestoria_ingresos_gocardless_demos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; v_todo jsonb := '[]'::jsonb;
begin
  for r in select a.id from public.accounts a
            where a.is_demo is true and exists (select 1 from public.conta_gc_payout p where p.account_id = a.id)
            order by a.id loop
    v := public.demo_gestoria_ingresos_gocardless(r.id);
    v_todo := v_todo || jsonb_build_object('cuenta', r.id, 'nuevos', v->'nuevos', 'frase', v->>'frase');
  end loop;
  return v_todo;
end $$;
comment on function public.demo_gestoria_ingresos_gocardless_demos() is
  'GD · Cada 30 minutos (cron gd-ingresos-gocardless): el ingreso de las liquidaciones de GoCardless nuevas en el banco de cada cuenta de DEMOSTRACIÓN. Ninguna otra cuenta. Si falla, falla (cron lo apunta), no calla.';
revoke all on function public.demo_gestoria_ingresos_gocardless_demos() from public, anon, authenticated;
grant execute on function public.demo_gestoria_ingresos_gocardless_demos() to service_role;

-- El cron, donde hay pg_cron (en una base local sin él, nada).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('gd-ingresos-gocardless') from cron.job where jobname = 'gd-ingresos-gocardless'$q$;
    execute $q$select cron.schedule('gd-ingresos-gocardless', '*/30 * * * *', 'select public.demo_gestoria_ingresos_gocardless_demos()')$q$;
  end if;
end $$;

-- Y ahora, para «Gestoría Demo».
do $$
declare v jsonb;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo) then
    raise notice 'GD: no está «Gestoría Demo»: no se apunta ningún ingreso.';
    return;
  end if;
  v := public.demo_gestoria_ingresos_gocardless('de000000-0000-4000-8000-0000000000a0');
  raise notice 'GD: %', v->>'frase';
end $$;
