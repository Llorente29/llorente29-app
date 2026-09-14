-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 `read_apifootball_key` · LA HERMANA DEL MISMO AGUJERO · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Al cerrar `internal_secret` se buscó la CLASE, no el caso: todas las
-- funciones SECURITY DEFINER de `public` que tocan el Vault. Salieron 24, y
-- esta es la otra que DEVUELVE un secreto sin comprobar nada:
--
--     select decrypted_secret from vault.decrypted_secrets
--      where name = 'apifootball_key' limit 1;
--
-- Permisos: anon=X, authenticated=X, postgres=X, service_role=X.
--
-- Misma puerta, un secreto concreto en vez de cualquiera. La clave de
-- API-Football no es la de Instagram, pero se paga igual: es una clave de pago
-- de un tercero y estaba al alcance de cualquiera con la clave anon.
--
-- QUIÉN LA LLAMA: una sola, `supabase/functions/sports-events/index.ts:38`, con
-- un cliente creado con `SUPABASE_SERVICE_ROLE_KEY` (línea 19). En la base: 0
-- funciones, 0 crons, 0 disparadores. En el front: 0 llamadas.
--
-- ── LAS OTRAS 22, QUE NO SE TOCAN, Y POR QUÉ ──────────────────────────────
--
-- Hay más definer con `anon` que tocan el Vault --`set_product_availability`,
-- `set_location_status`, toda la familia `*_by_token` que usan las tablets--
-- pero ésas NO devuelven el secreto: lo LEEN por dentro para llamar a una edge
-- function. Es otra clase de riesgo y quitarles `anon` rompería las tablets.
-- Se quedan como están, MEDIDAS y dichas, no revocadas a bulto.

revoke execute on function public.read_apifootball_key() from public, anon, authenticated;

do $ensayo$
declare v_acl text; v_anon text := 'no probado'; v_srv int;
begin
  begin
    declare v text;
    begin
      set local role anon;
      select public.read_apifootball_key() into v;
      v_anon := 'SIGUE PUDIENDO';
    end;
  exception
    when insufficient_privilege then v_anon := 'sin permiso (42501)';
    when others then v_anon := 'otro error: ' || sqlstate;
  end;
  reset role;

  if v_anon !~ 'sin permiso' then
    raise exception 'anon sigue leyendo la clave de API-Football: %', v_anon;
  end if;

  select case when public.read_apifootball_key() is null then 0 else 1 end into v_srv;
  if v_srv <> 1 then
    raise exception 'se ha roto sports-events: la clave ya no se lee con service_role';
  end if;

  select coalesce((select string_agg(x, ', ' order by x) from unnest(p.proacl::text[]) x), '(por defecto)')
    into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'read_apifootball_key';
  if v_acl <> 'postgres=X/postgres, service_role=X/postgres' then
    raise exception 'los permisos no han quedado como debian: %', v_acl;
  end if;

  raise notice 'ENSAYO OK · anon: % · sports-events sigue leyendo · permisos: %', v_anon, v_acl;
end;
$ensayo$;
