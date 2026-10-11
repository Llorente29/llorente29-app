-- ============================================================================
-- Vuelta atrás de Compras · 7 · la liquidación mensual desde sus documentos.
-- PARA si alguna liquidación «documentos» está confirmada: su factura y sus
-- asientos se deshacen antes (anular en el libro, anular la factura). Si no,
-- borra las de borrador, quita las funciones y la tabla de lo casado, y deja
-- licensed_settlement como estaba (sus dos CHECK y sin las tres columnas).
-- ============================================================================
do $$
begin
  if exists (select 1 from public.licensed_settlement where formula = 'documentos' and status <> 'borrador') then
    raise exception 'Hay liquidaciones de documentos confirmadas: deshaz antes sus asientos y su factura.';
  end if;
end $$;
delete from public.licensed_settlement where formula = 'documentos';
drop function if exists public.compras_liquidacion_confirmar(uuid);
drop function if exists public._compras_liquidacion_confirmar(uuid, text);
drop function if exists public.compras_liquidacion_contraste(uuid);
drop function if exists public._compras_liquidacion_contraste(uuid);
drop function if exists public.compras_liquidacion_guardar(uuid, uuid, uuid, jsonb);
drop function if exists public._compras_liquidacion_guardar(uuid, uuid, uuid, jsonb, text);
drop function if exists public.compras_liquidacion_casar_producto(uuid, text, uuid, boolean);
drop table if exists public.settlement_product_match;
alter table public.licensed_settlement drop constraint if exists licensed_settlement_nueva_completa;
alter table public.licensed_settlement add constraint licensed_settlement_nueva_completa
  check (formula = 'anterior' or (party_id is not null and location_id is not null and status is not null and purchases_amount is not null
         and contributions_amount is not null and brand_sales_base is not null and commission_pct is not null and commission_amount is not null and amount is not null));
alter table public.licensed_settlement drop constraint if exists licensed_settlement_formula_check;
alter table public.licensed_settlement add constraint licensed_settlement_formula_check check (formula in ('anterior', 'compras_aportaciones_comision'));
alter table public.licensed_settlement drop column if exists received_invoice_id;
alter table public.licensed_settlement drop column if exists supplier_id;
alter table public.licensed_settlement drop column if exists company_id;
