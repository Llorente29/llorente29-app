-- supabase/vuelta-atras/20261121T1120_r14_proveedor_solo_al_leer.down.sql
--
-- R14 · Vuelta atrás de la 1120: fuera el disparador que da de alta al proveedor al leer.
-- Lo que ya dio de alta se queda (es un proveedor de verdad, con su «Deshacer» en la
-- ficha mientras exista la 1110). Va después de la de la 1130 y antes que la de la 1110.
drop trigger if exists r14_proveedor_solo on public.supplier_invoice;
drop function if exists public.tg_r14_proveedor_solo();
