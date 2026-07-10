-- 20260709T2010_seed_staff_roles.sql
-- Semilla estándar de roles/áreas (idempotente) + trigger al crear cuenta +
-- backfill de cuentas existentes. Calcado de seed_ingredient_families_for_account.
-- SECURITY DEFINER: NO probar en el SQL Editor; se ejecuta desde el trigger/backfill.

begin;

create or replace function public.seed_staff_roles_for_account(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_role (account_id, name, color, kind, sort) values
    (p_account, 'Sala',      'blue',     'servicio', 1),
    (p_account, 'Cocina',    'coral',    'cocina',   2),
    (p_account, 'Barra',     'amber',    'servicio', 3),
    (p_account, 'Reparto',   'teal',     'reparto',  4),
    (p_account, 'Office',    'gray',     'otro',     5),
    (p_account, 'Recepción', 'purple',   'servicio', 6)
  on conflict (account_id, lower(name)) do nothing;
end;
$$;

create or replace function public.tg_seed_staff_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_staff_roles_for_account(new.id);
  return new;
end;
$$;

drop trigger if exists seed_staff_roles_after_insert_accounts on public.accounts;
create trigger seed_staff_roles_after_insert_accounts
  after insert on public.accounts
  for each row execute function public.tg_seed_staff_roles();

-- Backfill de las cuentas que ya existen.
do $$
declare a record;
begin
  for a in select id from public.accounts loop
    perform public.seed_staff_roles_for_account(a.id);
  end loop;
end $$;

commit;
