-- supabase/migrations/20261109T1731_gd_volver_a_empezar.sql
--
-- GD · «Volver a empezar» (Julio, nº51), la parte de Sumied. La llama la
-- función conta-gd-volver-a-empezar después de dejar el portal de pruebas y el
-- sandbox como el primer día, y antes de volver a leerlos.
--
--   demo_gestoria_volver_a_empezar(cuenta): SOLO cuentas de demostración y SOLO
--   la plataforma. Vacía de la cuenta demo todo lo que nace de usarla —lo leído
--   del CRM y de GoCardless, los clientes, sus líneas y tarifas, los cobros, los
--   recibos, las facturas, el banco, los asientos— y se queda con lo que la
--   configura: las empresas, su plan y sus enlaces, la actividad, el ejercicio,
--   los modelos, las series, el banco (la cuenta, no sus movimientos), los
--   ajustes y las dos conexiones (CRM y GoCardless), y las personas de la
--   cuenta. Después vuelve a pasar las siembras de la contabilidad y del banco.
--   Todo o nada: si una tabla no se deja vaciar, para y dice cuál y por qué,
--   y no cambia nada.
--
--   Qué se queda es una lista cerrada (_gd_se_queda). Lo demás con filas de la
--   cuenta demo se vacía: así una tabla nueva de mañana también vuelve a cero
--   sin tocar esta función.
--
-- OJO, y va dicho en la tanda: el analizador no ve dentro de las funciones. La
-- migración no la llama: solo se ejecuta cuando el administrador de una demo
-- pulsa «Volver a empezar». No toca ninguna otra cuenta (regla 9): cada
-- borrado lleva account_id = la cuenta demo. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1731_gd_volver_a_empezar.down.sql

create or replace function public._gd_se_queda()
returns text[] language sql immutable as $$
  select array[
    -- La cuenta y quién entra.
    'user_profiles', 'user_active_account', 'feature_flags', 'conta_user_pref',
    -- Las empresas y su contabilidad.
    'company', 'company_account', 'company_account_link', 'company_account_log', 'company_activity', 'company_person',
    'company_tax_profile', 'tax_obligation', 'fiscal_year', 'invoice_series',
    -- El banco (la cuenta, no lo que pasa por ella) y los ajustes.
    'treasury_account', 'bank_settings', 'conta_gestoria_ajustes',
    -- Las dos conexiones (sus secretos viven en el Vault).
    'conta_crm', 'conta_cobro_gocardless'
  ]::text[]
$$;
comment on function public._gd_se_queda() is
  'GD · Las tablas que «Volver a empezar» deja como están en una cuenta demo: la configuración. Lo demás con filas de la cuenta se vacía.';
revoke all on function public._gd_se_queda() from public, anon, authenticated;

create or replace function public.demo_gestoria_volver_a_empezar(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_admin uuid; v_tabla text; v_n bigint; v_pasada int; v_en_pasada bigint;
  v_vaciadas jsonb := '{}'::jsonb; v_fallos jsonb := '{}'::jsonb; v_quedan text[]; v_total bigint := 0;
  v_cont jsonb; v_banco jsonb;
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'GD: % no es una cuenta de demostración: no se toca nada.', p_cuenta using errcode = '42501';
  end if;
  select user_id into v_admin from public.user_profiles where account_id = p_cuenta and role = 'admin' and active order by created_at limit 1;
  if v_admin is null then raise exception 'GD: la cuenta demo no tiene administrador: no se vuelve a empezar.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gd_volver_a_empezar:' || p_cuenta::text, 0));

  -- Como el administrador de la cuenta, en la cuenta abierta (DM1: «usuario:cuenta»).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || p_cuenta::text, true);

  -- Por pasadas: lo que una clave ajena no deja borrar todavía, en la siguiente
  -- (cuando ya no está lo que lo usa). Cada tabla, en su subtransacción.
  for v_pasada in 1..12 loop
    v_en_pasada := 0;
    for v_tabla in
      select c.table_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'account_id' and c.table_name <> all (public._gd_se_queda())
       order by c.table_name
    loop
      begin
        execute format('delete from public.%I where account_id = $1', v_tabla) using p_cuenta;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_vaciadas := jsonb_set(v_vaciadas, array[v_tabla], to_jsonb(coalesce((v_vaciadas->>v_tabla)::bigint, 0) + v_n));
          v_en_pasada := v_en_pasada + v_n;
        end if;
        v_fallos := v_fallos - v_tabla;
      exception when others then
        v_fallos := jsonb_set(v_fallos, array[v_tabla], to_jsonb(sqlerrm));
      end;
    end loop;
    v_total := v_total + v_en_pasada;
    exit when v_en_pasada = 0;
  end loop;

  -- ¿Queda algo de la cuenta fuera de la lista de lo que se queda?
  v_quedan := '{}';
  for v_tabla in
    select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'account_id' and c.table_name <> all (public._gd_se_queda())
  loop
    execute format('select count(*) from public.%I where account_id = $1', v_tabla) using p_cuenta into v_n;
    if v_n > 0 then v_quedan := array_append(v_quedan, format('%s (%s filas: %s)', v_tabla, v_n, coalesce(v_fallos->>v_tabla, 'vuelven a aparecer'))); end if;
  end loop;
  if cardinality(v_quedan) > 0 then
    raise exception 'GD: no se ha podido vaciar la demo, y no ha cambiado nada. Se resisten: %', array_to_string(v_quedan, '; ') using errcode = '55000';
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);

  -- Las siembras que no dependen de lo leído (la tarifa y los ingresos van después de leer).
  v_cont := public.demo_gestoria_contabilidad_sembrar(p_cuenta);
  v_banco := public.demo_gestoria_banco_sembrar(p_cuenta);

  return jsonb_build_object('filas', v_total, 'tablas', v_vaciadas,
    'frase', format('Vaciada la demo: %s filas de %s tablas. %s %s', v_total, (select count(*) from jsonb_object_keys(v_vaciadas)), v_cont->>'frase', v_banco->>'frase'));
end $$;
comment on function public.demo_gestoria_volver_a_empezar(uuid) is
  'GD · «Volver a empezar», la parte de Sumied: vacía de una cuenta demo todo lo que nace de usarla (todo menos _gd_se_queda) y vuelve a sembrar la contabilidad y el banco. Todo o nada. Solo cuentas demo; solo la plataforma.';
revoke all on function public.demo_gestoria_volver_a_empezar(uuid) from public, anon, authenticated;
grant execute on function public.demo_gestoria_volver_a_empezar(uuid) to service_role;
