-- supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql
-- Vuelta atrás de 20261118T0320: las tres columnas a null en los pedidos que
-- rellenó (r03_entrega_relleno), y fuera esa tabla.
update public.sale s
   set customer_phone_code = null, delivery_instructions = null, order_customer_note = null
  from public.r03_entrega_relleno r where r.sale_id = s.id;
drop table if exists public.r03_entrega_relleno;
