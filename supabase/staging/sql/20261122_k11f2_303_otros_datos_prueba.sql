-- supabase/staging/sql/20261122_k11f2_303_otros_datos_prueba.sql
--
-- SOLO STAGING. Prueba del K11f2 (20261122T1815_k11f2_303_otros_datos), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra los objetos que cambian:
-- public.conta_impuesto_303_cajas y public.journal_entry_anular.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario, con el 303 del 3T de 2026 presentado (si no lo
-- está, uno inventado aquí). Proveedor, cuentas y facturas inventados (T11). Por sus CAMINOS (regla 10): proponer y
-- validar cada recibida (journal_entry_proponer y journal_entry_validar, como la pantalla), recalcular el 303 como la
-- pantalla (conta_impuesto_303_desde_libro) y anular como la pantalla (journal_entry_anular).
--   1. Una recibida normal del 4T: suma su base a la [28] y su cuota a la [29].
--   2. Una con «No incluir en declaración de IVA»: está en el libro de IVA, pero el 303 del 4T no cambia ni un céntimo.
--   3. Una con «Rectificación de deducciones»: va a la [40] (base) y la [41] (cuota), no a la [28]/[29].
--   4. El 303 del 3T presentado, recalculado: el mismo de antes (regla 31).
--   5. El contraasiento de un asiento con plataforma la copia en su línea.
--   6. La vuelta atrás devuelve las dos funciones.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K11f2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_impuesto_303_cajas(vat_book_entry)'::regprocedure), 'K11f2: otros datos') = 0
     or strpos(pg_get_functiondef('public.journal_entry_anular(uuid,text,date,text)'::regprocedure), 'K11f2: la plataforma') = 0 then
    raise exception 'PRUEBA K11f2 · 0: falta la 1815 delante (la pone el ensayo de staging).';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _k11g (clave text primary key, valor text) on commit drop;
grant all on _k11g to authenticated;

-- Lo inventado: el 303 del 3T presentado (si no está), un proveedor con NIF y su subcuenta, una cuenta de gasto y tres
-- facturas del 4T.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_sup uuid := 'c0f20000-0000-4000-8000-0000000000a1'; k record;
begin
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv, filed_by_name)
  select a, emp, '303', 2026, 'quarterly', '3T', '2026-10-20', 'filed', 'zero', 0, '2026-10-15 10:00+02', 'outside', 'K11F2PRUEBA000000', 'Prueba K11f2'
   where public.conta_iva_presentado(emp, '2026-09-15') is null;
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values (v_sup, a, 'Proveedor de Prueba K11f2, S.L.', 'B00011163', 'ES', 'general');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000096', '4000', 'Proveedor de Prueba K11f2', 'own', 'manual'),
    (a, emp, 'pymes', '62900096', '629', 'Otros servicios de prueba K11f2', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', v_sup::text, 'principal', 'manual' from public.company_account c where c.company_id = emp and c.code = '40000096';
  for k in select * from (values ('f1', 'K11F2-NORMAL', false, false), ('f2', 'K11F2-FUERA', true, false), ('f3', 'K11F2-RECTIFICA', false, true)) v(n, numero, fuera, rectifica) loop
    insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                         tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at,
                                         exclude_from_vat_return, deduction_rectification)
    values (('c0f20000-0000-4000-8000-0000000000' || k.n)::uuid, a, emp, v_sup, 'invoice', k.numero, date '2026-11-05', 'aprobada', 'manual', 100, 21, 121, false,
            'prueba K11f2', timestamptz '2026-11-05 10:00+01', k.fuera, k.rectifica);
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (a, ('c0f20000-0000-4000-8000-0000000000' || k.n)::uuid, 21, 100, 21);
  end loop;
  insert into _k11g values ('303_3T_antes', md5(public.conta_impuesto_303_desde_libro(emp, 2026, '3T')::text)),
                           ('303_4T_antes', (public.conta_impuesto_303_desde_libro(emp, 2026, '4T') -> 'casillas')::text);
end $$;

-- El asiento de una recibida por la propuesta (journal_entry_proponer, como la pantalla), con su IVA general, y validado.
create or replace function pg_temp.k11g_recibida(p_factura uuid) returns uuid language plpgsql as $$
declare
  t uuid := (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null);
  v_num text := (select invoice_number from public.supplier_invoice where id = p_factura);
  v_r jsonb; v_e uuid;
begin
  v_r := public.journal_entry_proponer('c0e20000-0000-4000-8000-0000000000e3',
    jsonb_build_object('series', 2, 'fecha', date '2026-11-05', 'concepto', 'Prueba K11f2 · ' || v_num, 'source_type', 'supplier_invoice', 'source_id', p_factura,
                       'confianza', 'seguro', 'porque', 'prueba K11f2', 'documento', v_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900096', 'debe', 100, 'haber', 0, 'comun', true, 'documento', v_num),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', v_num,
                         'iva', jsonb_build_object('tipo_id', t, 'base', 100, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '40000096', 'debe', 0, 'haber', 121, 'comun', true, 'documento', v_num)), null, 'Prueba K11f2');
  v_e := (v_r ->> 'id')::uuid;
  perform public.journal_entry_validar(v_e, 'Prueba K11f2');
  return v_e;
end $$;
-- Una casilla del 303 del 4T, como número (0 si no está).
create or replace function pg_temp.k11g_caja(p_caja text) returns numeric language sql as $$
  select coalesce((public.conta_impuesto_303_desde_libro('c0e20000-0000-4000-8000-0000000000e3', 2026, '4T') -> 'casillas' ->> p_caja)::numeric, 0)
$$;
grant execute on function pg_temp.k11g_recibida(uuid) to authenticated;
grant execute on function pg_temp.k11g_caja(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
-- 1 · La normal: a la [28] y la [29].
do $$
declare c28 numeric := pg_temp.k11g_caja('28'); c29 numeric := pg_temp.k11g_caja('29');
begin
  perform pg_temp.k11g_recibida('c0f20000-0000-4000-8000-0000000000f1');
  if pg_temp.k11g_caja('28') - c28 <> 100 or pg_temp.k11g_caja('29') - c29 <> 21 then
    raise exception 'PRUEBA K11f2 · 1: la normal no suma 100 a la [28] y 21 a la [29] (% y %)', pg_temp.k11g_caja('28') - c28, pg_temp.k11g_caja('29') - c29;
  end if;
  insert into _k11g values ('4T_tras_normal', (public.conta_impuesto_303_desde_libro('c0e20000-0000-4000-8000-0000000000e3', 2026, '4T') -> 'casillas')::text);
  raise notice 'PRUEBA K11f2 · 1: la normal, +100 a la [28] y +21 a la [29].';
end $$;
-- 2 · «No incluir en declaración de IVA»: en el libro, pero fuera del 303.
do $$
declare v_e uuid; v_antes text := (select valor from _k11g where clave = '4T_tras_normal'); v_despues text;
begin
  v_e := pg_temp.k11g_recibida('c0f20000-0000-4000-8000-0000000000f2');
  if not exists (select 1 from public.vat_book_entry where entry_id = v_e and voided_at is null) then raise exception 'PRUEBA K11f2 · 2: la excluida no está en el libro de IVA'; end if;
  v_despues := (public.conta_impuesto_303_desde_libro('c0e20000-0000-4000-8000-0000000000e3', 2026, '4T') -> 'casillas')::text;
  if v_despues <> v_antes then raise exception 'PRUEBA K11f2 · 2: la excluida ha cambiado el 303 del 4T: % → %', v_antes, v_despues; end if;
  insert into _k11g values ('fuera', v_e::text);
  raise notice 'PRUEBA K11f2 · 2: «No incluir en declaración de IVA»: en el libro de IVA, y el 303 del 4T, ni un céntimo distinto.';
end $$;
-- 3 · «Rectificación de deducciones»: a la [40] y la [41].
do $$
declare c28 numeric := pg_temp.k11g_caja('28'); c40 numeric := pg_temp.k11g_caja('40'); c41 numeric := pg_temp.k11g_caja('41');
begin
  perform pg_temp.k11g_recibida('c0f20000-0000-4000-8000-0000000000f3');
  if pg_temp.k11g_caja('40') - c40 <> 100 or pg_temp.k11g_caja('41') - c41 <> 21 or pg_temp.k11g_caja('28') <> c28 then
    raise exception 'PRUEBA K11f2 · 3: la rectificación no va a la [40]/[41] (% y %; [28] %)', pg_temp.k11g_caja('40') - c40, pg_temp.k11g_caja('41') - c41, pg_temp.k11g_caja('28') - c28;
  end if;
  raise notice 'PRUEBA K11f2 · 3: «Rectificación de deducciones»: +100 a la [40] y +21 a la [41]; la [28], igual.';
end $$;
reset role;

-- 4 · El 303 del 3T presentado, igual (regla 31).
do $$ begin
  if md5(public.conta_impuesto_303_desde_libro('c0e20000-0000-4000-8000-0000000000e3', 2026, '3T')::text) <> (select valor from _k11g where clave = '303_3T_antes') then
    raise exception 'PRUEBA K11f2 · 4: el 303 del 3T presentado ha cambiado';
  end if;
  raise notice 'PRUEBA K11f2 · 4 · regla 31: el 303 del 3T presentado, recalculado, el mismo (huella %).', left((select valor from _k11g where clave = '303_3T_antes'), 12);
end $$;

-- 5 · El contraasiento copia la plataforma.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_e uuid; v_canal uuid := (select id from public.sales_channel where account_id = 'c0e20000-0000-4000-8000-0000000000e0' order by id limit 1); r jsonb; v_c uuid;
begin
  if v_canal is null then raise notice 'PRUEBA K11f2 · 5: la cuenta del núcleo no tiene ninguna plataforma; no se prueba.'; return; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  values (a, emp, (select id from public.fiscal_year where company_id = emp and date '2026-11-12' between starts_on and ends_on), 4, '2026-11-12', 'K11f2 con plataforma', 'manual', 'borrador', 'Prueba K11f2')
  returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common, channel_id)
  select a, emp, v_e, x.p, c.id, x.d, x.h, false, case when x.p = 1 then v_canal end
    from (values (1, '62900096', 10, 0), (2, '40000096', 0, 10)) x(p, code, d, h) join public.company_account c on c.company_id = emp and c.code = x.code;
  perform public.journal_entry_validar(v_e, 'Prueba K11f2');
  r := public.journal_entry_anular(v_e, 'Prueba K11f2: la plataforma en el contraasiento', null, 'Prueba K11f2');
  v_c := (r ->> 'contraasiento')::uuid;
  if (select channel_id from public.journal_line where entry_id = v_c and position = 1) is distinct from v_canal then
    raise exception 'PRUEBA K11f2 · 5: el contraasiento no lleva la plataforma';
  end if;
  raise notice 'PRUEBA K11f2 · 5: el contraasiento % lleva la plataforma de su línea.', r ->> 'numero';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás: las dos funciones como antes; la excluida vuelve a sumar.
\i supabase/vuelta-atras/20261122T1815_k11f2_303_otros_datos.down.sql
do $$
begin
  if strpos(pg_get_functiondef('public.conta_impuesto_303_cajas(vat_book_entry)'::regprocedure), 'K11f2') > 0
     or strpos(pg_get_functiondef('public.journal_entry_anular(uuid,text,date,text)'::regprocedure), 'K11f2') > 0 then
    raise exception 'PRUEBA K11f2 · 6: la vuelta atrás no devuelve las dos funciones';
  end if;
  raise notice 'PRUEBA K11f2 · 6: la vuelta atrás devuelve las dos funciones.';
end $$;

rollback;
