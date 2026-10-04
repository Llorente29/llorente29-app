-- ============================================================================
-- SOLO STAGING-CONTA · R02 · PRUEBA DE LA SUGERENCIA DE FOLVY (tarea 5)
-- ----------------------------------------------------------------------------
-- Sobre las semillas: Pita del Sur (cuenta A) lleva 3 pedidos «propios»
-- seguidos de Uber sin dirección (7A1F0, 7A1F1, 7A1F2). Comprueba:
--   1. que Folvy lo propone, con esos tres pedidos y para la cuenta A sola;
--   2. «No, lo arreglo en Uber»: queda escrito y no se vuelve a proponer;
--      la celda no cambia;
--   3. «Sí, la reparte Uber»: escribe la celda (ai_accepted) y queda escrito;
--   4. un pedido nuevo CON dirección deshace la racha: deja de proponerse;
--   5. B no ve la sugerencia de A ni puede responderla.
-- Todo en un sub-bloque deshecho al final: staging queda como estaba.
-- ============================================================================
do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  pita     constant uuid := 'e0200000-0000-4000-8000-00000000a0b2';
  a_uber   constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';
  a_centro constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  esperado text := ''; obtenido text := ''; t text; n int; v_last uuid;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    select string_agg(brand_name || ' · ' || channel_slug || ' · ' || array_to_string(codigos, ','), ' | '), max(last_sale_id::text)::uuid
      into t, v_last from public.reparto_sugerencias(a_cuenta);
    esperado := esperado || E'\n1 propone: Pita del Sur · uber · 7A1F0,7A1F1,7A1F2';
    obtenido := obtenido || E'\n1 propone: ' || coalesce(t, 'nada');

    -- 2 · No.
    begin
      t := public.reparto_responder_sugerencia(a_cuenta, pita, 'uber', v_last, false);
      select count(*) into n from public.reparto_sugerencias(a_cuenta);
      esperado := esperado || E'\n2 tras «No»: 0 sugerencias, celda own/migrated, registro rejected';
      obtenido := obtenido || E'\n2 tras «No»: ' || n || ' sugerencias, celda '
        || (select delivery_by || '/' || source from public.resolve_delivery_by(a_cuenta, pita, 'uber', null))
        || ', registro ' || (select status from public.delivery_policy_suggestion where last_sale_id = v_last);
      raise exception 'r02_deshacer_2';
    exception when raise_exception then if sqlerrm <> 'r02_deshacer_2' then raise; end if;
    end;

    -- 3 · Sí.
    begin
      t := public.reparto_responder_sugerencia(a_cuenta, pita, 'uber', v_last, true);
      esperado := esperado || E'\n3 tras «Sí»: celda platform/ai_accepted, registro accepted, 3 pedidos de prueba';
      obtenido := obtenido || E'\n3 tras «Sí»: celda '
        || (select delivery_by || '/' || source from public.resolve_delivery_by(a_cuenta, pita, 'uber', null))
        || ', registro ' || (select status from public.delivery_policy_suggestion where last_sale_id = v_last)
        || ', ' || (select jsonb_array_length(evidence) from public.delivery_policy_suggestion where last_sale_id = v_last)
        || ' pedidos de prueba';
      raise exception 'r02_deshacer_3';
    exception when raise_exception then if sqlerrm <> 'r02_deshacer_3' then raise; end if;
    end;

    -- 4 · Un pedido con dirección deshace la racha.
    perform set_config('role', 'none', true);
    insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, status, order_status,
                             service_type, delivery_address, raw_tab)
    values (a_cuenta, a_centro, pita, a_uber, 'hubrise', now(), 20, 'closed', 'completed',
            'own_delivery', 'Calle de Prueba 3, 28000 Madrid', '{"service_type":"delivery"}');
    perform set_config('role', 'authenticated', true);
    select count(*) into n from public.reparto_sugerencias(a_cuenta);
    esperado := esperado || E'\n4 con un pedido con dirección: 0 sugerencias';
    obtenido := obtenido || E'\n4 con un pedido con dirección: ' || n || ' sugerencias';

    -- 5 · B.
    perform set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
    begin
      perform 1 from public.reparto_sugerencias(a_cuenta);
      t := 'pudo leer';
    exception when insufficient_privilege then t := 'rechazado';
    end;
    esperado := esperado || E'\n5a B lee las de A: rechazado';
    obtenido := obtenido || E'\n5a B lee las de A: ' || t;
    begin
      perform public.reparto_responder_sugerencia(a_cuenta, pita, 'uber', v_last, true);
      t := 'pudo responder';
    exception when insufficient_privilege then t := 'rechazado';
    end;
    esperado := esperado || E'\n5b B responde por A: rechazado';
    obtenido := obtenido || E'\n5b B responde por A: ' || t;

    raise exception 'r02_deshacer';
  exception when raise_exception then
    if sqlerrm <> 'r02_deshacer' then raise; end if;
  end;

  raise notice E'R02 · sugerencia de Folvy\nESPERADO:%\nOBTENIDO:%', esperado, obtenido;
  if esperado <> obtenido then
    raise exception 'R02: la prueba de la sugerencia no da lo esperado (ver arriba)';
  end if;
  select count(*) into n from public.delivery_policy_suggestion;
  if n <> 0 then raise exception 'R02: quedaron % respuestas: el sub-bloque no se deshizo', n; end if;
end $$;
