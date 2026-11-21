-- supabase/staging/sql/20261121_x26_modificar_recibida_prueba.sql
--
-- SOLO STAGING. Prueba del X26 (20261121T1900_x26_modificar_recibida), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra lo nuevo:
-- public.conta_recibida_modificada, public.conta_recibida_se_puede_modificar(uuid) y
-- public.conta_recibida_modificar(uuid,jsonb,text). No cambia nada que exista.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. La recibida, su asiento y la cuenta nueva
-- son inventados, dentro de la transacción (T11). Por sus CAMINOS (regla 10):
--   1. Una recibida contabilizada en la 62800000: su asiento validado (journal_entry_validar), con su IVA en el libro
--      y su documento. Lo que se mide antes (regla 31): cuántos asientos hay, el saldo de la cuenta del proveedor,
--      el libro de IVA del trimestre y el número del asiento.
--   2. «Modificar» la cuenta de gasto (a una 628 nueva, «Electricidad»): el MISMO número de asiento y la cuenta nueva;
--      los mismos asientos, el mismo saldo del proveedor y el mismo libro de IVA; la cadena íntegra; su respaldo y su
--      historial.
--   3. «Modificar» y cancelar: la pantalla no llama a la base al cancelar; preguntar si se puede no cambia nada; y
--      guardar sin cambios no toca el asiento (ni su huella).
--   4. Lo que no se puede: la línea del proveedor; una cuenta de proveedor; y con el trimestre presentado, para con su
--      frase («El IVA del 4T ya está presentado…»).
--   5. La vuelta atrás: quita lo nuevo; el asiento se queda como quedó, con la cadena íntegra.
-- El importe y el IVA (y la pagada a la que se cambia el total) son del X26b: aquí no se pueden cambiar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X26: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_recibida_modificar(uuid,jsonb,text)') is null then raise exception 'PRUEBA X26 · 0: falta la 1900 delante.'; end if;
  if not exists (select 1 from public.company where id = 'c0e20000-0000-4000-8000-0000000000e3') then
    raise exception 'PRUEBA X26 · 0: falta la gestoría del núcleo (seed_k02_nucleo_staging.sql).';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x26 (clave text primary key, valor text) on commit drop;
grant all on _x26 to authenticated;

-- 1 · Una recibida contabilizada en la 62800000, con su IVA y su documento -------------------------------------------
insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                     tax_base_total, tax_total, grand_total, needs_review, created_by_name)
values ('c0e70000-0000-4000-8000-0000000002a6', 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3',
        'c0e40000-0000-4000-8000-0000000000a1', 'invoice', 'X26-PRUEBA-1', date '2026-11-10', 'aprobada', 'manual', 100, 21, 121, false, 'prueba X26');
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid; v_t uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-10' between starts_on and ends_on;
  select id into v_t from public.tax_rate where company_id is null and rate = 21 and treatment = 'taxed' order by id limit 1;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, document_ref, document_date)
  values (a, emp, v_y, 2, '2026-11-10', 'X26-PRUEBA-1-Proveedor de Prueba Ficha Uno, S.L.', 'supplier_invoice', 'c0e70000-0000-4000-8000-0000000002a6', 'X26-PRUEBA-1', '2026-11-10')
  returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common, tax_rate_id, tax_base, vat_book, vat_deductible)
  select a, emp, v_e, x.p, c.id, x.d, x.h, true,
         case when x.code = '47200021' then v_t end, case when x.code = '47200021' then 100 end,
         case when x.code = '47200021' then 'received' end, case when x.code = '47200021' then 'yes' end
    from (values (1, '62800000', 100, 0), (2, '47200021', 21, 0), (3, '40000071', 0, 121)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  update public.supplier_invoice set journal_entry_id = v_e where id = 'c0e70000-0000-4000-8000-0000000002a6';
  insert into _x26 values ('asiento', v_e::text);
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid := (select valor::uuid from _x26 where clave = 'asiento');
begin
  perform public.journal_entry_validar(v_e, 'Prueba X26');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA X26 · 1: el asiento no ha quedado validado'; end if;
end $$;
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'conta-documentos', 'c0e20000-0000-4000-8000-0000000000e0/' || valor || '/x26.pdf', '{"size": 1234, "mimetype": "application/pdf"}' from _x26 where clave = 'asiento';
insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by_name)
select 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', valor::uuid, 'factura_recibida',
       'c0e20000-0000-4000-8000-0000000000e0/' || valor || '/x26.pdf', 'X26-PRUEBA-1.pdf', repeat('b', 64), 1234, 'automático'
  from _x26 where clave = 'asiento';

-- La vara de la regla 31, la misma antes y después (con lo que se mide, por su empresa: regla 9).
create function pg_temp.x26_vara() returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'asientos', (select count(*) from public.journal_entry where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and status = 'validado'),
    'saldo_proveedor', (select coalesce(sum(l.debit - l.credit), 0) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
                         join public.company_account c on c.id = l.company_account_id
                        where e.company_id = 'c0e20000-0000-4000-8000-0000000000e3' and e.status = 'validado' and c.code = '40000071'),
    'libro_iva_4T', (select jsonb_build_object('filas', count(*), 'base', coalesce(sum(v.tax_base), 0), 'cuota', coalesce(sum(v.tax_amount), 0))
                       from public.vat_book_entry v where v.company_id = 'c0e20000-0000-4000-8000-0000000000e3' and v.voided_at is null
                        and v.issue_date between '2026-10-01' and '2026-12-31'),
    'numero', (select number from public.journal_entry where id = (select valor::uuid from _x26 where clave = 'asiento')))
$f$;
insert into _x26 values ('antes', pg_temp.x26_vara()::text);
insert into _x26 select 'huella', hash from public.journal_entry where id = (select valor::uuid from _x26 where clave = 'asiento');
do $$ begin raise notice 'PRUEBA X26 · 1: contabilizada en la 62800000. Antes: %', (select valor from _x26 where clave = 'antes'); end $$;

-- 2 · «Modificar» la cuenta de gasto: el mismo número y la cuenta nueva ---------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_se jsonb; v_cod text; v_e uuid := (select valor::uuid from _x26 where clave = 'asiento');
begin
  v_se := public.conta_recibida_se_puede_modificar('c0e70000-0000-4000-8000-0000000002a6');
  if not (v_se->>'puede')::boolean then raise exception 'PRUEBA X26 · 2: debería poderse modificar (%)', v_se; end if;
  r := public.company_account_add('c0e20000-0000-4000-8000-0000000000e3', '628', 'Electricidad X26', null, null, null, 'Prueba X26', 'manual');
  v_cod := r->>'code';
  insert into _x26 values ('nueva', v_cod);
  r := public.conta_recibida_modificar('c0e70000-0000-4000-8000-0000000002a6', jsonb_build_array(jsonb_build_object('posicion', 1, 'cuenta', v_cod)), 'Prueba X26');
  if (r->>'cambiadas')::int <> 1 then raise exception 'PRUEBA X26 · 2: no ha cambiado la línea (%)', r; end if;
  if (select c.code from public.journal_line l join public.company_account c on c.id = l.company_account_id where l.entry_id = v_e and l.position = 1) <> v_cod then
    raise exception 'PRUEBA X26 · 2: la línea 1 no está en la %', v_cod;
  end if;
  raise notice 'PRUEBA X26 · 2: «%»', r->>'texto';
end $$;
reset role;
do $$
declare v_antes jsonb := (select valor::jsonb from _x26 where clave = 'antes'); v_despues jsonb := pg_temp.x26_vara();
begin
  if v_despues <> v_antes then raise exception 'PRUEBA X26 · 2: la vara no es la misma: antes %, después %', v_antes, v_despues; end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA X26 · 2: la cadena de huellas no cuadra'; end if;
  if (select hash from public.journal_entry where id = (select valor::uuid from _x26 where clave = 'asiento')) = (select valor from _x26 where clave = 'huella') then
    raise exception 'PRUEBA X26 · 2: la huella del asiento no ha cambiado';
  end if;
  if (select count(*) from public.conta_recibida_modificada where invoice_id = 'c0e70000-0000-4000-8000-0000000002a6') <> 1
     or (select count(*) from public.supplier_invoice_change where supplier_invoice_id = 'c0e70000-0000-4000-8000-0000000002a6' and what = 'guardar' and (cambios->>'modificada')::boolean) <> 1 then
    raise exception 'PRUEBA X26 · 2: falta su respaldo o su historial';
  end if;
  raise notice 'PRUEBA X26 · 2 · regla 31: antes % · después % (iguales); la cadena íntegra; respaldo e historial.', v_antes, v_despues;
end $$;

-- 3 · «Modificar» y cancelar; y guardar sin cambios -----------------------------------------------------------------
insert into _x26 select 'huella2', hash from public.journal_entry where id = (select valor::uuid from _x26 where clave = 'asiento');
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_e uuid := (select valor::uuid from _x26 where clave = 'asiento');
begin
  perform public.conta_recibida_se_puede_modificar('c0e70000-0000-4000-8000-0000000002a6');
  r := public.conta_recibida_modificar('c0e70000-0000-4000-8000-0000000002a6',
         jsonb_build_array(jsonb_build_object('posicion', 1, 'cuenta', (select valor from _x26 where clave = 'nueva'))), 'Prueba X26');
  if (r->>'cambiadas')::int <> 0 then raise exception 'PRUEBA X26 · 3: sin cambios ha cambiado algo (%)', r; end if;
  if (select hash from public.journal_entry where id = v_e) <> (select valor from _x26 where clave = 'huella2') then
    raise exception 'PRUEBA X26 · 3: sin cambios ha cambiado la huella';
  end if;
  raise notice 'PRUEBA X26 · 3: preguntar no cambia nada; sin cambios, «%», y la huella igual.', r->>'texto';
end $$;

-- 4 · Lo que no se puede -------------------------------------------------------------------------------------------------
do $$
declare v_msg text;
begin
  begin perform public.conta_recibida_modificar('c0e70000-0000-4000-8000-0000000002a6', '[{"posicion": 3, "cuenta": "62800000"}]', 'Prueba X26');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '^La línea 3 es la del proveedor o la del IVA' then raise exception 'PRUEBA X26 · 4: la línea del proveedor (%)', v_msg; end if;
  v_msg := null;
  begin perform public.conta_recibida_modificar('c0e70000-0000-4000-8000-0000000002a6', '[{"posicion": 1, "cuenta": "40000071"}]', 'Prueba X26');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ 'no es una cuenta de gasto' then raise exception 'PRUEBA X26 · 4: una cuenta de proveedor (%)', v_msg; end if;
  raise notice 'PRUEBA X26 · 4: la línea del proveedor y una cuenta de proveedor, no.';
end $$;
reset role;
-- El 303 del 4T, presentado.
insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', '303', 2026, 'quarterly', '4T', date '2027-01-30', 'filed', 'zero', 0, now(), 'outside', 'PRUEBAX26CSV0000');
set local role authenticated;
do $$
declare v_se jsonb; v_msg text;
begin
  v_se := public.conta_recibida_se_puede_modificar('c0e70000-0000-4000-8000-0000000002a6');
  if (v_se->>'puede')::boolean or v_se->>'porque' <> 'El IVA del 4T ya está presentado: esta factura no se puede modificar.' then
    raise exception 'PRUEBA X26 · 4: con el 4T presentado (%)', v_se;
  end if;
  begin perform public.conta_recibida_modificar('c0e70000-0000-4000-8000-0000000002a6', '[{"posicion": 1, "cuenta": "62800000"}]', 'Prueba X26');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from v_se->>'porque' then raise exception 'PRUEBA X26 · 4: con el 4T presentado, modificar (%)', v_msg; end if;
  raise notice 'PRUEBA X26 · 4: con el 4T presentado, «%»', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 5 · La vuelta atrás -------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261121T1900_x26_modificar_recibida.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_modificar(uuid,jsonb,text)') is not null or to_regclass('public.conta_recibida_modificada') is not null then
    raise exception 'PRUEBA X26 · 5: la vuelta atrás no quita lo nuevo';
  end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA X26 · 5: la cadena no cuadra después'; end if;
  raise notice 'PRUEBA X26 · 5: la vuelta atrás quita las dos funciones y la tabla; el asiento se queda como quedó, con la cadena íntegra.';
end $$;

rollback;
