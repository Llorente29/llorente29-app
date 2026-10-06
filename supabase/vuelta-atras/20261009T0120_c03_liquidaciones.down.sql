-- Vuelta atrás de 20261009T0120_c03_liquidaciones.sql. PARA si hay algo hecho
-- con lo nuevo que se perdería: cobros apuntados, periodos confirmados,
-- liquidaciones del socio con la fórmula nueva, aportaciones o acuerdos
-- enlazados a su socio. Las de junio («anterior») se quedan como estaban.
do $$
begin
  if exists (select 1 from public.channel_settlement where collected_on is not null or period_confirmed_at is not null)
     or exists (select 1 from public.licensed_settlement where formula <> 'anterior')
     or exists (select 1 from public.brand_partner_contribution)
     or exists (select 1 from public.brand_licensing_agreement where party_id is not null) then
    raise exception 'Hay cobros, periodos confirmados, liquidaciones del socio, aportaciones o acuerdos enlazados: no se quita nada.';
  end if;
end $$;

drop function if exists public.brand_partner_contribution_misma_cuenta() cascade;
drop table if exists public.brand_partner_contribution;

drop index if exists public.ux_licensed_settlement_local_periodo;
alter table public.licensed_settlement
  drop constraint if exists licensed_settlement_formula_check,
  drop constraint if exists licensed_settlement_status_check,
  drop constraint if exists licensed_settlement_nueva_completa,
  drop constraint if exists licensed_settlement_confirmada_con_quien,
  drop column if exists formula, drop column if exists party_id, drop column if exists status,
  drop column if exists purchases_amount, drop column if exists contributions_amount, drop column if exists brand_sales_base,
  drop column if exists commission_pct, drop column if exists commission_amount, drop column if exists amount,
  drop column if exists detail, drop column if exists updated_at, drop column if exists created_by, drop column if exists created_by_name,
  drop column if exists confirmed_at, drop column if exists confirmed_by, drop column if exists confirmed_by_name;

drop index if exists public.idx_bla_party;
alter table public.brand_licensing_agreement
  drop constraint if exists bla_commission_base_check,
  drop column if exists party_id, drop column if exists commission_base;

drop index if exists public.idx_channel_settlement_party;
alter table public.channel_settlement
  drop constraint if exists channel_settlement_cobro_completo,
  drop constraint if exists channel_settlement_periodo_propuesto,
  drop column if exists party_id, drop column if exists collected_on, drop column if exists collected_amount,
  drop column if exists collection_note, drop column if exists collected_by, drop column if exists collected_by_name,
  drop column if exists proposed_period_from, drop column if exists proposed_period_to, drop column if exists proposed_period_note,
  drop column if exists period_confirmed_at, drop column if exists period_confirmed_by;
