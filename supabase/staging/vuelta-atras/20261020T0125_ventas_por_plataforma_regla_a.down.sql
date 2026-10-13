-- Vuelta atrás de 20261020T0125 (solo staging): la empresa A vuelve a la regla
-- de antes. PARA si tiene resúmenes por unidad (antes, la vuelta atrás de la
-- 0130). La 70000001 se quita solo si la creó la 0125 y nadie la ha usado.
do $$
declare
  v_quien constant text := 'Folvy (R9, staging: regla de la empresa A)';
  v_e uuid;
begin
  select id into v_e from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1;
  if v_e is null then return; end if;
  if exists (select 1 from public.sales_day_summary where company_id = v_e and unit_key is not null) then
    raise exception 'Vuelta atrás de la 0125 (staging): la empresa A tiene resúmenes por unidad; retíralos antes.';
  end if;
  delete from public.conta_ventas_marca where company_id = v_e and created_by_name = v_quien;
  delete from public.conta_ventas_canal where company_id = v_e and created_by_name = v_quien;
  delete from public.company_account a where a.company_id = v_e and a.code = '70000001' and a.created_by_name = v_quien
     and not exists (select 1 from public.journal_line l where l.company_account_id = a.id);
end $$;
