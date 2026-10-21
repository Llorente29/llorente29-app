-- supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql
-- Vuelta atrás de 20261118T0320: las tres columnas a null en los pedidos que
-- rellenó, los Uber que recolocó otra vez con el tipo de reparto que tenían
-- (r03_entrega_relleno.service_type_antes), y fuera esa tabla.
select set_config('folvy.reparto_tal_cual', 'on', true);
update public.sale s
   set customer_phone_code = null, delivery_instructions = null, order_customer_note = null
  from public.r03_entrega_relleno r where r.sale_id = s.id and r.service_type_antes is null;
update public.sale s
   set service_type = r.service_type_antes, delivery_by_reason = null
  from public.r03_entrega_relleno r where r.sale_id = s.id and r.service_type_antes is not null;
select set_config('folvy.reparto_tal_cual', '', true);
drop table if exists public.r03_entrega_relleno;
