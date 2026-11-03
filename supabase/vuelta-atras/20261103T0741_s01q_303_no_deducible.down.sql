-- supabase/vuelta-atras/20261103T0741_s01q_303_no_deducible.down.sql
-- Vuelta atrás de la 0741: conta_impuesto_303_cajas, la de antes (desde su respaldo).
select public._restaurar_funcion('public.conta_impuesto_303_cajas(public.vat_book_entry)', '20261103T0741_s01q_303_no_deducible');
