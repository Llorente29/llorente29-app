-- Vuelta atrás de 20261024T1631_c12b_foodint_mensual.sql (C12b).
-- Foodint vuelve a «al validar» (modo nulo) y sus envíos pendientes vuelven a
-- la cola: next_try_at = now() a los que tienen menos de 3 intentos, para que
-- la siguiente pasada los coja. PARA si Foodint ya tiene un traspaso empezado:
-- volver al envío al momento con un mes a medio traspasar mezclaría los dos.
do $$
declare v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  if exists (select 1 from public.conta_diez_traspaso where account_id = v_acc and estado in ('confirmado', 'traspasando')) then
    raise exception 'C12b · vuelta atrás: Foodint tiene un traspaso a medias. Primero se termina.';
  end if;
  update public.conta_diez_envio_empresa set modo = null, cambiado_por_nombre = 'Vuelta atrás C12b', cambiado_en = now()
   where account_id = v_acc and modo = 'mensual';
  update public.external_send set next_try_at = now(), updated_at = now()
   where account_id = v_acc and status = 'pendiente' and next_try_at is null and attempts < 3;
end $$;
