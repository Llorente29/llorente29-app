-- ============================================================================
-- SOLO STAGING-CONTA · R02 · PRUEBAS DE LA RESOLUCIÓN, EL GUARDADO Y EL R01
-- ----------------------------------------------------------------------------
-- Encargo §8: «unitarias de resolve_dispatch con las tres capas (celda,
-- herencia, por defecto) y source correcto» y «el R01 arreglado (fila por
-- cuenta y por local)». Sobre las semillas de seed_r02_quien_reparte.sql.
--
-- Todo va en un sub-bloque que acaba en `raise exception`: al capturarla,
-- PostgreSQL lo deshace entero. Los resultados se guardan en variables, que
-- sobreviven, y se comprueban al final: si alguno no es el esperado, el
-- fichero acaba en error (workflow rojo). Staging queda como estaba.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  a_centro constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  a_mercado constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  burger   constant uuid := 'e0200000-0000-4000-8000-00000000a0b1';
  pita     constant uuid := 'e0200000-0000-4000-8000-00000000a0b2';
  smash    constant uuid := 'e0200000-0000-4000-8000-00000000a0b3';
  cedida   constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';
  kebab    constant uuid := 'e0200000-0000-4000-8000-00000000b0b1';
  a_uber   constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';
  esperado text := '';
  obtenido text := '';
  t text;
  n int;
  v_id uuid;
  v_sale uuid := gen_random_uuid();
  procedure_ok boolean;
begin
  begin
    -- ── 1 · Las capas, sin ninguna celda de marca (quitamos las migradas) ──
    delete from public.brand_delivery_policy where account_id in (a_cuenta, b_cuenta);

    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, burger, 'glovo', a_centro);
    esperado := esperado || E'\n1a herencia cuenta (propia, glovo): own/inherited';
    obtenido := obtenido || E'\n1a herencia cuenta (propia, glovo): ' || t;

    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, cedida, 'glovo', a_centro);
    esperado := esperado || E'\n1b herencia cuenta (cedida, glovo): platform/inherited';
    obtenido := obtenido || E'\n1b herencia cuenta (cedida, glovo): ' || t;

    select delivery_by || '/' || source into t from public.resolve_delivery_by(b_cuenta, kebab, 'justeat', null);
    esperado := esperado || E'\n1c sin herencia ni celda (B, justeat): platform/default';
    obtenido := obtenido || E'\n1c sin herencia ni celda (B, justeat): ' || t;

    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, burger, 'deliveroo', a_centro);
    esperado := esperado || E'\n1d plataforma sin nada (deliveroo): platform/default';
    obtenido := obtenido || E'\n1d plataforma sin nada (deliveroo): ' || t;

    -- ── 2 · Como admin de A: guardar celdas (marca, local) y herencia ──────
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- Celda de marca (todos los locales): Burger Norte en Glovo → platform.
    select delivery_by || '/' || source into t
      from public.reparto_guardar_celda(a_cuenta, burger, 'glovo', null, 'platform', 'manual');
    esperado := esperado || E'\n2a celda de marca guardada: platform/manual';
    obtenido := obtenido || E'\n2a celda de marca guardada: ' || t;

    -- Celda de un local: en Norte Mercado, Burger Norte en Glovo → own.
    perform public.reparto_guardar_celda(a_cuenta, burger, 'glovo', a_mercado, 'own', 'manual');
    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, burger, 'glovo', a_mercado);
    esperado := esperado || E'\n2b celda del local manda en su local: own/manual';
    obtenido := obtenido || E'\n2b celda del local manda en su local: ' || t;
    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, burger, 'glovo', a_centro);
    esperado := esperado || E'\n2c y en otro local manda la de la marca: platform/manual';
    obtenido := obtenido || E'\n2c y en otro local manda la de la marca: ' || t;

    -- Volver a guardar la misma celda: actualiza, no duplica (índice normal).
    perform public.reparto_guardar_celda(a_cuenta, burger, 'glovo', null, 'own', 'manual');
    select count(*) into n from public.brand_delivery_policy
     where account_id = a_cuenta and brand_id = burger and channel_slug = 'glovo';
    esperado := esperado || E'\n2d guardar dos veces: 2 filas (marca + local), valor own';
    select string_agg(delivery_by, ',' order by location_id) into t from public.brand_delivery_policy
     where account_id = a_cuenta and brand_id = burger and channel_slug = 'glovo'
       and location_id = '00000000-0000-0000-0000-000000000000';
    obtenido := obtenido || E'\n2d guardar dos veces: ' || n || ' filas (marca + local), valor ' || t;

    -- Quitar la decisión: vuelve a heredar.
    select delivery_by || '/' || source into t
      from public.reparto_guardar_celda(a_cuenta, burger, 'glovo', null, null, 'manual');
    esperado := esperado || E'\n2e quitar la celda de marca: own/inherited';
    obtenido := obtenido || E'\n2e quitar la celda de marca: ' || t;

    -- Quien lo decidió lo pone el servidor.
    select coalesce(decided_by::text, 'NULL') || ' ' || coalesce(decided_by_name, 'NULL') into t
      from public.brand_delivery_policy
     where account_id = a_cuenta and brand_id = burger and channel_slug = 'glovo' and location_id = a_mercado;
    esperado := esperado || E'\n2f decided_by es el usuario: ' || a_user::text;
    obtenido := obtenido || E'\n2f decided_by es el usuario: ' || split_part(t, ' ', 1);

    -- ── 3 · R01: la herencia se guarda por cuenta y por local ──────────────
    v_id := public.reparto_guardar_herencia(a_cuenta, 'glovo', 'own', null, 'platform');
    perform public.reparto_guardar_herencia(a_cuenta, 'glovo', 'own', null, 'own');       -- otra vez: actualiza
    perform public.reparto_guardar_herencia(a_cuenta, 'glovo', 'own', a_mercado, 'platform');
    perform public.reparto_guardar_herencia(a_cuenta, 'glovo', 'own', a_mercado, 'platform'); -- otra vez
    select count(*) filter (where location_id is null) || ' de cuenta + ' ||
           count(*) filter (where location_id = a_mercado) || ' del local' into t
      from public.channel_delivery_policy
     where account_id = a_cuenta and channel_slug = 'glovo' and ownership_type = 'own';
    esperado := esperado || E'\n3a R01 guardado: 1 de cuenta + 1 del local';
    obtenido := obtenido || E'\n3a R01 guardado: ' || t;
    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, pita, 'glovo', a_mercado);
    esperado := esperado || E'\n3b herencia del local antes que la de la cuenta: platform/inherited';
    obtenido := obtenido || E'\n3b herencia del local antes que la de la cuenta: ' || t;
    select delivery_by || '/' || source into t from public.resolve_delivery_by(a_cuenta, pita, 'glovo', a_centro);
    esperado := esperado || E'\n3c y en otro local, la de la cuenta: own/inherited';
    obtenido := obtenido || E'\n3c y en otro local, la de la cuenta: ' || t;

    -- ── 4 · RLS: A no ve ni toca lo de B ───────────────────────────────────
    select count(*) into n from public.brand_delivery_policy where account_id = b_cuenta;
    esperado := esperado || E'\n4a A ve filas de B: 0';
    obtenido := obtenido || E'\n4a A ve filas de B: ' || n;
    begin
      perform public.reparto_guardar_celda(b_cuenta, kebab, 'glovo', null, 'platform', 'manual');
      t := 'pudo escribir';
    exception when insufficient_privilege then t := 'rechazado';
    end;
    esperado := esperado || E'\n4b A escribe en B: rechazado';
    obtenido := obtenido || E'\n4b A escribe en B: ' || t;
    begin
      perform public.reparto_guardar_celda(a_cuenta, kebab, 'glovo', null, 'platform', 'manual');
      t := 'pudo escribir';
    exception when check_violation then t := 'rechazado';
    end;
    esperado := esperado || E'\n4c A cuelga una celda de la marca de B: rechazado';
    obtenido := obtenido || E'\n4c A cuelga una celda de la marca de B: ' || t;

    -- ── 5 · El pedido: entra con la resolución y no cambia si cambia la celda
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    -- Pita del Sur en Uber, sin celda: herencia own → own_delivery.
    insert into public.sale (id, account_id, location_id, brand_id, channel_id, source, sold_at, total,
                             status, order_status, service_type, delivery_address, raw_tab)
    values (v_sale, a_cuenta, a_centro, pita, a_uber, 'hubrise', now(), 10, 'open', 'new',
            'platform_delivery', null, '{"service_type":"delivery"}');
    select service_type into t from public.sale where id = v_sale;
    esperado := esperado || E'\n5a entra con la resolución (aunque el webhook mande platform): own_delivery';
    obtenido := obtenido || E'\n5a entra con la resolución (aunque el webhook mande platform): ' || t;

    -- Cambiar la celda NO toca el pedido abierto; el webhook lo reescribe y se queda.
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform public.reparto_guardar_celda(a_cuenta, pita, 'uber', null, 'platform', 'manual');
    perform set_config('request.jwt.claims', '', true);
    update public.sale set service_type = 'own_delivery', order_status = 'accepted' where id = v_sale;
    select service_type into t from public.sale where id = v_sale;
    esperado := esperado || E'\n5b cambiar la celda no toca el abierto: own_delivery';
    obtenido := obtenido || E'\n5b cambiar la celda no toca el abierto: ' || t;

    -- resolve_dispatch: own sin dirección → no despacha (ámbar), sin mirar interruptor.
    select coalesce(carrier, 'NULL') || ' · ' || reason into t from public.resolve_dispatch(v_sale);
    esperado := esperado || E'\n5c resolve_dispatch sin dirección: NULL · sin dirección de entrega: la plataforma no la ha enviado';
    obtenido := obtenido || E'\n5c resolve_dispatch sin dirección: ' || t;

    -- Desde la etiqueta ámbar: «Cambiar a “la reparte Uber”» recoloca ESE pedido.
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select r.service_type || '/' || r.source into t from public.reparto_cambiar_desde_pedido(v_sale, 'platform') r;
    esperado := esperado || E'\n5d desde la etiqueta: platform_delivery/manual';
    obtenido := obtenido || E'\n5d desde la etiqueta: ' || t;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);

    -- Smash (interruptor apagado) con celda platform: un own_delivery que llega con dirección se queda en platform.
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform public.reparto_guardar_celda(a_cuenta, smash, 'uber', null, 'own', 'manual');
    perform set_config('request.jwt.claims', '', true);
    insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total,
                             status, order_status, service_type, delivery_address, raw_tab)
    values (a_cuenta, a_centro, smash, a_uber, 'hubrise', now(), 10, 'open', 'new',
            'platform_delivery', 'Calle de Prueba 1', '{"service_type":"delivery"}')
    returning service_type into t;
    esperado := esperado || E'\n5e Smash en Uber con celda «Nosotros»: own_delivery';
    obtenido := obtenido || E'\n5e Smash en Uber con celda «Nosotros»: ' || t;

    raise exception 'r02_deshacer';
  exception when raise_exception then
    if sqlerrm <> 'r02_deshacer' then raise; end if;
  end;

  raise notice E'R02 · pruebas de la resolución\nESPERADO:%\nOBTENIDO:%', esperado, obtenido;
  if esperado <> obtenido then
    raise exception 'R02: alguna prueba de la resolución no da lo esperado (ver arriba)';
  end if;

  -- Guarda: el sub-bloque se ha deshecho de verdad.
  select count(*) into n from public.brand_delivery_policy where source = 'manual'
     and account_id in (a_cuenta, b_cuenta);
  if n <> 0 then raise exception 'R02: quedaron % celdas manuales: el sub-bloque no se deshizo', n; end if;
  raise notice 'R02 · % comprobaciones iguales a lo esperado. Staging queda como estaba.',
    (select count(*) from regexp_split_to_table(esperado, E'\n') x where x <> '');
end $$;
