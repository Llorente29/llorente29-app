-- supabase/vuelta-atras/20261109T1130_gd_tarifa_demo.down.sql
--
-- Vuelta atrás de la 1130: quita la tarifa sembrada en «Gestoría Demo» (niveles,
-- precios, paquetes, los servicios creados por la tarifa y las líneas que no
-- vienen de GoCardless) y la función. Solo de esa cuenta, y solo si es demo.
-- Lo que no se deshace: si la siembra juntó en uno los servicios «IMPUESTO DE
-- SOCIEDADES <cliente>» de la importación, se queda junto (la próxima lectura de
-- GoCardless no los vuelve a separar; volver a sembrar el sandbox, sí).

do $$
declare c constant uuid := 'de000000-0000-4000-8000-0000000000a0';
begin
  if exists (select 1 from public.accounts where id = c and is_demo is true) then
    update public.conta_linea set nivel_id = null where account_id = c and nivel_id is not null;
    delete from public.conta_cliente_paquete where account_id = c;
    delete from public.conta_linea where account_id = c and origen = 'manual';
    delete from public.conta_precio where account_id = c;
    delete from public.conta_paquete where account_id = c;
    delete from public.conta_servicio_nivel where account_id = c;
    delete from public.conta_servicio s where s.account_id = c and s.clave like 'g04:%'
       and not exists (select 1 from public.conta_linea l where l.servicio_id = s.id)
       and not exists (select 1 from public.conta_tarifa t where t.servicio_id = s.id);
  end if;
end $$;
drop function if exists public.demo_gestoria_tarifa_sembrar(uuid);
