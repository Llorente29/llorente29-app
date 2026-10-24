-- W02 · Fin del relevo del secreto del despacho: fuera el _anterior.
--
-- VA EN OTRA TANDA, después de la 0100, cuando:
--   · los pedidos de los locales en automático hayan seguido saliendo a
--     Catcher después de la 0100 (carrier_order_id puesto), y
--   · los logs de catcher-dispatch no traigan ningún CATCHER_DISPATCH_SECRETO_ANTERIOR
--     en los últimos 15 minutos (o sea: ya nadie llega con el de antes).
-- Desde aquí, solo vale el secreto nuevo. El código del relevo en
-- catcher-dispatch se queda: sin el _anterior en Vault no hace nada, y sirve
-- para el próximo cambio.
-- No tiene vuelta atrás: el de antes se borra a propósito.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'catcher_dispatch_secret') then
    raise exception 'W02: no hay catcher_dispatch_secret en Vault: no se borra el _anterior';
  end if;
  delete from vault.secrets where name = 'catcher_dispatch_secret_anterior';
end $$;

select (select count(*) from vault.secrets where name = 'catcher_dispatch_secret') as secreto_vivo,
       (select count(*) from vault.secrets where name = 'catcher_dispatch_secret_anterior') as anterior_que_queda;
