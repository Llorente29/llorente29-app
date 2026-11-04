-- supabase/vuelta-atras/20261104T1041_s01p_factura_asiento_datos.down.sql
-- Vuelta atrás de la 1041: cada factura, con el asiento que tenía antes (desde
-- su copia, conta_s01p_factura_antes, cuenta a cuenta), y fuera la copia.
update public.supplier_invoice f
   set journal_entry_id = a.journal_entry_id
  from public.conta_s01p_factura_antes a
 where a.id = f.id and a.account_id = f.account_id
   and f.journal_entry_id is distinct from a.journal_entry_id;
drop table if exists public.conta_s01p_factura_antes;
