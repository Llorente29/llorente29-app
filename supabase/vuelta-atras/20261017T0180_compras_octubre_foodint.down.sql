-- ============================================================================
-- Vuelta atrás de Compras · 9 · octubre de Foodint. Quita SOLO lo que dio la
-- 0180 (apuntado en _compras_relleno_octubre): las facturas que creó y los
-- caminos. PARA si alguna de esas facturas ya no está «en revisión» o tiene
-- asiento en el libro: alguien ya trabajó con ella y deshacerla sería borrar
-- trabajo hecho.
-- ============================================================================
do $$
begin
  if to_regclass('public._compras_relleno_octubre') is null then return; end if;
  if exists (select 1 from public._compras_relleno_octubre r join public.supplier_invoice f on f.id = r.supplier_invoice_id
              where f.status <> 'en_revision'
                 or exists (select 1 from public.journal_entry j where j.source_type = 'supplier_invoice' and j.source_id = f.id and j.status <> 'anulado')) then
    raise exception 'Alguna factura del relleno de octubre ya está aprobada o en el libro: deshazla antes a mano.';
  end if;
  delete from public.supplier_invoice_receipt x using public._compras_relleno_octubre r
   where x.supplier_invoice_id = r.supplier_invoice_id;
  delete from public.supplier_invoice_line l using public._compras_relleno_octubre r
   where l.supplier_invoice_id = r.supplier_invoice_id;
  delete from public.goods_receipt_path p using public._compras_relleno_octubre r
   where p.goods_receipt_id = r.goods_receipt_id;
  delete from public.supplier_invoice f using public._compras_relleno_octubre r
   where f.id = r.supplier_invoice_id;
end $$;
drop table if exists public._compras_relleno_octubre;
