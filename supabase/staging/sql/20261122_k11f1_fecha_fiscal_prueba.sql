-- supabase/staging/sql/20261122_k11f1_fecha_fiscal_prueba.sql
--
-- SOLO STAGING. Prueba del K11f1 (20261122T0921_k11f1_fecha_contable y 20261122T0922_k11f1_iva_lee_la_fecha_fiscal),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los objetos que cambian: public.conta_vat_book_desde_asiento, public._conta_iva_candado_apunte,
-- public._conta_iva_candado_asiento, public._tg_s01p_trimestre_presentado, public._conta_periodo_admite,
-- public._conta_iva_ajustar_propuesta,
-- public._conta_recibida_no_antes_de_entrar y
-- public.conta_recibida_otros_datos; y el nuevo: public._conta_fecha_fiscal.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario, con el 303 del 3T de 2026 presentado (el de la
-- semilla K10b si está; si no, uno inventado aquí). Proveedor, cuentas y facturas inventados (T11).
--
-- Regla 10: un cambio de IVA se ensaya por sus CAMINOS, proponiendo y validando, no por su fórmula.
--   0. La 0921 y la 0922 están delante.
--   1. Una factura del 15/09 con su fecha fiscal en el 4T: el asiento se propone el 15/09 (la contable, en un trimestre
--      presentado, no se mueve), se apunta con su IVA y se valida; en el libro de IVA va el 01/10, y el 303 del 3T,
--      recalculado, no cambia ni un céntimo; el del 4T suma su base.
--   2. Sin fecha fiscal, como hasta hoy: la del 15/09 se propone el 01/10 (el primer día con el IVA abierto), y su IVA
--      el 15/09 no se deja apuntar.
--   3. «Otros datos» guarda la fecha contable y la fiscal; una fiscal en el 3T presentado o antes de la factura, no.
--   4. Antes y después: una factura normal del 4T, propuesta y validada con la 0922 y otra igual sin ella (vuelta
--      atrás): la misma huella del asiento y del libro de IVA. Y la vuelta atrás devuelve las ocho funciones.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K11f1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

create temp table _k11f (clave text primary key, valor text) on commit drop;
grant select, insert, update on _k11f to authenticated;

-- 0 · Lo de antes.
do $$ begin
  if to_regprocedure('public._conta_fecha_fiscal(text,uuid,date)') is null
     or strpos(pg_get_functiondef('public.conta_vat_book_desde_asiento(uuid)'::regprocedure), 'K11f1: la fecha fiscal') = 0 then
    raise exception 'PRUEBA K11f1 · 0: falta la 0921 o la 0922 delante (las pone el ensayo de staging).';
  end if;
  raise notice '0 · la 0921 y la 0922 delante.';
end $$;

-- Lo inventado: el 303 del 3T presentado (si no está), un proveedor con NIF y su subcuenta, una cuenta de gasto y
-- cinco facturas.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_sup uuid := 'c0ef0000-0000-4000-8000-0000000000a1'; k record;
begin
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv, filed_by_name)
  select a, emp, '303', 2026, 'quarterly', '3T', '2026-10-20', 'filed', 'zero', 0, '2026-10-15 10:00+02', 'outside', 'K11FPRUEBA0000000', 'Prueba K11f1'
   where public.conta_iva_presentado(emp, '2026-09-15') is null;
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values (v_sup, a, 'Proveedor de Prueba K11f1, S.L.', 'B00011155', 'ES', 'general');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000095', '4000', 'Proveedor de Prueba K11f1', 'own', 'manual'),
    (a, emp, 'pymes', '62900095', '629', 'Otros servicios de prueba K11f1', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', v_sup::text, 'principal', 'manual' from public.company_account c where c.company_id = emp and c.code = '40000095';
  for k in select * from (values ('f1', 'K11F-FISCAL', date '2026-09-15'), ('f2', 'K11F-SIN', date '2026-09-15'), ('f3', 'K11F-OTROS', date '2026-09-16'),
                                 ('f4', 'K11F-4T-A', date '2026-10-20'), ('f5', 'K11F-4T-B', date '2026-10-20')) v(n, numero, fecha) loop
    insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                         tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at)
    values (('c0ef0000-0000-4000-8000-0000000000' || k.n)::uuid, a, emp, v_sup, 'invoice', k.numero, k.fecha, 'aprobada', 'manual', 100, 21, 121, false, 'prueba K11f1', k.fecha::timestamptz + interval '10 hours');
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (a, ('c0ef0000-0000-4000-8000-0000000000' || k.n)::uuid, 21, 100, 21);
  end loop;
  insert into _k11f values ('303_3T_antes', md5(public.conta_impuesto_303_desde_libro(emp, 2026, '3T')::text)),
                           ('303_4T_antes', public.conta_impuesto_303_desde_libro(emp, 2026, '4T')::text);
end $$;

-- El asiento de una recibida por la propuesta (journal_entry_proponer, como la pantalla), con su IVA general.
create or replace function pg_temp.k11f_proponer(p_factura uuid, p_fecha date) returns uuid language plpgsql as $$
declare
  t uuid := (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null);
  v_num text := (select invoice_number from public.supplier_invoice where id = p_factura);
  v_r jsonb;
begin
  v_r := public.journal_entry_proponer('c0e20000-0000-4000-8000-0000000000e3',
    jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Prueba K11f1 · ' || v_num, 'source_type', 'supplier_invoice', 'source_id', p_factura,
                       'confianza', 'seguro', 'porque', 'prueba K11f1', 'documento', v_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900095', 'debe', 100, 'haber', 0, 'comun', true, 'documento', v_num),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', v_num,
                         'iva', jsonb_build_object('tipo_id', t, 'base', 100, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '40000095', 'debe', 0, 'haber', 121, 'comun', true, 'documento', v_num)), null, 'Prueba K11f1');
  return (v_r ->> 'id')::uuid;
end $$;
-- La huella del asiento (cuentas, importes, tipo, base, libro) y la de su fila del libro de IVA (fechas y periodo, sin ids).
create or replace function pg_temp.k11f_huella(p_entry uuid) returns text language sql as $$
  select md5(coalesce((select string_agg(format('%s|%s|%s|%s|%s|%s|%s', l.position, c.code, l.debit, l.credit, coalesce(t.code, ''), coalesce(l.tax_base::text, ''), coalesce(l.vat_book, '')), ';' order by l.position)
                         from public.journal_line l join public.company_account c on c.id = l.company_account_id left join public.tax_rate t on t.id = l.tax_rate_id
                        where l.entry_id = p_entry), '')
             || '#' || coalesce((select string_agg(format('%s|%s|%s|%s|%s|%s|%s', v.book, v.issue_date, v.received_date, v.tax_base, v.tax_amount, v.deductible_amount, coalesce(v.deduction_period, '')), ';' order by v.tax_base)
                                  from public.vat_book_entry v where v.entry_id = p_entry and v.voided_at is null), ''))
$$;
grant execute on function pg_temp.k11f_proponer(uuid, date) to authenticated;
grant execute on function pg_temp.k11f_huella(uuid) to authenticated;

-- 1 · La del 15/09 con su fecha fiscal en el 4T.
update public.supplier_invoice set deduct_from = '2026-10-01' where id = 'c0ef0000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid; v_dia date; v_recep date;
begin
  v_e := pg_temp.k11f_proponer('c0ef0000-0000-4000-8000-0000000000f1', '2026-09-15');
  select entry_date into v_dia from public.journal_entry where id = v_e;
  if v_dia is distinct from '2026-09-15' then raise exception 'PRUEBA K11f1 · 1: con fecha fiscal, la contable se ha movido al %', v_dia; end if;
  perform public.journal_entry_validar(v_e, 'Prueba K11f1');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K11f1 · 1: no se ha validado'; end if;
  select received_date into v_recep from public.vat_book_entry where entry_id = v_e and voided_at is null limit 1;
  if v_recep is distinct from '2026-10-01' then raise exception 'PRUEBA K11f1 · 1: en el libro de IVA va el % y no el 01/10', v_recep; end if;
  raise notice '1 · la del 15/09 con fiscal 01/10: asiento el %, validada, en el libro de IVA el %.', v_dia, v_recep;
end $$;
reset role;
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; v_4t jsonb; v_antes jsonb := (select valor::jsonb from _k11f where clave = '303_4T_antes');
begin
  if md5(public.conta_impuesto_303_desde_libro(emp, 2026, '3T')::text) is distinct from (select valor from _k11f where clave = '303_3T_antes') then
    raise exception 'PRUEBA K11f1 · 1: el 303 del 3T presentado ha cambiado';
  end if;
  v_4t := public.conta_impuesto_303_desde_libro(emp, 2026, '4T');
  if v_4t::text = v_antes::text then raise exception 'PRUEBA K11f1 · 1: el 303 del 4T no la ha sumado'; end if;
  raise notice '1 · el 303 del 3T presentado, recalculado: el mismo (huella %); el del 4T la suma.', left((select valor from _k11f where clave = '303_3T_antes'), 12);
end $$;

-- 2 · Sin fecha fiscal, como hasta hoy.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid; v_dia date;
begin
  v_e := pg_temp.k11f_proponer('c0ef0000-0000-4000-8000-0000000000f2', '2026-09-15');
  select entry_date into v_dia from public.journal_entry where id = v_e;
  if v_dia is distinct from '2026-10-01' then raise exception 'PRUEBA K11f1 · 2: sin fecha fiscal, la del 15/09 se ha propuesto el % (hasta hoy, el 01/10)', v_dia; end if;
  raise notice '2 · sin fecha fiscal, la del 15/09 se propone el % (como hasta hoy).', v_dia;
end $$;
reset role;
do $$
declare v_m text;
begin
  begin
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, document_ref)
    values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3',
            (select id from public.fiscal_year where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and date '2026-09-15' between starts_on and ends_on),
            2, '2026-09-15', 'Prueba K11f1 · a mano', 'supplier_invoice', 'c0ef0000-0000-4000-8000-0000000000f3', 'K11F-OTROS');
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible)
    select 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', e.id, 1,
           (select id from public.company_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and code = '47200021'), 21, 0,
           (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null), 100, 'received', 'yes'
      from public.journal_entry e where e.source_id = 'c0ef0000-0000-4000-8000-0000000000f3';
    raise exception 'PRUEBA K11f1 · 2: sin fecha fiscal ha dejado apuntar IVA el 15/09, con el 3T presentado';
  exception when others then
    if sqlerrm like 'PRUEBA K11f1%' then raise; end if;
    v_m := sqlerrm;
  end;
  raise notice '2 · sin fecha fiscal, su IVA el 15/09 no se deja apuntar: «%»', v_m;
end $$;

-- 3 · «Otros datos»: la fecha contable y la fiscal.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_r jsonb; v_ok boolean;
begin
  v_ok := false;
  begin perform public.conta_recibida_otros_datos('c0ef0000-0000-4000-8000-0000000000f3', '{"fecha_fiscal": "2026-09-20"}', 'Prueba K11f1');
  exception when sqlstate '23514' then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA K11f1 · 3: ha dejado una fecha fiscal en el 3T presentado'; end if;
  v_ok := false;
  begin perform public.conta_recibida_otros_datos('c0ef0000-0000-4000-8000-0000000000f4', '{"fecha_fiscal": "2026-10-10"}', 'Prueba K11f1');
  exception when sqlstate '22023' then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA K11f1 · 3: ha dejado una fecha fiscal antes de la de la factura'; end if;
  v_r := public.conta_recibida_otros_datos('c0ef0000-0000-4000-8000-0000000000f3', '{"fecha_fiscal": "2026-10-05", "fecha_contable": "2026-09-16"}', 'Prueba K11f1');
  if (select deduct_from from public.supplier_invoice where id = 'c0ef0000-0000-4000-8000-0000000000f3') is distinct from '2026-10-05'
     or (select accounting_date from public.supplier_invoice where id = 'c0ef0000-0000-4000-8000-0000000000f3') is distinct from '2026-09-16' then
    raise exception 'PRUEBA K11f1 · 3: no se han guardado las dos fechas (%)', v_r;
  end if;
  raise notice '3 · una fiscal en el 3T presentado o antes de la factura, no; las dos fechas, sí: «%»', v_r ->> 'texto';
end $$;

-- 4 · Antes y después: una factura normal del 4T con la 0922 y otra igual sin ella.
do $$
declare v_e uuid;
begin
  v_e := pg_temp.k11f_proponer('c0ef0000-0000-4000-8000-0000000000f4', '2026-10-20');
  perform public.journal_entry_validar(v_e, 'Prueba K11f1');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K11f1 · 4: la del 4T no se ha validado'; end if;
  insert into _k11f values ('huella_4t', pg_temp.k11f_huella(v_e));
end $$;
reset role;
\i supabase/vuelta-atras/20261122T0922_k11f1_iva_lee_la_fecha_fiscal.down.sql
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid;
begin
  v_e := pg_temp.k11f_proponer('c0ef0000-0000-4000-8000-0000000000f5', '2026-10-20');
  perform public.journal_entry_validar(v_e, 'Prueba K11f1');
  -- Solo cambia el número de la factura en el libro (K11F-4T-A / B): la huella no lo lleva.
  if pg_temp.k11f_huella(v_e) is distinct from (select valor from _k11f where clave = 'huella_4t') then
    raise exception 'PRUEBA K11f1 · 4: la del 4T, antes (sin la 0922) % y después %', pg_temp.k11f_huella(v_e), (select valor from _k11f where clave = 'huella_4t');
  end if;
  raise notice '4 · la del 4T, antes (sin la 0922) y después: la misma huella del asiento y del libro de IVA %.', pg_temp.k11f_huella(v_e);
end $$;
reset role;
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc like '%K11f1%') then
    raise exception 'PRUEBA K11f1 · 4: alguna función sigue con el trozo del K11f1';
  end if;
  raise notice '4 · la vuelta atrás de la 0922 devuelve las ocho funciones como eran.';
end $$;
\i supabase/vuelta-atras/20261122T0921_k11f1_fecha_contable.down.sql
do $$ begin
  if to_regprocedure('public._conta_fecha_fiscal(text,uuid,date)') is not null then raise exception 'PRUEBA K11f1 · 4: _conta_fecha_fiscal sigue'; end if;
  raise notice '4 · y la de la 0921 quita _conta_fecha_fiscal.';
end $$;

rollback;
