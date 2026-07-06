-- 20260706T1600_social_directive.sql
-- Módulo Social · Pieza 0a — Directivas del humano + palanca de fase
--
-- social_directive: el humano deja su INTENCIÓN y el agente la respeta ANTES de sus reglas
-- R1/R2/R3 (misma filosofía que 'origin' en pedidos: capa que se enchufa delante sin reescribir).
-- Los tres tipos son la misma fila con campos distintos:
--   A empujar  → kind='push'    + brand_id / menu_item_id
--   B contexto → kind='context' + theme (calor/lluvia/generico) [+ caption opcional]
--   C a medida → kind='custom'  + caption / hashtags / photo_url / template
-- Lo que el humano no rellena, lo completa el agente con su maquinaria (foto, voz, margen).
--
-- set_launch_phase: palanca apetito/comunidad/conversion (la llama la app, puerta de admin).
-- claim_pending_directive: el agente consume la directiva pendiente (atómico, service_role).

begin;

create table if not exists public.social_directive (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  kind          text not null check (kind in ('push','context','custom')),
  status        text not null default 'pending' check (status in ('pending','consumed','expired','cancelled')),
  brand_id      uuid references brand(id) on delete set null,
  menu_item_id  uuid references menu_item(id) on delete set null,
  template      text check (template in ('apetito','curiosidad','oferta')),
  theme         text,
  caption       text,
  hashtags      text[],
  photo_url     text,
  anonymous     boolean,
  networks      text[],
  valid_from    timestamptz not null default now(),
  valid_until   timestamptz,
  consumed_at   timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists ix_social_directive_pending
  on public.social_directive (account_id, status, valid_from);

alter table public.social_directive enable row level security;
drop policy if exists social_directive_rw on public.social_directive;
create policy social_directive_rw on public.social_directive for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

create or replace function public.set_launch_phase(p_account_id uuid, p_phase text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'no autorizado';
  end if;
  if p_phase not in ('apetito','comunidad','conversion') then
    raise exception 'fase invalida: %', p_phase;
  end if;
  update social_config set launch_phase = p_phase, updated_by = auth.uid(), updated_at = now()
   where account_id = p_account_id;
  if not found then
    insert into social_config(account_id, launch_phase, updated_by) values (p_account_id, p_phase, auth.uid());
  end if;
end $$;

create or replace function public.claim_pending_directive(p_account_id uuid)
returns public.social_directive
language plpgsql security definer set search_path = public as $$
declare v public.social_directive;
begin
  select * into v from social_directive
   where account_id = p_account_id and status = 'pending'
     and valid_from <= now() and (valid_until is null or valid_until >= now())
   order by created_at
   for update skip locked
   limit 1;
  if v.id is null then return null; end if;
  update social_directive set status = 'consumed', consumed_at = now() where id = v.id;
  return v;
end $$;

revoke all on function public.set_launch_phase(uuid, text)       from public, anon;
grant  execute on function public.set_launch_phase(uuid, text)   to authenticated;
revoke all on function public.claim_pending_directive(uuid)      from public, anon, authenticated;
grant  execute on function public.claim_pending_directive(uuid)  to service_role;

commit;
