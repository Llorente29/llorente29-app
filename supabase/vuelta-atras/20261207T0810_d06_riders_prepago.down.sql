-- supabase/vuelta-atras/20261207T0810_d06_riders_prepago.down.sql
--
-- Vuelta atrás de 20261207T0810_d06_riders_prepago: RIDERS de Foodint otra vez
-- sin forma de pago, como estaba el 23/10. Solo si sigue con «prepaid» (si
-- alguien la ha cambiado después a mano, se respeta). En staging, nada.
do $$
declare
  v_n int;
begin
  update public.supplier set payment_method = null
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1' and payment_method = 'prepaid';
  get diagnostics v_n = row_count;
  raise notice 'D06 0810 vuelta atrás: % fila(s) de RIDERS sin forma de pago.', v_n;
end $$;
