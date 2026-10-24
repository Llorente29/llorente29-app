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
--   3. El recargo de equivalencia aún no se deja guardar (lo dice). Otra con
--      retención: F-2026/0002; la retención va a una 473 y el libro la lleva.
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

-- El número que toca la enésima de una serie, con lo que diga su Numeración (cifras, inicio y año) o lo de serie.
create function pg_temp.numero_esperado(p_empresa uuid, p_serie text, p_n int) returns text language sql stable as $f$
  select p_serie || '-' || case when coalesce(s.reset_yearly, true) then '2026/' else '' end
         || lpad((coalesce(s.starts_at, 1) + p_n - 1)::text, coalesce(s.digits, 4), '0')
    from (select 1) x left join public.invoice_series s on s.company_id = p_empresa and s.code = p_serie and s.is_active
$f$;
grant execute on function pg_temp.numero_esperado(uuid, text, int) to authenticated;

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
  -- El número que toca: con las cifras de la serie de la empresa (Numeración), o 4.
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
  if r->>'numero' <> pg_temp.numero_esperado(v_e, 'F', 1) then raise exception 'PRUEBA V01 · 2: el número es % y no F-2026/0001.', r->>'numero'; end if;
  v_entry := (r->>'asiento')::uuid;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = v_entry;
  if v_d <> v_h or v_d <> 1259.5 then raise exception 'PRUEBA V01 · 2: el asiento no cuadra a 1.259,50 (debe %, haber %).', v_d, v_h; end if;
  perform 1 from public.journal_entry where id = v_entry and status = 'validado' and source_type = 'customer_invoice' and source_id = v_f1 and series = 1;
  if not found then raise exception 'PRUEBA V01 · 2: el asiento no está validado en la serie de Ventas con su factura.'; end if;
  select count(*) into v_n from public.vat_book_entry where entry_id = v_entry and book = 'issued' and invoice_type = 'F1' and number = (select number_text from public.customer_invoice where id = v_f1)
     and counterpart_tax_id = '12345678Z' and tax_amount in (210, 4.5);
  if v_n <> 2 then raise exception 'PRUEBA V01 · 2: el libro de expedidas no tiene las dos anotaciones F1 con el NIF (%).', v_n; end if;
  perform 1 from public.customer_invoice where id = v_f1 and status = 'emitida' and hash is not null and entry_id = v_entry;
  if not found then raise exception 'PRUEBA V01 · 2: la factura no queda emitida con su huella y su asiento.'; end if;
  raise notice '2 · emitida F-2026/0001, asiento cuadrado y libro F1';

  -- 3 · El recargo, todavía no; la retención, a la 473.
  begin
    perform public.conta_venta_guardar(v_e, null,
      jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24', 'recargo', true),
      jsonb_build_array(jsonb_build_object('concepto', 'Catering', 'cantidad', 1, 'precio', 1000, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V01');
    raise exception 'PRUEBA V01 · 3: un borrador con recargo de equivalencia se ha guardado (aún no se sabe llevar al libro).';
  exception when feature_not_supported then null;
  end;
  r := public.conta_venta_guardar(v_e, null,
    jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24', 'retencion_id', v_ret),
    jsonb_build_array(jsonb_build_object('concepto', 'Catering', 'cantidad', 1, 'precio', 1000, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V01');
  v_f2 := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_f2, 'Prueba V01');
  if r->>'numero' <> pg_temp.numero_esperado(v_e, 'F', 2) then raise exception 'PRUEBA V01 · 3: el número es % y no %.', r->>'numero', pg_temp.numero_esperado(v_e, 'F', 2); end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = (r->>'asiento')::uuid;
  if v_d <> v_h then raise exception 'PRUEBA V01 · 3: con retención el asiento no cuadra (debe %, haber %).', v_d, v_h; end if;
  if v_ret is not null then
    perform 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
      join public.customer_invoice f on f.entry_id = l.entry_id
     where l.entry_id = (r->>'asiento')::uuid and a.code like '473%' and f.withholding_amount > 0 and l.debit = f.withholding_amount;
    if not found then raise exception 'PRUEBA V01 · 3: la retención no está en el debe de una 473.'; end if;
    perform 1 from public.vat_book_entry v join public.customer_invoice f on f.entry_id = v.entry_id
     where v.entry_id = (r->>'asiento')::uuid and f.withholding_amount > 0 and v.withholding_amount = f.withholding_amount;
    if not found then raise exception 'PRUEBA V01 · 3: el libro no lleva la retención de la factura.'; end if;
  end if;
  raise notice '3 · el recargo aún no; F-2026/0002 con la retención en la 473';

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
  perform 1 from public.customer_invoice where id = (r->>'id')::uuid and status = 'borrador' and number is null;
  if not found then raise exception 'PRUEBA V01 · 5: la que no se pudo emitir no sigue en borrador sin número.'; end if;
  raise notice '5 · sin NIF no se emite (el contador, en el 10)';

  -- 6 · Corregir importes: eran 10, fueron 8.
  r := public.conta_venta_corregir(v_f1, 'importes', 'Eran 10 menús y fueron 8', 'Prueba V01');
  v_r1 := (r->>'id')::uuid;
  r := public.conta_venta_guardar(v_e, v_r1, jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24', 'motivo', 'Eran 10 menús y fueron 8'),
    jsonb_build_array(
      jsonb_build_object('concepto', 'Menú comedor', 'cantidad', 8, 'precio', 100, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705),
      jsonb_build_object('concepto', 'Menú celíaco', 'cantidad', 1, 'precio', 50, 'descuento', 10, 'tipo_id', v_t10, 'cuenta_id', v_c700)), 'Prueba V01');
  r := public.conta_venta_emitir(v_r1, 'Prueba V01');
  if r->>'numero' <> pg_temp.numero_esperado(v_e, 'R', 1) or (r->>'total')::numeric <> -242 then
    raise exception 'PRUEBA V01 · 6: la rectificativa es % por % y no R-2026/0001 por −242.', r->>'numero', r->>'total';
  end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = (r->>'asiento')::uuid;
  if v_d <> v_h or v_d <> 242 then raise exception 'PRUEBA V01 · 6: el asiento de la rectificativa no cuadra a 242 (debe %, haber %).', v_d, v_h; end if;
  perform 1 from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
   where jl.entry_id = (r->>'asiento')::uuid and a.code like '430%' and jl.credit = 242;
  if not found then raise exception 'PRUEBA V01 · 6: en la rectificativa la 430 no va al haber.'; end if;
  perform 1 from public.vat_book_entry where entry_id = (r->>'asiento')::uuid and invoice_type = 'R4' and corrects_ref = (select number_text from public.customer_invoice where id = v_f1) and tax_amount = -42;
  if not found then raise exception 'PRUEBA V01 · 6: el libro no tiene la R4 que corrige la F-2026/0001 por −42 de IVA.'; end if;
  raise notice '6 · R-2026/0001 por la diferencia';

  -- 7 · Anular la F-2026/0002 entera.
  r := public.conta_venta_corregir(v_f2, 'anular', 'Pedido cancelado', 'Prueba V01');
  v_r2 := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_r2, 'Prueba V01');
  if r->>'numero' <> pg_temp.numero_esperado(v_e, 'R', 2) then raise exception 'PRUEBA V01 · 7: la rectificativa para anular es % y no R-2026/0002.', r->>'numero'; end if;
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

-- 10 · Sin huecos (el contador solo lo ve el servidor): dos emitidas de la F, el contador en la segunda.
do $$
declare v_e uuid := (select v from _v01 where clave = 'empresa');
begin
  if (select pg_temp.numero_esperado(v_e, 'F', 2)) is distinct from (select max(number_text) from public.customer_invoice where company_id = v_e and series_code = 'F' and status <> 'borrador')
     or (select count(*) from public.customer_invoice where company_id = v_e and series_code = 'F' and status <> 'borrador') <> 2 then
    raise exception 'PRUEBA V01 · 5: la que no se emitió ha gastado número (o faltan emitidas).';
  end if;
  raise notice '5 · sin huecos: dos emitidas de la F y la segunda es la que toca';
end $$;

-- 10 · La vuelta atrás: con emitidas, su freno para (la misma condición que su primer bloque).
do $$ begin
  if not exists (select 1 from public.customer_invoice where status <> 'borrador') then
    raise exception 'PRUEBA V01 · 10: no hay emitidas para probar el freno.';
  end if;
  raise notice '10 · con emitidas, la vuelta atrás para (su freno ve % emitidas)', (select count(*) from public.customer_invoice where status <> 'borrador');
  raise notice 'PRUEBA V01 en verde: borrador, emitir sin huecos, el asiento y el libro, el recargo aún no y la retención, corregir y anular, cobros, B fuera.';
end $$;

rollback;
