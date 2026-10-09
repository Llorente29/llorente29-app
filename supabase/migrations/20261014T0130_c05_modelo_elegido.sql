-- ============================================================================
-- C05 · Libros y balances — 4 · EL MODELO QUE ELIGE CADA EMPRESA (regla 4)
-- ----------------------------------------------------------------------------
-- Folvy PROPONE el modelo (normal, abreviado o pymes) con los límites de la
-- LSC (arts. 257.1 y 258.1) y del RD 1515/2007 art. 2.1 (vigente: los mismos
-- que el 257). La empresa puede elegir uno MÁS completo, nunca uno que no le
-- corresponda: eso lo comprueba el núcleo (src/modules/conta/lib/
-- cuentasAnuales.ts, puedeElegir) antes de guardar, y aquí queda quién eligió
-- qué, cuándo y con qué cifras.
-- Todo nuevo; nada en el camino del pedido. Solo añade.
-- Vuelta atrás: supabase/vuelta-atras/20261014T0130_c05_modelo_elegido.down.sql
-- ============================================================================

create table if not exists public.annual_accounts_choice (
  fiscal_year_id   uuid primary key references public.fiscal_year(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete restrict,
  model            text not null check (model in ('normal', 'abreviado', 'pymes')),
  proposed_model   text not null check (proposed_model in ('normal', 'abreviado', 'pymes')),
  -- Las cifras con las que se propuso (activo, cifra de negocios, plantilla media, y las del anterior).
  figures          jsonb not null default '{}' check (jsonb_typeof(figures) = 'object'),
  reason           text,
  chosen_at        timestamptz not null default now(),
  chosen_by        uuid,
  chosen_by_name   text
);
comment on table public.annual_accounts_choice is
  'C05 · regla 4. El modelo de cuentas anuales de cada ejercicio: el que propuso Folvy por los límites (LSC 257.1 y 258.1; RD 1515/2007 art. 2.1) y el elegido, que puede ser más completo, nunca menos.';

alter table public.annual_accounts_choice enable row level security;
drop policy if exists annual_accounts_choice_select on public.annual_accounts_choice;
create policy annual_accounts_choice_select on public.annual_accounts_choice for select to authenticated using (belongs_to_account(account_id));
drop policy if exists annual_accounts_choice_insert on public.annual_accounts_choice;
create policy annual_accounts_choice_insert on public.annual_accounts_choice for insert to authenticated with check (current_user_is_admin_or_manager_of(account_id));
drop policy if exists annual_accounts_choice_update on public.annual_accounts_choice;
create policy annual_accounts_choice_update on public.annual_accounts_choice for update to authenticated using (current_user_is_admin_or_manager_of(account_id));
revoke all on table public.annual_accounts_choice from anon;

drop trigger if exists trg_annual_accounts_choice_misma_cuenta on public.annual_accounts_choice;
create trigger trg_annual_accounts_choice_misma_cuenta before insert or update on public.annual_accounts_choice
  for each row execute function public.conta_misma_cuenta();
