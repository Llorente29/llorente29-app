-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 `internal_secret` ESTABA ABIERTA A CUALQUIERA · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Apareció buscando dónde escribir la llave renovada de Meta (#30), o sea
-- mirando el Vault desde el lado de quién puede leerlo.
--
-- ── QUÉ ERA ───────────────────────────────────────────────────────────────
--
--     create function public.internal_secret(p_name text) returns text
--     security definer
--     as 'select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1';
--
-- Devuelve CUALQUIER secreto del Vault, por nombre, sin comprobar nada. Y sus
-- permisos eran:
--
--     anon=X/postgres, authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres
--
-- `anon` es la clave pública: viaja en el paquete de JavaScript de la web,
-- porque ese es su trabajo. Vive en el navegador de cualquiera que abra Folvy.
-- Y `public.internal_secret` la publica PostgREST como RPC.
--
-- O sea: quien abriera Folvy, cogiera la clave anon del JS y llamara a
--
--     POST /rest/v1/rpc/internal_secret   {"p_name":"ig_token_foodint"}
--
-- se llevaba la llave de Instagram en claro. Y con ella `cron_secret`,
-- `google_ai_key`, `catcher_dispatch_secret`, `order_advance_secret`, los
-- escritores de HubRise de las dos cuentas y las credenciales de conector.
-- Los QUINCE secretos, uno por uno, sabiendo sólo el nombre.
--
-- ── MEDIDO, NO SUPUESTO (regla 5) ─────────────────────────────────────────
--
-- Se probó COMO anon de verdad --`set local role anon`, no simulando la claim--
-- llamando a `internal_secret('ig_token_foodint')`. Devolvió una cadena de
-- longitud 187 con forma de llave de Meta. No se imprimió el valor: solo si
-- vino algo, cuánto medía y si tenía pinta de llave.
--
-- ── QUIÉN LA LLAMA DE VERDAD ──────────────────────────────────────────────
--
--   · en la base:            0 funciones, 0 crons, 0 disparadores
--   · en el front (`src/`):  0 llamadas. Sólo aparece el tipo generado en
--                            `database.ts`, que no llama a nada.
--   · en las edge functions: UNA, `catcher-dispatch/index.ts:359`, que lee
--                            `catcher_dispatch_secret` con un cliente creado
--                            con `serviceKey` (línea 343).
--
-- Así que quitarle `anon` y `authenticated` no rompe nada: el único que la usa
-- entra por `service_role`, que se queda.
--
-- ── LA BANDA ──────────────────────────────────────────────────────────────
--
-- Un REVOKE sobre una función no toma cierre sobre ninguna tabla, y no cambia
-- nada para `service_role`, que es por donde pasa el camino del pedido
-- (`catcher-dispatch`). Y esto es un agujero abierto AHORA MISMO: esperar a las
-- 23:45 son once horas más con la llave de Instagram al alcance de cualquiera.

revoke execute on function public.internal_secret(text) from public, anon, authenticated;

-- ── ENSAYO · por los dos lados, con la misma vara ─────────────────────────
do $ensayo$
declare
  v_acl  text;
  v_anon text := 'no probado';
  v_srv  int;
begin
  -- 1 · anon ya NO puede.
  begin
    declare v text;
    begin
      set local role anon;
      select public.internal_secret('ig_token_foodint') into v;
      v_anon := 'SIGUE PUDIENDO';
    end;
  exception
    when insufficient_privilege then v_anon := 'sin permiso (42501), que es lo que se busca';
    when others then v_anon := 'otro error: ' || sqlstate;
  end;
  reset role;

  if v_anon !~ 'sin permiso' then
    raise exception 'anon sigue pudiendo leer el Vault: %', v_anon;
  end if;

  -- 2 · ...y el único que la usa de verdad SÍ. Se comprueba que vuelve algo,
  --     nunca QUÉ vuelve.
  select case when public.internal_secret('catcher_dispatch_secret') is null then 0 else 1 end
    into v_srv;
  if v_srv <> 1 then
    raise exception 'se ha roto el camino de catcher-dispatch: el secreto ya no se lee';
  end if;

  -- 3 · y los permisos quedan EXACTAMENTE en los dos que tienen que quedar.
  select coalesce((select string_agg(x, ', ' order by x) from unnest(p.proacl::text[]) x), '(por defecto)')
    into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'internal_secret';

  if v_acl <> 'postgres=X/postgres, service_role=X/postgres' then
    raise exception 'los permisos no han quedado como debian: %', v_acl;
  end if;

  raise notice 'ENSAYO OK · anon: % · catcher sigue leyendo · permisos: %', v_anon, v_acl;
end;
$ensayo$;
