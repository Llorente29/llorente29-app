-- supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261113T0100 (D01, las liquidaciones por correo,
-- empezando por Uber Eats). Todo en una transacción con ROLLBACK: no cambia
-- staging. Datos inventados (ni una tienda ni una cifra de verdad); el resumen
-- leído es el que deja _shared/liquidacionUber.ts (paraRegistrar).
--
--   0. La estructura: la dirección de liquidaciones, los resultados nuevos del
--      registro, el mapa de tiendas, las columnas nuevas y que un usuario no
--      escribe en el mapa.
--   1. Como administrador de A: la dirección liquidaciones-<empresa>@ (apagada;
--      la segunda vez, la misma) y la de facturas por la misma función.
--   2. Como la función de entrada (service_role): conta_entrada_destino dice la
--      clase de la dirección (conta_entrada_destino).
--   3. Un resumen de una tienda nueva SIN proveedor de la plataforma: la
--      tienda entra sin asignar, la liquidación por revisar, y la factura no se
--      crea y se dice («falta el proveedor»).
--   4. Con el proveedor: conta_liquidacion_factura_proponer crea la factura de
--      comisión SIN número, en revisión, con sus dos líneas (comisión a la
--      cuenta de la plataforma, anuncios a la 627 de la plantilla), su IVA y la
--      regla del céntimo (16,53 + 3,47 = 20,00); las promociones en artículos
--      fuera de la factura, en su columna. La segunda vez, la misma.
--   5. El mismo resumen otra vez: no crea nada y lo dice.
--   6. Asignar la tienda: su marca, su local y su banco; la liquidación los toma.
--   7. Un neto negativo (cuatro semanas): «sin cobro», y la factura sale igual
--      (con el aviso de varias semanas); como se solapa con la del paso 3, las
--      DOS liquidaciones y sus facturas quedan por aclarar enseñando la otra; lo
--      que no cuadra al leer va también a su factura; sin cargos: sin factura.
--   8. conta_recibida_envio: la factura de comisión sin número no va a Diez;
--      con número, sí.
--   9. B no registra en A ni ve sus tiendas; anon no llama a nada.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 liquidaciones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · La estructura, y preparar (como postgres): el tercero de Uber como plataforma, sin ficha de proveedor todavía.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_canal uuid; v_party uuid; n int;
begin
  if to_regclass('public.platform_store') is null then raise exception 'PRUEBA D01 liquidaciones · 0: falta platform_store.'; end if;
  select count(*) into n from information_schema.columns where table_schema = 'public' and (
    (table_name = 'channel_settlement' and column_name in ('other_earnings', 'promo_charges', 'ads_spend', 'item_promotions', 'chargebacks', 'adjustments', 'store_id', 'inbound_email_id', 'commission_invoice_id'))
    or (table_name = 'supplier_invoice' and column_name = 'brand_id') or (table_name = 'supplier_invoice_line' and column_name = 'expense_account_code')
    or (table_name = 'party_role' and column_name in ('commission_account_code', 'ads_account_code')));
  if n <> 13 then raise exception 'PRUEBA D01 liquidaciones · 0: faltan columnas nuevas (% de 13).', n; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'company_inbound_address_kind_check')) not like '%liquidaciones%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'inbound_email_log_outcome_check')) not like '%confirmacion%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'supplier_invoice_source_check')) not like '%liquidacion%' then
    raise exception 'PRUEBA D01 liquidaciones · 0: algún CHECK no se ha ampliado.';
  end if;
  -- Las dos tablas que cambian en caliente (declaradas en la cabecera de la 0100), por su nombre:
  -- public.company_inbound_address (la clase y su prefijo, atados) y public.inbound_email_log (los resultados nuevos).
  if (select count(*) from pg_constraint where conrelid = 'public.company_inbound_address'::regclass and contype = 'c'
        and conname in ('company_inbound_address_kind_check', 'company_inbound_address_local_part_check')) <> 2
     or pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.company_inbound_address'::regclass and conname = 'company_inbound_address_local_part_check')) not like '%kind%'
     or (select count(*) from pg_constraint where conrelid = 'public.inbound_email_log'::regclass and conname = 'inbound_email_log_outcome_check'
           and pg_get_constraintdef(oid) like '%liquidacion%' and pg_get_constraintdef(oid) like '%no_es_liquidacion%') <> 1 then
    raise exception 'PRUEBA D01 liquidaciones · 0: los CHECK de public.company_inbound_address o de public.inbound_email_log no son los de la 0100.';
  end if;
  -- Y lo que no pueden guardar: una dirección cuya clase no es su prefijo, y un resultado que no existe.
  begin
    insert into public.company_inbound_address (account_id, company_id, kind, local_part) values (v_acc, '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'liquidaciones', 'facturas-cruzada');
    raise exception 'PRUEBA D01 liquidaciones · 0: public.company_inbound_address acepta «liquidaciones» con prefijo de facturas.';
  exception when check_violation then null; end;
  begin
    insert into public.inbound_email_log (email_id, to_address, outcome) values ('prueba-d01-x', 'x@entrada.folvy.app', 'inventado');
    raise exception 'PRUEBA D01 liquidaciones · 0: public.inbound_email_log acepta un resultado que no existe.';
  exception when check_violation then null; end;
  insert into public.inbound_email_log (email_id, to_address, outcome) values ('prueba-d01-confirmacion', 'liquidaciones-x@entrada.folvy.app', 'confirmacion');
  raise notice 'PRUEBA D01 liquidaciones · 0: el mapa de tiendas, las 13 columnas y los tres CHECK ampliados; en public.company_inbound_address la clase y el prefijo van atados, y public.inbound_email_log guarda «confirmacion» y rechaza lo que no existe.';

  select id into v_canal from public.sales_channel where account_id = v_acc and slug = 'uber';
  if v_canal is null then raise exception 'PRUEBA D01 liquidaciones · 0: la cuenta A no tiene el canal de Uber.'; end if;
  -- Un canal tiene una sola plataforma (ux_party_role_canal). Si el Uber de A
  -- ya la tiene (la de seed_d01_tiendas_staging.sql, 17/10), se usa esa, con
  -- la cuenta de comisión que pide la prueba; si no, una inventada.
  select pr.party_id into v_party from public.party_role pr
   where pr.account_id = v_acc and pr.role = 'platform' and pr.channel_id = v_canal;
  if v_party is null then
    insert into public.party (account_id, name, created_by_name) values (v_acc, 'Plataforma inventada (prueba D01)', 'Prueba D01') returning id into v_party;
    insert into public.party_role (account_id, party_id, role, channel_id, commission_account_code) values (v_acc, v_party, 'platform', v_canal, '62300001');
  else
    update public.party_role set commission_account_code = '62300001' where account_id = v_acc and party_id = v_party and role = 'platform';
  end if;
  perform set_config('prueba.party', v_party::text, true);
  perform set_config('prueba.loc', (select id::text from public.locations where account_id = v_acc order by created_at limit 1), true);
  perform set_config('prueba.marca', (select id::text from public.brand where account_id = v_acc order by created_at limit 1), true);
  perform set_config('prueba.banco', (select id::text from public.treasury_account where account_id = v_acc and company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' order by created_at limit 1), true);
end $$;

-- 1 · Como administrador de A: las direcciones.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  r jsonb; r2 jsonb;
begin
  r := public.conta_direccion_entrada(v_e, 'liquidaciones', 'Prueba D01');
  if r->>'direccion' not like 'liquidaciones-%@entrada.folvy.app' or (r->>'active')::boolean or r->>'kind' <> 'liquidaciones' then raise exception 'PRUEBA D01 liquidaciones · 1: %', r; end if;
  r2 := public.conta_direccion_entrada(v_e, 'liquidaciones', 'Prueba D01');
  if not (r2->>'ya_estaba')::boolean or r2->>'id' <> r->>'id' then raise exception 'PRUEBA D01 liquidaciones · 1: la segunda vez no es la misma: %', r2; end if;
  if public.conta_direccion_entrada(v_e, 'facturas', 'Prueba D01')->>'direccion' not like 'facturas-%' then raise exception 'PRUEBA D01 liquidaciones · 1: la de facturas no sale.'; end if;
  begin
    perform public.conta_direccion_entrada(v_e, 'nominas', 'Prueba D01');
    raise exception 'PRUEBA D01 liquidaciones · 1: ha aceptado una dirección de otra clase.';
  exception when sqlstate '22023' then null; end;
  perform set_config('prueba.lp', r->>'local_part', true);
  raise notice 'PRUEBA D01 liquidaciones · 1: % (apagada), la misma la segunda vez, y la de facturas por la misma función.', r->>'direccion';
end $$;
reset role;

-- 2–3 · Como la función de entrada (service_role, sin persona).
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  d jsonb; r jsonb; v_cs public.channel_settlement; p jsonb;
begin
  -- 2
  d := public.conta_entrada_destino(current_setting('prueba.lp'), 'entrada.folvy.app');
  if d->>'tipo' <> 'liquidaciones' or d->>'company_id' <> v_e::text or (d->>'activa')::boolean then raise exception 'PRUEBA D01 liquidaciones · 2: %', d; end if;
  raise notice 'PRUEBA D01 liquidaciones · 2: conta_entrada_destino dice la clase de la dirección (liquidaciones), y que está apagada.';

  -- 3 · El resumen de una semana, como lo deja paraRegistrar. Comisión 10,00 y anuncios 10,00 (IVA dentro).
  p := jsonb_build_object('proveedor', 'uber', 'email_id', 'prueba-d01-correo-1', 'tienda', 'Marca Inventada (Calle Inventada 1, Madrid, ES, 28001)', 'marca', 'Marca Inventada',
    'desde', '2026-09-21', 'hasta', '2026-09-27', 'referencia', null, 'deposito_iniciado', null, 'pedidos', 4,
    'ventas', jsonb_build_object('base', 80, 'iva', 8, 'total', 88, 'pedidos', 4),
    'ganancias', jsonb_build_object('ventas', 88, 'pedidosVentas', 4, 'otras', 0, 'total', 88),
    'uber', jsonb_build_object('tasas', -8, 'otros', 0, 'total', -8),
    'marketing', jsonb_build_object('promociones', -15, 'otrosPromo', -2, 'anuncios', -10, 'total', -27),
    'modificaciones', jsonb_build_object('contracargo', 0, 'pedidosContracargo', 0, 'ajustes', 0, 'total', 0),
    'neto', 53, 'diario', '[]'::jsonb, 'contracargos', '[]'::jsonb, 'mensual', null, 'avisos', '[]'::jsonb,
    'factura', jsonb_build_object('comision', jsonb_build_object('total', 10, 'base', 8.27), 'publicidad', jsonb_build_object('total', 10, 'base', 8.26),
                                  'base', 16.53, 'iva', 3.47, 'total', 20, 'tipo_iva', 21, 'avisos', '[]'::jsonb));
  r := public.conta_liquidacion_registrar(v_e, p, null);
  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  if not (r->>'tienda_nueva')::boolean or r->'factura'->>'estado' <> 'falta_proveedor' or v_cs.commission_invoice_id is not null then raise exception 'PRUEBA D01 liquidaciones · 3: %', r; end if;
  if v_cs.source <> 'correo_uber' or v_cs.net_payout <> 53 or v_cs.commission <> -8 or v_cs.promo_charges <> -2 or v_cs.ads_spend <> -10 or v_cs.item_promotions <> -15
     or v_cs.gross_sales <> 88 or v_cs.base_amount <> 80 or v_cs.promo_product <> 0 or v_cs.period_grain <> 'week' or v_cs.settlement_date <> '2026-09-28'
     or v_cs.inbound_email_id <> 'prueba-d01-correo-1' or not v_cs.needs_review or v_cs.brand_id is not null or v_cs.channel_id is null then
    raise exception 'PRUEBA D01 liquidaciones · 3: la liquidación no queda como debe: %', to_jsonb(v_cs) - 'raw';
  end if;
  if (select count(*) from public.platform_store where account_id = v_acc and brand_id is null and id = v_cs.store_id) <> 1 then raise exception 'PRUEBA D01 liquidaciones · 3: la tienda no entra sin asignar.'; end if;
  if r->>'texto' not like 'Liquidación del 21/09 al 27/09/2026 leída: neto 53,00 €. La plataforma no tiene ficha de proveedor%Tienda nueva: dale su marca y su local.' then
    raise exception 'PRUEBA D01 liquidaciones · 3: el texto no dice lo que ha pasado: %', r->>'texto';
  end if;
  raise notice 'PRUEBA D01 liquidaciones · 3: tienda nueva sin asignar, la liquidación por revisar y «falta el proveedor», dicho: %', r->>'texto';
  perform set_config('prueba.liq', v_cs.id::text, true);
  perform set_config('prueba.tienda', v_cs.store_id::text, true);

end $$;
reset role;

-- 4 (como postgres) · La plataforma ya tiene su ficha de proveedor.
do $$
declare v_sup uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'Plataforma inventada', 'Plataforma Inventada SL', 'B00000099', true, 'Prueba D01') returning id into v_sup;
  -- Dar de alta un proveedor ya le crea su tercero y su papel: ese papel pasa al tercero de la plataforma.
  update public.party_role set party_id = current_setting('prueba.party')::uuid where account_id = 'c01a0000-0000-4000-8000-00000000000a' and supplier_id = v_sup and role = 'supplier';
  if not found then
    insert into public.party_role (account_id, party_id, role, supplier_id) values ('c01a0000-0000-4000-8000-00000000000a', current_setting('prueba.party')::uuid, 'supplier', v_sup);
  end if;
  perform set_config('prueba.sup', v_sup::text, true);
end $$;

-- 4–7 · Otra vez como la función de entrada.
set local role service_role;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  r jsonb; v_cs public.channel_settlement; v_i public.supplier_invoice; p jsonb; v_sup uuid := current_setting('prueba.sup')::uuid; n int;
begin
  select * into v_cs from public.channel_settlement where id = current_setting('prueba.liq')::uuid;
  p := v_cs.raw;
  r := public.conta_liquidacion_factura_proponer(v_cs.id, null);
  if r->>'estado' <> 'creada' then raise exception 'PRUEBA D01 liquidaciones · 4: %', r; end if;
  select * into v_i from public.supplier_invoice where id = (r->>'factura_id')::uuid;
  if v_i.invoice_number is not null or v_i.status <> 'en_revision' or v_i.source <> 'liquidacion' or v_i.supplier_id <> v_sup or v_i.company_id <> v_e
     or v_i.tax_base_total <> 16.53 or v_i.tax_total <> 3.47 or v_i.grand_total <> 20 or v_i.invoice_date <> '2026-09-29' or v_i.reading_confidence <> 'duda'
     or v_i.reading->'requisitos'->0->>'id' <> 'numero' or (v_i.reading->'requisitos'->0->>'ok')::boolean then
    raise exception 'PRUEBA D01 liquidaciones · 4: la factura no queda como debe: %', to_jsonb(v_i) - 'reading';
  end if;
  if (select string_agg(expense_account_code || '=' || line_amount::text, ',' order by position) from public.supplier_invoice_line where supplier_invoice_id = v_i.id) <> '62300001=8.27,62700000=8.26' then
    raise exception 'PRUEBA D01 liquidaciones · 4: las líneas no van a sus cuentas: %', (select string_agg(expense_account_code || '=' || line_amount::text, ',' order by position) from public.supplier_invoice_line where supplier_invoice_id = v_i.id);
  end if;
  if (select count(*) from public.supplier_invoice_tax where supplier_invoice_id = v_i.id and vat_pct = 21 and base = 16.53 and vat_amount = 3.47) <> 1 then raise exception 'PRUEBA D01 liquidaciones · 4: falta su IVA.'; end if;
  if (select commission_invoice_id from public.channel_settlement where id = v_cs.id) <> v_i.id then raise exception 'PRUEBA D01 liquidaciones · 4: la liquidación no apunta a su factura.'; end if;
  if public.conta_liquidacion_factura_proponer(v_cs.id, null)->>'estado' <> 'ya_estaba' then raise exception 'PRUEBA D01 liquidaciones · 4: la segunda vez crea otra.'; end if;
  raise notice 'PRUEBA D01 liquidaciones · 4: factura de comisión sin número, en revisión: 8,27 a la 62300001 y 8,26 a la 62700000, IVA 3,47, total 20,00; las promociones en artículos (15,00) fuera, en su columna.';
  perform set_config('prueba.factura', v_i.id::text, true);

  -- 5 · El mismo resumen otra vez.
  select count(*) into n from public.channel_settlement where account_id = v_acc and source = 'correo_uber';
  r := public.conta_liquidacion_registrar(v_e, p, null);
  if not (r->>'ya_estaba')::boolean or r->>'liquidacion_id' <> v_cs.id::text or (select count(*) from public.channel_settlement where account_id = v_acc and source = 'correo_uber') <> n then
    raise exception 'PRUEBA D01 liquidaciones · 5: %', r;
  end if;
  raise notice 'PRUEBA D01 liquidaciones · 5: el mismo resumen otra vez no crea nada y lo dice: %', r->>'texto';

  -- 7 · Cuatro semanas con neto negativo (la factura sale igual), y una sin cargos (sin factura).
  r := public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'prueba-d01-correo-2', 'desde', '2026-08-31', 'hasta', '2026-09-27', 'neto', -4.5, 'avisos', '["Algo inventado no cuadra."]'::jsonb), null);
  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  if v_cs.net_payout <> -4.5 or v_cs.period_grain <> 'weeks' or r->>'texto' not like '%neto −4,50 € (sin cobro: pasa al siguiente)%' or r->'factura'->>'estado' <> 'creada'
     or v_cs.review_note not like '%Por aclarar: 1 cosa no cuadra al leer.%'
     or v_cs.review_note not like '%Por aclarar: Se solapa con la liquidación del 21/09 al 27/09/2026. Cada día cuenta una sola vez%'
     or r->>'texto' not like '%Por aclarar: Se solapa con la liquidación del 21/09 al 27/09/2026 (cada día cuenta una sola vez).' then
    raise exception 'PRUEBA D01 liquidaciones · 7: %', r;
  end if;
  if not exists (select 1 from public.supplier_invoice i, jsonb_array_elements(i.reading->'requisitos') x where i.id = v_cs.commission_invoice_id and x->>'id' = 'semanas') then
    raise exception 'PRUEBA D01 liquidaciones · 7: la factura de cuatro semanas no lo avisa.';
  end if;
  if not exists (select 1 from public.supplier_invoice i, jsonb_array_elements(i.reading->'requisitos') x where i.id = v_cs.commission_invoice_id and x->>'id' = 'solape') then
    raise exception 'PRUEBA D01 liquidaciones · 7: la factura de la que se solapa no lo avisa.';
  end if;
  if not exists (select 1 from public.supplier_invoice i, jsonb_array_elements(i.reading->'requisitos') x where i.id = v_cs.commission_invoice_id and x->>'id' = 'cuadre' and x->>'texto' like '%Algo inventado no cuadra.%') then
    raise exception 'PRUEBA D01 liquidaciones · 7: la factura de la que no cuadra al leer no lo dice.';
  end if;
  -- Los DOS lados del solape: la del paso 3 ahora también lo dice, enseñando la otra, y su factura también.
  if (select review_note from public.channel_settlement where id = current_setting('prueba.liq')::uuid) not like '%Por aclarar: Se solapa con la liquidación del 31/08 al 27/09/2026.%'
     or not exists (select 1 from public.supplier_invoice i, jsonb_array_elements(i.reading->'requisitos') x where i.id = current_setting('prueba.factura')::uuid and x->>'id' = 'solape') then
    raise exception 'PRUEBA D01 liquidaciones · 7: la otra liquidación del solape (o su factura) no lo dice.';
  end if;
  r := public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'prueba-d01-correo-3', 'desde', '2026-09-28', 'hasta', '2026-10-04', 'factura', null), null);
  if r->'factura'->>'estado' <> 'sin_factura' then raise exception 'PRUEBA D01 liquidaciones · 7: sin cargos ha hecho factura: %', r; end if;
  begin
    perform public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('proveedor', 'glovo'), null);
    raise exception 'PRUEBA D01 liquidaciones · 7: ha aceptado un resumen que no es de Uber.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'x', 'desde', '2026-10-05', 'hasta', '2026-10-11',
      'factura', (p->'factura') || jsonb_build_object('iva', 3.48)), null);
    raise exception 'PRUEBA D01 liquidaciones · 7: ha aceptado una factura que no cuadra.';
  exception when sqlstate '22023' then null; end;
  if exists (select 1 from public.channel_settlement where account_id = v_acc and period_from = '2026-10-05' and source = 'correo_uber') then raise exception 'PRUEBA D01 liquidaciones · 7: lo rechazado ha dejado algo.'; end if;
  raise notice 'PRUEBA D01 liquidaciones · 7: neto negativo «sin cobro» con su factura (y el aviso de las semanas); el solape, por aclarar en las dos y en sus facturas; sin cargos, sin factura; otra plataforma o una factura que no cuadra, no, y no dejan nada.';
end $$;
reset role;

-- 6 y 8 · Como administrador de A: asignar la tienda, y lo que va a Diez.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_cs public.channel_settlement; r jsonb; v_entry uuid; v_falla text;
begin
  -- 0 (usuario) · Nadie escribe en el mapa a mano.
  begin
    update public.platform_store set brand_id = null where id = current_setting('prueba.tienda')::uuid;
    if found then raise exception 'PRUEBA D01 liquidaciones · 0: un usuario escribe en platform_store.'; end if;
  exception when insufficient_privilege then null; end;

  -- 6
  r := public.conta_tienda_plataforma_asignar(current_setting('prueba.tienda')::uuid, current_setting('prueba.marca')::uuid, current_setting('prueba.loc')::uuid,
                                              nullif(current_setting('prueba.banco'), '')::uuid, 'Prueba D01');
  select * into v_cs from public.channel_settlement where id = current_setting('prueba.liq')::uuid;
  -- Asignar la tienda quita «sin asignar», no el solape con la de cuatro semanas (paso 7): sigue por revisar por eso, y solo por eso.
  if v_cs.brand_id::text <> current_setting('prueba.marca') or v_cs.location_id::text <> current_setting('prueba.loc') or not v_cs.needs_review
     or v_cs.review_note <> 'Por aclarar: Se solapa con la liquidación del 31/08 al 27/09/2026. Cada día cuenta una sola vez: ninguna de las dos se asienta hasta aclararlo.' then
    raise exception 'PRUEBA D01 liquidaciones · 6: la liquidación no toma la marca y el local: %', to_jsonb(v_cs) - 'raw';
  end if;
  begin
    perform public.conta_tienda_plataforma_asignar(current_setting('prueba.tienda')::uuid, gen_random_uuid(), null, null, 'Prueba D01');
    raise exception 'PRUEBA D01 liquidaciones · 6: ha aceptado una marca que no es de la cuenta.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA D01 liquidaciones · 6: la tienda con su marca, su local y su banco; su liquidación los toma y ya no está «sin asignar» (sigue por revisar por el solape: %).', v_cs.review_note;

  -- 8 · El asiento propuesto de la factura de comisión y lo que va a Diez.
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-29', 'concepto', 'Factura Plataforma inventada', 'source_type', 'supplier_invoice', 'source_id', current_setting('prueba.factura'),
                       'confianza', 'duda', 'porque', 'Prueba D01'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62300001', 'debe', 8.27, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', '62700000', 'debe', 8.26, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', '47200021', 'debe', 3.47, 'haber', 0, 'comun', true,
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 16.53, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000003', 'debe', 0, 'haber', 20, 'comun', true)),
    null, 'Prueba D01');
  v_entry := (r->>'id')::uuid;
  begin
    perform public.conta_recibida_envio(v_entry);
    v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is distinct from 'La factura de comisión no tiene número: no va a Diez hasta tenerlo.' then raise exception 'PRUEBA D01 liquidaciones · 8: sin número ha salido hacia Diez (%).', v_falla; end if;
  -- Validado (como lo validaría una persona), queda en el libro: de él se aprenden las cuentas.
  perform public.journal_entry_validar(v_entry, 'Prueba D01');
  perform set_config('prueba.asiento', v_entry::text, true);
  perform set_config('prueba.falla', v_falla, true);
end $$;
reset role;

-- 8 (como postgres) · Lo aprendido del libro: con ese asiento validado, la 623x y la
-- 627x de las facturas de la 41000003 son las suyas. Y llega el número.
do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c623 text; c627 text;
begin
  c623 := public._conta_cuenta_aprendida(v_e, '41000003', '623');
  c627 := public._conta_cuenta_aprendida(v_e, '41000003', '627');
  if c627 is distinct from '62700000' or c623 is null or public._conta_cuenta_aprendida(v_e, null, '623') is not null then
    raise exception 'PRUEBA D01 liquidaciones · 8: lo aprendido no es lo del libro (623 %, 627 %).', c623, c627;
  end if;
  raise notice 'PRUEBA D01 liquidaciones · 8: lo aprendido del libro para la 41000003: 627 → %, 623 → % (la más usada en su serie 2 validada); sin 410, nada.', c627, c623;
end $$;
update public.supplier_invoice set invoice_number = 'INVENTADA-0001' where id = current_setting('prueba.factura')::uuid;

set local role authenticated;
do $$
declare r jsonb; v_entry uuid := current_setting('prueba.asiento')::uuid; v_falla text := current_setting('prueba.falla');
begin
  r := public.conta_recibida_envio(v_entry);
  if r->'factura'->>'numero' <> 'INVENTADA-0001' or r->'proveedor'->>'nif' <> 'B00000099' then raise exception 'PRUEBA D01 liquidaciones · 8: con número no sale bien: %', r; end if;
  raise notice 'PRUEBA D01 liquidaciones · 8: sin número no va a Diez («%»); con número, sí.', v_falla;
end $$;
reset role;

-- 9 · Como administrador de B, y como anon.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_liquidacion_registrar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '{"proveedor":"uber","tienda":"x","desde":"2026-07-06","hasta":"2026-07-12","neto":1}', 'B');
    raise exception 'PRUEBA D01 liquidaciones · 9: B ha registrado una liquidación en A.';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.conta_liquidacion_factura_proponer(current_setting('prueba.liq')::uuid, 'B');
    raise exception 'PRUEBA D01 liquidaciones · 9: B ha propuesto una factura en A.';
  exception when sqlstate '42501' then null; end;
  if exists (select 1 from public.platform_store where id = current_setting('prueba.tienda')::uuid) then raise exception 'PRUEBA D01 liquidaciones · 9: B ve las tiendas de A.'; end if;
  raise notice 'PRUEBA D01 liquidaciones · 9: B no registra ni propone en A, ni ve sus tiendas.';
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.conta_liquidacion_registrar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '{}', null);
    raise exception 'PRUEBA D01 liquidaciones · 9: anon llama a conta_liquidacion_registrar.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 liquidaciones · 9: anon no llama a nada.';
end $$;
reset role;

rollback;
