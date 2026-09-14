-- ═══════════════════════════════════════════════════════════════════════════
-- LA FICHA DEJA DE MANDAR EL `ig_user_id` · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- En `src/modules/social/lib/laFichaDeLaCuenta.ts` escribí, de mi puño:
--
--     «Los identificadores no salen: el `ig_user_id` no le dice nada a nadie.»
--
-- Y era mentira. Se comprobó llamando a la RPC de verdad: venía
-- `"usuario": "17841450632305123"`. La pantalla no lo pinta --`CuentaDeRed` ni
-- siquiera tiene ese campo-- así que viajaba al navegador para que el front lo
-- tirara a la basura.
--
-- No es un secreto: el `ig_user_id` es público en Instagram, y esto NO es un
-- agujero. Es un fichero que dice una cosa y un código que hace otra, que es la
-- familia de la regla 30: lo caro no es el dato, es que quien lea el comentario
-- se fíe de él.
--
-- Se quita del payload. Lo que sí sale y tiene que salir sigue igual: el NOMBRE
-- de la llave en el Vault, que no es secreto y es lo que hace falta para ir a
-- renovarla.
--
-- LA BANDA, CONTADA: a esta RPC la llaman 0 funciones, 0 crons y 0 disparadores
-- --la llama el navegador--. No está en el camino del pedido y un
-- CREATE OR REPLACE de función no toma cierre sobre ninguna tabla.
-- Permisos ANTES: authenticated=X, postgres=X, service_role=X. CREATE OR
-- REPLACE los conserva, y se comprueba abajo.

create or replace function public.social_estado_de_la_cuenta(p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'red',            sa.network,
           'enlazada',       (sa.link_status = 'linked'),
           'enlazada_el',    sa.config->>'linked_at',
           -- Nunca la llave. Solo su NOMBRE en el Vault, que no es un secreto
           -- y es lo que hace falta para ir a renovarla.
           --
           -- Y tampoco el `ig_user_id` (14/09): no lo pinta nadie, y mandarlo
           -- al navegador para tirarlo desmentía el comentario del fichero de
           -- la ficha, que decia que los identificadores no salen.
           'llave_nombre',   sa.config->>'token_vault_name',
           'llave_ok_at',    sa.llave_ok_at,
           'llave_fallo_at', sa.llave_fallo_at,
           'llave_fallo_clase', sa.llave_fallo_clase,
           'llave_caduca_el',   sa.llave_caduca_el,
           -- Se cuentan aqui para que la pantalla no tenga que restar fechas:
           -- una cuenta hecha en dos sitios se despega en uno de los dos.
           'dias_para_caducar', case when sa.llave_caduca_el is null then null
                                     else (sa.llave_caduca_el::date - current_date) end,
           -- Lo ultimo que se publico de verdad. Es la otra mitad de la prueba:
           -- una llave «sin fallos» que no ha publicado nunca no dice nada.
           'ultima_publicacion', (
             select max(sp.published_at) from social_post sp
              where sp.account_id = p_account and sp.social_account_id = sa.id
                and sp.status = 'published')
         ) order by sa.network), '[]'::jsonb)
    into v
    from social_account sa
   where sa.account_id = p_account;

  return jsonb_build_object('cuentas', v);
end;
$fn$;

-- ── ENSAYO · contra la cuenta REAL, y comprobando las dos cosas: que el
--    identificador ya no sale, y que la llave sigue sin salir (que era la
--    aserción de ayer y no se toca).
do $ensayo$
declare v_res jsonb; v_acl text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}', true);

  select public.social_estado_de_la_cuenta('51ad1792-6629-4ef7-833a-b57b09a86710') into v_res;

  if v_res::text ~ '(IG|EAA)[A-Za-z0-9_-]{20,}' then
    raise exception 'LA LLAVE SE HA COLADO EN LA FICHA';
  end if;
  if v_res::text ~ '"usuario"' then
    raise exception 'el identificador sigue saliendo: %', v_res;
  end if;
  if v_res::text !~ 'ig_token_foodint' then
    raise exception 'se ha ido tambien el nombre del Vault, que SI tiene que salir: %', v_res;
  end if;
  if jsonb_array_length(v_res->'cuentas') <> 3 then
    raise exception 'deberian salir las 3 redes y salen %', jsonb_array_length(v_res->'cuentas');
  end if;

  select coalesce((select string_agg(x, ', ' order by x) from unnest(p.proacl::text[]) x), '(por defecto)')
    into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'social_estado_de_la_cuenta';
  if v_acl <> 'authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres' then
    raise exception 'los permisos de la ficha han cambiado: %', v_acl;
  end if;

  raise notice 'ENSAYO OK · sin llave, sin identificador, con nombre de Vault, 3 redes, permisos iguales';
end;
$ensayo$;
