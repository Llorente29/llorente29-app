-- supabase/staging/sql/20261123_k11b_erp10_excel_prueba.sql
--
-- SOLO STAGING. Prueba del K11b: el candado de ERP10 de los pagos (K10c, 0920) por el camino del EXCEL, el que el K10c
-- no probó (Respuesta K10c · 1 lo probó con conta_erp10_envio, la salida del X10f). Todo en una transacción con
-- ROLLBACK: staging no cambia. No añade ni cambia nada de la base: usa public.conta_recibida_pago_apuntar,
-- public.conta_recibida_pago_se_puede_cambiar, public.conta_recibida_pago_cambiar y public.conta_recibida_pago_borrar.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Proveedor y cuentas inventados (T11). Por sus
-- CAMINOS (regla 10): la recibida se propone y se valida (journal_entry_proponer y journal_entry_validar) y el pago se
-- apunta con la función de la ficha; la salida a ERP10 por el Excel es una partida de un lote (conta_erp10_salida_lote
-- y conta_erp10_salida_partida), como la deja «Sacar a ERP10».
--   1. Un pago apuntado y sin salir: se puede cambiar.
--   2. Con su asiento en una partida «salida» del Excel: no se cambia ni se borra («Este pago ya está en ERP10…»), y
--      la ficha lo dice en el `title` (se_puede_cambiar: puede = false, con el porqué).
--   3. La partida, «retirada» (el lote se retiró): vuelve a poderse, y se cambia con el mismo número.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K11b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_recibida_pago_apuntar(uuid,uuid,text,date,numeric,text,text)') is null then raise exception 'PRUEBA K11b · 0: falta la 0920 del K10c.'; end if;
end $$;
set local statement_timeout = '120s';
create temp table _k11b (clave text primary key, valor text) on commit drop;
grant all on _k11b to authenticated;

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f70000-0000-4000-8000-0000000000a1', a, 'Proveedor de Prueba K11b Excel, S.L.', 'B00011214', 'ES', 'general');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000098', '4000', 'Proveedor de Prueba K11b Excel', 'own', 'manual'),
    (a, emp, 'pymes', '62900098', '629', 'Otros servicios de prueba K11b', 'own', 'manual'),
    (a, emp, 'pymes', '55100098', '551', 'Cuenta corriente con socio de prueba K11b', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', 'c0f70000-0000-4000-8000-0000000000a1', 'principal', 'manual' from public.company_account c where c.company_id = emp and c.code = '40000098';
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at)
  values ('c0f70000-0000-4000-8000-0000000000f1', a, emp, 'c0f70000-0000-4000-8000-0000000000a1', 'invoice', 'K11B-EXCEL', date '2026-11-05',
          'aprobada', 'manual', 100, 21, 121, false, 'prueba K11b', timestamptz '2026-11-05 10:00+01');
end $$;

-- La recibida por la propuesta, como la pantalla, y validada.
create or replace function pg_temp.k11b_recibida(p_factura uuid) returns uuid language plpgsql as $$
declare
  t uuid := (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null); v_r jsonb; v_e uuid;
begin
  v_r := public.journal_entry_proponer('c0e20000-0000-4000-8000-0000000000e3',
    jsonb_build_object('series', 2, 'fecha', date '2026-11-05', 'concepto', 'Prueba K11b · K11B-EXCEL', 'source_type', 'supplier_invoice', 'source_id', p_factura,
                       'confianza', 'seguro', 'porque', 'prueba K11b', 'documento', 'K11B-EXCEL'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900098', 'debe', 100, 'haber', 0, 'comun', true, 'documento', 'K11B-EXCEL'),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', 'K11B-EXCEL',
                         'iva', jsonb_build_object('tipo_id', t, 'base', 100, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '40000098', 'debe', 0, 'haber', 121, 'comun', true, 'documento', 'K11B-EXCEL')), null, 'Prueba K11b');
  v_e := (v_r ->> 'id')::uuid;
  perform public.journal_entry_validar(v_e, 'Prueba K11b');
  update public.supplier_invoice set journal_entry_id = v_e where id = p_factura;
  return v_e;
end $$;
grant execute on function pg_temp.k11b_recibida(uuid) to authenticated;

-- 1 · Un pago apuntado y sin salir: se puede cambiar.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; f1 constant uuid := 'c0f70000-0000-4000-8000-0000000000f1'; r jsonb; s jsonb;
begin
  perform pg_temp.k11b_recibida(f1);
  r := public.conta_recibida_pago_apuntar(emp, f1, '55100098', date '2026-11-10', 60, 'Pago K11b por el Excel', 'Prueba K11b');
  insert into _k11b values ('p', r->>'pago'), ('e', r->>'asiento');
  s := public.conta_recibida_pago_se_puede_cambiar((r->>'pago')::uuid);
  if (s->>'puede')::boolean is not true then raise exception 'PRUEBA K11b · 1: sin salir a ERP10 no se puede cambiar (%)', s; end if;
  raise notice 'PRUEBA K11b · 1: pago de 60,00 apuntado (asiento 4 / %), sin salir a ERP10: se puede cambiar.', r->>'numero';
end $$;
reset role;

-- 2 · Su asiento sale a ERP10 por el Excel: una partida «salida» de un lote, como la deja «Sacar a ERP10».
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  e uuid := (select valor::uuid from _k11b where clave = 'e');
begin
  insert into public.conta_erp10_salida_lote (id, account_id, company_id, mes, ficheros, asientos, creado_por_nombre)
  values ('c0f70000-0000-4000-8000-0000000000c1', a, emp, date '2026-11-01', '["asientos-2026-11.xlsx"]'::jsonb, 1, 'Prueba K11b');
  insert into public.conta_erp10_salida_partida (account_id, company_id, lote_id, entry_id, clase, huella, estado)
  values (a, emp, 'c0f70000-0000-4000-8000-0000000000c1', e, 'asiento', left(md5(public.journal_entry_canonico(e)), 12), 'salida');
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare p uuid := (select valor::uuid from _k11b where clave = 'p'); s jsonb; v_msg text;
begin
  s := public.conta_recibida_pago_se_puede_cambiar(p);
  if (s->>'puede')::boolean is not false or s->>'porque' is distinct from 'Este pago ya está en ERP10. Para quitarlo, anúlalo allí y aquí con un contraasiento.' then
    raise exception 'PRUEBA K11b · 2: con su partida «salida», se_puede_cambiar dice %', s;
  end if;
  begin perform public.conta_recibida_pago_cambiar(p, '55100098', date '2026-11-11', 61, null, 'Prueba K11b'); exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'Este pago ya está en ERP10. Para quitarlo, anúlalo allí y aquí con un contraasiento.' then raise exception 'PRUEBA K11b · 2: cambiar (%)', v_msg; end if;
  v_msg := null;
  begin perform public.conta_recibida_pago_borrar(p, 'prueba', 'Prueba K11b'); exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'Este pago ya está en ERP10. Para quitarlo, anúlalo allí y aquí con un contraasiento.' then raise exception 'PRUEBA K11b · 2: borrar (%)', v_msg; end if;
  if not exists (select 1 from public.supplier_invoice_payment where id = p) then raise exception 'PRUEBA K11b · 2: se ha borrado igual'; end if;
  raise notice 'PRUEBA K11b · 2: con su asiento en el Excel de ERP10 (partida «salida»), no se cambia ni se borra: «%»', s->>'porque';
end $$;
reset role;

-- 3 · La partida, retirada: vuelve a poderse, y se cambia con el mismo número. (Borrarlo con la partida retirada lo
--     para la clave ajena de la partida, ON DELETE RESTRICT: va en el parte del K11b como lo que no sé, no se prueba aquí.)
update public.conta_erp10_salida_partida set estado = 'retirada' where lote_id = 'c0f70000-0000-4000-8000-0000000000c1';
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare p uuid := (select valor::uuid from _k11b where clave = 'p'); s jsonb; r jsonb;
begin
  s := public.conta_recibida_pago_se_puede_cambiar(p);
  if (s->>'puede')::boolean is not true then raise exception 'PRUEBA K11b · 3: con la partida retirada, %', s; end if;
  r := public.conta_recibida_pago_cambiar(p, '55100098', date '2026-11-11', 61, 'Pago K11b, cambiado', 'Prueba K11b');
  if (select amount from public.supplier_invoice_payment where id = p) <> 61 then raise exception 'PRUEBA K11b · 3: el pago no ha cambiado'; end if;
  raise notice 'PRUEBA K11b · 3: con la partida retirada, se puede y se cambia: «%»', r->>'frase';
end $$;
reset role;

rollback;
