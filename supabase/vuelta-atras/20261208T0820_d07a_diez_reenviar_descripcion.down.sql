-- supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql
--
-- Vuelta atrás de 20261208T0820_d07a_diez_reenviar_descripcion: los que siguen
-- «pendiente» con el motivo que les puso la 0820 dejan de reintentarse
-- (attempts = 3, como si se hubieran agotado: «lo tiene que mirar una
-- persona»). Los que ya llegaron a Diez se quedan como están: están allí. En
-- staging, nada.
do $$
declare v_n int;
begin
  update public.external_send
     set attempts = 3, updated_at = now()
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'factura' and status = 'pendiente'
     and last_error like 'Se vuelve a mandar con la descripción en 40 caracteres (D07a).%';
  get diagnostics v_n = row_count;
  raise notice 'D07a 0820 vuelta atrás: % envíos dejan de reintentarse.', v_n;
end $$;
