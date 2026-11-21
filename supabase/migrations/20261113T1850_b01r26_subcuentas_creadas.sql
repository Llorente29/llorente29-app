-- supabase/migrations/20261113T1850_b01r26_subcuentas_creadas.sql
--
-- B01r·26 (13/11) · LAS SUBCUENTAS QUE SUMIED CREA EN DIEZ ANTES DEL TRASPASO.
-- Lo decidido por Julio el 24/10 (docs/conta/c12/traspaso-completo.md): antes de
-- preparar los dos Excel del mes, Sumied comprueba que todas las subcuentas que
-- usan existen en Diez; si falta alguna, no se genera nada y la pantalla ofrece
-- «Crearlas en Diez», con el nombre que tienen en Sumied y solo cuando un
-- administrador lo confirma. Aquí queda quién y cuándo, y en qué base.
--
-- SOLO AÑADE: una tabla (la escribe solo el servidor, conta-diez-traspaso; la
-- leen los de la cuenta). Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261113T1850_b01r26_subcuentas_creadas.down.sql

create table if not exists public.conta_diez_subcuenta_creada (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  traspaso_id uuid not null references public.conta_diez_traspaso(id) on delete restrict,
  base text not null check (base ~ '^C\d{4}$' and base <> 'C0001'),
  codigo text not null check (codigo ~ '^\d{6,12}$'),
  nombre text not null check (btrim(nombre) <> ''),
  creada_por uuid,
  creada_por_nombre text,
  creada_en timestamptz not null default now(),
  unique (company_id, base, codigo)
);
comment on table public.conta_diez_subcuenta_creada is
  'B01r26 · Cada subcuenta que Sumied creó en Diez antes de un traspaso, con «Crearlas en Diez» (un administrador lo confirma): en qué base, con qué nombre, quién y cuándo.';
alter table public.conta_diez_subcuenta_creada enable row level security;
drop policy if exists conta_diez_subcuenta_creada_leer on public.conta_diez_subcuenta_creada;
create policy conta_diez_subcuenta_creada_leer on public.conta_diez_subcuenta_creada for select using (public.belongs_to_account(account_id));
revoke all on table public.conta_diez_subcuenta_creada from public, anon, authenticated;
grant select on table public.conta_diez_subcuenta_creada to authenticated;
grant all on table public.conta_diez_subcuenta_creada to service_role;
