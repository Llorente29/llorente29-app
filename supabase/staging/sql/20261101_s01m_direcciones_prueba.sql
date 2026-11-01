-- supabase/staging/sql/20261101_s01m_direcciones_prueba.sql
--
-- S01m · Prueba en ROLLBACK de la tanda claude/s01m-otras-direcciones (0945 y
-- 0946), con la cuenta D de staging y direcciones inventadas (T11):
--
--   1. Una tienda con una dirección que no es la del local: sin otra dirección,
--      ningún local; con ella, el suyo (lo de antes del paréntesis manda igual).
--   2. La misma otra dirección en dos locales: ninguno (no se adivina).
--   3. Dos liquidaciones de la misma quincena y el mismo importe, una de cada
--      local: sin la otra dirección, la factura (que dice la dirección vieja) no
--      sabe cuál es. Como persona, guardar las otras direcciones (sin repetidas
--      ni vacías) vuelve a buscar y lo dice; la factura queda ligada a la suya.
--   4. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01m: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo del S01h y el S01i (ya en producción): se pueden pasar dos veces.
\i supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
\i supabase/migrations/20261101T0050_s01i_comision_liquidacion.sql
\i supabase/migrations/20261101T0051_s01i_comision_sin_banco.sql
\i supabase/migrations/20261101T0945_s01m_otras_direcciones.sql
\i supabase/migrations/20261101T0946_s01m_local_por_otras.sql

do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_l1 uuid; v_l2 uuid; v_canal uuid; v_sup uuid; v_party uuid; v_t uuid;
begin
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado Este S01m', 'Calle Inventada, 4') returning id into v_l1;
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado Oeste S01m', 'Paseo de Prueba, 9') returning id into v_l2;
  insert into public.sales_channel (account_id, name, slug) values (v_acc, 'Plataforma de prueba S01m', 'plataforma-prueba-s01m') returning id into v_canal;
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'Plataforma de Prueba S01m, S.L.', 'B00000196') returning id into v_sup;
  select party_id into v_party from public.party_role where account_id = v_acc and role = 'supplier' and supplier_id = v_sup;
  if v_party is null then
    insert into public.party (account_id, name) values (v_acc, 'Plataforma de Prueba S01m, S.L.') returning id into v_party;
    insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup);
  end if;
  insert into public.party_role (account_id, party_id, role, channel_id) values (v_acc, v_party, 'platform', v_canal);
  -- La tienda que la plataforma tiene con una dirección vieja (la del local Este no es).
  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_acc, v_e, 'glovo', 'S.L. Marca S01m - MAD - C. de Calle Antigua (Avenida Vieja de Prueba 106)') returning id into v_t;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, net_payout, raw)
  values (v_acc, v_canal, v_t, '2026-10-01', '2026-10-15', 's01m-prueba-1', 100, '{"factura":{"total":41.11}}');
  -- Otra tienda, del local Oeste por su dirección, con la misma quincena y el mismo importe.
  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_acc, v_e, 'glovo', 'S.L. Marca S01m - MAD - Paseo de Prueba 9 (Paseo de Prueba 9)') returning id into v_t;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, net_payout, raw)
  values (v_acc, v_canal, v_t, '2026-10-01', '2026-10-15', 's01m-prueba-2', 100, '{"factura":{"total":41.11}}');
  perform set_config('prueba.l1', v_l1::text, true);
  perform set_config('prueba.l2', v_l2::text, true);
  perform set_config('prueba.sup', v_sup::text, true);
end $$;

-- 1 · Sin la otra dirección, ningún local; con ella, el suyo.
do $$
declare v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d'; v_txt text := 'S.L. Marca S01m - MAD - C. de Calle Antigua (Avenida Vieja de Prueba 106)';
begin
  if public._conta_local_de_texto(v_acc, array[v_txt]) is not null then
    raise exception 'PRUEBA S01m · 1: sin la otra dirección ya da un local.';
  end if;
  insert into public.location_address_alias (account_id, location_id, address) values (v_acc, current_setting('prueba.l1')::uuid, 'Avenida Vieja de Prueba, 106');
  if public._conta_local_de_texto(v_acc, array[v_txt]) is distinct from current_setting('prueba.l1')::uuid then
    raise exception 'PRUEBA S01m · 1: con la otra dirección no da su local.';
  end if;
  -- Lo de antes del paréntesis manda: «Paseo de Prueba 9» antes del paréntesis es el Oeste, aunque el paréntesis sea la otra del Este.
  if public._conta_local_de_texto(v_acc, array['Marca - MAD - Paseo de Prueba 9 (Avenida Vieja de Prueba 106)']) is distinct from current_setting('prueba.l2')::uuid then
    raise exception 'PRUEBA S01m · 1: lo de antes del paréntesis ya no manda.';
  end if;
  raise notice 'PRUEBA S01m · 1: sin la otra dirección, ningún local; con ella, el suyo; lo de antes del paréntesis sigue mandando.';
end $$;

-- 2 · La misma otra dirección en dos locales: ninguno.
do $$
declare v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
begin
  insert into public.location_address_alias (account_id, location_id, address) values (v_acc, current_setting('prueba.l2')::uuid, 'Avenida Vieja de Prueba 106');
  if public._conta_local_de_texto(v_acc, array['Marca (Avenida Vieja de Prueba 106)']) is not null then
    raise exception 'PRUEBA S01m · 2: con la misma otra dirección en dos locales, elige uno.';
  end if;
  delete from public.location_address_alias where location_id = current_setting('prueba.l2')::uuid;
  delete from public.location_address_alias where location_id = current_setting('prueba.l1')::uuid;
  raise notice 'PRUEBA S01m · 2: la misma otra dirección en dos locales: ninguno.';
end $$;

-- 3 · Como persona: guardar, y la factura que esperaba su liquidación queda ligada.
do $$
declare v_inv uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, reading)
  values ('c01d0000-0000-4000-8000-00000000000d', 'c01d0000-0000-4000-8000-0000000000d2', current_setting('prueba.sup')::uuid, 'PRUEBA-S01M-1', '2026-10-15', 41.11, 'en_revision', 'manual', 'Prueba S01m',
          jsonb_build_object('factura', jsonb_build_object('periodo', jsonb_build_object('desde', '2026-10-01', 'hasta', '2026-10-15'),
                                                           'tienda', jsonb_build_object('direccion', 'Avenida Vieja de Prueba 106'))))
  returning id into v_inv;
  perform set_config('prueba.inv', v_inv::text, true);
  if exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v_inv) then
    raise exception 'PRUEBA S01m · 3: la factura se ha ligado antes de tener la otra dirección (con dos que coinciden al céntimo).';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_local_direcciones_guardar(current_setting('prueba.l1')::uuid, array['Avenida Vieja de Prueba, 106', '  ', 'avenida vieja de prueba, 106'], 'Prueba S01m');
  if (r->>'guardadas')::int <> 1 or (r->>'ligadas')::int < 1
     or r->>'texto' not like 'Local Inventado Este S01m: guardada 1 otra dirección. Vuelta a buscar la liquidación de % sin ligar: 1 ligada ahora.' then
    raise exception 'PRUEBA S01m · 3: guardar no dice lo que ha hecho: %', r;
  end if;
  if (select count(*) from public.location_address_alias where location_id = current_setting('prueba.l1')::uuid) <> 1 then
    raise exception 'PRUEBA S01m · 3: como persona no ve la otra dirección guardada.';
  end if;
  raise notice 'PRUEBA S01m · 3: como persona: «%»', r->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if not exists (select 1 from public.channel_settlement_invoice k join public.channel_settlement cs on cs.id = k.settlement_id
                  where k.supplier_invoice_id = current_setting('prueba.inv')::uuid and cs.import_key = 's01m-prueba-1') then
    raise exception 'PRUEBA S01m · 3: la factura no ha quedado ligada a la liquidación de su tienda.';
  end if;
end $$;

-- 4 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261101T0946_s01m_local_por_otras.down.sql
\i supabase/vuelta-atras/20261101T0945_s01m_otras_direcciones.down.sql
do $$ begin
  if to_regclass('public.location_address_alias') is not null or to_regprocedure('public.conta_local_direcciones_guardar(uuid,text[],text)') is not null
     or position('location_address_alias' in (select prosrc from pg_proc where oid = 'public._conta_local_de_texto(uuid,text[])'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01m · 4: la vuelta atrás no lo deja como estaba.';
  end if;
  raise notice 'PRUEBA S01m · 4: la vuelta atrás quita la tabla y la función, y deja _conta_local_de_texto como estaba.';
end $$;
\i supabase/migrations/20261101T0945_s01m_otras_direcciones.sql
\i supabase/migrations/20261101T0946_s01m_local_por_otras.sql

rollback;
