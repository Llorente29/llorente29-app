-- supabase/staging/sql/20261122_k11a_base_ficha_recibida_prueba.sql
--
-- SOLO STAGING. Prueba del K11a (20261122T0839_k11a_otros_datos_y_lineas y 20261122T0840_k11a_plataforma_en_el_asiento),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra el objeto que cambia: public._journal_entry_proponer (dos trozos); y los nuevos: public.conta_recibida_otros_datos,
-- public.conta_recibida_por_defecto, public.conta_tipo_factura, public.conta_clave_regimen y
-- public.supplier_invoice_expense_dato.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Proveedores, cuentas, marca, plataforma y
-- facturas inventados, dentro de la transacción (T11).
--
-- Regla 10: un cambio de IVA se ensaya por sus CAMINOS, proponiendo y validando, no por su fórmula.
--   0. La 0839 y la 0840 están delante.
--   1. Los catálogos y lo que da cada factura por defecto: F1 y 01; R4 un abono; 09 una intracomunitaria; 12 una con
--      retención del 115.
--   2. Por la propuesta (journal_entry_proponer, como la pantalla), una factura al 100 % y otra al 50 % (lo no
--      deducible a la cuenta de gasto, con su IVA «no»): las dos se validan, con la huella del asiento y del libro de
--      IVA. La de la línea de gasto lleva su plataforma (journal_line.channel_id).
--   3. «Otros datos» y los datos de las líneas se guardan (conta_recibida_otros_datos), con su rastro; un % de 150 o
--      una marca de otra cuenta, no.
--   4. Deshacer la 0840 y volver a proponer y validar las mismas dos facturas (sin plataforma): la misma huella que
--      antes (antes y después). Y deshacer la 0839: fuera lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K11a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _k11a (clave text primary key, valor text) on commit drop;
grant select, insert, update on _k11a to authenticated;

-- 0 · Lo de antes.
do $$ begin
  if to_regprocedure('public.conta_recibida_otros_datos(uuid,jsonb,text)') is null
     or strpos(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure), 'K11a: la plataforma') = 0 then
    raise exception 'PRUEBA K11a · 0: falta la 0839 o la 0840 delante (las pone el ensayo de staging).';
  end if;
  raise notice '0 · la 0839 y la 0840 delante.';
end $$;

-- Lo inventado: un proveedor con NIF y su subcuenta, una cuenta de gasto, una marca, una plataforma y seis facturas.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_sup uuid := 'c0ec0000-0000-4000-8000-0000000000a1'; k record;
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values (v_sup, a, 'Proveedor de Prueba K11a, S.L.', 'B00011049', 'ES', 'general');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000096', '4000', 'Proveedor de Prueba K11a', 'own', 'manual'),
    (a, emp, 'pymes', '62100096', '621', 'Arrendamientos de prueba K11a', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', v_sup::text, 'principal', 'manual' from public.company_account c where c.company_id = emp and c.code = '40000096';
  insert into public.brand (id, account_id, name, slug, ownership_type, is_active) values ('c0ec0000-0000-4000-8000-0000000000c1', a, 'Marca de Prueba K11a', 'marca-de-prueba-k11a', 'own', true);
  insert into public.sales_channel (id, account_id, name, slug, channel_type) values ('c0ec0000-0000-4000-8000-0000000000c2', a, 'Plataforma de Prueba K11a', 'plataforma-de-prueba-k11a', 'delivery');
  for k in select * from (values ('f1', 'K11A-100', 'invoice'), ('f2', 'K11A-50', 'invoice'), ('f3', 'K11A-100-B', 'invoice'), ('f4', 'K11A-50-B', 'invoice'),
                                 ('f5', 'K11A-ABONO', 'credit_note'), ('f6', 'K11A-INTRA', 'invoice')) v(n, numero, kind) loop
    insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                         tax_base_total, tax_total, grand_total, needs_review, created_by_name)
    values (('c0ec0000-0000-4000-8000-0000000000' || k.n)::uuid, a, emp, v_sup, k.kind, k.numero, '2026-10-20', 'aprobada', 'manual', 100, 21, 121, false, 'prueba K11a');
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (a, ('c0ec0000-0000-4000-8000-0000000000' || k.n)::uuid, 21, 100, 21);
  end loop;
end $$;

-- 1 · Los catálogos y lo que da cada factura por defecto.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v text;
begin
  if (select count(*) from public.conta_tipo_factura) <> 12 or (select count(*) from public.conta_clave_regimen) <> 14 then
    raise exception 'PRUEBA K11a · 1: los catálogos no tienen 12 tipos y 14 claves';
  end if;
  update public.supplier_invoice set vat_operation = 'intra_servicios' where id = 'c0ec0000-0000-4000-8000-0000000000f6';
  select string_agg(((public.conta_recibida_por_defecto(x.id)) ->> 'tipo_factura') || '/' || ((public.conta_recibida_por_defecto(x.id)) ->> 'clave_regimen'), ' ' order by x.n) into v
    from (values (1, 'c0ec0000-0000-4000-8000-0000000000f1'::uuid), (2, 'c0ec0000-0000-4000-8000-0000000000f5'::uuid), (3, 'c0ec0000-0000-4000-8000-0000000000f6'::uuid)) x(n, id);
  if v is distinct from 'F1/01 R4/01 F1/09' then raise exception 'PRUEBA K11a · 1: lo que da por defecto es «%»', v; end if;
  raise notice '1 · 12 tipos de factura y 14 claves; por defecto: normal F1/01, abono R4/01, intracomunitaria F1/09.';
end $$;
reset role;
do $$
declare v_w uuid := (select id from public.withholding_rate where filed_in = '115' limit 1);
begin
  if v_w is null then raise notice '1 · sin retención del 115 en el catálogo: la clave 12 no se prueba aquí.'; return; end if;
  update public.supplier_invoice set withholding_rate_id = v_w, withholding_amount = 19, withholding_base = 100 where id = 'c0ec0000-0000-4000-8000-0000000000f1';
  if public.conta_recibida_por_defecto('c0ec0000-0000-4000-8000-0000000000f1') ->> 'clave_regimen' is distinct from '12' then
    raise exception 'PRUEBA K11a · 1: con retención del 115 no da la clave 12';
  end if;
  update public.supplier_invoice set withholding_rate_id = null, withholding_amount = null, withholding_base = null where id = 'c0ec0000-0000-4000-8000-0000000000f1';
  raise notice '1 · con retención del 115, la clave 12 (arrendamiento de local).';
end $$;

-- El asiento de una recibida por la propuesta (journal_entry_proponer), al 100 o al 50 %, con o sin plataforma.
create or replace function pg_temp.k11a_proponer(p_factura uuid, p_pct int, p_canal boolean) returns uuid language plpgsql as $$
declare
  t uuid := (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null);
  v_num text := (select invoice_number from public.supplier_invoice where id = p_factura);
  v_lineas jsonb; v_r jsonb;
begin
  v_lineas := jsonb_build_array(jsonb_build_object('cuenta', '62100096', 'debe', 100, 'haber', 0, 'local_id', null, 'comun', true, 'documento', v_num,
                                                   'marca_id', 'c0ec0000-0000-4000-8000-0000000000c1', 'canal_id', case when p_canal then 'c0ec0000-0000-4000-8000-0000000000c2' end));
  if p_pct = 100 then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', v_num,
                                                                 'iva', jsonb_build_object('tipo_id', t, 'base', 100, 'libro', 'received', 'deducible', 'yes')));
  else
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('cuenta', '47200021', 'debe', 10.5, 'haber', 0, 'comun', true, 'documento', v_num,
                         'iva', jsonb_build_object('tipo_id', t, 'base', 50, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '62100096', 'debe', 10.5, 'haber', 0, 'comun', true, 'documento', v_num, 'concepto', 'IVA no deducible 21 %',
                         'marca_id', 'c0ec0000-0000-4000-8000-0000000000c1', 'canal_id', case when p_canal then 'c0ec0000-0000-4000-8000-0000000000c2' end,
                         'iva', jsonb_build_object('tipo_id', t, 'base', 50, 'libro', 'received', 'deducible', 'no')));
  end if;
  v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', '40000096', 'debe', 0, 'haber', 121, 'comun', true, 'documento', v_num));
  v_r := public.journal_entry_proponer('c0e20000-0000-4000-8000-0000000000e3',
    jsonb_build_object('series', 2, 'fecha', '2026-10-20', 'concepto', 'Prueba K11a · ' || v_num, 'source_type', 'supplier_invoice', 'source_id', p_factura,
                       'confianza', 'seguro', 'porque', 'prueba K11a', 'documento', v_num), v_lineas, null, 'Prueba K11a');
  return (v_r ->> 'id')::uuid;
end $$;
-- La huella de un asiento y de su libro de IVA: cuentas, importes, tipos, bases, deducible y marca, por posición (sin la plataforma).
create or replace function pg_temp.k11a_huella(p_entry uuid) returns text language sql as $$
  select md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s', l.position, c.code, l.debit, l.credit, coalesce(t.code, ''), coalesce(l.vat_book, ''),
                               coalesce(l.tax_base::text, ''), coalesce(l.vat_deductible, '') || '|' || coalesce(l.brand_id::text, '')), ';' order by l.position))
    from public.journal_line l join public.company_account c on c.id = l.company_account_id left join public.tax_rate t on t.id = l.tax_rate_id
   where l.entry_id = p_entry
$$;
grant execute on function pg_temp.k11a_proponer(uuid, int, boolean) to authenticated;
grant execute on function pg_temp.k11a_huella(uuid) to authenticated;

-- 2 · Por la propuesta: al 100 % y al 50 %, con plataforma, validadas.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid; k record; v_canal int; v_libro text;
begin
  for k in select * from (values ('f1'::text, 100, 'cien'), ('f2', 50, 'cincuenta')) v(n, pct, clave) loop
    v_e := pg_temp.k11a_proponer(('c0ec0000-0000-4000-8000-0000000000' || k.n)::uuid, k.pct, true);
    perform public.journal_entry_validar(v_e, 'Prueba K11a');
    if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K11a · 2: la del % %% no se ha validado', k.pct; end if;
    select count(*) into v_canal from public.journal_line where entry_id = v_e and channel_id = 'c0ec0000-0000-4000-8000-0000000000c2';
    select string_agg(format('%s %s %s', l.vat_deductible, l.tax_base, (select c.code from public.company_account c where c.id = l.company_account_id)), ', ' order by l.position)
      into v_libro from public.journal_line l where l.entry_id = v_e and l.vat_book = 'received';
    insert into _k11a values ('huella_' || k.clave, pg_temp.k11a_huella(v_e));
    raise notice '2 · al % %%: validada, huella %, % apunte(s) con su plataforma, libro de IVA: %.', k.pct, pg_temp.k11a_huella(v_e), v_canal, v_libro;
    if v_canal <> (case when k.pct = 100 then 1 else 2 end) then raise exception 'PRUEBA K11a · 2: la plataforma no ha llegado a sus apuntes (%)', v_canal; end if;
  end loop;
end $$;

-- 3 · «Otros datos» y los datos de las líneas.
do $$
declare v_r jsonb; v_f public.supplier_invoice; v_ok boolean;
begin
  v_r := public.conta_recibida_otros_datos('c0ec0000-0000-4000-8000-0000000000f3', jsonb_build_object(
    'tipo_factura', 'F2', 'clave_regimen', '12', 'no_iva', true, 'rectificacion', true, 'no_347', true, 'iva_deducible', 50,
    'lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'concepto', 'Renting de prueba K11a', 'marca', 'c0ec0000-0000-4000-8000-0000000000c1', 'plataforma', 'c0ec0000-0000-4000-8000-0000000000c2'))), 'Prueba K11a');
  select * into v_f from public.supplier_invoice where id = 'c0ec0000-0000-4000-8000-0000000000f3';
  if v_f.invoice_type <> 'F2' or v_f.regime_key <> '12' or not v_f.exclude_from_vat_return or not v_f.deduction_rectification or not v_f.exclude_from_347
     or v_f.vat_deductible_pct <> 50
     or not exists (select 1 from public.supplier_invoice_expense_dato d where d.supplier_invoice_id = v_f.id and d.position = 0 and d.concept = 'Renting de prueba K11a'
                    and d.channel_id = 'c0ec0000-0000-4000-8000-0000000000c2') then
    raise exception 'PRUEBA K11a · 3: no se ha guardado todo (%)', v_r;
  end if;
  if not exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = v_f.id and by_name = 'Prueba K11a') then raise exception 'PRUEBA K11a · 3: sin rastro'; end if;
  -- Volver a 100 es lo de siempre (nulo).
  perform public.conta_recibida_otros_datos(v_f.id, '{"iva_deducible": 100}', 'Prueba K11a');
  if (select vat_deductible_pct from public.supplier_invoice where id = v_f.id) is not null then raise exception 'PRUEBA K11a · 3: el 100 no vuelve a ser lo de siempre'; end if;
  v_ok := false;
  begin perform public.conta_recibida_otros_datos(v_f.id, '{"iva_deducible": 150}', 'Prueba K11a'); exception when sqlstate '22023' then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA K11a · 3: ha dejado un IVA deducible del 150 %%'; end if;
  v_ok := false;
  begin perform public.conta_recibida_otros_datos(v_f.id, jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'marca', gen_random_uuid()))), 'Prueba K11a');
  exception when sqlstate '42501' then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA K11a · 3: ha dejado una marca que no es de la cuenta'; end if;
  raise notice '3 · guardado, con su rastro: «%»; el 100 vuelve a lo de siempre; un 150 %% y una marca ajena, no.', v_r ->> 'texto';
end $$;
reset role;

-- 4 · Deshacer la 0840 y proponer lo mismo (sin plataforma): la misma huella. Después, deshacer la 0839.
\i supabase/vuelta-atras/20261122T0840_k11a_plataforma_en_el_asiento.down.sql
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid; k record;
begin
  if strpos(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure), 'K11a') > 0 then
    raise exception 'PRUEBA K11a · 4: _journal_entry_proponer no ha vuelto a ser la de antes';
  end if;
  for k in select * from (values ('f3'::text, 100, 'cien'), ('f4', 50, 'cincuenta')) v(n, pct, clave) loop
    -- La f3 se cambió en el 3: se le quita lo cambiado (con su asiento propuesto, si lo hubiera).
    update public.supplier_invoice set invoice_type = null, regime_key = null, exclude_from_vat_return = null, deduction_rectification = null,
           exclude_from_347 = null, vat_deductible_pct = null where id = ('c0ec0000-0000-4000-8000-0000000000' || k.n)::uuid;
    v_e := pg_temp.k11a_proponer(('c0ec0000-0000-4000-8000-0000000000' || k.n)::uuid, k.pct, false);
    perform public.journal_entry_validar(v_e, 'Prueba K11a');
    if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K11a · 4: la del % %% no se ha validado antes', k.pct; end if;
    if pg_temp.k11a_huella(v_e) is distinct from (select valor from _k11a where clave = 'huella_' || k.clave) then
      raise exception 'PRUEBA K11a · 4: al % %%, la huella de antes (%) no es la de después (%)', k.pct, pg_temp.k11a_huella(v_e), (select valor from _k11a where clave = 'huella_' || k.clave);
    end if;
    raise notice '4 · al % %%, antes (sin la 0840) y después: la misma huella %.', k.pct, pg_temp.k11a_huella(v_e);
  end loop;
end $$;
reset role;
\i supabase/vuelta-atras/20261122T0839_k11a_otros_datos_y_lineas.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_otros_datos(uuid,jsonb,text)') is not null or to_regprocedure('public.conta_recibida_por_defecto(uuid)') is not null then
    raise exception 'PRUEBA K11a · 4: las funciones nuevas siguen';
  end if;
  raise notice '4 · la vuelta atrás de la 0839 quita las funciones nuevas (las columnas, con datos de esta prueba, se quedan).';
end $$;

rollback;
