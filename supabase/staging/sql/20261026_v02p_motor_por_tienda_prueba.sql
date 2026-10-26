-- supabase/staging/sql/20261026_v02p_motor_por_tienda_prueba.sql
--
-- SOLO STAGING. Prueba de 20261026T0125_v02p_motor_por_tienda (cambia:
-- public.conta_liquidaciones, public.conta_liquidacion_resolver y
-- public.conta_liquidacion_resolucion), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. En la empresa de la cuenta A que tiene tiendas.
--
--   (Empieza con su vuelta atrás, por si ya estuviera.)
--   0. Lo de antes: la huella de las dos funciones. Los datos: dos marcas con
--      pedidos de Uber la misma semana en Norte Centro (100 € y 60 €), la tienda
--      de la primera con su marca, y el corte.
--   1. La liquidación de la tienda de la primera marca (135 € a precio de carta,
--      sus pedidos suman 100 € con las promociones) se compara con lo que vendió
--      ESA marca (100 €): no sale ninguna diferencia (antes salía la de la otra
--      marca, 60 €, y los 35 € de promociones, como si faltaran).
--   2. La segunda marca, sin liquidación, sale aparte: «Falta su liquidación» por
--      su tienda, con sus 60 €.
--   3. Una liquidación de antes del corte (de referencia) no sale como «Diferencia».
--   4. Las diferencias de dos tiendas del mismo local y la misma semana se
--      resuelven por separado.
--   5. La vuelta atrás: sin el trabajo de la prueba, las dos funciones como
--      estaban (su huella), sin la marca en las diferencias.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V02P: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261026T0125_v02p_motor_por_tienda.down.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;
insert into _p select 'fn:' || p.proname, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('conta_liquidaciones', 'conta_liquidacion_resolver');

-- 0 · Los datos (como postgres).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_uber constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';
  v_b1 constant uuid := 'e0200000-0000-4000-8000-00000000a0b1'; v_b2 constant uuid := 'e0200000-0000-4000-8000-00000000a0b2';
  v_e uuid; v_centro uuid; v_s uuid; v_w date := date_trunc('week', current_date)::date - 14;
begin
  select ps.company_id into v_e from public.platform_store ps where ps.account_id = v_acc order by ps.created_at limit 1;
  if v_e is null then select c.id into v_e from public.company c where c.account_id = v_acc order by c.created_at limit 1; end if;
  select id into v_centro from public.locations where account_id = v_acc and name = 'Norte Centro';
  if v_e is null or v_centro is null then raise exception 'PRUEBA V02P: falta la empresa o Norte Centro de la cuenta A.'; end if;
  update public.locations set address = 'Calle Prueba Tiendas, 1' where id = v_centro;
  update public.party_role set settlement_every = 'weekly', payout_days_after = 1 where account_id = v_acc and role = 'platform' and channel_id = v_uber;
  delete from public.bank_settings where company_id = v_e;
  insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, v_w - 30);
  -- Pedidos de Uber de la semana W: la marca 1 vende 100, la marca 2 vende 60.
  insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status) values
    (v_acc, v_centro, v_b1, v_uber, 'manual', (v_w + 1)::timestamp + time '13:00', 60.00, 5.45, 54.55, 'closed'),
    (v_acc, v_centro, v_b1, v_uber, 'manual', (v_w + 2)::timestamp + time '21:00', 40.00, 3.64, 36.36, 'closed'),
    (v_acc, v_centro, v_b2, v_uber, 'manual', (v_w + 3)::timestamp + time '14:00', 60.00, 5.45, 54.55, 'closed');
  -- La tienda de la marca 1, con su marca y su local.
  insert into public.platform_store (account_id, company_id, provider, external_text, channel_id, brand_id, location_id, created_by_name)
  values (v_acc, v_e, 'uber', 'Burger V02P (Calle Prueba Tiendas 1, Madrid, ES, 28001)', v_uber, v_b1, v_centro, 'Prueba V02P') returning id into v_s;
  insert into public.platform_store_tramo (account_id, store_id, brand_id, location_id, valid_from, motivo, created_by_name)
  values (v_acc, v_s, v_b1, v_centro, null, 'Prueba V02P', 'Prueba V02P');
  insert into _p values ('empresa', v_e::text), ('centro', v_centro::text), ('w', v_w::text), ('tienda', v_s::text);
end $$;

\i supabase/migrations/20261026T0125_v02p_motor_por_tienda.sql

-- 1 y 3 · Las liquidaciones, como el servicio.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
do $$
declare v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_w date := (select v::date from _p where clave = 'w'); v_r jsonb;
begin
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda', 'Burger V02P (Calle Prueba Tiendas 1, Madrid, ES, 28001)',
    'desde', v_w, 'hasta', v_w + 6, 'neto', 70, 'pedidos', 2, 'ventas', jsonb_build_object('total', 135), 'pedidos_total', 100, 'comision', 30, 'otros', -35), 'Prueba V02P');
  insert into _p values ('liq', v_r->>'liquidacion_id');
  -- 3 · Una de antes del corte, que no cuadra con nada: de referencia.
  v_r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'uber', 'origen', 'informe', 'tienda', 'Burger V02P (Calle Prueba Tiendas 1, Madrid, ES, 28001)',
    'desde', v_w - 63, 'hasta', v_w - 57, 'neto', 7, 'ventas', jsonb_build_object('total', 10)), 'Prueba V02P');
  update public.channel_settlement set is_reference = true where id = (v_r->>'liquidacion_id')::uuid;
end $$;

-- 1 a 4 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _p where clave = 'empresa'); v_centro uuid := (select v::uuid from _p where clave = 'centro');
  v_w date := (select v::date from _p where clave = 'w'); v_m jsonb; v_f jsonb; v_rol uuid; v_r jsonb;
begin
  v_m := public.conta_liquidaciones(v_e, v_w - 70, current_date);
  -- 1 · La tienda de la marca 1: su liquidación contra lo que vendió la marca 1.
  select x into v_f from jsonb_array_elements(v_m) x
   where (x->>'desde')::date = v_w and x->>'local_id' = v_centro::text and x->>'marca_id' = 'e0200000-0000-4000-8000-00000000a0b1';
  if v_f is null or v_f->>'estado' = 'diferencia' or (v_f->'piezas'->'vendido'->>'total')::numeric <> 100 or (v_f->'piezas'->'vendido'->'pedidos'->>'pedidos')::int <> 2
     or (v_f->'piezas'->'liquidacion'->>'ventas')::numeric <> 135 or (v_f->'piezas'->'liquidacion'->>'pedidos_total')::numeric <> 100 then
    raise exception 'PRUEBA V02P 1: la liquidación de la tienda no se compara con lo que vendió su marca (%).', v_f;
  end if;
  raise notice '1 · la liquidación de una tienda (135 € de carta, sus pedidos suman %) se compara con lo que vendió su marca: % €, sin diferencia',
    v_f->'piezas'->'liquidacion'->>'pedidos_total', v_f->'piezas'->'vendido'->>'total';
  -- 2 · La marca 2, aparte y sin liquidación.
  select x into v_f from jsonb_array_elements(v_m) x
   where (x->>'desde')::date = v_w and x->>'local_id' = v_centro::text and x->>'marca_id' = 'e0200000-0000-4000-8000-00000000a0b2';
  if v_f is null or v_f->>'estado' <> 'falta_liquidacion' or (v_f->'piezas'->'vendido'->>'total')::numeric <> 60 then
    raise exception 'PRUEBA V02P 2: la otra marca no sale aparte, sin liquidación, con sus 60 € (%).', v_f;
  end if;
  raise notice '2 · la otra marca sale aparte: Falta su liquidación, con sus 60 €';
  -- 3 · La de antes del corte no es una diferencia.
  select x into v_f from jsonb_array_elements(v_m) x where (x->>'desde')::date = v_w - 63 and x->>'local_id' = v_centro::text;
  if v_f is null or v_f->>'estado' = 'diferencia' then raise exception 'PRUEBA V02P 3: la de antes del corte sale como diferencia (%).', v_f; end if;
  raise notice '3 · la de antes del corte: %', v_f->>'frase';
  -- 4 · Dos tiendas del mismo local y semana se resuelven por separado.
  v_rol := (select (x->>'intermediario_id')::uuid from jsonb_array_elements(v_m) x where (x->>'desde')::date = v_w limit 1);
  v_r := public.conta_liquidacion_resolver(v_e, v_rol, v_centro, 'e0200000-0000-4000-8000-00000000a0b1', v_w, v_w + 6, 'reclamacion', 2, 'Marca 1: lo reclamo.', null, null, 'Prueba V02P');
  v_r := public.conta_liquidacion_resolver(v_e, v_rol, v_centro, 'e0200000-0000-4000-8000-00000000a0b2', v_w, v_w + 6, 'reclamacion', 3, 'Marca 2: lo reclamo.', null, null, 'Prueba V02P');
  if v_r->>'texto' not like '%hasta que llegue%' then raise exception 'PRUEBA V02P 4: la segunda resolución no dice lo que ha hecho (%).', v_r; end if;
  begin
    perform public.conta_liquidacion_resolver(v_e, v_rol, v_centro, 'e0200000-0000-4000-8000-00000000a0b2', v_w, v_w + 6, 'reclamacion', 3, 'Otra vez.', null, null, 'Prueba V02P');
    raise exception 'PRUEBA V02P 4: deja resolver dos veces la misma tienda.';
  exception when unique_violation then null;
  end;
  select x into v_f from jsonb_array_elements(public.conta_liquidaciones(v_e, v_w - 70, current_date)) x
   where (x->>'desde')::date = v_w and x->>'marca_id' = 'e0200000-0000-4000-8000-00000000a0b2';
  if (v_f->>'reclamado_sin_llegar')::numeric <> 3 then raise exception 'PRUEBA V02P 4: lo reclamado de la marca 2 no es suyo (%).', v_f; end if;
  raise notice '4 · dos tiendas del mismo local y semana se resuelven por separado';
end $$;
reset role;

-- 5 · La vuelta atrás: sin el trabajo de la prueba (su guarda, para si lo hay), todo como estaba.
delete from public.conta_liquidacion_resolucion where company_id = (select v::uuid from _p where clave = 'empresa');
\i supabase/vuelta-atras/20261026T0125_v02p_motor_por_tienda.down.sql
do $$ begin
  if exists (select 1 from _p b join pg_proc p on 'fn:' || p.proname = b.clave join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text) <> b.v) then
    raise exception 'PRUEBA V02P 5: conta_liquidaciones o conta_liquidacion_resolver no vuelven como estaban.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_liquidacion_resolucion' and column_name = 'brand_id')
     or to_regprocedure('public.conta_liquidacion_resolver(uuid,uuid,uuid,uuid,date,date,text,numeric,text,date,jsonb,text)') is not null then
    raise exception 'PRUEBA V02P 5: la vuelta atrás se deja la marca o el resolutor nuevo.';
  end if;
  raise notice '5 · la vuelta atrás: todo como estaba';
  raise notice 'PRUEBA V02P en verde: el motor por tienda, la marca sin liquidación aparte, lo de antes del corte y las diferencias de cada tienda.';
end $$;

rollback;
