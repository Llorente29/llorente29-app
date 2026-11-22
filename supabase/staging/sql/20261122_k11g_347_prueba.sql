-- supabase/staging/sql/20261122_k11g_347_prueba.sql
--
-- SOLO STAGING. Prueba del K11g (20261122T1855_k11g_347_desde_los_libros), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra lo nuevo:
-- public.conta_347_desde_los_libros(uuid,integer). No cambia nada que exista.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Proveedores, cuentas y facturas inventados
-- (T11). Por sus CAMINOS: cada recibida se propone y se valida (journal_entry_proponer y journal_entry_validar, como la
-- pantalla), y el 347 y el 303 se calculan con las funciones de la pantalla.
--   1. Proveedor uno: tres facturas de 1.210,00 € en el 4T → en el 347, clave A, 3.630,00 (todo en el 4T).
--   2. Una cuarta suya marcada «No incluir en modelo 347» → no suma; el 347 dice que salta una «marcada».
--   3. Proveedor dos: dos de 1.210,00 € (2.420,00) → por debajo de 3.005,06: no sale.
--   4. Un abono del proveedor uno marcado «Rectificación de deducciones» (Julio, 22/11: «el signo lo da la factura»):
--      en el 303 del 4T resta en la [40] (−100) y la [41] (−21); y en el 347, el del proveedor uno baja a 3.509,00.
--   5. Arrendamiento (art. 34.1.d): con un contrato de alquiler del proveedor uno (su referencia catastral, inventada),
--      sale en «arrendamientos» con el arrendador, la referencia y lo facturado en el año sin lo marcado (3.509,00).
--   6. Metálico (art. 34.1.h): un cliente que paga 7.000,00 € en caja (570 al debe contra su 430) sale en «metalico»;
--      otro con 2.000,00, no.
--   7. Ventas (clave B): un cliente con dos facturas expedidas de 2.000,00 € (en el libro de expedidas, puestas aquí
--      a mano: el libro es lo que lee el 347) sale con 4.000,00 en la clave B; otro con 1.000,00, no.
--   8. La vuelta atrás quita la función.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K11g: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_347_desde_los_libros(uuid,integer)') is null then raise exception 'PRUEBA K11g · 0: falta la 1855 delante.'; end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; k record;
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f30000-0000-4000-8000-0000000000a1', a, 'Proveedor Uno de Prueba K11g, S.L.', 'B00011171', 'ES', 'general'),
    ('c0f30000-0000-4000-8000-0000000000a2', a, 'Proveedor Dos de Prueba K11g, S.L.', 'B00011189', 'ES', 'general');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000097', '4000', 'Proveedor Uno de Prueba K11g', 'own', 'manual'),
    (a, emp, 'pymes', '40000098', '4000', 'Proveedor Dos de Prueba K11g', 'own', 'manual'),
    (a, emp, 'pymes', '62900097', '629', 'Otros servicios de prueba K11g', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', case c.code when '40000097' then 'c0f30000-0000-4000-8000-0000000000a1' else 'c0f30000-0000-4000-8000-0000000000a2' end, 'principal', 'manual'
    from public.company_account c where c.company_id = emp and c.code in ('40000097', '40000098');
  for k in select * from (values
      ('b1', 'a1', 'K11G-UNO-1', 'invoice', false, false), ('b2', 'a1', 'K11G-UNO-2', 'invoice', false, false), ('b3', 'a1', 'K11G-UNO-3', 'invoice', false, false),
      ('b4', 'a1', 'K11G-UNO-FUERA', 'invoice', true, false), ('b5', 'a2', 'K11G-DOS-1', 'invoice', false, false), ('b6', 'a2', 'K11G-DOS-2', 'invoice', false, false),
      ('b7', 'a1', 'K11G-UNO-ABONO', 'credit_note', false, true)) v(n, sup, numero, clase, fuera, rectifica) loop
    insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                         tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at, exclude_from_347, deduction_rectification)
    values (('c0f30000-0000-4000-8000-0000000000' || k.n)::uuid, a, emp, ('c0f30000-0000-4000-8000-0000000000' || k.sup)::uuid, k.clase, k.numero, date '2026-11-05',
            'aprobada', 'manual', 1000, 210, 1210, false, 'prueba K11g', timestamptz '2026-11-05 10:00+01', k.fuera, k.rectifica);
  end loop;
end $$;

-- Una recibida (o un abono) por la propuesta, como la pantalla, y validada. Un abono lleva la 472 y el gasto al haber.
create or replace function pg_temp.k11g_recibida(p_factura uuid, p_prov text, p_base numeric, p_abono boolean) returns uuid language plpgsql as $$
declare
  t uuid := (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null);
  v_num text := (select invoice_number from public.supplier_invoice where id = p_factura);
  c numeric := round(p_base * 0.21, 2); v_r jsonb; v_e uuid;
begin
  v_r := public.journal_entry_proponer('c0e20000-0000-4000-8000-0000000000e3',
    jsonb_build_object('series', 2, 'fecha', date '2026-11-05', 'concepto', 'Prueba K11g · ' || v_num, 'source_type', 'supplier_invoice', 'source_id', p_factura,
                       'confianza', 'seguro', 'porque', 'prueba K11g', 'documento', v_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900097', 'debe', case when p_abono then 0 else p_base end, 'haber', case when p_abono then p_base else 0 end, 'comun', true, 'documento', v_num),
      jsonb_build_object('cuenta', '47200021', 'debe', case when p_abono then 0 else c end, 'haber', case when p_abono then c else 0 end, 'comun', true, 'documento', v_num,
                         'iva', jsonb_build_object('tipo_id', t, 'base', p_base, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', p_prov, 'debe', case when p_abono then p_base + c else 0 end, 'haber', case when p_abono then 0 else p_base + c end, 'comun', true, 'documento', v_num)),
    null, 'Prueba K11g');
  v_e := (v_r ->> 'id')::uuid;
  perform public.journal_entry_validar(v_e, 'Prueba K11g');
  return v_e;
end $$;
create or replace function pg_temp.k11g_347(p_nif text) returns jsonb language sql as $$
  select (select t from jsonb_array_elements(public.conta_347_desde_los_libros('c0e20000-0000-4000-8000-0000000000e3', 2026) -> 'terceros') t
           where t ->> 'nif' = p_nif and t ->> 'clave' = 'A')
$$;
create or replace function pg_temp.k11g_caja(p_caja text) returns numeric language sql as $$
  select coalesce((public.conta_impuesto_303_desde_libro('c0e20000-0000-4000-8000-0000000000e3', 2026, '4T') -> 'casillas' ->> p_caja)::numeric, 0)
$$;
grant execute on function pg_temp.k11g_recibida(uuid, text, numeric, boolean) to authenticated;
grant execute on function pg_temp.k11g_347(text) to authenticated;
grant execute on function pg_temp.k11g_caja(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare x jsonb; c40 numeric; c41 numeric; v_fuera int;
begin
  -- 1 · Tres de 1.210,00 del proveedor uno.
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b1', '40000097', 1000, false);
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b2', '40000097', 1000, false);
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b3', '40000097', 1000, false);
  x := pg_temp.k11g_347('B00011171');
  if x is null or (x ->> 'total')::numeric <> 3630 or (x ->> 't4')::numeric <> 3630 then raise exception 'PRUEBA K11g · 1: el proveedor uno no sale con 3.630,00 en el 4T (%)', x; end if;
  raise notice 'PRUEBA K11g · 1: proveedor uno, clave A, % € (4T %).', x ->> 'total', x ->> 't4';
  -- 2 · La cuarta, marcada: no suma.
  v_fuera := coalesce((public.conta_347_desde_los_libros('c0e20000-0000-4000-8000-0000000000e3', 2026) -> 'fuera' ->> 'marcada')::int, 0);
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b4', '40000097', 1000, false);
  x := pg_temp.k11g_347('B00011171');
  if (x ->> 'total')::numeric <> 3630 then raise exception 'PRUEBA K11g · 2: la marcada «No incluir en modelo 347» ha sumado (%)', x; end if;
  if coalesce((public.conta_347_desde_los_libros('c0e20000-0000-4000-8000-0000000000e3', 2026) -> 'fuera' ->> 'marcada')::int, 0) <> v_fuera + 1 then
    raise exception 'PRUEBA K11g · 2: no dice que salta una marcada';
  end if;
  raise notice 'PRUEBA K11g · 2: la marcada no suma (sigue en % €) y el 347 dice que la salta.', x ->> 'total';
  -- 3 · Proveedor dos: 2.420,00, por debajo del límite.
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b5', '40000098', 1000, false);
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b6', '40000098', 1000, false);
  if pg_temp.k11g_347('B00011189') is not null then raise exception 'PRUEBA K11g · 3: el proveedor dos (2.420,00) sale en el 347'; end if;
  raise notice 'PRUEBA K11g · 3: el proveedor dos, con 2.420,00 €, no sale (límite 3.005,06).';
  -- 4 · Un abono marcado «Rectificación de deducciones»: resta en la [40]/[41] y en el 347.
  c40 := pg_temp.k11g_caja('40'); c41 := pg_temp.k11g_caja('41');
  perform pg_temp.k11g_recibida('c0f30000-0000-4000-8000-0000000000b7', '40000097', 100, true);
  if pg_temp.k11g_caja('40') - c40 <> -100 or pg_temp.k11g_caja('41') - c41 <> -21 then
    raise exception 'PRUEBA K11g · 4: el abono de rectificación no resta en la [40]/[41] (% y %)', pg_temp.k11g_caja('40') - c40, pg_temp.k11g_caja('41') - c41;
  end if;
  x := pg_temp.k11g_347('B00011171');
  if (x ->> 'total')::numeric <> 3509 then raise exception 'PRUEBA K11g · 4: el abono no baja el 347 del proveedor uno a 3.509,00 (%)', x; end if;
  raise notice 'PRUEBA K11g · 4: el abono de rectificación resta: [40] −100, [41] −21; y el 347 del proveedor uno, % €.', x ->> 'total';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 5, 6 y 7 · Arrendamiento, metálico y ventas.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid := (select id from public.fiscal_year where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and date '2026-11-12' between starts_on and ends_on);
  v_e uuid; k record;
begin
  insert into public.company_lease (account_id, company_id, supplier_id, situation, cadastral_ref, street_name, municipality, province, postal_code)
  values (a, emp, 'c0f30000-0000-4000-8000-0000000000a1', '1', '0000000AA0000A0001AA', 'Calle de Prueba', 'Madrid', '28', '28000');
  insert into public.party (id, account_id, name, tax_id, source) values
    ('c0f30000-0000-4000-8000-0000000000c1', a, 'Cliente Uno de Prueba K11g, S.L.', 'B00011197', 'manual'),
    ('c0f30000-0000-4000-8000-0000000000c2', a, 'Cliente Dos de Prueba K11g, S.L.', 'B00011205', 'manual');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '57000097', '570', 'Caja de prueba K11g', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  -- 6 · Cobros en caja: 7.000,00 del cliente uno y 2.000,00 del dos (contra dos 43 de la semilla, con su tercero en la línea).
  for k in select * from (values ('43000081', 'c0f30000-0000-4000-8000-0000000000c1', 7000), ('43000082', 'c0f30000-0000-4000-8000-0000000000c2', 2000)) v(cta, party, imp) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
    values (a, emp, v_y, 4, '2026-11-12', 'K11g cobro en caja', 'manual', 'borrador', 'Prueba K11g') returning id into v_e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common, party_id)
    select a, emp, v_e, x.p, c.id, x.d, x.h, false, case when x.p = 2 then k.party::uuid end
      from (values (1, '57000097', k.imp, 0), (2, k.cta, 0, k.imp)) x(p, code, d, h) join public.company_account c on c.company_id = emp and c.code = x.code;
    perform public._journal_entry_validar(v_e, 'Prueba K11g');
  end loop;
  -- 7 · El libro de expedidas: dos de 2.000,00 al cliente uno y una de 1.000,00 al dos.
  for k in select * from (values ('B00011197', 'Cliente Uno de Prueba K11g, S.L.', 'K11G-V1', 2000), ('B00011197', 'Cliente Uno de Prueba K11g, S.L.', 'K11G-V2', 2000),
                                 ('B00011205', 'Cliente Dos de Prueba K11g, S.L.', 'K11G-V3', 1000)) v(nif, nombre, num, total) loop
    insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, number, issue_date, counterpart_tax_id, counterpart_country, counterpart_name,
                                       qualification, tax_base, tax_rate, tax_amount, total, source_type)
    values (a, emp, v_e, 'issued', 'F1', k.num, date '2026-11-12', k.nif, 'ES', k.nombre, 'S1', round(k.total / 1.21, 2), 21, k.total - round(k.total / 1.21, 2), k.total, 'manual');
  end loop;
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb := public.conta_347_desde_los_libros('c0e20000-0000-4000-8000-0000000000e3', 2026); x jsonb;
begin
  select t into x from jsonb_array_elements(r -> 'arrendamientos') t where t ->> 'referencia_catastral' = '0000000AA0000A0001AA';
  if x is null or x ->> 'nif' <> 'B00011171' or (x ->> 'total')::numeric <> 3509 then raise exception 'PRUEBA K11g · 5: el alquiler no sale con su arrendador, su referencia y 3.509,00 (%)', x; end if;
  raise notice 'PRUEBA K11g · 5: arrendamiento: % (%), referencia %, % €.', x ->> 'arrendador', x ->> 'nif', x ->> 'referencia_catastral', x ->> 'total';
  select t into x from jsonb_array_elements(r -> 'metalico') t where t ->> 'nif' = 'B00011197';
  if x is null or (x ->> 'total')::numeric <> 7000 then raise exception 'PRUEBA K11g · 6: el cobro en caja del cliente uno no sale con 7.000,00 (%)', r -> 'metalico'; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'metalico') t where t ->> 'nif' = 'B00011205') then raise exception 'PRUEBA K11g · 6: el cliente dos (2.000,00) sale en metálico'; end if;
  raise notice 'PRUEBA K11g · 6: metálico: % con % €; el de 2.000,00, no.', x ->> 'cliente', x ->> 'total';
  select t into x from jsonb_array_elements(r -> 'terceros') t where t ->> 'nif' = 'B00011197' and t ->> 'clave' = 'B';
  if x is null or (x ->> 'total')::numeric <> 4000 then raise exception 'PRUEBA K11g · 7: el cliente uno no sale en la clave B con 4.000,00 (%)', x; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'terceros') t where t ->> 'nif' = 'B00011205') then raise exception 'PRUEBA K11g · 7: el cliente dos (1.000,00) sale'; end if;
  raise notice 'PRUEBA K11g · 7: ventas: cliente uno, clave B, % € (4T %); el de 1.000,00, no.', x ->> 'total', x ->> 't4';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 8 · La vuelta atrás.
\i supabase/vuelta-atras/20261122T1855_k11g_347_desde_los_libros.down.sql
do $$ begin
  if to_regprocedure('public.conta_347_desde_los_libros(uuid,integer)') is not null then raise exception 'PRUEBA K11g · 8: la vuelta atrás no quita la función'; end if;
  raise notice 'PRUEBA K11g · 8: la vuelta atrás quita la función.';
end $$;

rollback;
