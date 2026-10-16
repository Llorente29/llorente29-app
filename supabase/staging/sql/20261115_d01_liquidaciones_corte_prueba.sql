-- supabase/staging/sql/20261115_d01_liquidaciones_corte_prueba.sql
--
-- SOLO STAGING. Prueba de 20261115T0100 (D01, el corte por fecha de las
-- liquidaciones por correo). Todo en una transacción con ROLLBACK: no cambia
-- staging. Datos inventados. Cambian en caliente, y aquí se prueban por su
-- nombre: public.conta_liquidacion_factura_proponer (decide el corte) y
-- public._conta_liquidacion_marcar (lo dice en la nota).
--
--   0. La fecha de corte es la de Bancos (bank_settings.cutover_date); sin
--      ella, el día siguiente al último importado (fiscal_year).
--   1. Una semana que acaba antes del corte (14–20/09): de referencia, sin
--      factura, y su nota y su texto lo dicen.
--   2. La semana que cruza el corte (28/09–04/10): real, con su factura entera
--      y su fecha (06/10, ya del periodo abierto).
--   3. Cuatro semanas que acaban antes del corte (31/08–27/09): de referencia;
--      y como se solapan con la del paso 1, las dos lo siguen diciendo.
--   4. Cuatro semanas que cruzan el corte (07/09–04/10): real (manda su
--      último día), con su factura; y por aclarar: se solapa con otras.
--   5. Como administrador de A: volver a proponer la factura de una de
--      referencia no crea nada y lo dice.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 corte: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · Preparar (como postgres) y la fecha de corte.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_canal uuid; v_party uuid; v_sup uuid; v_fy date;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'channel_settlement' and column_name = 'is_reference') then
    raise exception 'PRUEBA D01 corte · 0: falta channel_settlement.is_reference.';
  end if;
  select max(imported_until) + 1 into v_fy from public.fiscal_year where company_id = v_e and imported_until is not null;
  delete from public.bank_settings where company_id = v_e;
  if public._conta_corte(v_e) is distinct from v_fy then raise exception 'PRUEBA D01 corte · 0: sin ajustes de Bancos, el corte no es el del último importado (% ≠ %).', public._conta_corte(v_e), v_fy; end if;
  insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, date '2026-10-01');
  if public._conta_corte(v_e) <> date '2026-10-01' then raise exception 'PRUEBA D01 corte · 0: el corte no es el de Bancos.'; end if;
  raise notice 'PRUEBA D01 corte · 0: el corte es el de Bancos (01/10/2026); sin él, el siguiente al último importado (%).', coalesce(v_fy::text, 'ninguno');

  select id into v_canal from public.sales_channel where account_id = v_acc and slug = 'uber';
  if v_canal is null then raise exception 'PRUEBA D01 corte · 0: la cuenta A no tiene el canal de Uber.'; end if;
  insert into public.party (account_id, name, created_by_name) values (v_acc, 'Plataforma inventada (prueba corte)', 'Prueba D01 corte') returning id into v_party;
  insert into public.party_role (account_id, party_id, role, channel_id, commission_account_code) values (v_acc, v_party, 'platform', v_canal, '62300001');
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Plataforma inventada corte', 'Plataforma Inventada Corte SL', 'B00000099', true, 'Prueba D01 corte') returning id into v_sup;
  update public.party_role set party_id = v_party where account_id = v_acc and supplier_id = v_sup and role = 'supplier';
  if not found then insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup); end if;
end $$;

-- 1–4 · Como la función de entrada (service_role, sin persona).
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  p jsonb; r jsonb; v_cs public.channel_settlement; v_i public.supplier_invoice;
begin
  p := jsonb_build_object('proveedor', 'uber', 'tienda', 'Marca Corte Inventada (Calle Inventada 9, Madrid, ES, 28001)', 'marca', 'Marca Corte Inventada',
    'referencia', null, 'deposito_iniciado', null, 'pedidos', 4,
    'ventas', jsonb_build_object('base', 80, 'iva', 8, 'total', 88, 'pedidos', 4),
    'ganancias', jsonb_build_object('ventas', 88, 'pedidosVentas', 4, 'otras', 0, 'total', 88),
    'uber', jsonb_build_object('tasas', -8, 'otros', 0, 'total', -8),
    'marketing', jsonb_build_object('promociones', -15, 'otrosPromo', -2, 'anuncios', -10, 'total', -27),
    'modificaciones', jsonb_build_object('contracargo', 0, 'pedidosContracargo', 0, 'ajustes', 0, 'total', 0),
    'neto', 53, 'diario', '[]'::jsonb, 'contracargos', '[]'::jsonb, 'mensual', null, 'avisos', '[]'::jsonb,
    'factura', jsonb_build_object('comision', jsonb_build_object('total', 10, 'base', 8.27), 'publicidad', jsonb_build_object('total', 10, 'base', 8.26),
                                  'base', 16.53, 'iva', 3.47, 'total', 20, 'tipo_iva', 21, 'avisos', '[]'::jsonb));

  -- 1 · Antes del corte: de referencia.
  r := public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'prueba-corte-1', 'desde', '2026-09-14', 'hasta', '2026-09-20'), null);
  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  if r->'factura'->>'estado' <> 'referencia' or v_cs.commission_invoice_id is not null or v_cs.is_reference is not true
     or v_cs.review_note not like 'De referencia: es de antes del cierre de la contabilidad%' or r->>'texto' not like '%De referencia: es de antes del cierre (30/09/2026)%' then
    raise exception 'PRUEBA D01 corte · 1: %', r;
  end if;
  if exists (select 1 from public.supplier_invoice where source = 'liquidacion' and (reading->>'liquidacion_id')::uuid = v_cs.id) then raise exception 'PRUEBA D01 corte · 1: ha creado una factura.'; end if;
  perform set_config('prueba.ref1', v_cs.id::text, true);
  raise notice 'PRUEBA D01 corte · 1: 14–20/09, de referencia y sin factura: %', r->>'texto';

  -- 2 · La semana que cruza el corte: real, factura entera con su fecha (06/10).
  r := public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'prueba-corte-2', 'desde', '2026-09-28', 'hasta', '2026-10-04'), null);
  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  select * into v_i from public.supplier_invoice where id = v_cs.commission_invoice_id;
  if r->'factura'->>'estado' <> 'creada' or v_cs.is_reference is true or v_i.invoice_date <> date '2026-10-06' or v_i.grand_total <> 20 or v_cs.review_note like '%De referencia%' then
    raise exception 'PRUEBA D01 corte · 2: %', r;
  end if;
  raise notice 'PRUEBA D01 corte · 2: 28/09–04/10, real: factura entera de 20,00 € con fecha 06/10/2026.';

  -- 3 · Cuatro semanas que acaban antes del corte: de referencia; y se solapa con la del paso 1 (los dos lados lo dicen).
  r := public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'prueba-corte-3', 'desde', '2026-08-31', 'hasta', '2026-09-27'), null);
  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  if r->'factura'->>'estado' <> 'referencia' or v_cs.is_reference is not true or v_cs.commission_invoice_id is not null
     or v_cs.review_note not like '%Se solapa con la liquidación del 14/09 al 20/09/2026%'
     or (select review_note from public.channel_settlement where id = current_setting('prueba.ref1')::uuid) not like '%Se solapa con la liquidación del 31/08 al 27/09/2026%' then
    raise exception 'PRUEBA D01 corte · 3: %', jsonb_build_object('r', r, 'nota', v_cs.review_note);
  end if;
  raise notice 'PRUEBA D01 corte · 3: 31/08–27/09, de referencia; el solape con 14–20/09 se dice en las dos.';

  -- 4 · Cuatro semanas que cruzan el corte: real (manda el último día), con factura, y por aclarar por el solape.
  r := public.conta_liquidacion_registrar(v_e, p || jsonb_build_object('email_id', 'prueba-corte-4', 'desde', '2026-09-07', 'hasta', '2026-10-04'), null);
  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  if r->'factura'->>'estado' <> 'creada' or v_cs.is_reference is true or v_cs.commission_invoice_id is null or not v_cs.needs_review
     or v_cs.review_note not like '%Por aclarar: Se solapa con%' then
    raise exception 'PRUEBA D01 corte · 4: %', jsonb_build_object('r', r, 'nota', v_cs.review_note);
  end if;
  raise notice 'PRUEBA D01 corte · 4: 07/09–04/10, real con su factura y por aclarar (se solapa).';
end $$;
reset role;

-- 5 · Como administrador de A: proponer otra vez la factura de una de referencia.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_liquidacion_factura_proponer(current_setting('prueba.ref1')::uuid, 'Prueba D01 corte');
  if r->>'estado' <> 'referencia' then raise exception 'PRUEBA D01 corte · 5: %', r; end if;
  raise notice 'PRUEBA D01 corte · 5: volver a proponer la de referencia no crea nada: %', r->>'texto';
end $$;
reset role;

rollback;
