-- supabase/migrations/20261121T0130_s01_ejes_analiticos.sql
--
-- S01 · La analítica de cada empresa (inventario del paso 1, §4.2, aprobado por
-- Julio): Contabilidad › Definiciones › Analítica. SOLO AÑADE: una tabla nueva,
-- sus políticas y sus filas de hoy. No toca ninguna fila ni función que exista.
--
--   1. conta_eje_analitico: una fila por empresa y eje. Los ejes son las dos
--      columnas que ya existen en journal_line (location_id → «local»,
--      brand_id → «marca»). Cada eje se enciende o se apaga y se llama como la
--      empresa quiera («Local», «Proyecto», «Centro de coste»…).
--      SIN FILA = APAGADO. Apagado, el eje ni se pide ni se enseña, pero lo
--      guardado se queda: no se borra ningún dato ni ninguna columna.
--   2. RLS por cuenta, como el resto de contabilidad: lee quien es de la
--      cuenta; enciende, apaga y renombra el administrador o el gestor. No se
--      borran filas (apagar es activo = false). La empresa tiene que ser de esa
--      cuenta (regla 9).
--   3. Las empresas de hoy: «Local» encendido si su cuenta tiene locales y
--      «Marca» si tiene marcas. Medido el 17/10 en producción (por cuenta): una
--      sola cuenta con empresa, Foodint, con 3 locales y 18 marcas (345 apuntes
--      con local y 203 con marca): las dos encendidas.
--
-- Va antes que la 0140, que hace que la regla 5 de la validación solo pida el
-- local si el eje «local» está encendido.
-- Vuelta atrás: supabase/vuelta-atras/20261121T0130_s01_ejes_analiticos.down.sql.
-- Prueba (rollback): supabase/staging/sql/20261121_s01_analitica_prueba.sql.

create table if not exists public.conta_eje_analitico (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  company_id    uuid not null references public.company(id) on delete cascade,
  eje           text not null check (eje in ('local', 'marca')),
  activo        boolean not null default true,
  nombre        text not null check (length(btrim(nombre)) between 1 and 40),
  nombre_plural text check (nombre_plural is null or length(btrim(nombre_plural)) between 1 and 40),
  posicion      int not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (company_id, eje)
);
comment on table public.conta_eje_analitico is
  'S01 (17/10): los ejes de analítica de cada empresa (local → journal_line.location_id, marca → journal_line.brand_id). Sin fila = apagado: ni se pide ni se enseña, pero lo guardado se queda.';
create index if not exists conta_eje_analitico_cuenta on public.conta_eje_analitico (account_id);

alter table public.conta_eje_analitico enable row level security;
drop policy if exists conta_eje_analitico_select on public.conta_eje_analitico;
create policy conta_eje_analitico_select on public.conta_eje_analitico for select to authenticated
  using ((select public.belongs_to_account(account_id)));
drop policy if exists conta_eje_analitico_insert on public.conta_eje_analitico;
create policy conta_eje_analitico_insert on public.conta_eje_analitico for insert to authenticated
  with check (public.current_user_is_admin_or_manager_of(account_id)
              and exists (select 1 from public.company c where c.id = company_id and c.account_id = conta_eje_analitico.account_id));
drop policy if exists conta_eje_analitico_update on public.conta_eje_analitico;
create policy conta_eje_analitico_update on public.conta_eje_analitico for update to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id))
  with check (public.current_user_is_admin_or_manager_of(account_id)
              and exists (select 1 from public.company c where c.id = company_id and c.account_id = conta_eje_analitico.account_id));
grant select, insert, update on public.conta_eje_analitico to authenticated;

-- Al día: quién y cuándo lo cambió (lo enseña la pantalla).
create or replace function public.conta_eje_analitico_al_dia()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_conta_eje_analitico_al_dia on public.conta_eje_analitico;
create trigger trg_conta_eje_analitico_al_dia before insert or update on public.conta_eje_analitico
  for each row execute function public.conta_eje_analitico_al_dia();

-- Las empresas de hoy, por lo que tiene su cuenta (regla 9: por account_id).
insert into public.conta_eje_analitico (account_id, company_id, eje, activo, nombre, nombre_plural, posicion)
select c.account_id, c.id, 'local', true, 'Local', 'Locales', 1
  from public.company c
 where exists (select 1 from public.locations l where l.account_id = c.account_id)
on conflict (company_id, eje) do nothing;
insert into public.conta_eje_analitico (account_id, company_id, eje, activo, nombre, nombre_plural, posicion)
select c.account_id, c.id, 'marca', true, 'Marca', 'Marcas', 2
  from public.company c
 where exists (select 1 from public.brand b where b.account_id = c.account_id)
on conflict (company_id, eje) do nothing;
