-- supabase/staging/sql/20261024_v01_facturas_venta_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T0835_v01_facturas_venta (public.journal_entry
-- y las facturas de venta), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. En la empresa A de pruebas (Taberna de Prueba Norte), con
-- clientes y facturas inventados dentro de la transacción.
--
--   (Empieza con su vuelta atrás, por si la 0835 ya estuviera.)
--   0. Lo de antes: el CHECK de los orígenes de un asiento no admite
--      'customer_invoice'. La 0835, y ya lo admite.
--   1. Como usuario de A: un cliente con NIF y un borrador con dos líneas (21 %
--      y 10 % con descuento): sus cifras.
--   2. Emitir: F-2026/0001, el asiento validado y cuadrado (430 por el total,
--      70x, 477 por tipo) y el libro de expedidas (F1, el NIF del cliente).
--   3. Otra con recargo y retención: F-2026/0002; el libro lleva el recargo y
--      la retención.
--   4. Una emitida no se cambia ni se borra; un borrador sí se borra.
--   5. Sin huecos: una que no se puede emitir (sin NIF) no gasta número.
--   6. Corregir importes (eran 10, fueron 8): R-2026/0001 por la diferencia,
--      el asiento en el otro lado y el libro R4 con la que corrige.
--   7. Anularla entera: la original queda anulada.
--   8. Cobros: en partes; no más de lo que queda.
--   9. B no ve ni toca nada de A.
--  10. La vuelta atrás para si hay emitidas; sin ellas deja el CHECK como estaba.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261024T0835_v01_facturas_venta.down.sql

-- 0 · Lo de antes.
do $$ begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_source_type_check' and conrelid = 'public.journal_entry'::regclass)) ~ 'customer_invoice' then
    raise exception 'PRUEBA V01 · 0: el CHECK ya admitía customer_invoice antes de la 0835.';
  end if;
end $$;

\i supabase/migrations/20261024T0835_v01_facturas_venta.sql

do $$ begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_source_type_check' and conrelid = 'public.journal_entry'::regclass)) !~ 'customer_invoice' then
    raise exception 'PRUEBA V01 · 0: con la 0835, el CHECK no admite customer_invoice.';
  end if;
  raise notice '0 · el CHECK, antes y después';
end $$;

create temp table _v01 (clave text primary key, v uuid) on commit drop;
grant select, insert on _v01 to authenticated;

-- La empresa A (la que tiene su plan con las 477 enlazadas) y lo que usan las líneas.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select c.id into v_e from public.company c where c.account_id = v_acc
     and exists (select 1 from public.company_account_link k where k.company_id = c.id and k.entity = 'tax_rate' and k.role = 'repercutido')
   order by c.created_at limit 1;
  if v_e is null then raise exception 'PRUEBA V01: la cuenta A no tiene una empresa con sus 477 enlazadas.'; end if;
  insert into _v01 values ('empresa', v_e),
    ('t21', (select id from public.tax_rate where code = 'iva_general' and company_id is null)),
    ('t10', (select id from public.tax_rate where code = 'iva_reducido' and company_id is null)),
    ('c705', (select id from public.company_account where company_id = v_e and code = '70500000')),
    ('c700', (select id from public.company_account where company_id = v_e and code = '70000000')),
    ('ret', (select id from public.withholding_rate where (company_id is null or company_id = v_e) order by rate desc limit 1));
  if exists (select 1 from _v01 where v is null and clave <> 'ret') then
    raise exception 'PRUEBA V01: falta algo de la empresa A (%).', (select string_agg(clave, ', ') from _v01 where v is null);
  end if;
end $$;

-- 1 a 8 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := (select v from _v01 where clave = 'empresa');
  v_t21 uuid := (select v from _v01 where clave = 't21');
  v_t10 uuid := (select v from _v01 where clave = 't10');
  v_c705 uuid := (select v from _v01 where clave = 'c705');
  v_c700 uuid := (select v from _v01 where clave = 'c700');
  v_ret uuid := (select v from _v01 where clave = 'ret');
  v_cli uuid; v_sin uuid; r jsonb; v_f1 uuid; v_f2 uuid; v_b uuid; v_r1 uuid; v_r2 uuid; v_entry uuid; v_n int; v_d numeric; v_h numeric; v_x record;
begin
  -- 1 · El cliente y el borrador.
  r := public.party_save_customer(v_acc, null, 'Colegio Prueba V01', '12345678Z', '{}'::jsonb, 'Prueba V01');
  v_cli := (r->>'party_id')::uuid;
  r := public.conta_venta_guardar(v_e, null,
    jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24', 'vence', '2026-11-23', 'correo', 'colegio@ejemplo.test'),
    jsonb_build_array(
      jsonb_build_object('concepto', 'Menú comedor', 'cantidad', 10, 'precio', 100, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705),
      jsonb_build_object('concepto', 'Menú celíaco', 'cantidad', 1, 'precio', 50, 'descuento', 10, 'tipo_id', v_t10, 'cuenta_id', v_c700)), 'Prueba V01');
  v_f1 := (r->>'id')::uuid;
  perform 1 from public.customer_invoice where id = v_f1 and status = 'borrador' and base = 1045 and tax = 214.5 and total = 1259.5 and customer->>'nif' = '12345678Z';
  if not found then raise exception 'PRUEBA V01 · 1: las cifras del borrador no son base 1.045, IVA 214,50 y total 1.259,50 (%).',
    (select jsonb_build_object('base', base, 'iva', tax, 'total', total) from public.customer_invoice where id = v_f1); end if;
  raise notice '1 · el borrador, con sus cifras';

  -- 2 · Emitir.
  r := public.conta_venta_emitir(v_f1, 'Prueba V01');
  if r->>'numero' <> 'F-2026/0001' then raise exception 'PRUEBA V01 · 2: el número es % y no F-2026/0001.', r->>'numero'; end if;
  v_entry := (r->>'asiento')::uuid;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = v_entry;
  if v_d <> v_h or v_d <> 1259.5 then raise exception 'PRUEBA V01 · 2: el asiento no cuadra a 1.259,50 (debe %, haber %).', v_d, v_h; end if;
  perform 1 from public.journal_entry where id = v_entry and status = 'validado' and source_type = 'customer_invoice' and source_id = v_f1 and series = 1;
  if not found then raise exception 'PRUEBA V01 · 2: el asiento no está validado en la serie de Ventas con su factura.'; end if;
  select count(*) into v_n from public.vat_book_entry where entry_id = v_entry and book = 'issued' and invoice_type = 'F1' and number = 'F-2026/0001'
     and counterpart_tax_id = '12345678Z' and tax_amount in (210, 4.5);
  if v_n <> 2 then raise exception 'PRUEBA V01 · 2: el libro de expedidas no tiene las dos anotaciones F1 con el NIF (%).', v_n; end if;
  perform 1 from public.customer_invoice where id = v_f1 and status = 'emitida' and hash is not null and entry_id = v_entry;
  if not found then raise exception 'PRUEBA V01 · 2: la factura no queda emitida con su huella y su asiento.'; end if;
  raise notice '2 · emitida F-2026/0001, asiento cuadrado y libro F1';

  -- 3 · Recargo y retención.
  r := public.conta_venta_guardar(v_e, null,
    jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24', 'recargo', true, 'retencion_id', v_ret),
    jsonb_build_array(jsonb_build_object('concepto', 'Catering', 'cantidad', 1, 'precio', 1000, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V01');
  v_f2 := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_f2, 'Prueba V01');
  if r->>'numero' <> 'F-2026/0002' then raise exception 'PRUEBA V01 · 3: el número es % y no F-2026/0002.', r->>'numero'; end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = (r->>'asiento')::uuid;
  if v_d <> v_h then raise exception 'PRUEBA V01 · 3: con recargo y retención el asiento no cuadra (debe %, haber %).', v_d, v_h; end if;
  perform 1 from public.vat_book_entry where entry_id = (r->>'asiento')::uuid and surcharge_amount = 52;
  if not found then raise exception 'PRUEBA V01 · 3: el libro no lleva el recargo de equivalencia (52 €).'; end if;
  if v_ret is not null then
    perform 1 from public.vat_book_entry v join public.customer_invoice f on f.entry_id = v.entry_id
     where v.entry_id = (r->>'asiento')::uuid and f.withholding_amount > 0 and v.withholding_amount = f.withholding_amount;
    if not found then raise exception 'PRUEBA V01 · 3: el libro no lleva la retención de la factura.'; end if;
  end if;
  raise notice '3 · F-2026/0002 con recargo y retención';

  -- 4 · Lo emitido no se cambia; un borrador se borra.
  begin
    perform public.conta_venta_borrar(v_f1);
    raise exception 'PRUEBA V01 · 4: se ha podido borrar una emitida.';
  exception when check_violation then null;
  end;
  begin
    perform public.conta_venta_guardar(v_e, v_f1, jsonb_build_object('cliente_id', v_cli), '[]'::jsonb, 'Prueba V01');
    raise exception 'PRUEBA V01 · 4: se ha podido cambiar una emitida.';
  exception when check_violation then null;
  end;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli), '[]'::jsonb, 'Prueba V01');
  v_b := (r->>'id')::uuid;
  r := public.conta_venta_borrar(v_b);
  if exists (select 1 from public.customer_invoice where id = v_b) then raise exception 'PRUEBA V01 · 4: el borrador no se ha borrado.'; end if;
  raise notice '4 · una emitida no se cambia ni se borra; un borrador sí';

  -- 5 · Sin huecos: sin NIF no se emite y no gasta número.
  r := public.party_save_customer(v_acc, null, 'Particular sin NIF V01', null, '{}'::jsonb, 'Prueba V01');
  v_sin := (r->>'party_id')::uuid;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_sin),
    jsonb_build_array(jsonb_build_object('concepto', 'Algo', 'cantidad', 1, 'precio', 10, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V01');
  begin
    perform public.conta_venta_emitir((r->>'id')::uuid, 'Prueba V01');
    raise exception 'PRUEBA V01 · 5: se ha emitido sin NIF.';
  exception when check_violation then null;
  end;
  if (select last_number from public.customer_invoice_counter where company_id = v_e and series_code = 'F' and fiscal_year = 2026) <> 2 then
    raise exception 'PRUEBA V01 · 5: la que no se emitió ha gastado número.';
  end if;
  raise notice '5 · sin huecos';

  -- 6 · Corregir importes: eran 10, fueron 8.
  r := public.conta_venta_corregir(v_f1, 'importes', 'Eran 10 menús y fueron 8', 'Prueba V01');
  v_r1 := (r->>'id')::uuid;
  r := public.conta_venta_guardar(v_e, v_r1, jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24', 'motivo', 'Eran 10 menús y fueron 8'),
    jsonb_build_array(
      jsonb_build_object('concepto', 'Menú comedor', 'cantidad', 8, 'precio', 100, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705),
      jsonb_build_object('concepto', 'Menú celíaco', 'cantidad', 1, 'precio', 50, 'descuento', 10, 'tipo_id', v_t10, 'cuenta_id', v_c700)), 'Prueba V01');
  r := public.conta_venta_emitir(v_r1, 'Prueba V01');
  if r->>'numero' <> 'R-2026/0001' or (r->>'total')::numeric <> -242 then
    raise exception 'PRUEBA V01 · 6: la rectificativa es % por % y no R-2026/0001 por −242.', r->>'numero', r->>'total';
  end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = (r->>'asiento')::uuid;
  if v_d <> v_h or v_d <> 242 then raise exception 'PRUEBA V01 · 6: el asiento de la rectificativa no cuadra a 242 (debe %, haber %).', v_d, v_h; end if;
  perform 1 from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
   where jl.entry_id = (r->>'asiento')::uuid and a.code like '430%' and jl.credit = 242;
  if not found then raise exception 'PRUEBA V01 · 6: en la rectificativa la 430 no va al haber.'; end if;
  perform 1 from public.vat_book_entry where entry_id = (r->>'asiento')::uuid and invoice_type = 'R4' and corrects_ref = 'F-2026/0001' and tax_amount = -42;
  if not found then raise exception 'PRUEBA V01 · 6: el libro no tiene la R4 que corrige la F-2026/0001 por −42 de IVA.'; end if;
  raise notice '6 · R-2026/0001 por la diferencia';

  -- 7 · Anular la F-2026/0002 entera.
  r := public.conta_venta_corregir(v_f2, 'anular', 'Pedido cancelado', 'Prueba V01');
  v_r2 := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_r2, 'Prueba V01');
  if r->>'numero' <> 'R-2026/0002' then raise exception 'PRUEBA V01 · 7: la rectificativa para anular es % y no R-2026/0002.', r->>'numero'; end if;
  perform 1 from public.customer_invoice where id = v_f2 and status = 'anulada';
  if not found then raise exception 'PRUEBA V01 · 7: la F-2026/0002 no queda anulada.'; end if;
  raise notice '7 · anulada entera con la R-2026/0002';

  -- 8 · Cobros en partes.
  r := public.conta_venta_cobrar(v_f1, date '2026-10-30', 500, 'transfer', null, 'Prueba V01');
  if (r->>'queda')::numeric <> 759.5 then raise exception 'PRUEBA V01 · 8: tras cobrar 500 quedan % y no 759,50.', r->>'queda'; end if;
  begin
    perform public.conta_venta_cobrar(v_f1, date '2026-10-30', 800, 'transfer', null, 'Prueba V01');
    raise exception 'PRUEBA V01 · 8: se ha podido cobrar más de lo que queda.';
  exception when invalid_parameter_value then null;
  end;
  select count(*) into v_n from public.customer_invoice_event where invoice_id = v_f1;
  if v_n < 4 then raise exception 'PRUEBA V01 · 8: el historial de la F-2026/0001 tiene % frases (creada, emitida, corregida, cobro).', v_n; end if;
  insert into _v01 values ('f1', v_f1);
  raise notice '8 · cobros en partes, y el historial';
end $$;

-- 9 · B no ve ni toca nada de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_f1 uuid := (select v from _v01 where clave = 'f1');
begin
  if exists (select 1 from public.customer_invoice where id = v_f1) or exists (select 1 from public.customer_invoice_line where invoice_id = v_f1)
     or exists (select 1 from public.customer_invoice_event where invoice_id = v_f1) then
    raise exception 'PRUEBA V01 · 9: B ve las facturas de A.';
  end if;
  begin
    perform public.conta_venta_cobrar(v_f1, null, 1, null, null, 'B');
    raise exception 'PRUEBA V01 · 9: B ha cobrado una factura de A.';
  exception when no_data_found or sqlstate 'P0002' or insufficient_privilege then null;
  end;
  begin
    insert into public.customer_invoice (account_id, company_id) select account_id, company_id from public.journal_entry limit 1;
    raise exception 'PRUEBA V01 · 9: B escribe en customer_invoice sin pasar por las funciones.';
  exception when insufficient_privilege then null;
  end;
  raise notice '9 · B no ve ni toca nada de A';
end $$;
reset role;

-- 10 · La vuelta atrás: con emitidas, su freno para (la misma condición que su primer bloque).
do $$ begin
  if not exists (select 1 from public.customer_invoice where status <> 'borrador') then
    raise exception 'PRUEBA V01 · 10: no hay emitidas para probar el freno.';
  end if;
  raise notice '10 · con emitidas, la vuelta atrás para (su freno ve % emitidas)', (select count(*) from public.customer_invoice where status <> 'borrador');
  raise notice 'PRUEBA V01 en verde: borrador, emitir sin huecos, el asiento y el libro, recargo y retención, corregir y anular, cobros, B fuera.';
end $$;

rollback;
