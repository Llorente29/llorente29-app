-- ============================================================================
-- C03 · 3 · LIQUIDACIONES: las de plataforma y las del socio de marca
-- ----------------------------------------------------------------------------
-- Respuesta 1 del C03: lo que ya existe manda.
--
-- A) channel_settlement (Ventas, Capa B) se AMPLÍA, no se duplica:
--    · el tercero de la plataforma (party_id);
--    · el cobro: cuándo llegó y cuánto (collected_on / collected_amount). El
--      estado (pendiente / cobrada / vencida / con diferencia) se calcula en el
--      núcleo con estas dos columnas, el neto y la fecha de la liquidación:
--      nunca se cuadra solo;
--    · el periodo PROPUESTO desde los pedidos que contiene, en columnas aparte
--      (proposed_period_from/to): period_from/to no se tocan hasta que la
--      persona confirma. Así Ventas y el vigía B59, que leen period_*,
--      settlement_date y los importes, leen exactamente lo mismo que antes.
-- B) brand_licensing_agreement apunta a su socio (party_id) y dice la base de
--    la comisión. owner_name se queda hasta que la revisión enlace cada acuerdo
--    a su tercero (en producción hay 0 acuerdos).
-- C) brand_partner_contribution: las aportaciones del socio, por local.
-- D) licensed_settlement se AMPLÍA con la fórmula de Julio, POR LOCAL Y POR
--    PERIODO: compras del local − aportaciones del socio en ese local +
--    comisión sobre las ventas de sus marcas en ese local. Las filas que ya
--    hay (3, de junio, una por local, reales) quedan como «fórmula anterior»
--    sin recalcular: el valor por defecto de la columna nueva las marca al
--    añadirla, sin un solo UPDATE (y marca igual lo que se cargue a la manera
--    de antes).
-- Vuelta atrás: supabase/vuelta-atras/20261009T0120_c03_liquidaciones.down.sql
-- ============================================================================

-- ── A · channel_settlement ──────────────────────────────────────────────────
alter table public.channel_settlement
  add column if not exists party_id              uuid references public.party(id) on delete set null,
  add column if not exists collected_on          date,
  add column if not exists collected_amount      numeric,
  add column if not exists collection_note       text,
  add column if not exists collected_by          uuid,
  add column if not exists collected_by_name     text,
  add column if not exists proposed_period_from  date,
  add column if not exists proposed_period_to    date,
  add column if not exists proposed_period_note  text,
  add column if not exists period_confirmed_at   timestamptz,
  add column if not exists period_confirmed_by   uuid;
alter table public.channel_settlement
  drop constraint if exists channel_settlement_cobro_completo,
  add constraint channel_settlement_cobro_completo check ((collected_on is null) = (collected_amount is null)),
  drop constraint if exists channel_settlement_periodo_propuesto,
  add constraint channel_settlement_periodo_propuesto check (
    (proposed_period_from is null) = (proposed_period_to is null)
    and (proposed_period_from is null or proposed_period_to >= proposed_period_from));
comment on column public.channel_settlement.party_id is 'C03. El tercero de la plataforma (party_role platform del mismo canal).';
comment on column public.channel_settlement.collected_amount is 'C03. Lo que llegó al banco. Si no es el neto, la liquidación está «con diferencia» y la ficha dice la cifra; nunca se cuadra sola.';
comment on column public.channel_settlement.proposed_period_from is 'C03. Periodo propuesto desde los pedidos que contiene (primero y último), «por confirmar». period_from/to no se tocan hasta confirmar.';
create index if not exists idx_channel_settlement_party on public.channel_settlement (party_id) where party_id is not null;

-- ── B · brand_licensing_agreement: el socio, un tercero ─────────────────────
alter table public.brand_licensing_agreement
  add column if not exists party_id        uuid references public.party(id) on delete restrict,
  add column if not exists commission_base text not null default 'brand_sales';
alter table public.brand_licensing_agreement
  drop constraint if exists bla_commission_base_check,
  add constraint bla_commission_base_check check (commission_base in ('brand_sales'));
comment on column public.brand_licensing_agreement.party_id is 'C03. El socio de marca (party con papel brand_partner). Sustituye a owner_name cuando la revisión lo enlaza.';
comment on column public.brand_licensing_agreement.commission_base is 'C03. Sobre qué se calcula revenue_share_pct: brand_sales = ventas sin IVA de sus marcas en el local y el periodo.';
create index if not exists idx_bla_party on public.brand_licensing_agreement (party_id) where party_id is not null;

-- ── C · brand_partner_contribution: lo que aporta el socio, por local ───────
create table if not exists public.brand_partner_contribution (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  party_id        uuid not null references public.party(id) on delete restrict,
  location_id     uuid not null references public.locations(id),
  contributed_on  date not null,
  kind            text not null check (kind in ('marketing', 'packaging', 'other')),
  amount          numeric(12, 2) not null check (amount > 0),
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text
);
comment on table public.brand_partner_contribution is
  'C03. Aportaciones del socio de marca (marketing, packaging, otras), por local. Restan en su liquidación del periodo.';
create index if not exists idx_bpc_party_periodo on public.brand_partner_contribution (party_id, location_id, contributed_on);

-- ── D · licensed_settlement: la fórmula de Julio, por local y periodo ───────
alter table public.licensed_settlement
  add column if not exists formula              text not null default 'anterior',
  add column if not exists party_id             uuid references public.party(id) on delete restrict,
  add column if not exists status               text,
  add column if not exists purchases_amount     numeric(12, 2),
  add column if not exists contributions_amount numeric(12, 2),
  add column if not exists brand_sales_base     numeric(12, 2),
  add column if not exists commission_pct       numeric(5, 2),
  add column if not exists commission_amount    numeric(12, 2),
  add column if not exists amount               numeric(12, 2),
  add column if not exists detail               jsonb,
  add column if not exists updated_at           timestamptz,
  add column if not exists created_by           uuid,
  add column if not exists created_by_name      text,
  add column if not exists confirmed_at         timestamptz,
  add column if not exists confirmed_by         uuid,
  add column if not exists confirmed_by_name    text;
-- El valor por defecto se QUEDA en 'anterior': quien escriba a la manera de
-- antes (la carga de CTB de junio no dice fórmula) sigue funcionando y su fila
-- queda marcada como lo que es. Solo las funciones del C03 escriben la nueva.
-- (Quitarlo rompía ese camino: lo cazó la prueba de staging, 06/10.)
alter table public.licensed_settlement alter column formula set default 'anterior';
alter table public.licensed_settlement
  drop constraint if exists licensed_settlement_formula_check,
  add constraint licensed_settlement_formula_check check (formula in ('anterior', 'compras_aportaciones_comision')),
  drop constraint if exists licensed_settlement_status_check,
  add constraint licensed_settlement_status_check check (status is null or status in ('borrador', 'confirmada', 'saldada')),
  drop constraint if exists licensed_settlement_nueva_completa,
  add constraint licensed_settlement_nueva_completa check (
    formula = 'anterior'
    or (party_id is not null and location_id is not null and status is not null
        and purchases_amount is not null and contributions_amount is not null and brand_sales_base is not null
        and commission_pct is not null and commission_amount is not null and amount is not null)),
  drop constraint if exists licensed_settlement_confirmada_con_quien,
  add constraint licensed_settlement_confirmada_con_quien check (status is null or status = 'borrador' or confirmed_at is not null);
comment on column public.licensed_settlement.formula is
  'C03. anterior = las de junio de 2026 (ingresos por servicio − materiales − …), conservadas sin recalcular. compras_aportaciones_comision = la de Julio, por local y periodo.';
comment on column public.licensed_settlement.amount is
  'C03. compras − aportaciones + comisión. Positivo: a favor del socio (se le paga); negativo: a tu favor.';
comment on column public.licensed_settlement.detail is 'C03. De dónde sale cada línea: albaranes, aportaciones y ventas por marca, con sus ids.';
create unique index if not exists ux_licensed_settlement_local_periodo
  on public.licensed_settlement (party_id, location_id, period_from, period_to)
  where formula = 'compras_aportaciones_comision';

-- ── RLS de lo nuevo (lo ampliado conserva la suya) ──────────────────────────
alter table public.brand_partner_contribution enable row level security;
drop policy if exists brand_partner_contribution_select on public.brand_partner_contribution;
create policy brand_partner_contribution_select on public.brand_partner_contribution for select using (belongs_to_account(account_id));
drop policy if exists brand_partner_contribution_insert on public.brand_partner_contribution;
create policy brand_partner_contribution_insert on public.brand_partner_contribution for insert with check (current_user_is_admin_or_manager_of(account_id));
drop policy if exists brand_partner_contribution_update on public.brand_partner_contribution;
create policy brand_partner_contribution_update on public.brand_partner_contribution for update using (current_user_is_admin_or_manager_of(account_id));
drop policy if exists brand_partner_contribution_delete on public.brand_partner_contribution;
create policy brand_partner_contribution_delete on public.brand_partner_contribution for delete using (current_user_is_admin_or_manager_of(account_id));
revoke all on table public.brand_partner_contribution from anon;

-- Las aportaciones, del socio y del local de la misma cuenta.
create or replace function public.brand_partner_contribution_misma_cuenta()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from party_role r where r.party_id = new.party_id and r.account_id = new.account_id and r.role = 'brand_partner') then
    raise exception 'Esas aportaciones no son de un socio de marca de esta cuenta.' using errcode = '23514';
  end if;
  if not exists (select 1 from locations l where l.id = new.location_id and l.account_id = new.account_id) then
    raise exception 'Ese local no es de esta cuenta.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.brand_partner_contribution_misma_cuenta() from public, anon, authenticated;
drop trigger if exists trg_bpc_misma_cuenta on public.brand_partner_contribution;
create trigger trg_bpc_misma_cuenta before insert or update on public.brand_partner_contribution
  for each row execute function public.brand_partner_contribution_misma_cuenta();
