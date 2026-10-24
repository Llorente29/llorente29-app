-- N3 · El maestro «local → empresa» (cola de noche del 23/10, paso 4 de la auditoría C09).
--
-- POR QUÉ: ninguna tabla dice a qué empresa pertenece un local. Hoy funciona
-- porque en producción hay 1 empresa en 1 cuenta (medido el 24/10: 1 empresa,
-- 1 cuenta con empresa, 8 locales en total). Con una cuenta de dos empresas
-- —ya las hay en staging: la cuenta A tiene dos— Sumied no sabe a qué
-- empresa van las ventas, las recepciones o las nóminas de un local.
--
-- QUÉ AÑADE (solo añade: no toca ninguna tabla ni función que exista):
--   · public.location_company: un local, una empresa, de la misma cuenta.
--     Lo escribe solo el servidor (nadie desde la API); se lee con RLS por cuenta.
--   · location_company_misma_cuenta: el disparador que para un local y una
--     empresa de cuentas distintas (o un account_id que no es el de los dos).
--   · public.empresa_del_local(local): la empresa de un local, o NULL si no
--     tiene. Con RLS del que pregunta: no devuelve la de otra cuenta.
--   · Y lo que ya se sabe sin adivinar: el local de una cuenta con UNA sola
--     empresa es de esa empresa (source 'unica_empresa'). Una cuenta con dos o
--     más empresas se queda sin filas: eso se decide a mano, no se adivina.
--
-- Se puede pasar dos veces seguidas (if not exists, create or replace, on
-- conflict do nothing). Sin Foodint ni ningún id de producción dentro.
-- Prueba: supabase/staging/sql/20261024_n3_local_empresa_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261024T0630_n3_local_empresa.down.sql

create table if not exists public.location_company (
  location_id uuid primary key references public.locations(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete restrict,
  account_id  uuid not null,
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  constraint location_company_source check (source in ('unica_empresa', 'alta', 'manual'))
);
create index if not exists location_company_company_idx on public.location_company (company_id);
create index if not exists location_company_account_idx on public.location_company (account_id);

comment on table public.location_company is
  'N3 (24/10). A qué empresa pertenece cada local: uno por local, de la misma cuenta. source: unica_empresa (la cuenta tiene una sola empresa), alta (al crear el local), manual.';

create or replace function public.location_company_misma_cuenta()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare v_loc uuid; v_emp uuid;
begin
  select l.account_id into v_loc from public.locations l where l.id = new.location_id;
  select c.account_id into v_emp from public.company c where c.id = new.company_id;
  if v_loc is distinct from new.account_id or v_emp is distinct from new.account_id then
    raise exception 'El local y la empresa tienen que ser de la misma cuenta (local %, empresa %, fila %).', v_loc, v_emp, new.account_id
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists location_company_misma_cuenta on public.location_company;
create trigger location_company_misma_cuenta
  before insert or update on public.location_company
  for each row execute function public.location_company_misma_cuenta();

alter table public.location_company enable row level security;
drop policy if exists location_company_read on public.location_company;
create policy location_company_read on public.location_company for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.location_company from anon, authenticated;
grant select on public.location_company to authenticated;

create or replace function public.empresa_del_local(p_location uuid)
 returns uuid
 language sql
 stable
 set search_path to 'public'
as $function$
  select lc.company_id from public.location_company lc where lc.location_id = p_location
$function$;

comment on function public.empresa_del_local(uuid) is
  'N3 (24/10). La empresa de un local, o NULL si no tiene. Con el RLS del que pregunta: no ve la de otra cuenta.';
revoke execute on function public.empresa_del_local(uuid) from public, anon;
grant execute on function public.empresa_del_local(uuid) to authenticated;

-- Lo que se sabe sin adivinar: cuenta con una sola empresa → sus locales son de esa empresa.
insert into public.location_company (location_id, company_id, account_id, source)
select l.id, u.company_id, l.account_id, 'unica_empresa'
  from public.locations l
  join (select c.account_id, (array_agg(c.id))[1] as company_id
          from public.company c group by c.account_id having count(*) = 1) u
    on u.account_id = l.account_id
on conflict (location_id) do nothing;
