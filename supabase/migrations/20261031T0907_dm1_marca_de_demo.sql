-- cambia: public.accounts · prueba: supabase/staging/sql/20261031_dm1_marca_de_demo_prueba.sql
--
-- supabase/migrations/20261031T0907_dm1_marca_de_demo.sql
--
-- DM1 · PR 2a · La marca de demo y la puerta (31/10/2026). SOLO AÑADE.
--
-- Una cuenta de demostración nunca manda nada fuera (encargo DM1, PR 2;
-- respuesta 1, «una sola puerta y una máquina que la vigile»):
--
--   1. accounts.is_demo: la marca. NULL o false, una cuenta de verdad, como
--      todas las de hoy. Solo la pone el superadministrador: las políticas de
--      accounts ya solo le dejan escribir a él (accounts_write_admin), y el
--      disparador de abajo lo cierra también para las funciones que escriben
--      en accounts por su cuenta (security definer).
--   2. cuenta_puede_salir(cuenta): la puerta. Falso para una cuenta de demo;
--      verdadero para todas las demás (y para una cuenta que no existe: no es
--      de demo, y quien llama ya decide qué hacer sin cuenta). La llama cada
--      función del servidor que habla con fuera en nombre de una cuenta
--      (supabase/functions/_shared/puerta.ts), y la prueba
--      tests/unit/demo/puerta.test.ts falla si una no lo hace.
--
-- Hoy ninguna cuenta es de demo: nada cambia para nadie hasta que el
-- superadministrador marque una (PR 2b, Casa Lola).
--
-- Vuelta atrás: supabase/vuelta-atras/20261031T0907_dm1_marca_de_demo.down.sql

alter table public.accounts add column if not exists is_demo boolean;
comment on column public.accounts.is_demo is
  'DM1 (31/10/2026). Cuenta de demostración: no manda nada fuera (cuenta_puede_salir) y se restaura con un botón. Solo la pone el superadministrador.';

create or replace function public.cuenta_puede_salir(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce((select a.is_demo from public.accounts a where a.id = p_account_id), false)
$$;
comment on function public.cuenta_puede_salir(uuid) is
  'DM1 (31/10/2026). La puerta: falso si la cuenta es de demo (no manda nada fuera). La llaman las funciones del servidor que hablan con fuera (_shared/puerta.ts).';
revoke all on function public.cuenta_puede_salir(uuid) from public, anon;
grant execute on function public.cuenta_puede_salir(uuid) to authenticated, service_role;

-- Solo el superadministrador cambia la marca. Sin usuario (service_role, una
-- migración, una tarea programada) se deja: es la plataforma.
create or replace function public._accounts_is_demo_solo_plataforma()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_demo is distinct from (case when tg_op = 'UPDATE' then old.is_demo else null end)
     and auth.uid() is not null and not public.current_user_is_admin() then
    raise exception 'SOLO_PLATAFORMA' using errcode = '42501',
      hint = 'Solo el superadministrador marca una cuenta como demo.';
  end if;
  return new;
end $$;
comment on function public._accounts_is_demo_solo_plataforma() is
  'DM1 (31/10/2026). accounts.is_demo solo lo cambia el superadministrador (o la plataforma, sin usuario).';
revoke all on function public._accounts_is_demo_solo_plataforma() from public, anon, authenticated;

drop trigger if exists accounts_is_demo_solo_plataforma on public.accounts;
create trigger accounts_is_demo_solo_plataforma
  before insert or update of is_demo on public.accounts
  for each row execute function public._accounts_is_demo_solo_plataforma();
