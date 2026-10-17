-- supabase/migrations/20261121T0100_s01_esqueleto.sql
--
-- S01 · El esqueleto de contabilidad: lo que guarda de cada persona y lo que
-- decide qué sale en cada empresa. SOLO AÑADE (una tabla nueva y una columna
-- que admite nulos): no toca ninguna fila ni ninguna función que exista.
--
--   1. conta_user_pref: una fila por cuenta y usuario con lo que cada persona
--      deja a su gusto: el NIVEL (sin experiencia · medio · experto: cambia
--      palabras, ayuda y lo que se ofrece de serie; nunca dónde está cada
--      cosa), los FAVORITOS (ids del catálogo de órdenes del front, en el
--      orden en que se fijaron), la cinta oculta, la densidad, la barra
--      desplegada y el documento oculto. Antes (M01) vivía en el navegador; en
--      la base le sigue a la persona de un ordenador a otro.
--      Por qué una tabla y no columnas en user_profiles: user_profiles es de
--      toda Folvy (rol, empleado, bienvenida); lo de contabilidad va aparte.
--      RLS: cada uno lee y escribe SOLO su fila, de una cuenta suya.
--   2. company.is_hospitality: la marca EXPLÍCITA de hostelería de cada empresa
--      (Julio, 17/10: «los datos pueden generar dudas»; los datos solo
--      sugieren). Con ella sale lo que solo tiene sentido en hostelería
--      (Liquidaciones, plataformas, socios de marca). Nula = sin decir: el
--      front lo trata como «no». Se pone en el alta por la actividad y se
--      cambia en Ajustes (paso 3 del S01); las de hoy, en la 0110.
--
-- Nada de esto está en el camino del pedido: ni pg_cron, ni disparadores de
-- sale ni de pedidos lo leen. `alter table company add column` nula y sin
-- valor por defecto no reescribe la tabla (un instante de cierre exclusivo,
-- como cualquier columna nueva).
-- Vuelta atrás: supabase/vuelta-atras/20261121T0100_s01_esqueleto.down.sql

-- 1 ----------------------------------------------------------------------------------
create table if not exists public.conta_user_pref (
  account_id        uuid not null references public.accounts(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  nivel             text not null default 'medio' check (nivel in ('sin_experiencia', 'medio', 'experto')),
  favoritos         jsonb not null default '[]'::jsonb check (jsonb_typeof(favoritos) = 'array'),
  cinta_oculta      boolean not null default false,
  densidad          text not null default 'compacta' check (densidad in ('compacta', 'comoda')),
  barra_desplegada  boolean not null default true,
  documento_oculto  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (account_id, user_id)
);
comment on table public.conta_user_pref is
  'S01 (17/10): lo que cada persona deja a su gusto en contabilidad: nivel, favoritos (ids del catálogo de órdenes del front), cinta oculta, densidad, barra y documento. Una fila por cuenta y usuario; cada uno solo la suya.';
comment on column public.conta_user_pref.nivel is
  'sin_experiencia · medio · experto. Cambia palabras, ayuda y lo que se ofrece de serie; nunca dónde está cada cosa ni lo que se puede hacer.';
comment on column public.conta_user_pref.favoritos is
  'Lista de ids del catálogo de órdenes del front (src/modules/conta/esqueleto/ordenes.ts), en el orden en que se fijaron. No son direcciones.';

-- El updated_at, al día en cada cambio.
create or replace function public.conta_user_pref_al_dia() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_conta_user_pref_al_dia on public.conta_user_pref;
create trigger trg_conta_user_pref_al_dia before update on public.conta_user_pref
  for each row execute function public.conta_user_pref_al_dia();

alter table public.conta_user_pref enable row level security;
drop policy if exists conta_user_pref_select on public.conta_user_pref;
create policy conta_user_pref_select on public.conta_user_pref for select to authenticated
  using (user_id = (select auth.uid()) and account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_user_pref_insert on public.conta_user_pref;
create policy conta_user_pref_insert on public.conta_user_pref for insert to authenticated
  with check (user_id = (select auth.uid()) and account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_user_pref_update on public.conta_user_pref;
create policy conta_user_pref_update on public.conta_user_pref for update to authenticated
  using (user_id = (select auth.uid()) and account_id = any ((select public.current_user_account_ids())::uuid[]))
  with check (user_id = (select auth.uid()) and account_id = any ((select public.current_user_account_ids())::uuid[]));
-- Sin política de borrar: una preferencia no se borra, se cambia.
revoke all on table public.conta_user_pref from anon;
grant select, insert, update on table public.conta_user_pref to authenticated;

-- 2 ----------------------------------------------------------------------------------
alter table public.company add column if not exists is_hospitality boolean;
comment on column public.company.is_hospitality is
  'S01 (17/10): la empresa es de hostelería (marca explícita; los datos solo sugieren). Con ella salen Liquidaciones, plataformas y socios de marca. Nula = sin decir, se trata como no.';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  grant select on table public.conta_user_pref to conta_lectura;
end $$;
