-- supabase/staging/sql/20261121_k10b_cabecera_recibida_prueba.sql
--
-- SOLO STAGING. Prueba del K10b (20261121T2150_k10b_cabecera_recibida y 20261121T2151_k10b_regla_11_lee_la_factura),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra el objeto
-- que cambia: public.conta_motivos_para_validar (la regla 11, tres trozos); y los nuevos:
-- public.conta_recibida_cabecera, public.conta_operacion_clase y public.conta_operacion_nombre.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Los proveedores, las cuentas, las
-- facturas y el 303 presentado son inventados, dentro de la transacción (T11).
--
-- Regla 10: un cambio de IVA se ensaya por sus CAMINOS, validando, no por su fórmula.
--   0. La 2150 y la 2151 están delante.
--   1. Lo de antes no cambia: una factura normal (IVA general) y una con inversión del sujeto pasivo,
--      con el tipo vacío (el de su ficha, lo de siempre) y con el mismo tipo escrito en la factura: los
--      mismos motivos y la misma huella del asiento y del libro de IVA, y las dos se validan.
--   2. El tipo cambiado en la factura: a un proveedor de España con «Adquisición intracomunitaria de
--      servicios», un apunte con IVA general no se valida (y lo dice), y con «Compra en otro país de la UE»
--      se valida; su libro de IVA sale de recibidas con su tipo intracomunitario.
--   3. El trimestre: con el 303 del 3T presentado, la factura del 15/09 se apunta el 01/10
--      (conta_recibida_fecha); su IVA el 15/09 no se deja ni apuntar y el 01/10 sí; elegir el 3T
--      («deduce_en») no se deja, el 2T tampoco (antes de su fecha), y el 4T sí.
--   4. El concepto, las observaciones y la marca se guardan, con su rastro.
--   5. Deshacer: la vuelta atrás devuelve conta_motivos_para_validar como era y quita lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K10b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _k10b (clave text primary key, valor text) on commit drop;
grant select, insert, update on _k10b to authenticated;

-- 0 · Lo de antes.
do $$ begin
  if to_regprocedure('public.conta_recibida_cabecera(uuid,jsonb,text)') is null
     or strpos(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure), 'K10b: el tipo de operación') = 0 then
    raise exception 'PRUEBA K10b · 0: falta la 2150 o la 2151 delante (las pone el ensayo de staging).';
  end if;
  raise notice '0 · la 2150 y la 2151 delante.';
end $$;

-- Lo inventado: dos proveedores de España (uno normal y uno con inversión del sujeto pasivo en su ficha), sus
-- subcuentas, la 472 y la 477 al 21 %, una cuenta de gasto, y cuatro facturas por revisar.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_nac uuid := 'c0eb0000-0000-4000-8000-0000000000a1'; v_isp uuid := 'c0eb0000-0000-4000-8000-0000000000a2';
begin
  insert into public.supplier (id, account_id, name, country_code, vat_regime) values
    (v_nac, a, 'Proveedor de Prueba K10b Normal, S.L.', 'ES', 'general'),
    (v_isp, a, 'Proveedor de Prueba K10b Obras, S.L.', 'ES', 'inversion_sujeto_pasivo');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000097', '4000', 'Proveedor de Prueba K10b Normal', 'own', 'manual'),
    (a, emp, 'pymes', '40000098', '4000', 'Proveedor de Prueba K10b Obras', 'own', 'manual'),
    (a, emp, 'pymes', '62900097', '629', 'Otros servicios de prueba K10b', 'own', 'manual'),
    (a, emp, 'pymes', '47200097', '472', 'IVA soportado de prueba K10b', 'own', 'manual'),
    (a, emp, 'pymes', '47700097', '477', 'IVA repercutido de prueba K10b', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', x.de, 'principal', 'manual'
    from (values ('40000097', v_nac::text), ('40000098', v_isp::text)) x(codigo, de)
    join public.company_account c on c.company_id = emp and c.code = x.codigo;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name)
  values
    ('c0eb0000-0000-4000-8000-0000000000f1', a, emp, v_nac, 'invoice', 'K10B-NORMAL', '2026-10-20', 'aprobada', 'manual', 100, 21, 121, false, 'prueba K10b'),
    ('c0eb0000-0000-4000-8000-0000000000f2', a, emp, v_isp, 'invoice', 'K10B-ISP',    '2026-10-20', 'aprobada', 'manual', 100, 0, 100, false, 'prueba K10b'),
    ('c0eb0000-0000-4000-8000-0000000000f3', a, emp, v_nac, 'invoice', 'K10B-INTRA',  '2026-10-21', 'aprobada', 'manual', 100, 0, 100, false, 'prueba K10b'),
    ('c0eb0000-0000-4000-8000-0000000000f4', a, emp, v_nac, 'invoice', 'K10B-SEPT',   '2026-09-15', 'en_revision', 'manual', 100, 21, 121, true, 'prueba K10b');
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values
    (a, 'c0eb0000-0000-4000-8000-0000000000f1', 21, 100, 21), (a, 'c0eb0000-0000-4000-8000-0000000000f2', 21, 100, 0),
    (a, 'c0eb0000-0000-4000-8000-0000000000f3', 21, 100, 0), (a, 'c0eb0000-0000-4000-8000-0000000000f4', 21, 100, 21);
end $$;

-- Un asiento de recibida, propuesto, con su IVA: «general» (472 al 21 %), «isp» o «ue» (472 con su tipo y la 477 sin tipo).
create or replace function pg_temp.k10b_asiento(p_factura uuid, p_fecha date, p_iva text) returns uuid language plpgsql as $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid; v_t uuid; v_prov uuid; v_num text;
  c629 uuid := (select id from public.company_account where company_id = emp and code = '62900097');
  c472 uuid := (select id from public.company_account where company_id = emp and code = '47200097');
  c477 uuid := (select id from public.company_account where company_id = emp and code = '47700097');
begin
  select l.company_account_id, i.invoice_number into v_prov, v_num from public.supplier_invoice i
    join public.company_account_link l on l.company_id = emp and l.entity = 'supplier' and l.entity_id = i.supplier_id::text and l.role = 'principal'
   where i.id = p_factura;
  select id into v_y from public.fiscal_year where company_id = emp and p_fecha between starts_on and ends_on;
  select id into v_t from public.tax_rate where is_system and valid_to is null
     and code = case p_iva when 'general' then 'iva_general' when 'isp' then 'isp' else 'ue_compra' end;
  delete from public.journal_entry where source_type = 'supplier_invoice' and source_id = p_factura and status <> 'validado';
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, document_ref)
  values (a, emp, v_y, 2, p_fecha, 'Prueba K10b · ' || v_num, 'supplier_invoice', p_factura, v_num) returning id into v_e;
  if p_iva = 'general' then
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date) values
      (a, emp, v_e, 1, c629, 100, 0, null, null, null, null, null, null),
      (a, emp, v_e, 2, c472, 21, 0, v_t, 100, 'received', 'yes', v_num, p_fecha),
      (a, emp, v_e, 3, v_prov, 0, 121, null, null, null, null, null, null);
  else
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date) values
      (a, emp, v_e, 1, c629, 100, 0, null, null, null, null, null, null),
      (a, emp, v_e, 2, c472, 21, 0, v_t, 100, 'received', 'yes', v_num, p_fecha),
      (a, emp, v_e, 3, c477, 0, 21, null, null, null, null, null, null),
      (a, emp, v_e, 4, v_prov, 0, 100, null, null, null, null, null, null);
  end if;
  return v_e;
end $$;

-- La huella de un asiento y de su libro de IVA: las cuentas, los importes, los tipos y el libro, por posición.
create or replace function pg_temp.k10b_huella(p_entry uuid) returns text language sql as $$
  select md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s', l.position, c.code, l.debit, l.credit, coalesce(t.code, ''), coalesce(l.vat_book, ''), coalesce(l.tax_base::text, '')), ';' order by l.position))
    from public.journal_line l join public.company_account c on c.id = l.company_account_id left join public.tax_rate t on t.id = l.tax_rate_id
   where l.entry_id = p_entry
$$;
create or replace function pg_temp.k10b_motivos(p_entry uuid) returns text language sql as $$
  select coalesce(string_agg(m.codigo, ',' order by m.orden, m.codigo), '') from public.conta_motivos_para_validar(p_entry) m
$$;
grant execute on function pg_temp.k10b_motivos(uuid) to authenticated;

-- 1 · Lo de antes no cambia: el tipo vacío (el de su ficha) y el mismo tipo escrito dan los mismos motivos y la misma huella; las dos se validan.
do $$
declare v_e uuid; v_h1 text; v_m1 text; v_h2 text; v_m2 text; k record;
begin
  for k in select * from (values ('c0eb0000-0000-4000-8000-0000000000f1'::uuid, 'general', 'interior', 'normal'),
                                 ('c0eb0000-0000-4000-8000-0000000000f2'::uuid, 'isp', 'isp_interior', 'isp')) x(factura, iva, op, clave) loop
    v_e := pg_temp.k10b_asiento(k.factura, '2026-10-20', k.iva);
    v_h1 := pg_temp.k10b_huella(v_e); v_m1 := pg_temp.k10b_motivos(v_e);
    if v_m1 like '%tipo_contra_pais%' then raise exception 'PRUEBA K10b · 1: la % con el tipo de su ficha no se valida por el tipo (%)', k.clave, v_m1; end if;
    update public.supplier_invoice set vat_operation = k.op where id = k.factura;
    v_h2 := pg_temp.k10b_huella(v_e); v_m2 := pg_temp.k10b_motivos(v_e);
    if v_m1 is distinct from v_m2 or v_h1 is distinct from v_h2 then
      raise exception 'PRUEBA K10b · 1: la % no da lo mismo con su tipo escrito (motivos «%» / «%», huella % / %)', k.clave, v_m1, v_m2, v_h1, v_h2;
    end if;
    insert into _k10b values ('asiento_' || k.clave, v_e::text), ('huella_' || k.clave, v_h1);
    raise notice '1 · la % : motivos «%» con el tipo vacío y con «%», huella % las dos veces.', k.clave, v_m1, k.op, v_h1;
  end loop;
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare k text;
begin
  foreach k in array array['normal', 'isp'] loop
    perform public.journal_entry_validar((select valor::uuid from _k10b where clave = 'asiento_' || k), 'Prueba K10b');
    if (select status from public.journal_entry where id = (select valor::uuid from _k10b where clave = 'asiento_' || k)) <> 'validado' then
      raise exception 'PRUEBA K10b · 1: la % no ha quedado validada', k;
    end if;
  end loop;
  raise notice '1 · las dos validadas, con su asiento y su libro de IVA como antes.';
end $$;
reset role;

-- 2 · El tipo cambiado en la factura: un proveedor de España con «Adquisición intracomunitaria de servicios».
do $$
declare v_e uuid; v_m text; v_t text;
begin
  update public.supplier_invoice set vat_operation = 'intra_servicios' where id = 'c0eb0000-0000-4000-8000-0000000000f3';
  v_e := pg_temp.k10b_asiento('c0eb0000-0000-4000-8000-0000000000f3', '2026-10-21', 'general');
  select string_agg(m.motivo, ' ') into v_t from public.conta_motivos_para_validar(v_e) m where m.codigo = 'tipo_contra_pais';
  if v_t is null or strpos(v_t, 'Adquisición intracomunitaria de servicios') = 0 then
    raise exception 'PRUEBA K10b · 2: con el tipo cambiado a intracomunitaria, el IVA general no lo para o no lo dice (%)', v_t;
  end if;
  raise notice '2 · con IVA general no se valida: «%»', v_t;
  v_e := pg_temp.k10b_asiento('c0eb0000-0000-4000-8000-0000000000f3', '2026-10-21', 'ue');
  v_m := pg_temp.k10b_motivos(v_e);
  if v_m like '%tipo_contra_pais%' then raise exception 'PRUEBA K10b · 2: con «Compra en otro país de la UE» sigue parada (%)', v_m; end if;
  insert into _k10b values ('asiento_intra', v_e::text);
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid := (select valor::uuid from _k10b where clave = 'asiento_intra'); v_libro text;
begin
  perform public.journal_entry_validar(v_e, 'Prueba K10b');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K10b · 2: la intracomunitaria no ha quedado validada'; end if;
  select string_agg(format('%s %s %s', l.vat_book, t.code, l.tax_base), ', ') into v_libro
    from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id where l.entry_id = v_e;
  if v_libro is distinct from 'received ue_compra 100.00' then raise exception 'PRUEBA K10b · 2: su libro de IVA es «%»', v_libro; end if;
  raise notice '2 · con «Compra en otro país de la UE» se valida; su libro de IVA: %.', v_libro;
end $$;
reset role;

-- 3 · El trimestre: el 303 del 3T presentado.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_f jsonb;
begin
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv, filed_by_name)
  values (a, emp, '303', 2026, 'quarterly', '3T', '2026-10-20', 'filed', 'zero', 0, '2026-10-15 10:00+02', 'outside', 'K10BPRUEBA0000000', 'Prueba K10b');
  v_f := public.conta_recibida_fecha(emp, '2026-09-15');
  if (v_f->>'fecha')::date is distinct from '2026-10-01' then raise exception 'PRUEBA K10b · 3: la del 15/09 no va al 01/10 (%)', v_f; end if;
  raise notice '3 · con el 3T presentado, la del 15/09 se apunta el %: «%»', v_f->>'fecha', v_f->>'aviso';
end $$;
do $$
declare v_e uuid; v_m text;
begin
  -- Con IVA en el 3T presentado no se puede ni apuntar: lo para el disparador del IVA presentado (V04), antes que la validación.
  begin
    v_e := pg_temp.k10b_asiento('c0eb0000-0000-4000-8000-0000000000f4', '2026-09-15', 'general');
    raise exception 'PRUEBA K10b · 3: ha dejado apuntar IVA el 15/09, con el 3T presentado';
  exception when others then
    if sqlerrm like 'PRUEBA K10b%' then raise; end if;
    v_m := sqlerrm;
  end;
  raise notice '3 · su IVA el 15/09 no se deja apuntar: «%»', v_m;
  v_e := pg_temp.k10b_asiento('c0eb0000-0000-4000-8000-0000000000f4', '2026-10-01', 'general');
  v_m := pg_temp.k10b_motivos(v_e);
  if v_m like '%periodo_cerrado%' then raise exception 'PRUEBA K10b · 3: el 01/10 sigue parado (%)', v_m; end if;
  raise notice '3 · el 01/10 se apunta y no lo para el periodo.';
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_r jsonb; v_ok boolean;
begin
  v_ok := false;
  begin
    perform public.conta_recibida_cabecera('c0eb0000-0000-4000-8000-0000000000f4', '{"deduce_en": "2026-07-01"}', 'Prueba K10b');
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA K10b · 3: ha dejado elegir el 3T presentado'; end if;
  v_ok := false;
  begin
    perform public.conta_recibida_cabecera('c0eb0000-0000-4000-8000-0000000000f4', '{"deduce_en": "2026-04-01"}', 'Prueba K10b');
  exception when sqlstate '22023' then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA K10b · 3: ha dejado deducirla en el 2T, antes de su fecha'; end if;
  v_r := public.conta_recibida_cabecera('c0eb0000-0000-4000-8000-0000000000f4', '{"deduce_en": "2026-11-15"}', 'Prueba K10b');
  if (select deduct_from from public.supplier_invoice where id = 'c0eb0000-0000-4000-8000-0000000000f4') is distinct from '2026-10-01' then
    raise exception 'PRUEBA K10b · 3: el 4T no se ha guardado como su primer día (%)', v_r;
  end if;
  raise notice '3 · el 3T presentado y el 2T no se dejan; el 4T sí: «%»', v_r->>'texto';
end $$;

-- 4 · El concepto, las observaciones y la marca, con su rastro.
do $$
declare v_r jsonb; v_marca uuid := (select id from public.brand where account_id = 'c0e20000-0000-4000-8000-0000000000e0' order by name limit 1); v_f public.supplier_invoice;
begin
  v_r := public.conta_recibida_cabecera('c0eb0000-0000-4000-8000-0000000000f4',
    jsonb_build_object('concepto', 'Concepto de prueba K10b', 'observaciones', 'Observación de prueba K10b', 'marca', v_marca, 'operacion', 'exenta'), 'Prueba K10b');
  select * into v_f from public.supplier_invoice where id = 'c0eb0000-0000-4000-8000-0000000000f4';
  if v_f.entry_concept is distinct from 'Concepto de prueba K10b' or v_f.notes is distinct from 'Observación de prueba K10b'
     or v_f.brand_id is distinct from v_marca or v_f.vat_operation is distinct from 'exenta' then
    raise exception 'PRUEBA K10b · 4: no se ha guardado todo (%)', v_r;
  end if;
  if not exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = v_f.id and by_name = 'Prueba K10b' and cambios::text like '%observaciones%') then
    raise exception 'PRUEBA K10b · 4: no ha dejado rastro';
  end if;
  raise notice '4 · guardado, con su rastro: «%»%', v_r->>'texto', case when v_marca is null then ' (la cuenta no tiene marcas: sin marca)' else '' end;
end $$;
reset role;

-- 5 · Deshacer.
\i supabase/vuelta-atras/20261121T2151_k10b_regla_11_lee_la_factura.down.sql
\i supabase/vuelta-atras/20261121T2150_k10b_cabecera_recibida.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure), 'K10b') > 0 then
    raise exception 'PRUEBA K10b · 5: conta_motivos_para_validar no ha vuelto a ser la de antes';
  end if;
  if to_regprocedure('public.conta_recibida_cabecera(uuid,jsonb,text)') is not null then
    raise exception 'PRUEBA K10b · 5: conta_recibida_cabecera sigue';
  end if;
  raise notice '5 · la vuelta atrás devuelve conta_motivos_para_validar como era y quita conta_recibida_cabecera (las columnas, con datos de esta prueba, se quedan).';
end $$;

rollback;
