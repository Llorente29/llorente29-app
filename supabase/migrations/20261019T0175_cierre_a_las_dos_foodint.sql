-- ============================================================================
-- C04b · Respuesta 4 · DATOS: Foodint cierra el día a las 2:00
-- ----------------------------------------------------------------------------
-- Decidido por Julio (12/10): «Los cierres diarios pasan a las 02:00 (hora de
-- Madrid), para que entren todas las ventas del día.»
--
-- La 0170 cambia la hora DE SERIE. La de Foodint está GUARDADA en su ficha
-- fiscal (company_tax_profile.sales_day_close_time = 06:00, medido en
-- producción el 12/10, solo lectura: es la única empresa de producción), así
-- que la de serie no la mueve: hay que cambiar esa fila.
--
-- Anclado por id y cuenta (regla 9). PARA, sin cambiar nada, si la empresa no
-- es de la cuenta o si su hora no es 06:00 (la de serie de antes): otra hora
-- sería una decisión de alguien y no se pisa a escondidas. Si ya es 02:00, no
-- hace nada y lo dice. En una base sin Foodint (staging) no hace nada y lo
-- dice.
--
-- Es lo mismo que hace «Hora de cierre del día» en Ajustes › Ejercicio; se
-- escribe aquí para que quede en el historial con su huella.
--
-- Actualiza una fila que existe: va en «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261019T0175_cierre_a_las_dos_foodint.down.sql
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_hora time;
begin
  if not exists (select 1 from public.company where id = v_empresa) then
    raise notice 'cierre a las 2:00: esta base no tiene Foodint. No se cambia nada.';
    return;
  end if;
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise exception 'cierre a las 2:00: la empresa % no es de la cuenta %.', v_empresa, v_cuenta;
  end if;
  select sales_day_close_time into v_hora from public.company_tax_profile where company_id = v_empresa;
  if not found then
    raise exception 'cierre a las 2:00: Foodint no tiene ficha fiscal. No se cambia nada.';
  end if;
  if v_hora = time '02:00' then
    raise notice 'cierre a las 2:00: Foodint ya cierra a las 2:00. No se cambia nada.';
    return;
  end if;
  if v_hora is distinct from time '06:00' then
    raise exception 'cierre a las 2:00: Foodint tiene guardada otra hora (%), no la de serie de antes. No se pisa.', v_hora;
  end if;
  update public.company_tax_profile set sales_day_close_time = time '02:00' where company_id = v_empresa;
  raise notice 'cierre a las 2:00: Foodint pasa de las 6:00 a las 2:00.';
end $$;
