-- supabase/staging/sql/20261101_s01j2_correo_prueba.sql
--
-- S01j·2 · Prueba en ROLLBACK de la tanda claude/s01j2-correo-y-liquidacion
-- (1215–1218), con la cuenta D de staging y datos inventados (T11):
--
--   1. conta_correo_facturas: la plataforma de cada correo; su Excel leído, sin
--      leer (lo dejó como «no es un PDF») o que no venía; y la liquidación que
--      ya había entrado con otro correo, marcada «otro_correo».
--   2. conta_liquidacion_ficha: la del correo (con su factura y su correo), la
--      antigua sin periodo y una cuyas cifras no suman (se devuelven tal cual).
--      De otra cuenta, no.
--   3. El disparador: una liquidación nueva sin local recibe el del texto de su
--      tienda; si el texto no lo dice, se queda sin local; si la tienda tiene
--      local, no se toca.
--   4. Guardar otras direcciones de un local también pone el local en las
--      liquidaciones que ahora lo tienen, y lo dice.
--   5. La 1218 (datos de Foodint) no toca nada en una base sin Foodint.
--   6. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01j·2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo de antes (ya en producción), por si esta base aún no lo tiene: se puede pasar dos veces.
\i supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
\i supabase/migrations/20261101T0050_s01i_comision_liquidacion.sql
\i supabase/migrations/20261101T0051_s01i_comision_sin_banco.sql
\i supabase/migrations/20261101T0945_s01m_otras_direcciones.sql
\i supabase/migrations/20261101T0946_s01m_local_por_otras.sql
\i supabase/migrations/20261101T1215_s01j2_correo_que_salio.sql
\i supabase/migrations/20261101T1216_s01j2_ficha_liquidacion.sql
\i supabase/migrations/20261101T1217_s01j2_local_de_la_liquidacion.sql
\i supabase/migrations/20261101T1218_s01j2_local_foodint.sql

do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_l uuid; v_l2 uuid; v_canal uuid; v_t uuid; v_t2 uuid; v_cs uuid; v_cs_viejo uuid; v_cs_mal uuid; v_sup uuid; v_inv uuid; v_dir text;
begin
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado S01j2', 'Calle Inventada Norte, 7') returning id into v_l;
  insert into public.locations (account_id, name, address) values (v_acc, 'Otro Local S01j2', 'Paseo Inventado Sur, 3') returning id into v_l2;
  insert into public.sales_channel (account_id, name, slug) values (v_acc, 'Glovo de prueba S01j2', 'glovo-prueba-s01j2') returning id into v_canal;
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'Plataforma de Prueba S01j2, S.L.', 'B00000197') returning id into v_sup;
  -- La dirección de facturas de la empresa (si aún no la tiene).
  select local_part into v_dir from public.company_inbound_address where company_id = v_e and kind = 'facturas';
  if v_dir is null then
    v_dir := 'facturas-prueba-s01j2';
    insert into public.company_inbound_address (account_id, company_id, kind, local_part, domain, active) values (v_acc, v_e, 'facturas', v_dir, 'entrada.prueba.test', true);
  end if;
  -- Una tienda cuya dirección es la del local (sin local asignado) y otra que no dice nada.
  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_acc, v_e, 'glovo', 'S.L. Marca S01j2 - MAD - Calle Inventada Norte 7 (Calle Inventada Norte 7)') returning id into v_t;
  insert into public.platform_store (account_id, company_id, provider, external_text)
  values (v_acc, v_e, 'glovo', 'S.L. Marca S01j2 - MAD - Avenida Vieja Inventada 12 (Avenida Vieja Inventada 12)') returning id into v_t2;
  -- Como las 29 de Foodint: tiendas sin local (al crearse, otra regla ya les pone el suyo si su dirección lo dice).
  update public.platform_store set location_id = null where id in (v_t, v_t2);
  -- La liquidación que salió de un correo, con su factura de comisión ligada.
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, settlement_date, import_key, source,
                                         orders_count, gross_sales, commission, other_cost, net_payout, inbound_email_id, raw)
  values (v_acc, v_canal, v_t, '2026-10-01', '2026-10-15', '2026-10-22', 's01j2-1', 'excel_glovo', 31, 218, -43.23, 61.5, 236.27, 'correo-s01j2-1', '{}')
  returning id into v_cs;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'FAC-S01J2-1', '2026-10-15', 35.73, 7.50, 43.23, 'en_revision', 'manual', 'Prueba S01j2') returning id into v_inv;
  insert into public.channel_settlement_invoice (account_id, settlement_id, supplier_invoice_id) values (v_acc, v_cs, v_inv);
  -- Una antigua, sin periodo, de un fichero de antes; y una cuyas cifras no suman (ventas 0, saldo negativo).
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, source, gross_sales, net_payout, raw)
  values (v_acc, v_canal, v_t2, null, null, 's01j2-viejo', 'import_csv_glovo', null, 12.5, '{}') returning id into v_cs_viejo;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, source, gross_sales, commission, other_cost, net_payout, raw)
  values (v_acc, v_canal, v_t2, '2026-10-01', '2026-10-15', 's01j2-mal', 'correo_justeat', 0, -5.98, -5.98, 0, '{}') returning id into v_cs_mal;
  -- Los correos: el del Excel leído; el mismo Excel reenviado otra vez; uno con el Excel sin leer; uno de Glovo sin Excel; uno de otro.
  insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail, received_at) values
    ('correo-s01j2-1', v_dir || '@entrada.prueba.test', 'facturas@glovoapp.test', 'Glovo · Factura 1', v_e, v_acc, 'recibido',
       jsonb_build_object('dejados', '[]'::jsonb, 'tomados', 1, 'liquidaciones', jsonb_build_array(jsonb_build_object('id', v_cs, 'ya_estaba', false, 'plataforma', 'glovo'))), now() - interval '5 minutes'),
    ('correo-s01j2-2', v_dir || '@entrada.prueba.test', 'facturas@glovoapp.test', 'Glovo · Factura 1 (otra vez)', v_e, v_acc, 'recibido',
       jsonb_build_object('dejados', '[]'::jsonb, 'tomados', 1, 'liquidaciones', jsonb_build_array(jsonb_build_object('id', v_cs, 'ya_estaba', true, 'plataforma', 'glovo'))), now() - interval '4 minutes'),
    ('correo-s01j2-3', v_dir || '@entrada.prueba.test', 'facturas@glovoapp.test', 'Glovo · Factura 2', v_e, v_acc, 'recibido',
       jsonb_build_object('dejados', jsonb_build_array(jsonb_build_object('nombre', 'invoice-000000000002.XLSX', 'porque', 'no es un PDF ni una foto')), 'tomados', 1), now() - interval '3 minutes'),
    ('correo-s01j2-4', v_dir || '@entrada.prueba.test', 'facturas@glovoapp.test', 'Glovo · Factura 3', v_e, v_acc, 'recibido',
       jsonb_build_object('dejados', '[]'::jsonb, 'tomados', 1), now() - interval '2 minutes'),
    ('correo-s01j2-5', v_dir || '@entrada.prueba.test', 'pedidos@proveedor-inventado.test', 'Factura de octubre', v_e, v_acc, 'recibido',
       jsonb_build_object('dejados', '[]'::jsonb, 'tomados', 1), now() - interval '1 minute');
  perform set_config('prueba.l', v_l::text, true);
  perform set_config('prueba.l2', v_l2::text, true);
  perform set_config('prueba.canal', v_canal::text, true);
  perform set_config('prueba.t', v_t::text, true);
  perform set_config('prueba.t2', v_t2::text, true);
  perform set_config('prueba.cs', v_cs::text, true);
  perform set_config('prueba.viejo', v_cs_viejo::text, true);
  perform set_config('prueba.mal', v_cs_mal::text, true);
end $$;

-- 3 (va primero: la liquidación del correo ya se guardó con el disparador puesto) · El local por el texto de la tienda.
do $$ begin
  if (select location_id from public.channel_settlement where id = current_setting('prueba.cs')::uuid) is distinct from current_setting('prueba.l')::uuid then
    raise exception 'PRUEBA S01j·2 · 3: la liquidación del correo no ha recibido el local del texto de su tienda.';
  end if;
  if (select location_id from public.channel_settlement where id = current_setting('prueba.viejo')::uuid) is not null then
    raise exception 'PRUEBA S01j·2 · 3: una tienda cuyo texto no dice el local ha recibido uno (adivinado).';
  end if;
  if (select location_id from public.platform_store where id = current_setting('prueba.t')::uuid) is not null then
    raise exception 'PRUEBA S01j·2 · 3: se ha tocado el local de la tienda (se decide en Tiendas).';
  end if;
  -- Con la tienda con su local, la liquidación no lo copia: lo lee de la tienda.
  update public.platform_store set location_id = current_setting('prueba.l2')::uuid where id = current_setting('prueba.t2')::uuid;
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, source, net_payout, raw)
  values ('c01d0000-0000-4000-8000-00000000000d', current_setting('prueba.canal')::uuid, current_setting('prueba.t2')::uuid, '2026-10-16', '2026-10-31', 's01j2-tienda-con-local', 'excel_glovo', 1, '{}');
  if (select location_id from public.channel_settlement where import_key = 's01j2-tienda-con-local') is not null then
    raise exception 'PRUEBA S01j·2 · 3: con la tienda con su local, la liquidación ha copiado uno.';
  end if;
  update public.platform_store set location_id = null where id = current_setting('prueba.t2')::uuid;
  raise notice 'PRUEBA S01j·2 · 3: el local sale del texto de la tienda; si no lo dice, nada; la tienda no se toca.';
end $$;

-- 1 y 2 · Como persona: lo que ve Correo de facturas y la ficha.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; ll jsonb; c1 jsonb; c2 jsonb; c3 jsonb; c4 jsonb; c5 jsonb; f jsonb;
begin
  r := public.conta_correo_facturas('c01d0000-0000-4000-8000-0000000000d2');
  ll := r->'llegadas';
  select x into c1 from jsonb_array_elements(ll) x where x->>'email_id' = 'correo-s01j2-1';
  select x into c2 from jsonb_array_elements(ll) x where x->>'email_id' = 'correo-s01j2-2';
  select x into c3 from jsonb_array_elements(ll) x where x->>'email_id' = 'correo-s01j2-3';
  select x into c4 from jsonb_array_elements(ll) x where x->>'email_id' = 'correo-s01j2-4';
  select x into c5 from jsonb_array_elements(ll) x where x->>'email_id' = 'correo-s01j2-5';
  if c1->>'plataforma' <> 'glovo' or c1->>'excel' <> 'leido' or jsonb_array_length(c1->'liquidaciones') <> 1 or (c1->'liquidaciones'->0->>'otro_correo')::boolean then
    raise exception 'PRUEBA S01j·2 · 1: el correo del Excel leído no lo dice: %', c1;
  end if;
  if jsonb_array_length(c2->'liquidaciones') <> 1 or not (c2->'liquidaciones'->0->>'otro_correo')::boolean then
    raise exception 'PRUEBA S01j·2 · 1: el mismo Excel reenviado no enseña su liquidación (de otro correo): %', c2;
  end if;
  if c3->>'excel' <> 'sin_leer' or c4->>'excel' <> 'no_traia' or c5->>'excel' is not null or c5->>'plataforma' is not null then
    raise exception 'PRUEBA S01j·2 · 1: el estado del Excel no es el que toca: % / % / %', c3->>'excel', c4->>'excel', c5->>'excel';
  end if;
  raise notice 'PRUEBA S01j·2 · 1: plataforma, Excel leído / sin leer / no venía, y la liquidación del Excel reenviado (otro correo).';

  f := public.conta_liquidacion_ficha(current_setting('prueba.cs')::uuid);
  if f->>'local' <> 'Local Inventado S01j2' or f->'factura'->>'numero' <> 'FAC-S01J2-1' or f->'correo'->>'email_id' <> 'correo-s01j2-1'
     or (f->>'pedidos')::int <> 31 or (f->>'neto')::numeric <> 236.27 or (f->>'otros')::numeric <> 61.5 or (f->>'sin_periodo')::boolean then
    raise exception 'PRUEBA S01j·2 · 2: la ficha de la del correo no es la que toca: %', f;
  end if;
  f := public.conta_liquidacion_ficha(current_setting('prueba.viejo')::uuid);
  if not (f->>'sin_periodo')::boolean or f->'correo' <> 'null'::jsonb or f->>'origen' <> 'import_csv_glovo' then
    raise exception 'PRUEBA S01j·2 · 2: la antigua no dice que no tiene periodo ni correo: %', f;
  end if;
  f := public.conta_liquidacion_ficha(current_setting('prueba.mal')::uuid);
  if (f->>'ventas')::numeric + (f->>'comision')::numeric + (f->>'otros')::numeric = (f->>'neto')::numeric then
    raise exception 'PRUEBA S01j·2 · 2: la que no suma, suma (se ha retocado algo): %', f;
  end if;
  raise notice 'PRUEBA S01j·2 · 2: la ficha del correo, la antigua sin periodo y la que no suma, tal cual.';
end $$;
reset role;

-- 2 · De otra cuenta, no.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000ff', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_liquidacion_ficha(current_setting('prueba.cs')::uuid);
    raise exception 'PRUEBA S01j·2 · 2: alguien de fuera ve la ficha.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 4 · Guardar otras direcciones también pone el local en las liquidaciones.
update public.channel_settlement set location_id = null where id = current_setting('prueba.viejo')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_local_direcciones_guardar(current_setting('prueba.l2')::uuid, array['Avenida Vieja Inventada, 12'], 'Prueba S01j2');
  if (r->>'liquidaciones')::int < 2 or r->>'texto' not like '%Puesto Otro Local S01j2 en % liquidaciones que no tenían local.' then
    raise exception 'PRUEBA S01j·2 · 4: guardar no pone el local en las liquidaciones o no lo dice: %', r;
  end if;
  raise notice 'PRUEBA S01j·2 · 4: «%»', r->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select location_id from public.channel_settlement where id = current_setting('prueba.viejo')::uuid) is distinct from current_setting('prueba.l2')::uuid then
    raise exception 'PRUEBA S01j·2 · 4: la liquidación no tiene el local de su otra dirección.';
  end if;
end $$;

-- 5 · La 1218 en una base sin Foodint: nada.
do $$ begin
  if exists (select 1 from public.s01j2_local_puesto) then
    raise exception 'PRUEBA S01j·2 · 5: la 1218 ha puesto locales en una base sin Foodint.';
  end if;
  raise notice 'PRUEBA S01j·2 · 5: la 1218 no toca nada fuera de Foodint.';
end $$;

-- 6 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261101T1218_s01j2_local_foodint.down.sql
\i supabase/vuelta-atras/20261101T1217_s01j2_local_de_la_liquidacion.down.sql
\i supabase/vuelta-atras/20261101T1216_s01j2_ficha_liquidacion.down.sql
\i supabase/vuelta-atras/20261101T1215_s01j2_correo_que_salio.down.sql
do $$ begin
  if to_regprocedure('public.conta_liquidacion_ficha(uuid)') is not null or to_regclass('public.s01j2_local_puesto') is not null
     or exists (select 1 from pg_trigger where tgname = 's01j2_liquidacion_pon_local')
     or (select md5(prosrc) from pg_proc where oid = 'public.conta_correo_facturas(uuid)'::regprocedure) <> '68d34fa3c147c49e1c33efedf1084a2a'
     or (select md5(prosrc) from pg_proc where oid = 'public.conta_local_direcciones_guardar(uuid,text[],text)'::regprocedure) <> 'a25f1f1cfbeb84da514015991bdfdaa1' then
    raise exception 'PRUEBA S01j·2 · 6: la vuelta atrás no lo deja como estaba.';
  end if;
  raise notice 'PRUEBA S01j·2 · 6: la vuelta atrás deja las dos funciones con su huella de antes, sin la ficha, sin el disparador y sin la tabla.';
end $$;
\i supabase/migrations/20261101T1215_s01j2_correo_que_salio.sql
\i supabase/migrations/20261101T1216_s01j2_ficha_liquidacion.sql
\i supabase/migrations/20261101T1217_s01j2_local_de_la_liquidacion.sql
\i supabase/migrations/20261101T1218_s01j2_local_foodint.sql

rollback;
