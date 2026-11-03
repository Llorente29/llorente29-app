-- supabase/vuelta-atras/20261102T2010_s01q_borrar_vercel_supabase.down.sql
--
-- Vuelta atrás de la 2010: los 2 asientos (2/3272 y 2/3273) vuelven desde el
-- respaldo con sus líneas, su IVA y sus documentos; la serie 2 y la cadena, a su
-- número y su huella de antes; y cada factura como estaba (sin enlace y sin
-- estado en la pasada), desde conta_s01q7_factura_antes; y el 303 del 4T como
-- estaba, con su calculated_at, desde conta_s01q7_303_antes.
do $$
declare v_lote uuid; r jsonb;
begin
  select lote into v_lote from public.conta_asiento_borrado
   where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and que = 'asiento' and deshecho_at is null
     and motivo like 'S01q·7 · Duplicado:%' order by at desc limit 1;
  if v_lote is null then return; end if;
  r := public._conta_asientos_borrado_deshacer(v_lote);
  if to_regclass('public.conta_s01q7_factura_antes') is not null then
    update public.supplier_invoice si set journal_entry_id = b.journal_entry_id, updated_at = now()
      from public.conta_s01q7_factura_antes b where si.id = b.invoice_id;
    delete from public.supplier_invoice_auto a using public.conta_s01q7_factura_antes b where a.invoice_id = b.invoice_id;
    drop table public.conta_s01q7_factura_antes;
  end if;
  -- El 303 del 4T, exactamente como estaba: la declaración, sus líneas, sus cajas y sus comprobaciones.
  if to_regclass('public.conta_s01q7_303_antes') is not null then
    delete from public.tax_return_line where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    delete from public.tax_return_box where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    delete from public.tax_return_check where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    update public.tax_return t set status = a.status, amount = a.amount, result_kind = a.result_kind,
           calculated_at = a.calculated_at, updated_at = a.updated_at
      from (select (jsonb_populate_record(null::public.tax_return, fila)).* from public.conta_s01q7_303_antes where que = 'declaracion') a
     where t.id = a.id;
    insert into public.tax_return_line select (jsonb_populate_record(null::public.tax_return_line, fila)).* from public.conta_s01q7_303_antes where que = 'linea';
    insert into public.tax_return_box select (jsonb_populate_record(null::public.tax_return_box, fila)).* from public.conta_s01q7_303_antes where que = 'caja';
    insert into public.tax_return_check select (jsonb_populate_record(null::public.tax_return_check, fila)).* from public.conta_s01q7_303_antes where que = 'comprobacion';
    drop table public.conta_s01q7_303_antes;
  end if;
  raise notice 'S01q·7: %', r->>'texto';
end $$;
