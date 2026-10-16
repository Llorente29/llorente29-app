-- supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql
--
-- SOLO STAGING. Prueba de 20261116T0100_c06b_promociones_envios
-- (public.conta_propuesta_ventas_unidad y public.conta_resumen_ventas, y lo
-- que añade: conta_ventas_canal_cuenta, conta_envio_aclarado,
-- conta_cargos_de_pedidos, conta_envio_aclarar y el freno al validar). La
-- migración se aplica DENTRO de la transacción (\i) y todo acaba en ROLLBACK:
-- staging es compartido y no cambia. Pedidos inventados en la cuenta A, en
-- Glovo, con source «manual» (el disparador de «quién reparte» no los toca).
--
--   0. Lo de antes no cambia: un día de la semilla sin promociones ni envíos
--      da las mismas líneas con la función de antes y con la nueva.
--   1. Sin subcuenta de promociones ni de envíos: la promoción se queda
--      restada de la venta y el envío dentro, como hoy, y el asiento sale en
--      «duda» con su «Mira esto».
--   2. Con sus subcuentas, el ejemplo del diseño: un pedido de carta 30,00 con
--      10,00 de promoción y 3,50 de envío que repartimos nosotros (paga 23,50)
--      y otro de 20,00 sin nada. 430 43,50 · 70009002 9,09 al debe · venta
--      45,45 · 70500001 3,18 · 477 3,96 (base 39,54). Cuadra, «seguro» o
--      «probable», con sus razones y sus citas.
--   3. Un envío que repartió la plataforma: «Por aclarar» en el «Mira esto»,
--      «duda», el envío dentro de la venta; propuesto, NO se valida (el freno),
--      como usuario.
--   4. Aclarado «no_lo_paga» por la liquidación, como usuario: el propuesto se
--      quita; la nueva propuesta saca el envío de la venta y del cobro
--      (430 = total − envío) y lo dice («Fuera: el envío…»), y se valida.
--   5. conta_resumen_ventas del validado: cada pedido con su descuento, su
--      envío y su clase; cada línea con su papel.
--   6. conta_envio_aclarar sobre un pedido de un asiento validado: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA promociones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · Antes de la migración: las líneas de un día de la semilla (Glovo, 25/09).
do $$
begin
  perform set_config('prueba_promo.antes', coalesce((public.conta_propuesta_ventas_unidad('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2',
    '2026-09-25', 'e0200000-0000-4000-8000-00000000a0c1', null) -> 'lineas')::text, 'sin líneas'), true);
end $$;

\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql

do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_glovo constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_plan text; v_promo uuid; v_envio uuid; p jsonb; l jsonb; v_r jsonb; v_entry uuid;
  cargo constant text := '{"charges":[{"type":"delivery","name":"Delivery charge","price":"3.50 EUR","deleted":false},{"type":"other","name":"Small order fee","price":"0.00 EUR","deleted":false}]}';
  cargo2 constant text := '{"charges":[{"type":"delivery","name":"Delivery charge","price":"2.00 EUR","deleted":false}]}';
  h constant interval := interval '13 hours';
begin
  -- 0
  p := public.conta_propuesta_ventas_unidad(v_e, v_loc, '2026-09-25', v_glovo, null);
  if coalesce((p->'lineas')::text, 'sin líneas') <> current_setting('prueba_promo.antes') then
    raise exception 'PRUEBA promociones · 0: el día 25/09 de la semilla ha cambiado: antes %, ahora %.', current_setting('prueba_promo.antes'), p->'lineas';
  end if;
  raise notice 'PRUEBA promociones · 0: un día sin promociones ni envíos da las mismas líneas que antes.';

  -- 1 · Sin subcuentas: el 21/10, un pedido con promoción y envío propio.
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, discount_amount, service_type, raw_tab, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_glovo, ('2026-10-21'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 23.50, null, null, 10.00, 'own_delivery', cargo, 'manual', 'PR-1', true);
  p := public.conta_propuesta_ventas_unidad(v_e, v_loc, '2026-10-21', v_glovo, null);
  if p->'entrada'->>'confianza' <> 'duda'
     or not exists (select 1 from jsonb_array_elements(p->'entrada'->'razones') r where r->>'porque' like '%no tiene su subcuenta de promociones%')
     or not exists (select 1 from jsonb_array_elements(p->'entrada'->'razones') r where r->>'porque' like '%no tiene su subcuenta de envíos%')
     or exists (select 1 from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '7000900%' or x->>'cuenta' like '705%')
     or (select sum((x->>'haber')::numeric) from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '700%') <> 21.36 then
    raise exception 'PRUEBA promociones · 1: %', p;
  end if;
  raise notice 'PRUEBA promociones · 1: sin subcuentas, la promoción y el envío se quedan en la venta (21,36) y sale en duda con su «Mira esto».';

  -- 2 · Con sus subcuentas (las de Foodint, aquí inventadas en A).
  select plan into v_plan from public.company_account where company_id = v_e and code = '70000000';
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (v_acc, v_e, v_plan, '70009002', '700', 'PROMOCIONES GLOVO', 'own', 'manual', 'Prueba C06b') returning id into v_promo;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (v_acc, v_e, v_plan, '70500001', '705', 'ENVÍOS COBRADOS', 'own', 'manual', 'Prueba C06b') returning id into v_envio;
  insert into public.conta_ventas_canal_cuenta (company_id, account_id, channel_id, papel, company_account_id, created_by_name) values
    (v_e, v_acc, v_glovo, 'promociones', v_promo, 'Prueba C06b'), (v_e, v_acc, v_glovo, 'envios', v_envio, 'Prueba C06b');
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, discount_amount, service_type, raw_tab, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_glovo, ('2026-10-21'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'closed', 'completed', 20.00, null, null, null, 'own_delivery', null, 'manual', 'PR-2', true);
  p := public.conta_propuesta_ventas_unidad(v_e, v_loc, '2026-10-21', v_glovo, null);
  select jsonb_object_agg(x->>'cuenta', jsonb_build_object('d', (x->>'debe')::numeric, 'h', (x->>'haber')::numeric)) into l from jsonb_array_elements(p->'lineas') x;
  if (l->'70009002'->>'d')::numeric <> 9.09 or (l->'70500001'->>'h')::numeric <> 3.18 or (l->'70000001'->>'h')::numeric is distinct from 45.45 and (l->'70000000'->>'h')::numeric is distinct from 45.45
     or (select sum((x->>'debe')::numeric) from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '430%') <> 43.50
     or (select sum((x->>'haber')::numeric) from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '477%') <> 3.96
     or (select (x->'iva'->>'base')::numeric from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '477%') <> 39.54
     or (select sum((x->>'debe')::numeric) - sum((x->>'haber')::numeric) from jsonb_array_elements(p->'lineas') x) <> 0
     or p->'entrada'->>'confianza' = 'duda'
     or not exists (select 1 from jsonb_array_elements(p->'entrada'->'razones') r where r->>'decision' like 'Promociones: 1 pedido, 10,00 €%' and r->>'cita' = 'Ley 37/1992, art. 78.Tres.2.º')
     or not exists (select 1 from jsonb_array_elements(p->'entrada'->'razones') r where r->>'decision' like 'Envíos cobrados: 1 pedido, 3,50 €%' and r->>'cita' = 'Ley 37/1992, art. 78.Dos.1.º')
     or (select x->>'local_id' from jsonb_array_elements(p->'lineas') x where x->>'cuenta' = '70500001') <> v_loc::text then
    raise exception 'PRUEBA promociones · 2: %', p;
  end if;
  raise notice 'PRUEBA promociones · 2: 430 43,50 · promociones 9,09 · venta 45,45 · envíos 3,18 · IVA 3,96 (base 39,54); cuadra; confianza %.', p->'entrada'->>'confianza';

  -- 3 · Un envío que repartió la plataforma.
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, discount_amount, service_type, raw_tab, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca, v_glovo, ('2026-10-21'::timestamp + h + interval '2 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 12.00, null, null, null, 'platform_delivery', cargo2, 'manual', 'PR-3', true);
  p := public.conta_propuesta_ventas_unidad(v_e, v_loc, '2026-10-21', v_glovo, null);
  if p->'entrada'->>'confianza' <> 'duda'
     or not exists (select 1 from jsonb_array_elements(p->'entrada'->'razones') r where r->>'decision' = 'Mira esto' and r->>'porque' like 'Por aclarar: 1 pedido con envío%PR-3 · %envío 2,00 € · repartió la plataforma%Hasta entonces no se valida.')
     or (select sum((x->>'debe')::numeric) from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '430%') <> 55.50
     or (select (x->>'haber')::numeric from jsonb_array_elements(p->'lineas') x where x->>'cuenta' = '70500001') <> 3.18 then
    raise exception 'PRUEBA promociones · 3: %', p;
  end if;
  v_r := public._journal_entry_proponer(v_e, p->'entrada', p->'lineas', p->'resumen', 'Prueba C06b', null);
  v_entry := (v_r->>'id')::uuid;
  perform set_config('prueba_promo.entry', v_entry::text, true);
  perform set_config('prueba_promo.pr3', (select id::text from public.sale where account_id = v_acc and platform_order_code = 'PR-3'), true);
  raise notice 'PRUEBA promociones · 3: el envío de la plataforma, «Por aclarar» en el «Mira esto» y en duda; propuesto.';
end $$;

-- 3 (sigue) · Como usuario, no se valida.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_msg text; v_r jsonb;
begin
  begin
    perform public.journal_entry_validar(current_setting('prueba_promo.entry')::uuid, 'Prueba C06b');
    v_msg := null;
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'No se valida: 1 pedido con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma). Se resuelve con la liquidación de esa semana.' then
    raise exception 'PRUEBA promociones · 3: con un envío por aclarar se ha validado, o dice otra cosa: %', v_msg;
  end if;
  raise notice 'PRUEBA promociones · 3: no se valida: «%»', v_msg;

  -- 4 · La liquidación dice que Glovo no lo paga.
  v_r := public.conta_envio_aclarar(current_setting('prueba_promo.pr3')::uuid, 'no_lo_paga', 'Liquidación de Glovo de la semana (prueba)', 'Prueba C06b');
  if (v_r->>'quitado')::boolean is not true or v_r->>'texto' not like 'Aclarado: el envío del pedido PR-3 no lo paga la plataforma: sale de la venta y del cobro. El asiento propuesto de ese día se ha quitado%' then
    raise exception 'PRUEBA promociones · 4: %', v_r;
  end if;
  if exists (select 1 from public.journal_entry where id = current_setting('prueba_promo.entry')::uuid) then
    raise exception 'PRUEBA promociones · 4: el propuesto sigue ahí.';
  end if;
  raise notice 'PRUEBA promociones · 4: «%»', v_r->>'texto';
end $$;
reset role;

do $$
declare
  v_e     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_glovo constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  p jsonb; v_r jsonb;
begin
  p := public.conta_propuesta_ventas_unidad(v_e, v_loc, '2026-10-21', v_glovo, null);
  if p->'entrada'->>'confianza' = 'duda'
     or (select sum((x->>'debe')::numeric) from jsonb_array_elements(p->'lineas') x where x->>'cuenta' like '430%') <> 53.50
     or not exists (select 1 from jsonb_array_elements(p->'entrada'->'razones') r where r->>'decision' = 'Fuera: el envío de 1 pedido (2,00 €)')
     or (select sum((x->>'debe')::numeric) - sum((x->>'haber')::numeric) from jsonb_array_elements(p->'lineas') x) <> 0 then
    raise exception 'PRUEBA promociones · 4: %', p;
  end if;
  v_r := public._journal_entry_proponer(v_e, p->'entrada', p->'lineas', p->'resumen', 'Prueba C06b', null);
  perform set_config('prueba_promo.entry', v_r->>'id', true);
  raise notice 'PRUEBA promociones · 4: fuera de la venta y del cobro (430 53,50 = 55,50 − 2,00), con su razón.';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_r jsonb; v_msg text;
begin
  perform public.journal_entry_validar(current_setting('prueba_promo.entry')::uuid, 'Prueba C06b');
  -- 5
  v_r := public.conta_resumen_ventas(current_setting('prueba_promo.entry')::uuid);
  if v_r->>'estado' <> 'validado'
     or not exists (select 1 from jsonb_array_elements(v_r->'pedidos') x where x->>'codigo' = 'PR-1' and (x->>'descuento')::numeric = 10 and (x->>'envio')::numeric = 3.5 and x->>'clase' = 'cobrado')
     or not exists (select 1 from jsonb_array_elements(v_r->'pedidos') x where x->>'codigo' = 'PR-3' and (x->>'envio')::numeric = 2 and x->>'clase' = 'fuera')
     or not exists (select 1 from jsonb_array_elements(v_r->'pedidos') x where x->>'codigo' = 'PR-2' and x->>'clase' = 'ninguno')
     or not exists (select 1 from jsonb_array_elements(v_r->'lineas') x where x->>'cuenta' = '70009002' and x->>'papel' = 'promociones')
     or not exists (select 1 from jsonb_array_elements(v_r->'lineas') x where x->>'cuenta' = '70500001' and x->>'papel' = 'envios')
     or exists (select 1 from jsonb_array_elements(v_r->'lineas') x where x->>'cuenta' like '430%' and x->>'papel' is not null) then
    raise exception 'PRUEBA promociones · 5: %', v_r;
  end if;
  raise notice 'PRUEBA promociones · 5: validado; el resumen trae el descuento, el envío y la clase de cada pedido, y el papel de cada línea.';
  -- 6
  begin
    perform public.conta_envio_aclarar(current_setting('prueba_promo.pr3')::uuid, 'lo_paga', 'Otra vez (prueba)', 'Prueba C06b');
    v_msg := null;
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'El pedido PR-3 está en un asiento ya validado%' then
    raise exception 'PRUEBA promociones · 6: ha cambiado lo de un validado, o dice otra cosa: %', v_msg;
  end if;
  raise notice 'PRUEBA promociones · 6: lo validado no se cambia aquí: «%»', v_msg;
end $$;
reset role;

\echo '>>> Prueba de promociones y envíos en verde. ROLLBACK: no queda nada.'
rollback;
