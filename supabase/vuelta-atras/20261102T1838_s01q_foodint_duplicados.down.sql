-- supabase/vuelta-atras/20261102T1838_s01q_foodint_duplicados.down.sql
--
-- Vuelta atrás de la 1838: los 123 asientos vuelven (con sus líneas, su IVA y sus
-- documentos), la serie 2 y la cadena a su número y su huella de antes, y cada
-- factura otra vez «apuntada sola» con su asiento.
do $$
declare v_lote uuid; r jsonb;
begin
  select lote into v_lote from public.conta_asiento_borrado
   where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and que = 'asiento' and deshecho_at is null
     and motivo like 'S01q · Duplicado: la factura ya estaba en Diez%' order by at desc limit 1;
  if v_lote is null then return; end if;
  r := public._conta_asientos_borrado_deshacer(v_lote);
  update public.supplier_invoice si set journal_entry_id = null, updated_at = now()
    from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento' and si.id = (b.asiento->>'source_id')::uuid;
  update public.supplier_invoice_auto a set estado = 'apuntada', entry_id = b.entry_id, porque = a.porque, at = now()
    from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento' and a.invoice_id = (b.asiento->>'source_id')::uuid;
  raise notice 'S01q: %', r->>'texto';
end $$;
