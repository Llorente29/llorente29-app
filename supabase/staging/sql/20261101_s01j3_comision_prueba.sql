-- supabase/staging/sql/20261101_s01j3_comision_prueba.sql
--
-- S01j·3 · Prueba en ROLLBACK de la tanda claude/s01j3-just-eat-negativo
-- (1540 y 1541), con la cuenta A de staging y datos inventados (T11), como el
-- servicio (la entrada por correo):
--
--   1. Con la versión de antes, el abono de Just Eat (factura −5,98) se guarda
--      con la comisión del revés (−5,98): la prueba caza el fallo.
--   2. Con la 1540: el abono se guarda +5,98 y la liquidación cuadra (ventas +
--      comisión + otros = neto); el cargo de siempre, −total; el saldo negativo
--      («debes abonar»: neto −4,33), cuadra.
--   3. Glovo (comisión en positivo) y Uber (sus tasas, ya negativas) se guardan
--      igual que antes.
--   4. La 1541 en una base sin Foodint: nada.
--   5. La vuelta atrás deja la función byte a byte, y otra vez delante.

begin;
-- sin usuario: conta_liquidacion_registrar la llama el servicio (la entrada por correo de conta-facturas-entrada); la prueba entra como él.
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01j·3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert, update on _s to authenticated, service_role;

-- La huella de la función (la de antes: si el workflow ya ha pasado la 1540, se vuelve a la de antes desde su respaldo).
do $$ begin
  if position('then -nullif(p->>''comision''' in (select prosrc from pg_proc where oid = 'public.conta_liquidacion_registrar(uuid,jsonb,text)'::regprocedure)) > 0 then
    perform public._restaurar_funcion('public.conta_liquidacion_registrar(uuid,jsonb,text)', '20261101T1540_s01j3_comision_con_signo');
  end if;
  insert into _s values ('huella_antes', (select md5(prosrc) from pg_proc where oid = 'public.conta_liquidacion_registrar(uuid,jsonb,text)'::regprocedure));
  insert into _s values ('empresa', (select c.id::text from public.company c where c.account_id = 'c01a0000-0000-4000-8000-00000000000a' order by c.created_at limit 1));
end $$;

-- Una liquidación de prueba (de una plataforma, una tienda y una quincena) y lo que se guardó.
create function pg_temp.registrar(p_prov text, p_tienda text, p_desde date, p_extra jsonb) returns public.channel_settlement
language plpgsql as $$
declare r jsonb; cs public.channel_settlement;
begin
  r := public.conta_liquidacion_registrar((select v::uuid from _s where clave = 'empresa'),
         jsonb_build_object('proveedor', p_prov, 'origen', 'correo', 'tienda', p_tienda, 'marca', 'Marca Inventada S01j3',
                            'desde', p_desde, 'hasta', p_desde + 14) || p_extra, 'Prueba S01j3');
  select * into cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  return cs;
end $$;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 1 · Con la de antes: el abono se guarda del revés.
do $$
declare cs public.channel_settlement;
begin
  cs := pg_temp.registrar('justeat', 'Marca Inventada S01j3 (Calle Inventada Uno 1)', date '2026-07-01',
          jsonb_build_object('pedidos', 0, 'ventas', jsonb_build_object('total', 0), 'comision', -5.98, 'otros', -5.98, 'neto', 0, 'referencia', 'S01J3-0'));
  if cs.commission <> -5.98 then
    raise exception 'PRUEBA S01j·3 · 1: con la versión de antes el abono no sale del revés (%): la prueba no caza el fallo.', cs.commission;
  end if;
  raise notice 'PRUEBA S01j·3 · 1: con la de antes, el abono de −5,98 se guarda con comisión −5,98 (del revés): ventas + comisión + otros = −11,96 y el neto es 0.';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
\i supabase/migrations/20261101T1540_s01j3_comision_con_signo.sql
\i supabase/migrations/20261101T1541_s01j3_comision_foodint.sql
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 2 · Con la 1540: el abono, el cargo y el saldo negativo cuadran.
do $$
declare cs public.channel_settlement;
begin
  cs := pg_temp.registrar('justeat', 'Marca Inventada S01j3 (Calle Inventada Dos 2)', date '2026-07-16',
          jsonb_build_object('pedidos', 0, 'ventas', jsonb_build_object('total', 0), 'comision', -5.98, 'otros', -5.98, 'neto', 0, 'referencia', 'S01J3-1'));
  if cs.commission <> 5.98 or cs.gross_sales + cs.commission + cs.other_cost <> cs.net_payout then
    raise exception 'PRUEBA S01j·3 · 2: el abono no se guarda con su signo o no cuadra (comisión %, otros %, neto %).', cs.commission, cs.other_cost, cs.net_payout;
  end if;
  cs := pg_temp.registrar('justeat', 'Marca Inventada S01j3 (Calle Inventada Tres 3)', date '2026-08-01',
          jsonb_build_object('pedidos', 4, 'ventas', jsonb_build_object('total', 144.02), 'comision', 32.79, 'otros', -20.93, 'neto', 90.30, 'referencia', 'S01J3-2'));
  if cs.commission <> -32.79 or cs.gross_sales + cs.commission + cs.other_cost <> cs.net_payout then
    raise exception 'PRUEBA S01j·3 · 2: el cargo de siempre ya no se guarda como antes (comisión %).', cs.commission;
  end if;
  cs := pg_temp.registrar('justeat', 'Marca Inventada S01j3 (Calle Inventada Cuatro 4)', date '2026-08-16',
          jsonb_build_object('pedidos', 0, 'ventas', jsonb_build_object('total', 0), 'comision', 4.33, 'otros', 0, 'neto', -4.33, 'referencia', 'S01J3-3'));
  if cs.commission <> -4.33 or cs.net_payout <> -4.33 or cs.gross_sales + cs.commission + cs.other_cost <> cs.net_payout then
    raise exception 'PRUEBA S01j·3 · 2: el saldo negativo no cuadra (comisión %, neto %).', cs.commission, cs.net_payout;
  end if;
  raise notice 'PRUEBA S01j·3 · 2: el abono se guarda +5,98, el cargo −32,79 y el saldo negativo −4,33: las tres cuadran.';
end $$;

-- 3 · Glovo y Uber, igual que antes.
do $$
declare cs public.channel_settlement;
begin
  cs := pg_temp.registrar('glovo', 'Marca Inventada S01j3 - MAD - Calle Inventada Cinco 5 (Calle Inventada Cinco 5)', date '2026-07-01',
          jsonb_build_object('pedidos', 8, 'ventas', jsonb_build_object('total', 183.5), 'comision', 56.1, 'otros', 36, 'neto', 163.4, 'referencia', 'S01J3-G'));
  if cs.commission <> -56.1 or cs.gross_sales + cs.commission + cs.other_cost <> cs.net_payout then
    raise exception 'PRUEBA S01j·3 · 3: Glovo ya no se guarda como antes (comisión %).', cs.commission;
  end if;
  cs := pg_temp.registrar('uber', 'Marca Inventada S01j3 (Calle Inventada Seis 6, Madrid, ES, 28001)', date '2026-07-01',
          jsonb_build_object('pedidos', 4, 'ventas', jsonb_build_object('total', 100), 'comision', -30, 'otros', 0, 'neto', 70));
  if cs.commission <> -30 then
    raise exception 'PRUEBA S01j·3 · 3: Uber ya no se guarda como antes (comisión %).', cs.commission;
  end if;
  raise notice 'PRUEBA S01j·3 · 3: Glovo (−56,10) y Uber (−30) se guardan igual que antes.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 4 · La 1541 sin Foodint: nada.
do $$ begin
  if exists (select 1 from public.s01j3_comision_antes) then
    raise exception 'PRUEBA S01j·3 · 4: la 1541 ha corregido algo en una base sin Foodint.';
  end if;
  raise notice 'PRUEBA S01j·3 · 4: la 1541 no toca nada fuera de Foodint.';
end $$;

-- 5 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261101T1541_s01j3_comision_foodint.down.sql
\i supabase/vuelta-atras/20261101T1540_s01j3_comision_con_signo.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_liquidacion_registrar(uuid,jsonb,text)'::regprocedure) <> (select v from _s where clave = 'huella_antes')
     or to_regclass('public.s01j3_comision_antes') is not null then
    raise exception 'PRUEBA S01j·3 · 5: la vuelta atrás no deja la función como estaba.';
  end if;
  raise notice 'PRUEBA S01j·3 · 5: la vuelta atrás deja conta_liquidacion_registrar byte a byte (md5 %).', (select v from _s where clave = 'huella_antes');
end $$;
\i supabase/migrations/20261101T1540_s01j3_comision_con_signo.sql
\i supabase/migrations/20261101T1541_s01j3_comision_foodint.sql

rollback;
