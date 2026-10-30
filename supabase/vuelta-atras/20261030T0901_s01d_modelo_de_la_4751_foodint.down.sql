-- supabase/vuelta-atras/20261030T0901_s01d_modelo_de_la_4751_foodint.down.sql
--
-- Vuelta atrás de la 0901: las dos subcuentas de la 4751 de Foodint, sin modelo.
do $$
declare f constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  if not exists (select 1 from public.accounts where id = f) then
    raise notice 'S01d 0901 (vuelta atrás): esta base no tiene a Foodint: nada que deshacer.';
    return;
  end if;
  update public.company_account set withholding_model = null
   where account_id = f and code in ('47510000', '47510019');
end $$;
