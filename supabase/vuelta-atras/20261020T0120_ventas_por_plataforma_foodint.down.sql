-- Vuelta atrás de 20261020T0120: Foodint vuelve a la regla de antes (un
-- asiento por día y local). Quita su regla y las tres 708 nuevas si nadie las
-- ha usado. PARA si hay resúmenes por unidad de Foodint (antes, la vuelta
-- atrás de la 0130 o retirar esas unidades) o si alguna 708 nueva tiene líneas.
do $$
declare
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
begin
  if exists (select 1 from public.sales_day_summary where company_id = v_empresa and unit_key is not null) then
    raise exception 'Vuelta atrás de la 0120: Foodint tiene resúmenes por unidad; retíralos antes.';
  end if;
  if exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
              where a.company_id = v_empresa and a.code in ('70800003', '70800007', '70800008')) then
    raise exception 'Vuelta atrás de la 0120: las 708 nuevas ya tienen apuntes; no se quitan.';
  end if;
  delete from public.conta_ventas_marca where company_id = v_empresa;
  delete from public.conta_ventas_canal where company_id = v_empresa;
  delete from public.company_account where company_id = v_empresa and code in ('70800003', '70800007', '70800008') and created_by_name like 'Folvy (C04b R5%';
end $$;
