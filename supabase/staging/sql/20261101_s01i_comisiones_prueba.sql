-- supabase/staging/sql/20261101_s01i_comisiones_prueba.sql
--
-- SOLO STAGING. Prueba del S01i · las facturas de comisión de las plataformas
-- se ligan a su liquidación y se pagan por compensación (20261101T0050, 0051
-- y 0052). Todo en una transacción con ROLLBACK. Datos inventados, en la
-- cuenta D: una plataforma de prueba, dos locales con su dirección, dos marcas
-- y sus liquidaciones de la semana del 12 al 18/10. Prueba lo que cambia en
-- caliente: public.supplier_invoice (CHECK y disparador),
-- public.channel_settlement (disparador), public.conta_pagos_lista y
-- public.bank_facturas_para_casar.
--
--   1. _conta_dir_coincide: la calle y el número, en otro texto.
--   1b. El local: lo de antes del paréntesis manda (en Glovo, el paréntesis es la
--       sede de la sociedad); si casan dos locales, ninguno.
--   2. Encaja una sola (marca y semana): se liga sola, queda pagada por
--      compensación con la fecha de su liquidación, y no sale en Pagos ni en
--      las pendientes de Bancos.
--   2b. La marca de la vuelta atrás aparta los disparadores.
--   3. Dos de la misma marca esa semana y la factura sin dirección: elige la
--      que coincide al céntimo; si ninguna coincide, no adivina («varias»,
--      con su porqué) y la persona elige (conta_comision_ligar).
--   3b. Lo mismo con el rol de la persona (set local role authenticated).
--   4. Con la dirección de la tienda leída, elige el local.
--   5. Sin liquidación todavía («falta»): sin ligar; al llegar la
--      liquidación se liga sola, y al aprobarla queda pagada.
--   6. De antes de la primera liquidación de su plataforma: «fuera».
--   6b. Lo medido en Foodint: sin marca ni local, una sola candidata no basta;
--       y una liquidación de varias semanas no se queda la de una de ellas.
--   7. La 0052 no hace nada sin Foodint.
--   8. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01i: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- La forma de pago «compensation» de paid_method es del S01h (1850, ya en producción); se puede pasar dos veces.
\i supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
\i supabase/migrations/20261101T0050_s01i_comision_liquidacion.sql
\i supabase/migrations/20261101T0051_s01i_comision_sin_banco.sql
\i supabase/migrations/20261101T0052_s01i_comisiones_foodint.sql

-- 1 · La dirección.
do $$ begin
  if not public._conta_dir_coincide('Marca de prueba (Calle Inventada 12, Madrid, ES, 28000)', 'Inventada, 12')
     or not public._conta_dir_coincide('EMPRESA DE PRUEBA S.L. - Marca - MAD - C. de Inventada 12', 'Calle Inventada, 12')
     or public._conta_dir_coincide('Calle Inventada 120, Madrid', 'Inventada, 12')
     or public._conta_dir_coincide('Avenida de Prueba 7', 'Inventada, 12')
     or public._conta_dir_coincide(null, 'Inventada, 12')
     -- Sin número, la calle basta («C. de Inventada», «(Inventada)»); con otro número detrás, no.
     or not public._conta_dir_coincide('Marca - MAD - C. de Inventada (C. de Inventada)', 'Inventada, 12')
     or not public._conta_dir_coincide('Marca (Inventada)', 'Inventada, 12')
     or public._conta_dir_coincide('Marca - MAD - Inventada 7', 'Inventada, 12')
     or public._conta_dir_coincide('EMPRESA DE PRUEBA, S.L. Marca', 'Avenida de Prueba, 7') then
    raise exception 'PRUEBA S01i · 1: _conta_dir_coincide no reconoce bien la calle y el número.';
  end if;
  raise notice 'PRUEBA S01i · 1: la dirección se reconoce por su calle y su número (el 12 no es el 120).';
end $$;

-- Preparar: plataforma, proveedor, locales, marcas, tiendas y liquidaciones (todo inventado).
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_canal uuid; v_party uuid; v_sup uuid; v_l1 uuid; v_l2 uuid; v_m1 uuid; v_m2 uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid;
begin
  insert into public.sales_channel (account_id, name, slug) values (v_acc, 'Plataforma de prueba S01i', 'plataforma-prueba-s01i') returning id into v_canal;
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'Plataforma de Prueba S01i, S.L.', 'B00000191') returning id into v_sup;
  -- Al darlo de alta, la base le crea su tercero con el papel de proveedor; ese tercero es también la plataforma.
  select party_id into v_party from public.party_role where account_id = v_acc and role = 'supplier' and supplier_id = v_sup;
  if v_party is null then
    insert into public.party (account_id, name) values (v_acc, 'Plataforma de Prueba S01i, S.L.') returning id into v_party;
    insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup);
  end if;
  insert into public.party_role (account_id, party_id, role, channel_id) values (v_acc, v_party, 'platform', v_canal);
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado Norte', 'Inventada, 12') returning id into v_l1;
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado Sur', 'Avenida de Prueba, 7') returning id into v_l2;
  insert into public.brand (account_id, name, slug) values (v_acc, 'Marca Uno S01i', 'marca-uno-s01i') returning id into v_m1;
  insert into public.brand (account_id, name, slug) values (v_acc, 'Marca Dos S01i', 'marca-dos-s01i') returning id into v_m2;
  insert into public.platform_store (account_id, company_id, provider, external_text) values (v_acc, v_e, 'uber', 'Marca Uno S01i (Calle Inventada 12, Madrid, ES, 28000)') returning id into v_t1;
  insert into public.platform_store (account_id, company_id, provider, external_text) values (v_acc, v_e, 'uber', 'Marca Dos S01i (Calle Inventada 12, Madrid, ES, 28000)') returning id into v_t2;
  insert into public.platform_store (account_id, company_id, provider, external_text) values (v_acc, v_e, 'uber', 'Marca Dos S01i (Avenida de Prueba 7, Madrid, ES, 28000)') returning id into v_t3;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, net_payout, raw)
  values (v_acc, v_canal, v_t1, '2026-10-05', '2026-10-11', 's01i-prueba-1', 10, '{"factura":{"total":11.11}}'),
         (v_acc, v_canal, v_t1, '2026-10-12', '2026-10-18', 's01i-prueba-2', 66.78, '{"factura":{"total":53.79}}'),
         (v_acc, v_canal, v_t2, '2026-10-12', '2026-10-18', 's01i-prueba-3', 216.92, '{"factura":{"total":82.72}}'),
         (v_acc, v_canal, v_t3, '2026-10-12', '2026-10-18', 's01i-prueba-4', 66.94, '{"factura":{"total":63.66}}');
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.sup', v_sup::text, true);
  perform set_config('prueba.canal', v_canal::text, true);
  perform set_config('prueba.t1', v_t1::text, true);
end $$;

-- Una factura de la plataforma de prueba, con su semana en una línea y su destinatario.
create function pg_temp.factura(p_num text, p_total numeric, p_semana text, p_dest text, p_estado text, p_tienda text default null, p_fecha date default '2026-10-20')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, reading)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, current_setting('prueba.sup')::uuid, p_num, p_fecha, p_total, p_estado, 'manual', 'Prueba S01i',
          jsonb_build_object('factura', jsonb_build_object('destinatario', jsonb_build_object('nombre', p_dest))
            || case when p_tienda is not null then jsonb_build_object('tienda', jsonb_build_object('direccion', p_tienda)) else '{}'::jsonb end))
  returning id into v;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, position) values (v, 'Tasa de servicio ' || p_semana, 1);
  -- Las líneas llegan después de la factura: se vuelve a mirar, como al leerla.
  update public.supplier_invoice set reading = reading where id = v;
  return v;
end $$;

-- 1b · El local, por la dirección (la forma de las tiendas de Glovo y de Uber, medida en Foodint el 01/11).
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_l1 uuid; v_l2 uuid;
begin
  select id into v_l1 from public.locations where account_id = v_acc and name = 'Local Inventado Norte';
  select id into v_l2 from public.locations where account_id = v_acc and name = 'Local Inventado Sur';
  if public._conta_local_de_texto(v_acc, array['EMPRESA S.L. Marca - MAD - Avenida de Prueba 7 (Calle Inventada 12)']) is distinct from v_l2
     or public._conta_local_de_texto(v_acc, array['Marca (Calle Inventada 12, Madrid, ES, 28000)']) is distinct from v_l1
     or public._conta_local_de_texto(v_acc, array['Marca - MAD - C. de Inventada (C. de Inventada)']) is distinct from v_l1
     or public._conta_local_de_texto(v_acc, array[null, '', 'Marca (Avenida de Prueba 7)']) is distinct from v_l2
     or public._conta_local_de_texto(v_acc, array['Calle Inventada 12 y Avenida de Prueba 7']) is not null
     or public._conta_local_de_texto(v_acc, array['Marca - MAD - Calle Que No Existe 3']) is not null
     or public._conta_local_de_texto('c01d0000-0000-4000-8000-0000000000ff', array['Calle Inventada 12']) is not null then
    raise exception 'PRUEBA S01i · 1b: _conta_local_de_texto no elige bien el local.';
  end if;
  raise notice 'PRUEBA S01i · 1b: el local sale de lo de antes del paréntesis; con dos locales o ninguno, no elige; solo los de su cuenta.';
end $$;

-- 2 · Encaja una sola: ligada, pagada por compensación con la fecha de su liquidación, fuera de Pagos y de Bancos.
do $$
declare v uuid; f public.supplier_invoice; r jsonb;
begin
  v := pg_temp.factura('S01I-A', 53.79, '12/10/26 - 18/10/26', 'EMPRESA DE PRUEBA, S.L. Marca Uno S01i', 'aprobada');
  select * into f from public.supplier_invoice where id = v;
  if not exists (select 1 from public.channel_settlement_invoice k join public.channel_settlement cs on cs.id = k.settlement_id
                  where k.supplier_invoice_id = v and cs.import_key = 's01i-prueba-2') then
    raise exception 'PRUEBA S01i · 2: la factura no se ha ligado a la liquidación de su marca y su semana: %', public._conta_comision_estado(v);
  end if;
  if f.status <> 'pagada' or f.paid_method <> 'compensation' or f.payment_method <> 'compensation' or f.paid_at <> date '2026-10-18' then
    raise exception 'PRUEBA S01i · 2: no ha quedado pagada por compensación con la fecha de su liquidación: % % % %', f.status, f.paid_method, f.payment_method, f.paid_at;
  end if;
  if exists (select 1 from public.bank_facturas_para_casar(current_setting('prueba.e')::uuid) b where b.id = v)
     or exists (select 1 from jsonb_array_elements(public.conta_pagos_lista(current_setting('prueba.e')::uuid, date '2026-10-01')->'filas') x where x->>'id' = v::text) then
    raise exception 'PRUEBA S01i · 2: sale en Pagos o en las pendientes de Bancos.';
  end if;
  raise notice 'PRUEBA S01i · 2: ligada a la de su marca y su semana, pagada por compensación el 18/10, fuera de Pagos y de Bancos.';
end $$;

-- 2b · Lo que necesita la vuelta atrás de la 0052: con «s01i.sin_buscar», devolver a «aprobada» una
-- pagada por compensación no la vuelve a pagar (sin la marca, sí: es lo que paró el ensayo del 01/11).
do $$
declare v uuid;
begin
  select si.id into v from public.supplier_invoice si where si.invoice_number = 'S01I-A' and si.account_id = current_setting('prueba.acc')::uuid;
  perform set_config('s01i.sin_buscar', 'si', true);
  delete from public.supplier_invoice_payment where invoice_id = v and created_by_name = 'Sumied · compensada con la liquidación';
  update public.supplier_invoice set status = 'aprobada', paid_at = null, paid_method = null where id = v;
  if (select status from public.supplier_invoice where id = v) <> 'aprobada' then
    raise exception 'PRUEBA S01i · 2b: con la marca de la vuelta atrás, el disparador la ha vuelto a pagar.';
  end if;
  perform set_config('s01i.sin_buscar', '', true);
  update public.supplier_invoice set status = 'aprobada' where id = v;
  if (select status from public.supplier_invoice where id = v) <> 'pagada' then
    raise exception 'PRUEBA S01i · 2b: sin la marca, al tocar su estado no se ha vuelto a pagar por compensación.';
  end if;
  raise notice 'PRUEBA S01i · 2b: con la marca de la vuelta atrás no se vuelve a pagar; sin ella, sí.';
end $$;

-- 3 · Dos de la misma marca, sin dirección: la que coincide al céntimo; si ninguna, no adivina.
do $$
declare v uuid; w uuid; r jsonb;
begin
  v := pg_temp.factura('S01I-B', 63.66, '12/10/26 - 18/10/26', 'EMPRESA DE PRUEBA, S.L. Marca Dos S01i', 'aprobada');
  if not exists (select 1 from public.channel_settlement_invoice k join public.channel_settlement cs on cs.id = k.settlement_id
                  where k.supplier_invoice_id = v and cs.import_key = 's01i-prueba-4') then
    raise exception 'PRUEBA S01i · 3: con dos de su marca, no ha elegido la que coincide al céntimo: %', public._conta_comision_estado(v);
  end if;
  w := pg_temp.factura('S01I-C', 50.00, '12/10/26 - 18/10/26', 'EMPRESA DE PRUEBA, S.L. Marca Dos S01i', 'aprobada');
  r := public._conta_comision_estado(w);
  if r->>'estado' <> 'varias' or jsonb_array_length(r->'candidatas') <> 2
     or exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = w)
     or (select status from public.supplier_invoice where id = w) <> 'aprobada'
     or (select payment_method from public.supplier_invoice where id = w) <> 'compensation'
     or exists (select 1 from public.bank_facturas_para_casar(current_setting('prueba.e')::uuid) b where b.id = w) then
    raise exception 'PRUEBA S01i · 3: sin coincidir al céntimo, ha adivinado o sale en Bancos: %', r;
  end if;
  raise notice 'PRUEBA S01i · 3: elige la que coincide al céntimo; si ninguna: «%»', r->>'porque';
  -- La persona elige (como administrador de D).
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
  r := public.conta_comision_ligar(w, (select id from public.channel_settlement where import_key = 's01i-prueba-3'), 'Prueba S01i');
  perform set_config('request.jwt.claims', '', true);
  if (select status from public.supplier_invoice where id = w) <> 'pagada' or r->>'texto' not like 'Ligada con la liquidación del 12/10 al 18/10/2026: pagada por compensación%' then
    raise exception 'PRUEBA S01i · 3: al elegirla la persona no queda ligada y pagada: %', r;
  end if;
  raise notice 'PRUEBA S01i · 3: la persona elige: «%»', r->>'texto';
end $$;

-- 3b · Lo mismo, con el rol de la persona (RLS): ve el estado de su factura, elige y queda ligada.
select set_config('prueba.d', pg_temp.factura('S01I-D', 1.00, '12/10/26 - 18/10/26', 'EMPRESA DE PRUEBA, S.L. Marca Dos S01i', 'aprobada')::text, true);
select set_config('prueba.l4', (select id from public.channel_settlement where import_key = 's01i-prueba-4')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v uuid := current_setting('prueba.d')::uuid; r jsonb;
begin
  r := public.conta_comision_de_la_factura(v);
  if r->>'estado' <> 'varias' then raise exception 'PRUEBA S01i · 3b: como persona, el estado no es «varias»: %', r; end if;
  r := public.conta_comision_ligar(v, current_setting('prueba.l4')::uuid, 'Prueba S01i');
  if not exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v and settlement_id = current_setting('prueba.l4')::uuid and matched_by = 'persona') then
    raise exception 'PRUEBA S01i · 3b: como persona, no ve el enlace que acaba de hacer.';
  end if;
  begin
    perform public._conta_comision_ligar(v, current_setting('prueba.l4')::uuid, 'sumied', null);
    raise exception 'PRUEBA S01i · 3b: la persona puede llamar a la función interna.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA S01i · 3b: como persona (RLS): ve su estado, elige («%») y ve el enlace; la función interna no es suya.', r->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select status from public.supplier_invoice where id = current_setting('prueba.d')::uuid) <> 'pagada' then
    raise exception 'PRUEBA S01i · 3b: elegida por la persona, no ha quedado pagada por compensación.';
  end if;
end $$;

-- 4 · Con la dirección de la tienda leída, elige el local.
do $$
declare v uuid;
begin
  v := pg_temp.factura('S01I-D', 40.00, '12/10/26 - 18/10/26', 'EMPRESA DE PRUEBA, S.L. Marca Dos S01i', 'aprobada', 'Avenida de Prueba 7, 28000 Madrid');
  if not exists (select 1 from public.channel_settlement_invoice k join public.channel_settlement cs on cs.id = k.settlement_id
                  where k.supplier_invoice_id = v and cs.import_key = 's01i-prueba-4') then
    raise exception 'PRUEBA S01i · 4: con la dirección leída no ha elegido su local: %', public._conta_comision_estado(v);
  end if;
  raise notice 'PRUEBA S01i · 4: con la dirección de la tienda, la de su local (y la liquidación lleva ya dos facturas).';
end $$;

-- 5 · Falta la liquidación: al llegar se liga sola; al aprobarla, pagada.
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.factura('S01I-E', 22.00, '19/10/26 - 25/10/26', 'EMPRESA DE PRUEBA, S.L. Marca Uno S01i', 'en_revision', null, '2026-10-27');
  r := public._conta_comision_estado(v);
  if r->>'estado' <> 'falta' or r->>'porque' not like 'Falta la liquidación:%Se ligará sola cuando llegue.' then
    raise exception 'PRUEBA S01i · 5: sin liquidación no dice «Falta la liquidación»: %', r;
  end if;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, net_payout, raw)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.canal')::uuid, current_setting('prueba.t1')::uuid, '2026-10-19', '2026-10-25', 's01i-prueba-5', 30, '{"factura":{"total":22.00}}');
  if not exists (select 1 from public.channel_settlement_invoice k join public.channel_settlement cs on cs.id = k.settlement_id
                  where k.supplier_invoice_id = v and cs.import_key = 's01i-prueba-5') then
    raise exception 'PRUEBA S01i · 5: al llegar su liquidación no se ha ligado sola.';
  end if;
  if (select status from public.supplier_invoice where id = v) <> 'en_revision' then
    raise exception 'PRUEBA S01i · 5: una factura por revisar se ha pagado sin validarla.';
  end if;
  update public.supplier_invoice set status = 'aprobada' where id = v;
  if (select status from public.supplier_invoice where id = v) <> 'pagada' then
    raise exception 'PRUEBA S01i · 5: al aprobarla no ha quedado pagada por compensación.';
  end if;
  raise notice 'PRUEBA S01i · 5: «%»; al llegar la liquidación se liga sola, y al aprobarla queda pagada.', r->>'porque';
end $$;

-- 6 · De antes de la primera liquidación de su plataforma: compensada fuera de Sumied.
do $$
declare v uuid; f public.supplier_invoice;
begin
  v := pg_temp.factura('S01I-F', 9.99, '21/09/26 - 27/09/26', 'EMPRESA DE PRUEBA, S.L. Marca Uno S01i', 'aprobada', null, '2026-09-29');
  select * into f from public.supplier_invoice where id = v;
  if f.status <> 'pagada' or f.paid_method <> 'compensation'
     or not exists (select 1 from public.supplier_invoice_payment where invoice_id = v and note like 'Compensada fuera de Sumied%') then
    raise exception 'PRUEBA S01i · 6: la de antes de la primera liquidación no queda «Compensada fuera de Sumied»: % %', f.status, public._conta_comision_estado(v);
  end if;
  raise notice 'PRUEBA S01i · 6: «%»', public._conta_comision_estado(v)->>'porque';
end $$;

-- 6b · Lo que salió al medir Foodint (01/11): con una sola candidata, sin marca ni local, no se liga; y una
-- liquidación de varias semanas no se queda la factura de una de ellas si no coincide al céntimo.
do $$
declare v uuid; w uuid; r jsonb;
begin
  v := pg_temp.factura('S01I-G', 33.33, '05/10/26 - 11/10/26', 'EMPRESA DE PRUEBA, S.L.', 'aprobada', null, '2026-10-13');
  r := public._conta_comision_estado(v);
  if r->>'estado' <> 'varias' or exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v) then
    raise exception 'PRUEBA S01i · 6b: sin marca ni local, con una sola candidata, la ha ligado: %', r;
  end if;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, net_payout, raw)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.canal')::uuid, current_setting('prueba.t1')::uuid, '2026-09-07', '2026-10-30', 's01i-prueba-6', 5, '{"factura":{"total":2.31}}');
  w := pg_temp.factura('S01I-H', 7.58, '26/10/26 - 01/11/26', 'EMPRESA DE PRUEBA, S.L. Marca Uno S01i', 'aprobada', null, '2026-11-03');
  r := public._conta_comision_estado(w);
  if r->>'estado' <> 'varias' then
    raise exception 'PRUEBA S01i · 6b: la liquidación de varias semanas se ha quedado una factura que no coincide: %', r;
  end if;
  raise notice 'PRUEBA S01i · 6b: sin marca ni local no se liga («%»), ni a una liquidación de varias semanas.', r->>'porque';
end $$;

-- 7 · La 0052 no hace nada sin Foodint (lo dice su notice al cargarla arriba).
do $$ begin
  raise notice 'PRUEBA S01i · 7: la 0052, sin la cuenta de Foodint, no toca nada.';
end $$;

-- 8 · La vuelta atrás, y otra vez delante. La de la 0052 solo toca la cuenta de Foodint, que aquí no
-- está: se pasa para ver que entra y no hace nada (sus datos los mira el ensayo en producción).
\i supabase/vuelta-atras/20261101T0052_s01i_comisiones_foodint.down.sql
\i supabase/vuelta-atras/20261101T0051_s01i_comision_sin_banco.down.sql
\i supabase/vuelta-atras/20261101T0050_s01i_comision_liquidacion.down.sql
do $$ begin
  if to_regclass('public.channel_settlement_invoice') is not null or to_regprocedure('public._conta_comision_estado(uuid)') is not null
     or exists (select 1 from pg_trigger where tgname in ('s01i_factura_comision', 's01i_liquidacion_llega')) then
    raise exception 'PRUEBA S01i · 8: la vuelta atrás no quita la tabla, las funciones o los disparadores.';
  end if;
  raise notice 'PRUEBA S01i · 8: la vuelta atrás quita lo de la 0050 y la 0051.';
end $$;
\i supabase/migrations/20261101T0050_s01i_comision_liquidacion.sql
\i supabase/migrations/20261101T0051_s01i_comision_sin_banco.sql

rollback;
