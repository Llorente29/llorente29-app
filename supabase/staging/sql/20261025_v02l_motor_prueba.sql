-- supabase/staging/sql/20261025_v02l_motor_prueba.sql
--
-- SOLO STAGING. Prueba de 20261025T2253_v02l_motor_liquidaciones (añade) y
-- 20261025T2254_v02l_motor_cambia (cambia: public.conta_liquidacion_resolucion,
-- public.conta_liquidacion_registrar, public.conta_tienda_plataforma_asignar y
-- public.supplier_invoice), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. En la empresa de la cuenta A que tiene tiendas.
--
--   (Empieza con sus vueltas atrás, por si ya estuvieran.)
--   0. Lo de antes: las huellas de las dos funciones que cambian. Los datos:
--      direcciones de los locales, un local cerrado, el calendario de Uber,
--      cierres de cuatro semanas y el corte.
--   1. El correo de Uber: tienda nueva con su local por la dirección, su nombre y
--      su tramo; quien te paga (el papel de Uber); la misma semana otra vez, nada.
--   2. El informe de Uber con el ID de la tienda: la misma semana no se duplica,
--      y la tienda aprende su ID.
--   3. El motor: Falta su factura → Esperando el cobro → Cuadra (cerrada).
--   4. Una diferencia: «Lo reclamo» la resuelve, se recuerda hasta que llega.
--   5. Sin liquidación: Falta su liquidación (pasado su plazo) y Esperando
--      liquidación (aún a tiempo).
--   6. Glovo: la factura de comisión se engancha sola, llegue antes o después.
--   7. Just Eat sin papel en Contactos: se da de alta con su primera liquidación.
--   8. La tienda (por su ID) llega en otra dirección: se apunta, no se mueve;
--      confirmarla abre un tramo desde ese día y lo de antes no se mueve; una
--      liquidación del local cerrado avisa.
--   9. «Apuntar a mano», de un intermediario sin canal de venta (tipo Stripe):
--      se cuadra igual; su diferencia se resuelve por su contacto.
--  10. Cambiar en Sus tiendas la marca que ya tenía: tramo desde hoy.
--  11. Las vueltas atrás: sin el trabajo de la prueba, las dos funciones como
--      estaban (su huella) y sin nada de lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V02L: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/vuelta-atras/20261025T2254_v02l_motor_cambia.down.sql
\i supabase/vuelta-atras/20261025T2253_v02l_motor_liquidaciones.down.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;
insert into _p select 'fn:' || p.proname, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('conta_liquidacion_registrar', 'conta_tienda_plataforma_asignar');
insert into _p select 'tiendas_antes', count(*)::text from public.platform_store;

-- 0 · Los datos de prueba (como postgres).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid; v_centro uuid; v_cerrado uuid; v_w date := date_trunc('week', current_date)::date - 21; d int;
begin
  select ps.company_id into v_e from public.platform_store ps where ps.account_id = v_acc order by ps.created_at limit 1;
  if v_e is null then select c.id into v_e from public.company c where c.account_id = v_acc order by c.created_at limit 1; end if;
  if v_e is null then raise exception 'PRUEBA V02L: la cuenta A no tiene empresa.'; end if;
  select id into v_centro from public.locations where account_id = v_acc and name = 'Norte Centro';
  if v_centro is null then raise exception 'PRUEBA V02L: falta el local Norte Centro de la cuenta A.'; end if;
  update public.locations set address = 'Calle Prueba Liquidaciones, 1' where id = v_centro;
  insert into public.locations (account_id, name, address, active) values (v_acc, 'Local Cerrado V02L', 'Calle Prueba Liquidaciones, 3', false) returning id into v_cerrado;
  -- Uber: cada semana, paga al día siguiente; Glovo: cada quincena, a los 20 días.
  update public.party_role set settlement_every = 'weekly', payout_days_after = 1, payout_margin_days = null
   where account_id = v_acc and role = 'platform' and channel_id = 'e0200000-0000-4000-8000-00000000a0c2';
  update public.party_role set settlement_every = 'fortnightly', payout_days_after = 20
   where account_id = v_acc and role = 'platform' and channel_id = 'e0200000-0000-4000-8000-00000000a0c1';
  delete from public.party_role where account_id = v_acc and role = 'platform' and channel_id = 'e0200000-0000-4000-8000-00000000a0c3';
  -- Cierres de Uber en Norte Centro: W−1 (80, sin liquidación), W (100), W+1 (50) y esta semana (30).
  for d in 0..3 loop
    insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, total, tickets_count, channel_id, unit_key, sale_ids, detail_hash)
    values (v_acc, v_e, v_centro, v_w + (d - 1) * 7 + 2, case d when 0 then 80 when 1 then 100 when 2 then 50 else 0 end, 1,
            'e0200000-0000-4000-8000-00000000a0c2', 'v02l-prueba-' || d, '{}', 'v02l-prueba');
  end loop;
  insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, total, tickets_count, channel_id, unit_key, sale_ids, detail_hash)
  values (v_acc, v_e, v_centro, current_date, 30, 1, 'e0200000-0000-4000-8000-00000000a0c2', 'v02l-prueba-hoy', '{}', 'v02l-prueba');
  -- El corte, antes de todo esto (lo de antes del corte no se pide).
  delete from public.bank_settings where company_id = v_e;
  insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, v_w - 60);
  insert into _p values ('empresa', v_e::text), ('centro', v_centro::text), ('cerrado', v_cerrado::text), ('w', v_w::text);
end $$;

\i supabase/migrations/20261025T2253_v02l_motor_liquidaciones.sql
\i supabase/migrations/20261025T2254_v02l_motor_cambia.sql

-- La siembra: un nombre y un tramo por tienda que ya estaba.
do $$ begin
  if (select count(*) from public.platform_store_alias) <> (select count(*) from public.platform_store)
     or (select count(*) from public.platform_store_tramo where valid_from is null and valid_to is null) <> (select count(*) from public.platform_store) then
    raise exception 'PRUEBA V02L 0: la siembra no da un nombre y un tramo por tienda (% tiendas, % nombres, % tramos).',
      (select count(*) from public.platform_store), (select count(*) from public.platform_store_alias), (select count(*) from public.platform_store_tramo);
  end if;
  raise notice '0 · la siembra: un nombre y un tramo desde siempre por tienda';
end $$;

-- 1 y 2 · Como el servicio (la entrada por correo y la subida de un fichero).
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_centro uuid := (select v::uuid from _p where clave = 'centro');
  v_w date := (select v::date from _p where clave = 'w'); v_r jsonb; v_r2 jsonb; v_s public.platform_store; v_cs public.channel_settlement;
  v_tienda constant text := 'Burger Prueba V02L (Calle Prueba Liquidaciones 1, Madrid, ES, 28001)';
begin
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'marca', 'Burger Prueba V02L', 'tienda', v_tienda,
    'desde', v_w, 'hasta', v_w + 6, 'pedidos', 4, 'neto', 70, 'ventas', jsonb_build_object('total', 100, 'base', 90.91, 'iva', 9.09),
    'uber', jsonb_build_object('tasas', -30, 'otros', 0),
    'factura', jsonb_build_object('total', 30, 'base', 24.79, 'iva', 5.21, 'comision', jsonb_build_object('base', 24.79), 'publicidad', jsonb_build_object('base', 0))), 'Prueba V02L');
  select * into v_s from public.platform_store where id = (v_r->>'tienda_id')::uuid;
  select * into v_cs from public.channel_settlement where id = (v_r->>'liquidacion_id')::uuid;
  if not (v_r->>'tienda_nueva')::boolean or v_s.location_id is distinct from v_centro then
    raise exception 'PRUEBA V02L 1: la tienda nueva no sale con su local por la dirección (%).', v_r;
  end if;
  if (select count(*) from public.platform_store_alias where store_id = v_s.id) <> 1 or (select count(*) from public.platform_store_tramo where store_id = v_s.id) <> 1 then
    raise exception 'PRUEBA V02L 1: la tienda nueva no tiene su nombre y su tramo.';
  end if;
  if v_cs.source <> 'correo_uber' or v_cs.import_key <> 'uber-correo:' || v_s.id || ':' || v_w || ':' || (v_w + 6) or v_cs.location_id is distinct from v_centro
     or v_cs.commission <> -30 or v_cs.net_payout <> 70 or v_cs.period_grain <> 'week' or v_cs.party_id is null then
    raise exception 'PRUEBA V02L 1: el correo de Uber no se guarda como antes (%).', to_jsonb(v_cs) - 'raw';
  end if;
  if v_cs.party_id <> (select party_id from public.party_role where account_id = v_s.account_id and role = 'platform' and channel_id = 'e0200000-0000-4000-8000-00000000a0c2') then
    raise exception 'PRUEBA V02L 1: quien te paga no es el papel de Uber de Contactos.';
  end if;
  v_r2 := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'tienda', v_tienda, 'desde', v_w, 'hasta', v_w + 6, 'neto', 70,
    'ventas', jsonb_build_object('total', 100)), 'Prueba V02L');
  if not (v_r2->>'ya_estaba')::boolean or v_r2->>'liquidacion_id' <> v_r->>'liquidacion_id' then raise exception 'PRUEBA V02L 1: la misma semana otra vez crea otra (%).', v_r2; end if;
  insert into _p values ('tienda', v_s.id::text), ('liq_w', v_cs.id::text);
  raise notice '1 · el correo de Uber: tienda nueva con su local, su nombre y su tramo; la misma semana otra vez, nada';

  -- 2 · El informe, con el ID: no duplica la semana y la tienda aprende su ID.
  v_r2 := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda', v_tienda, 'tienda_id', 'v02l-uuid-1',
    'desde', v_w, 'hasta', v_w + 6, 'neto', 70, 'ventas', jsonb_build_object('total', 100)), 'Prueba V02L');
  if not (v_r2->>'ya_estaba')::boolean or not (v_r2->>'aprendido_id')::boolean or (select external_id from public.platform_store where id = v_s.id) <> 'v02l-uuid-1' then
    raise exception 'PRUEBA V02L 2: el informe con el ID duplica la semana o no enseña el ID a la tienda (%).', v_r2;
  end if;
  v_r2 := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda', v_tienda, 'tienda_id', 'v02l-uuid-1',
    'desde', v_w, 'hasta', v_w + 6, 'neto', 71, 'ventas', jsonb_build_object('total', 100)), 'Prueba V02L');
  if v_r2->>'texto' not like '%revísala%' then raise exception 'PRUEBA V02L 2: la misma semana con otro neto no lo dice (%).', v_r2->>'texto'; end if;
  raise notice '2 · el informe con el ID: la misma semana no se duplica, dice si no cuadra, y la tienda aprende su ID';
end $$;

-- 3 a 5 · El motor.
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_centro uuid := (select v::uuid from _p where clave = 'centro');
  v_w date := (select v::date from _p where clave = 'w'); v_liq uuid := (select v::uuid from _p where clave = 'liq_w');
  v_inv uuid; v_f jsonb; v_m jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  v_m := public.conta_liquidaciones(v_e, v_w - 14, current_date);
  select x into v_f from jsonb_array_elements(v_m) x where (x->>'desde')::date = v_w and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'falta_factura' or (v_f->'piezas'->'vendido'->>'total')::numeric <> 100 or (v_f->'piezas'->'liquidacion'->>'pagan')::numeric <> 70 then
    raise exception 'PRUEBA V02L 3: la semana con su liquidación y sin factura no sale «Falta su factura» (%).', v_f;
  end if;
  -- Su factura (la semanal de Uber, enlazada en Compras).
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source)
  values ('c01a0000-0000-4000-8000-00000000000a', v_e, 'c0300000-0000-4000-8000-000000000001', 'V02L-UBER-1', v_w + 7, 30, 'borrador', 'manual') returning id into v_inv;
  update public.channel_settlement set commission_invoice_id = v_inv where id = v_liq;
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x where (x->>'desde')::date = v_w and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'esperando_cobro' then raise exception 'PRUEBA V02L 3: con su factura no sale «Esperando el cobro» (%).', v_f->>'estado'; end if;
  update public.channel_settlement set collected_on = v_w + 8, collected_amount = 70 where id = v_liq;
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x where (x->>'desde')::date = v_w and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'cuadra' or not (v_f->>'cerrada')::boolean then raise exception 'PRUEBA V02L 3: con las cuatro piezas no cuadra y se cierra (%).', v_f; end if;
  raise notice '3 · el motor: Falta su factura → Esperando el cobro → Cuadra, cerrada';

  -- 5 · Sin liquidación: W−1, pasado su plazo; esta semana, aún a tiempo.
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x where (x->>'desde')::date = v_w - 7 and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'falta_liquidacion' or (v_f->'piezas'->'vendido'->>'total')::numeric <> 80 then
    raise exception 'PRUEBA V02L 5: la semana con ventas y sin liquidación, pasado su plazo, no sale «Falta su liquidación» (%).', v_f;
  end if;
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x
   where (x->>'desde')::date = date_trunc('week', current_date)::date and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'esperando_liquidacion' then raise exception 'PRUEBA V02L 5: esta semana no sale «Esperando liquidación» (%).', v_f; end if;
  raise notice '5 · sin liquidación: Falta su liquidación (pasado su plazo) y Esperando liquidación (aún a tiempo)';
end $$;

-- 4 · Una diferencia, reclamada hasta que llega.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_w date := (select v::date from _p where clave = 'w'); v_r jsonb;
begin
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda_id', 'v02l-uuid-1',
    'tienda', 'Burger Prueba V02L (Calle Prueba Liquidaciones 1, Madrid, ES, 28001)', 'desde', v_w + 7, 'hasta', v_w + 13, 'neto', 40,
    'ventas', jsonb_build_object('total', 45), 'comision', 5), 'Prueba V02L');
  update public.channel_settlement set collected_on = v_w + 15, collected_amount = 40 where id = (v_r->>'liquidacion_id')::uuid;
  insert into _p values ('liq_w2', v_r->>'liquidacion_id');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_centro uuid := (select v::uuid from _p where clave = 'centro');
  v_w date := (select v::date from _p where clave = 'w'); v_f jsonb; v_r jsonb; v_rol uuid;
begin
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x where (x->>'desde')::date = v_w + 7 and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'diferencia' or (v_f->>'diferencia')::numeric <> 5 then
    raise exception 'PRUEBA V02L 4: vendiste 50 y liquida 45, y no sale «Diferencia de 5 €» (%).', v_f;
  end if;
  v_rol := (v_f->>'intermediario_id')::uuid;
  v_r := public.conta_liquidacion_resolver(v_e, v_rol, v_centro, v_w + 7, v_w + 13, 'reclamacion', 5, 'Faltan dos bebidas: lo reclamo.', null, null, 'Prueba V02L');
  if v_r->>'texto' not like '%hasta que llegue%' then raise exception 'PRUEBA V02L 4: «Lo reclamo» no dice que se recuerda (%).', v_r; end if;
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x where (x->>'desde')::date = v_w + 7 and x->>'local_id' = v_centro::text;
  if v_f->>'estado' <> 'cuadra' or (v_f->>'cerrada')::boolean or (v_f->>'reclamado_sin_llegar')::numeric <> 5 then
    raise exception 'PRUEBA V02L 4: reclamada, no cuadra sin cerrarse con 5 € por llegar (%).', v_f;
  end if;
  perform public.conta_reclamacion_llegada((v_r->>'id')::uuid, v_w + 20, 5, null, 'Prueba V02L');
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 14, current_date)) x where (x->>'desde')::date = v_w + 7 and x->>'local_id' = v_centro::text;
  if not (v_f->>'cerrada')::boolean then raise exception 'PRUEBA V02L 4: llegado lo reclamado, no se cierra (%).', v_f; end if;
  insert into _p values ('rol_uber', v_rol::text);
  raise notice '4 · una diferencia de 5 €: «Lo reclamo» la resuelve y se recuerda hasta que llega';
end $$;
reset role;

-- 6 y 7 · Glovo y Just Eat, como el servicio.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_q date := date_trunc('month', current_date)::date - interval '1 month'; v_r jsonb; v_inv uuid; v_inv2 uuid; v_n int;
begin
  -- 6 · La liquidación antes que su factura: se engancha al llegar la factura.
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'glovo', 'origen', 'excel', 'tienda_id', 'v02l-glovo-1',
    'tienda', 'Pita Prueba V02L (Calle Prueba Liquidaciones 1, Madrid)', 'desde', v_q, 'hasta', v_q + 14, 'neto', 236.27, 'pedidos', 11,
    'ventas', jsonb_build_object('total', 218), 'comision', 43.23, 'otros', 61.5,
    'factura', jsonb_build_object('numero', 'IV02L000001', 'base', 35.73, 'iva', 7.5, 'total', 43.23)), 'Prueba V02L');
  if v_r->>'factura_id' is not null then raise exception 'PRUEBA V02L 6: engancha una factura que aún no ha llegado.'; end if;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source)
  values (v_acc, v_e, 'c0300000-0000-4000-8000-000000000001', 'IV02L000001', v_q + 14, 43.23, 'borrador', 'manual') returning id into v_inv;
  if (select commission_invoice_id from public.channel_settlement where id = (v_r->>'liquidacion_id')::uuid) is distinct from v_inv then
    raise exception 'PRUEBA V02L 6: al llegar la factura de Glovo a Compras no se engancha sola.';
  end if;
  -- La factura antes que la liquidación: se engancha al leerla.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source)
  values (v_acc, v_e, 'c0300000-0000-4000-8000-000000000001', 'IV02L000002', v_q + 30, 12.1, 'borrador', 'manual') returning id into v_inv2;
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'glovo', 'origen', 'excel', 'tienda_id', 'v02l-glovo-1',
    'tienda', 'Pita Prueba V02L (Calle Prueba Liquidaciones 1, Madrid)', 'desde', v_q + 15, 'hasta', (v_q + interval '1 month')::date - 1, 'neto', 50,
    'ventas', jsonb_build_object('total', 62.1), 'comision', 12.1, 'factura', jsonb_build_object('numero', 'IV02L000002', 'base', 10, 'iva', 2.1, 'total', 12.1)), 'Prueba V02L');
  if (v_r->>'factura_id')::uuid is distinct from v_inv2 or v_r->>'texto' not like '%enganchada%' then
    raise exception 'PRUEBA V02L 6: la factura que ya estaba no se engancha al leer la liquidación (%).', v_r;
  end if;
  insert into _p values ('tienda_glovo', v_r->>'tienda_id');
  raise notice '6 · Glovo: la factura de comisión se engancha sola, llegue antes o después';

  -- 7 · Just Eat, sin papel en Contactos: se da de alta, con su calendario.
  select count(*) into v_n from public.party_role where account_id = v_acc and role = 'platform';
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'justeat', 'origen', 'correo',
    'tienda', 'Burger Prueba V02L JE (Calle Prueba Liquidaciones 1, Madrid, 28001)', 'desde', v_q, 'hasta', v_q + 14, 'neto', 90.3,
    'ventas', jsonb_build_object('total', 144.02), 'comision', 32.79, 'otros', -20.93,
    'factura', jsonb_build_object('numero', 'V02LJE1', 'base', 27.1, 'iva', 5.69, 'total', 32.79),
    'intermediario', jsonb_build_object('nombre', 'Just Eat Prueba V02L', 'nif', 'B00000002')), 'Prueba V02L');
  if (select count(*) from public.party_role where account_id = v_acc and role = 'platform') <> v_n + 1
     or not exists (select 1 from public.party_role where id = (v_r->>'intermediario_id')::uuid and channel_id = 'e0200000-0000-4000-8000-00000000a0c3'
                      and settlement_every = 'fortnightly' and payout_days_after = 4) then
    raise exception 'PRUEBA V02L 7: Just Eat no se da de alta con su primera liquidación y su calendario (%).', v_r;
  end if;
  raise notice '7 · Just Eat sin papel en Contactos: dado de alta con su primera liquidación, cada quincena y 4 días';
end $$;

-- 8 · La tienda en otra dirección.
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_centro uuid := (select v::uuid from _p where clave = 'centro');
  v_cerrado uuid := (select v::uuid from _p where clave = 'cerrado'); v_tienda uuid := (select v::uuid from _p where clave = 'tienda');
  v_w date := (select v::date from _p where clave = 'w'); v_r jsonb;
begin
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda_id', 'v02l-uuid-1',
    'tienda', 'Burger Prueba V02L (Calle Prueba Liquidaciones 3, Madrid, ES, 28001)', 'desde', v_w + 7, 'hasta', v_w + 13, 'neto', 40,
    'ventas', jsonb_build_object('total', 45)), 'Prueba V02L');
  if v_r->>'cambio' is null or (select location_id from public.platform_store where id = v_tienda) is distinct from v_centro
     or not exists (select 1 from public.platform_store_cambio where id = (v_r->>'cambio')::uuid and kind = 'direccion' and (propuesta->>'local')::uuid = v_cerrado) then
    raise exception 'PRUEBA V02L 8: la tienda en otra dirección se mueve sola o no se apunta el cambio (%).', v_r;
  end if;
  insert into _p values ('cambio', v_r->>'cambio');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_centro uuid := (select v::uuid from _p where clave = 'centro');
  v_cerrado uuid := (select v::uuid from _p where clave = 'cerrado'); v_tienda uuid := (select v::uuid from _p where clave = 'tienda');
  v_hoy date := date_trunc('week', current_date)::date; v_r jsonb;
begin
  v_r := public.conta_tienda_cambio_decidir((select v::uuid from _p where clave = 'cambio'), true, null, null, v_hoy, 'Prueba V02L');
  if (select location_id from public.conta_tienda_en(v_tienda, v_hoy)) is distinct from v_cerrado
     or (select location_id from public.conta_tienda_en(v_tienda, v_hoy - 1)) is distinct from v_centro
     or exists (select 1 from public.channel_settlement where store_id = v_tienda and period_from < v_hoy and location_id is distinct from v_centro) then
    raise exception 'PRUEBA V02L 8: confirmar el cambio no abre el tramo desde ese día o mueve lo de antes (%).', v_r;
  end if;
  raise notice '8 · la tienda en otra dirección: se apunta y no se mueve; confirmada, tramo desde ese día y lo de antes donde estaba';
end $$;
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_cerrado uuid := (select v::uuid from _p where clave = 'cerrado');
  v_hoy date := date_trunc('week', current_date)::date; v_r jsonb; v_f jsonb;
begin
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda_id', 'v02l-uuid-1',
    'tienda', 'Burger Prueba V02L (Calle Prueba Liquidaciones 3, Madrid, ES, 28001)', 'desde', v_hoy, 'hasta', v_hoy + 6, 'neto', 10,
    'ventas', jsonb_build_object('total', 12)), 'Prueba V02L');
  if (select location_id from public.channel_settlement where id = (v_r->>'liquidacion_id')::uuid) is distinct from v_cerrado or v_r->>'texto' not like '%está cerrado%' then
    raise exception 'PRUEBA V02L 8: la liquidación del local cerrado no avisa (%).', v_r;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_hoy, v_hoy + 6)) x where x->>'local_id' = v_cerrado::text;
  if not exists (select 1 from jsonb_array_elements(v_f->'avisos') a where a->>'tipo' = 'local_cerrado') then
    raise exception 'PRUEBA V02L 8: la fila del local cerrado no lo avisa (%).', v_f;
  end if;
  raise notice '8 · una liquidación de un local cerrado entra y avisa';
end $$;

-- 9 y 10 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_m date := date_trunc('month', current_date)::date - interval '1 month';
  v_rol uuid; v_r jsonb; v_f jsonb; v_tg uuid := (select v::uuid from _p where clave = 'tienda_glovo'); v_n int;
begin
  -- 9 · Un intermediario sin canal de venta (tipo Stripe): de alta, apuntado a mano y cuadrado igual.
  v_rol := public.conta_intermediario_asegurar(v_e, 'stripe', null, 'Pasarela Prueba V02L', null, 'Prueba V02L');
  v_r := public.conta_liquidacion_apuntar(v_e, jsonb_build_object('intermediario', v_rol, 'desde', v_m, 'hasta', (v_m + interval '1 month')::date - 1,
    'vendido', 120, 'comision', 3.6, 'cobrado', 116.4), 'Prueba V02L');
  if v_r->>'texto' not like '%Falta su factura%' then raise exception 'PRUEBA V02L 9: apuntar a mano no dice que falta su factura (%).', v_r; end if;
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_m, (v_m + interval '1 month')::date - 1)) x where x->>'intermediario_id' = v_rol::text;
  if v_f->>'estado' <> 'falta_factura' or (v_f->'piezas'->'liquidacion'->>'pagan')::numeric <> 116.4 then
    raise exception 'PRUEBA V02L 9: lo apuntado a mano no se cuadra igual (%).', v_f;
  end if;
  begin
    perform public.conta_liquidacion_apuntar(v_e, jsonb_build_object('intermediario', v_rol, 'desde', v_m, 'hasta', (v_m + interval '1 month')::date - 1,
      'vendido', 120, 'comision', 3.6, 'cobrado', 116.4), 'Prueba V02L');
    raise exception 'PRUEBA V02L 9: deja apuntar dos veces la misma.';
  exception when unique_violation then null;
  end;
  v_r := public.conta_liquidacion_resolver(v_e, v_rol, null, v_m, (v_m + interval '1 month')::date - 1, 'reclamacion', 1.2, 'Comisión de más: la reclamo.', null, null, 'Prueba V02L');
  if not exists (select 1 from public.conta_liquidacion_resolucion where id = (v_r->>'id')::uuid and channel_id is null and party_id is not null) then
    raise exception 'PRUEBA V02L 9: la diferencia de un intermediario sin canal no se guarda por su contacto.';
  end if;
  raise notice '9 · un intermediario sin canal: de alta, apuntado a mano, se cuadra igual y su diferencia se resuelve';

  -- 10 · Sus tiendas: darle marca a la que no tenía vale desde siempre; cambiarla, desde hoy.
  perform public.conta_tienda_plataforma_asignar(v_tg, 'e0200000-0000-4000-8000-00000000a0b2', (select location_id from public.platform_store where id = v_tg), null, 'Prueba V02L');
  if (select count(*) from public.platform_store_tramo where store_id = v_tg) <> 1 or (select brand_id from public.conta_tienda_en(v_tg, date '2000-01-01')) is distinct from 'e0200000-0000-4000-8000-00000000a0b2' then
    raise exception 'PRUEBA V02L 10: darle marca a una tienda que no la tenía no vale desde siempre.';
  end if;
  perform public.conta_tienda_plataforma_asignar(v_tg, 'e0200000-0000-4000-8000-00000000a0b1', (select location_id from public.platform_store where id = v_tg), null, 'Prueba V02L');
  if (select count(*) from public.platform_store_tramo where store_id = v_tg) <> 2
     or (select brand_id from public.conta_tienda_en(v_tg, current_date - 1)) is distinct from 'e0200000-0000-4000-8000-00000000a0b2'
     or (select brand_id from public.conta_tienda_en(v_tg, current_date)) is distinct from 'e0200000-0000-4000-8000-00000000a0b1'
     or exists (select 1 from public.channel_settlement where store_id = v_tg and brand_id is distinct from 'e0200000-0000-4000-8000-00000000a0b2') then
    raise exception 'PRUEBA V02L 10: cambiar la marca que ya tenía no abre un tramo desde hoy o mueve lo de antes.';
  end if;
  raise notice '10 · Sus tiendas: dar marca vale desde siempre; cambiarla, desde hoy, y lo de antes no se mueve';
end $$;
reset role;

-- 11 · Las vueltas atrás: sin el trabajo de la prueba (sus guardas, para si lo hay), todo como estaba.
delete from public.conta_liquidacion_resolucion where company_id = (select v::uuid from _p where clave = 'empresa');
delete from public.platform_store_cambio where company_id = (select v::uuid from _p where clave = 'empresa');
delete from public.platform_store_tramo where valid_from is not null;
update public.platform_store set external_id = null where external_id like 'v02l-%';
\i supabase/vuelta-atras/20261025T2254_v02l_motor_cambia.down.sql
\i supabase/vuelta-atras/20261025T2253_v02l_motor_liquidaciones.down.sql
do $$ begin
  if exists (select 1 from _p b join pg_proc p on 'fn:' || p.proname = b.clave join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text) <> b.v) then
    raise exception 'PRUEBA V02L 11: conta_liquidacion_registrar o conta_tienda_plataforma_asignar no vuelven como estaban.';
  end if;
  if to_regclass('public.platform_store_alias') is not null or to_regclass('public.platform_store_tramo') is not null or to_regclass('public.platform_store_cambio') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('conta_liquidaciones', 'conta_tienda_reconocer', 'conta_liquidacion_apuntar', '_v02l_factura_comision_llega'))
     or exists (select 1 from information_schema.columns where table_schema = 'public' and ((table_name = 'payment_method' and column_name = 'party_id')
                  or (table_name = 'conta_liquidacion_resolucion' and column_name in ('arrived_on', 'party_id'))))
     or exists (select 1 from pg_trigger where tgname = 'v02l_factura_comision_llega')
     or (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'conta_liquidacion_resolucion' and column_name = 'channel_id') <> 'NO' then
    raise exception 'PRUEBA V02L 11: las vueltas atrás se dejan tablas, columnas, funciones o el disparador.';
  end if;
  raise notice '11 · las vueltas atrás: todo como estaba';
  raise notice 'PRUEBA V02L en verde: el correo y el informe de Uber, Glovo, Just Eat, las tiendas por su ID y con fecha, el motor con sus cuatro piezas, la diferencia reclamada, apuntar a mano y las vueltas atrás.';
end $$;

rollback;
