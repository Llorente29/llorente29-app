-- supabase/staging/sql/20261118_r03_direccion_incompleta_prueba.sql
--
-- SOLO STAGING. Prueba de 20261118T0300_r03_direccion_incompleta
-- (public.resolve_dispatch, public.pedidos_sin_direccion,
-- public.fijar_direccion_entrega, public.sale_coordenadas_de_entrega_by_token).
-- Todo en una transacción con ROLLBACK: no cambia staging. Pedidos inventados,
-- sin datos de cliente.
--
--   1. resolve_dispatch: con dirección, sí; sin dirección pero con punto del
--      mapa, sí (lo nuevo); sin nada, no, con el motivo que lo dice.
--   2. EL PERMISO POR LOCAL (Julio, 16/10): la tablet de Norte Centro ve sus
--      pedidos sin dirección y no los de Norte Mercado (misma cuenta, otro
--      local), ni los de la cuenta B. Ni en el aviso, ni en el punto del mapa,
--      ni pegando una dirección. Como `anon`, que es como entra la tablet.
--   3. sale_coordenadas_de_entrega (la de sesión) sigue cerrada a anon.
--   4. Pegar la dirección: la guarda aparte (delivery_address y raw_tab no se
--      tocan), dice quién la pegó, el pedido sale del aviso y resolve_dispatch
--      lo deja pasar. Un texto corto se rechaza con un mensaje que se entiende.

begin;

do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

-- La migración, dentro de esta transacción: se prueba sin dejarla puesta.
\i supabase/migrations/20261118T0300_r03_direccion_incompleta.sql

select set_config('folvy.reparto_tal_cual', 'on', true);

-- Dispositivos: uno por local (Norte Centro, Norte Mercado) y uno de la cuenta B.
insert into public.kds_device (id, account_id, location_id, label, token) values
  ('e0300000-0000-4000-8000-0000000000d1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'R03 Norte Centro', 'r03-prueba-norte-centro'),
  ('e0300000-0000-4000-8000-0000000000d2', 'c01a0000-0000-4000-8000-00000000000a', 'e0200000-0000-4000-8000-0000000000a3', 'R03 Norte Mercado', 'r03-prueba-norte-mercado'),
  ('e0300000-0000-4000-8000-0000000000d3', 'c01b0000-0000-4000-8000-00000000000b', 'c01b0000-0000-4000-8000-0000000000b2', 'R03 Cuenta B', 'r03-prueba-cuenta-b');

-- Pedidos: P1 sin calle con punto del mapa (Norte Centro), P2 sin nada (Norte
-- Centro), P3 sin calle con punto (Norte Mercado), P4 con dirección (Norte Centro).
insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, pos_short_code, platform_order_ref, raw_tab)
values
  ('e0300000-0000-4000-8000-0000000000f1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '3 minutes', now() - interval '3 minutes',
   20.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'GR301', '100000000301',
   '{"channel":"Glovo","service_type":"delivery","customer":{"latitude":"40.4100","longitude":"-3.7000","address_1":null}}'),
  ('e0300000-0000-4000-8000-0000000000f2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '2 minutes', now() - interval '2 minutes',
   20.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'GR302', '100000000302',
   '{"channel":"Glovo","service_type":"delivery","customer":{}}'),
  ('e0300000-0000-4000-8000-0000000000f3', 'c01a0000-0000-4000-8000-00000000000a', 'e0200000-0000-4000-8000-0000000000a3',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '2 minutes', now() - interval '2 minutes',
   20.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'GR303', '100000000303',
   '{"channel":"Glovo","service_type":"delivery","customer":{"latitude":"40.4200","longitude":"-3.6900"}}'),
  ('e0300000-0000-4000-8000-0000000000f4', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '1 minutes', now() - interval '1 minutes',
   20.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba, 1, 28000', 'Glovo', 'GR304', '100000000304',
   '{"channel":"Glovo","service_type":"delivery","customer":{"latitude":"40.4300","longitude":"-3.6800"}}');

select set_config('folvy.reparto_tal_cual', '', true);

do $$
declare
  r record; j jsonb; v_ids text; v_err text;
begin
  -- 1. resolve_dispatch
  select * into r from public.resolve_dispatch('e0300000-0000-4000-8000-0000000000f4');
  if r.carrier is null then raise exception 'R03 1a: con dirección no despacha (%).', r.reason; end if;
  select * into r from public.resolve_dispatch('e0300000-0000-4000-8000-0000000000f1');
  if r.carrier is null then raise exception 'R03 1b: sin calle pero con punto del mapa no despacha (%).', r.reason; end if;
  select * into r from public.resolve_dispatch('e0300000-0000-4000-8000-0000000000f2');
  if r.carrier is not null or r.reason not like '%tampoco el punto del mapa%' then
    raise exception 'R03 1c: sin dirección ni punto debería no despachar con su motivo; da % / %.', r.carrier, r.reason;
  end if;
  raise notice 'R03 1: resolve_dispatch · con dirección sí · con punto sí · sin nada no («%»).', r.reason;
end $$;

-- 2 y 3: como anon, que es como entra la tablet.
set local role anon;

do $$
declare
  j jsonb; v_ids text; v_err text;
begin
  -- El aviso de Norte Centro: P1 y P2, ni P3 (otro local) ni P4 (con dirección).
  j := public.pedidos_sin_direccion(null, 'r03-prueba-norte-centro');
  select string_agg(p->>'code', ',' order by p->>'code') into v_ids
    from jsonb_array_elements(j->'pedidos') p where p->>'code' like 'GR30%';
  if v_ids is distinct from 'GR301,GR302' then raise exception 'R03 2a: Norte Centro ve % (esperaba GR301,GR302).', v_ids; end if;
  -- El de Norte Mercado: solo P3.
  j := public.pedidos_sin_direccion(null, 'r03-prueba-norte-mercado');
  select string_agg(p->>'code', ',' order by p->>'code') into v_ids
    from jsonb_array_elements(j->'pedidos') p where p->>'code' like 'GR30%';
  if v_ids is distinct from 'GR303' then raise exception 'R03 2b: Norte Mercado ve % (esperaba GR303).', v_ids; end if;
  -- La cuenta B: ninguno.
  j := public.pedidos_sin_direccion(null, 'r03-prueba-cuenta-b');
  if exists (select 1 from jsonb_array_elements(j->'pedidos') p where p->>'code' like 'GR30%') then
    raise exception 'R03 2c: la tablet de la cuenta B ve pedidos de A.';
  end if;
  -- Un token que no existe no ve nada.
  begin
    perform public.pedidos_sin_direccion(null, 'r03-no-existe');
    raise exception 'R03 2d: un token inventado ha visto el aviso.';
  exception when others then
    if sqlerrm like 'R03 2d%' then raise; end if;
  end;
  -- Sin token y sin sesión (anon): no.
  begin
    perform public.pedidos_sin_direccion('c01a0000-0000-4000-8000-0000000000a2', null);
    raise exception 'R03 2e: anon sin token ha visto el aviso de Norte Centro.';
  exception when others then
    if sqlerrm like 'R03 2e%' then raise; end if;
  end;

  -- El punto del mapa: el suyo sí; el de otro local, no.
  j := public.sale_coordenadas_de_entrega_by_token('r03-prueba-norte-centro', 'e0300000-0000-4000-8000-0000000000f1');
  if (j->>'hay')::boolean is not true then raise exception 'R03 2f: la tablet no ve el punto de su pedido: %', j; end if;
  begin
    perform public.sale_coordenadas_de_entrega_by_token('r03-prueba-norte-centro', 'e0300000-0000-4000-8000-0000000000f3');
    raise exception 'R03 2g: Norte Centro ve el punto de un pedido de Norte Mercado.';
  exception when others then
    if sqlerrm like 'R03 2g%' then raise; end if;
    v_err := sqlerrm;
  end;
  begin
    perform public.sale_coordenadas_de_entrega_by_token('r03-prueba-cuenta-b', 'e0300000-0000-4000-8000-0000000000f1');
    raise exception 'R03 2h: la cuenta B ve el punto de un pedido de A.';
  exception when others then
    if sqlerrm like 'R03 2h%' then raise; end if;
  end;
  -- Pegar en un pedido de otro local: no.
  begin
    perform public.fijar_direccion_entrega('e0300000-0000-4000-8000-0000000000f3', 'Calle Inventada de Prueba, 3, 2ºB', 'r03-prueba-norte-centro');
    raise exception 'R03 2i: Norte Centro ha pegado una dirección en un pedido de Norte Mercado.';
  exception when others then
    if sqlerrm like 'R03 2i%' then raise; end if;
  end;
  raise notice 'R03 2: permiso por local · Norte Centro ve GR301,GR302 · Norte Mercado GR303 · cuenta B nada · token inventado y anon sin token, rechazados · punto y pegar de otro local, rechazados («%»).', v_err;

  -- 4. Pegar la dirección en el suyo.
  begin
    perform public.fijar_direccion_entrega('e0300000-0000-4000-8000-0000000000f1', '  12 ', 'r03-prueba-norte-centro');
    raise exception 'R03 4a: un texto de 2 letras se ha aceptado como dirección.';
  exception when others then
    if sqlerrm like 'R03 4a%' then raise; end if;
    if sqlerrm not like 'Falta la dirección%' then raise exception 'R03 4a: el mensaje no se entiende: %', sqlerrm; end if;
  end;
  j := public.fijar_direccion_entrega('e0300000-0000-4000-8000-0000000000f1', 'Calle Inventada de Prueba,  1,   4ºB', 'r03-prueba-norte-centro');
  if (j->>'ok')::boolean is not true or j->>'carrier' is null or (j->>'ya_en_catcher')::boolean then
    raise exception 'R03 4b: pegar no ha dado lo esperado: %', j;
  end if;
  if j->>'direccion' <> 'Calle Inventada de Prueba, 1, 4ºB' then raise exception 'R03 4c: no ha limpiado los espacios: %', j->>'direccion'; end if;
  if coalesce(j->>'por', '') not like 'tablet · %' then raise exception 'R03 4e: no dice quién la ha escrito: %', j->>'por'; end if;
  j := public.pedidos_sin_direccion(null, 'r03-prueba-norte-centro');
  if exists (select 1 from jsonb_array_elements(j->'pedidos') p where p->>'code' = 'GR301') then
    raise exception 'R03 4d: con la dirección pegada, GR301 sigue en el aviso.';
  end if;
  raise notice 'R03 4: pegar · corto rechazado · guardado · sale del aviso · %', j;
end $$;

reset role;

do $$
declare r record;
begin
  select delivery_address, delivery_address_fixed, delivery_address_fixed_by, raw_tab
    into r from public.sale where id = 'e0300000-0000-4000-8000-0000000000f1';
  if r.delivery_address is not null then raise exception 'R03 4e: ha tocado delivery_address (%).', r.delivery_address; end if;
  if r.raw_tab not like '%"address_1":null%' then raise exception 'R03 4f: ha tocado raw_tab.'; end if;
  if r.delivery_address_fixed_by <> 'tablet · R03 Norte Centro' then raise exception 'R03 4g: quién la pegó: %', r.delivery_address_fixed_by; end if;

  -- 3. La de sesión, cerrada a anon; las tres nuevas, abiertas (la puerta es el token).
  if has_function_privilege('anon', 'public.sale_coordenadas_de_entrega(uuid)', 'EXECUTE') then
    raise exception 'R03 3a: sale_coordenadas_de_entrega abierta a anon.';
  end if;
  if not has_function_privilege('anon', 'public.sale_coordenadas_de_entrega_by_token(text, uuid)', 'EXECUTE') then
    raise exception 'R03 3b: la variante por token no la puede llamar la tablet.';
  end if;
  if (select count(*) from pg_proc where proname = 'resolve_dispatch' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'R03 3c: resolve_dispatch con más de una firma.';
  end if;
  raise notice 'R03 3: sale_coordenadas_de_entrega cerrada a anon · la de token abierta · resolve_dispatch una sola firma. delivery_address y raw_tab intactos; la pegó «%».', r.delivery_address_fixed_by;
end $$;

-- 5. La puerta de sesión (el ordenador), como usuario: el de A ve el aviso de
-- Norte Centro y pega; el de B, no.
set local role authenticated;

do $$
declare j jsonb; v_ids text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  j := public.pedidos_sin_direccion('c01a0000-0000-4000-8000-0000000000a2', null);
  select string_agg(p->>'code', ',' order by p->>'code') into v_ids
    from jsonb_array_elements(j->'pedidos') p where p->>'code' like 'GR30%';
  if v_ids is distinct from 'GR302' then raise exception 'R03 5a: el usuario de A ve % en Norte Centro (esperaba GR302: GR301 ya tiene dirección).', v_ids; end if;
  j := public.fijar_direccion_entrega('e0300000-0000-4000-8000-0000000000f2', 'Calle Inventada de Prueba, 2, bajo', null);
  if (j->>'ok')::boolean is not true then raise exception 'R03 5b: el usuario de A no ha podido pegar: %', j; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
  begin
    perform public.pedidos_sin_direccion('c01a0000-0000-4000-8000-0000000000a2', null);
    raise exception 'R03 5c: el usuario de B ve el aviso de Norte Centro.';
  exception when others then
    if sqlerrm like 'R03 5c%' then raise; end if;
  end;
  begin
    perform public.fijar_direccion_entrega('e0300000-0000-4000-8000-0000000000f3', 'Calle Inventada de Prueba, 3, 1º', null);
    raise exception 'R03 5d: el usuario de B ha pegado una dirección en un pedido de A.';
  exception when others then
    if sqlerrm like 'R03 5d%' then raise; end if;
  end;
  raise notice 'R03 5: sesión · A ve GR302 y pega · B no ve ni pega.';
end $$;

reset role;

rollback;
