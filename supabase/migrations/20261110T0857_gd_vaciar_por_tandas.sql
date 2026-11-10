-- supabase/migrations/20261110T0857_gd_vaciar_por_tandas.sql
--
-- GD · «Volver a empezar», la parte de Sumied, POR TANDAS (Julio, nº84).
--
-- La 1731 vaciaba la demo entera en una sola llamada. La base corta cualquier
-- llamada de la plataforma a los 8 segundos (statement_timeout del
-- authenticator), y el 10/11 a las 07:48 UTC pasó de 8: «canceling statement
-- due to statement timeout». El 06:49 había tardado unos 6. No puede depender
-- de la suerte.
--
--   demo_gestoria_volver_a_empezar_tanda(cuenta, ms): SOLO cuentas demo y SOLO
--   la plataforma. Cada llamada es una transacción y hace como mucho lo que
--   cabe en `ms` milisegundos:
--     · si a la cuenta le queda algo de lo que nace del uso (todo menos
--       _gd_se_queda), borra tabla a tabla hasta que se acaba el tiempo y
--       contesta {sigue: true};
--     · si ya no le queda nada, vuelve a sembrar la contabilidad y el banco y
--       contesta {sigue: false} con su frase.
--   La función conta-gd-volver-a-empezar la vuelve a llamar mientras diga
--   «sigue», igual que el portal de pruebas.
--   Si una llamada no consigue borrar nada y aún queda algo (una clave ajena
--   que no deja), para y dice qué tablas se resisten y por qué.
--
-- Ya no es todo o nada entre llamadas: si una tanda falla, la demo queda a
-- medio vaciar, y volver a pulsar sigue desde ahí (cada borrado es repetible).
-- Dentro de cada llamada, cada tabla va en su subtransacción, como en la 1731.
--
-- Solo AÑADE una función: la 1731 (demo_gestoria_volver_a_empezar) se queda
-- como está; la deja de llamar la función de la rama y se quitará en otra
-- tanda, cuando lo publicado ya no la use (dos pasos).
--
-- OJO, y va dicho en la tanda: el analizador no ve dentro de las funciones. La
-- migración no la llama: solo se ejecuta cuando el administrador de una demo
-- pulsa «Volver a empezar». No toca ninguna otra cuenta (regla 9): cada
-- borrado lleva account_id = la cuenta demo. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0857_gd_vaciar_por_tandas.down.sql

create or replace function public.demo_gestoria_volver_a_empezar_tanda(p_cuenta uuid, p_ms int default 4000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_hasta timestamptz := clock_timestamp() + make_interval(secs => greatest(coalesce(p_ms, 4000), 0) / 1000.0);
  v_admin uuid; v_tabla text; v_n bigint; v_en_pasada bigint; v_total bigint := 0;
  v_tablas text[]; v_con_filas text[] := '{}'; v_fallos jsonb := '{}'::jsonb; v_quedan text[] := '{}';
  v_cont jsonb; v_banco jsonb; v_corto boolean := false;
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'GD: % no es una cuenta de demostración: no se toca nada.', p_cuenta using errcode = '42501';
  end if;
  select user_id into v_admin from public.user_profiles where account_id = p_cuenta and role = 'admin' and active order by created_at limit 1;
  if v_admin is null then raise exception 'GD: la cuenta demo no tiene administrador: no se vuelve a empezar.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gd_volver_a_empezar:' || p_cuenta::text, 0));

  select array_agg(c.table_name::text order by c.table_name) into v_tablas
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'account_id' and c.table_name <> all (public._gd_se_queda());

  -- ¿Qué le queda a la cuenta?
  foreach v_tabla in array v_tablas loop
    execute format('select exists (select 1 from public.%I where account_id = $1)', v_tabla) using p_cuenta into v_corto;
    if v_corto then v_con_filas := array_append(v_con_filas, v_tabla); end if;
  end loop;

  if cardinality(v_con_filas) = 0 then
    -- Ya no queda nada: las siembras que no dependen de lo leído (la tarifa y los ingresos van después de leer).
    v_cont := public.demo_gestoria_contabilidad_sembrar(p_cuenta);
    v_banco := public.demo_gestoria_banco_sembrar(p_cuenta);
    return jsonb_build_object('sigue', false, 'filas', 0,
      'frase', format('Vaciada la demo. %s %s', v_cont->>'frase', v_banco->>'frase'));
  end if;

  -- Como el administrador de la cuenta, en la cuenta abierta (DM1: «usuario:cuenta»).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || p_cuenta::text, true);

  -- Por pasadas, mientras quede tiempo: lo que una clave ajena no deja borrar
  -- todavía, en la siguiente (cuando ya no está lo que lo usa).
  v_corto := false;
  <<pasadas>>
  for v_pasada in 1..12 loop
    v_en_pasada := 0;
    foreach v_tabla in array v_con_filas loop
      -- El tiempo solo corta cuando ya se ha borrado algo en esta llamada: así cada tanda avanza.
      if clock_timestamp() >= v_hasta and v_total + v_en_pasada > 0 then v_total := v_total + v_en_pasada; v_corto := true; exit pasadas; end if;
      begin
        execute format('delete from public.%I where account_id = $1', v_tabla) using p_cuenta;
        get diagnostics v_n = row_count;
        v_en_pasada := v_en_pasada + v_n;
        v_fallos := v_fallos - v_tabla;
      exception when others then
        v_fallos := jsonb_set(v_fallos, array[v_tabla], to_jsonb(sqlerrm));
      end;
    end loop;
    v_total := v_total + v_en_pasada;
    exit when v_en_pasada = 0;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);

  -- Sin borrar nada y sin quedarse sin tiempo: lo que queda no se deja borrar.
  if v_total = 0 and not v_corto then
    foreach v_tabla in array v_con_filas loop
      execute format('select count(*) from public.%I where account_id = $1', v_tabla) using p_cuenta into v_n;
      if v_n > 0 then v_quedan := array_append(v_quedan, format('%s (%s filas: %s)', v_tabla, v_n, coalesce(v_fallos->>v_tabla, 'vuelven a aparecer'))); end if;
    end loop;
    raise exception 'GD: no se ha podido vaciar la demo. Se resisten: %', array_to_string(v_quedan, '; ') using errcode = '55000';
  end if;

  return jsonb_build_object('sigue', true, 'filas', v_total,
    'frase', format('Borradas %s filas; se sigue en la siguiente tanda.', v_total));
end $$;
comment on function public.demo_gestoria_volver_a_empezar_tanda(uuid, int) is
  'GD · «Volver a empezar», la parte de Sumied, por tandas (nº84): cada llamada borra de una cuenta demo lo que cabe en p_ms (todo menos _gd_se_queda) y dice si sigue; cuando no queda nada, vuelve a sembrar la contabilidad y el banco. Solo cuentas demo; solo la plataforma.';
revoke all on function public.demo_gestoria_volver_a_empezar_tanda(uuid, int) from public, anon, authenticated;
grant execute on function public.demo_gestoria_volver_a_empezar_tanda(uuid, int) to service_role;
