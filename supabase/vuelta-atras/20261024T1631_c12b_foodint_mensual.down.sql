-- Vuelta atrás de 20261024T1631_c12b_foodint_mensual.sql (C12b).
-- C12c (25/10): restaura EXACTAMENTE desde la copia que guardó la 1631
-- (conta_c12b_antes), sin now() ni reglas:
--   · la empresa, su modo, cambiado_por_nombre y cambiado_en de antes;
--   · cada envío pendiente, su next_try_at y su updated_at de antes (el que no
--     tenía reintento sigue sin él).
-- Después borra la copia. PARA:
--   · si Foodint ya tiene un traspaso empezado: volver al envío al momento con
--     un mes a medio traspasar mezclaría los dos;
--   · si no hay copia: sin ella no se puede dejar exacto, y no se inventa.
do $$
declare v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  if exists (select 1 from public.conta_diez_traspaso where account_id = v_acc and estado in ('confirmado', 'traspasando')) then
    raise exception 'C12b · vuelta atrás: Foodint tiene un traspaso a medias. Primero se termina.';
  end if;
  if to_regclass('public.conta_c12b_antes') is null then
    raise exception 'C12b · vuelta atrás: no está la copia de antes (conta_c12b_antes). Sin ella no se deja exacto: no se toca nada.';
  end if;
  update public.conta_diez_envio_empresa e
     set modo = a.modo, cambiado_por_nombre = a.cambiado_por_nombre, cambiado_en = a.cambiado_en
    from public.conta_c12b_antes a
   where a.tabla = 'conta_diez_envio_empresa' and e.company_id = a.fila and e.account_id = v_acc;
  update public.external_send s
     set next_try_at = a.next_try_at, updated_at = a.updated_at
    from public.conta_c12b_antes a
   where a.tabla = 'external_send' and s.id = a.fila and s.account_id = v_acc;
  -- Dentro del mismo bloque: una sola sentencia, que o se hace entera o no.
  drop table public.conta_c12b_antes;
end $$;
