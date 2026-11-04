-- supabase/vuelta-atras/20261104T2211_s01p_22_a_octubre.down.sql
--
-- Vuelta atrás de la 2211: fuera los 22 asientos de octubre (con _conta_asientos_borrar,
-- que los respalda), y los 22 de noviembre vuelven desde el primer respaldo con su
-- número y su huella; y el 303 del 4T como estaba, desde conta_s01p4_303_antes.
do $$
declare v_lote uuid; v_nuevos uuid[]; r jsonb;
begin
  select lote into v_lote from public.conta_asiento_borrado
   where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and que = 'asiento' and deshecho_at is null
     and motivo like 'S01p·4 · Facturas de octubre asentadas en noviembre%' order by at desc limit 1;
  if v_lote is null then return; end if;
  select array_agg(i.journal_entry_id) into v_nuevos from public.supplier_invoice i
   where i.id in (select (b.asiento->>'source_id')::uuid from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento')
     and i.journal_entry_id is not null;
  delete from public.tax_return_line where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
  if v_nuevos is not null then
    r := public._conta_asientos_borrar('658728c0-fcd7-46ef-a860-d4e5e6eb21d9', v_nuevos,
           'S01p·4 · Vuelta atrás: los asientos de octubre de las 22 facturas se quitan para devolver los de noviembre.', 'Vuelta atrás S01p·4');
  end if;
  r := public._conta_asientos_borrado_deshacer(v_lote);
  if to_regclass('public.conta_s01p4_303_antes') is not null then
    delete from public.tax_return_line where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    delete from public.tax_return_box where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    delete from public.tax_return_check where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    update public.tax_return t set status = a.status, amount = a.amount, result_kind = a.result_kind,
           calculated_at = a.calculated_at, updated_at = a.updated_at
      from (select (jsonb_populate_record(null::public.tax_return, fila)).* from public.conta_s01p4_303_antes where que = 'declaracion') a
     where t.id = a.id;
    insert into public.tax_return_line select (jsonb_populate_record(null::public.tax_return_line, fila)).* from public.conta_s01p4_303_antes where que = 'linea';
    insert into public.tax_return_box select (jsonb_populate_record(null::public.tax_return_box, fila)).* from public.conta_s01p4_303_antes where que = 'caja';
    insert into public.tax_return_check select (jsonb_populate_record(null::public.tax_return_check, fila)).* from public.conta_s01p4_303_antes where que = 'comprobacion';
    drop table public.conta_s01p4_303_antes;
  end if;
  raise notice 'S01p·4: %', r->>'texto';
end $$;
