-- Vuelta atrás de 20261009T0150_c03_lectura.sql: quita el SELECT de lo nuevo a
-- conta_lectura. Antes de la 0150 no podía leer ninguna de estas: medido en
-- producción el 06/10 (role_table_grants): de channel_settlement,
-- licensed_settlement y brand_licensing_agreement, ningún permiso.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then return; end if;
  revoke select on table public.party, public.party_role, public.customer_fiscal, public.brand_partner_contribution,
                         public.channel_settlement, public.licensed_settlement, public.brand_licensing_agreement from conta_lectura;
end $$;
