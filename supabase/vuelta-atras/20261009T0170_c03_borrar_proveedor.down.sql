-- Vuelta atrás de 20261009T0170_c03_borrar_proveedor.sql: quita el disparador
-- y su función. No toca datos: los terceros que ya se borraron con sus
-- proveedores no vuelven (tampoco sus proveedores).
drop trigger if exists trg_party_al_borrar_proveedor on public.supplier;
drop function if exists public.party_al_borrar_proveedor();
