-- supabase/migrations/20261112T0938_g06_enlace_gocardless.sql
--
-- G06 · Tarea 2 · El enlace entre un cliente de GoCardless y su ficha, en UN sitio (Julio, nº 140).
--
-- Hoy vive en dos y no coinciden (el 12/11 en QBO, 108 clientes de GoCardless con cobro activo atados en uno
-- y no en el otro, y 15 atados a fichas distintas):
--   · conta_gc_cliente.party_id (y casado_por), que la lectura reescribe entera en cada pasada;
--   · conta_cobro_cliente.gc_cliente_id (y gc_casado_por), una fila por ficha que nunca se borra.
-- La causa: la lectura de GoCardless leía las fichas sin paginar y solo veía 1.000 de las 1.536 de QBO (se
-- arregla en conta-gocardless-leer, en este mismo PR).
--
-- AÑADE, sin tocar nada de lo que existe:
--   1 · conta_gc_enlace: un cliente de GoCardless (de una empresa emisora), su ficha, por qué está atado (nif,
--       correo, nombre o persona), en qué estado (atado, propuesto o conflicto) y, si lo hizo una persona, quién
--       y cuándo. Lo de una persona manda sobre lo automático: la lectura no lo pisa.
--   2 · conta_gc_enlace_elegido: el cliente de GoCardless de cada ficha y empresa, uno solo, con la regla de hoy
--       (plan.ts, «elegido»): primero el de una persona, después el de más mandatos vivos, después el de más
--       suscripciones activas y, si empatan, el de id menor. Es lo que leerán el cobro y el portal.
--   3 · El relleno, con lo que hay hoy, por este orden: lo enlazado a mano (conta_gestoria_decision, tipo
--       enlace, el más reciente), conta_gc_cliente.party_id y conta_cobro_cliente.gc_cliente_id. Si los dos
--       enlaces de ahora dicen fichas distintas, queda como «conflicto» con las dos candidatas, para que lo
--       decida una persona (Julio, nº 140): no se elige a ciegas.
--
-- Los dos enlaces de ahora se siguen escribiendo igual (cautela del nº 140): nadie deja de leerlos hasta que
-- todos los que leen hayan cambiado, y quitarlos va en otra tanda.
-- No toca recibos, cobros ni facturas. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261112T0938_g06_enlace_gocardless.down.sql

create table if not exists public.conta_gc_enlace (
  company_id     uuid not null references public.company(id) on delete cascade,
  gc_cliente_id  text not null,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  party_id       uuid references public.party(id) on delete cascade,
  por            text not null check (por in ('nif', 'correo', 'nombre', 'persona')),
  estado         text not null default 'atado' check (estado in ('atado', 'propuesto', 'conflicto')),
  candidatas     uuid[] not null default '{}',
  porque         text,
  quien          uuid,
  quien_name     text,
  decidido_at    timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (company_id, gc_cliente_id),
  constraint conta_gc_enlace_atado_con_ficha check (estado <> 'atado' or party_id is not null)
);
comment on table public.conta_gc_enlace is
  'G06 · El sitio único del enlace: qué ficha (party) es cada cliente de GoCardless de una empresa emisora, por qué (nif, correo, nombre o persona) y en qué estado (atado, propuesto, conflicto). Lo de una persona manda sobre lo automático.';
create index if not exists conta_gc_enlace_party_idx on public.conta_gc_enlace (account_id, party_id);
create index if not exists conta_gc_enlace_estado_idx on public.conta_gc_enlace (account_id, estado) where estado <> 'atado';

alter table public.conta_gc_enlace enable row level security;
revoke all on table public.conta_gc_enlace from public, anon, authenticated;
grant select on table public.conta_gc_enlace to authenticated;
drop policy if exists conta_gc_enlace_leer on public.conta_gc_enlace;
create policy conta_gc_enlace_leer on public.conta_gc_enlace for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_gc_enlace to conta_lectura; end if;
end $$;

-- El elegido de cada ficha y empresa (uno solo), con la regla de plan.ts. security_invoker: lee con la RLS de quien pregunta.
create or replace view public.conta_gc_enlace_elegido with (security_invoker = true) as
select distinct on (e.company_id, e.party_id)
       e.account_id, e.company_id, e.party_id, e.gc_cliente_id, e.por
  from public.conta_gc_enlace e
  left join public.conta_gc_cliente g on g.company_id = e.company_id and g.gc_id = e.gc_cliente_id
 where e.estado = 'atado'
 order by e.company_id, e.party_id, (e.por = 'persona') desc, coalesce(g.mandatos_vivos, 0) desc, coalesce(g.suscripciones_activas, 0) desc, e.gc_cliente_id;
comment on view public.conta_gc_enlace_elegido is
  'G06 · El cliente de GoCardless de cada ficha y empresa, uno solo: el de una persona; si no, el de más mandatos vivos, más suscripciones activas y, si empatan, el de id menor (la regla de conta-gocardless-leer/plan.ts).';
revoke all on public.conta_gc_enlace_elegido from public, anon, authenticated;
grant select on public.conta_gc_enlace_elegido to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on public.conta_gc_enlace_elegido to conta_lectura; end if;
end $$;

-- El relleno, con lo de hoy. Solo escribe en la tabla nueva.
insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, quien, quien_name, decidido_at)
with
  -- 1 · Lo enlazado a mano en la ficha (el más reciente de cada cliente de GoCardless).
  mano as (
    select distinct on (d.company_id, d.gc_cliente_id) d.company_id, d.gc_cliente_id, d.account_id, d.party_id, d.quien, d.quien_name, d.cuando
      from public.conta_gestoria_decision d
     where d.tipo = 'enlace' and d.gc_cliente_id is not null and d.party_id is not null
     order by d.company_id, d.gc_cliente_id, d.cuando desc),
  -- 2 · Lo que dicen los dos enlaces de ahora, cliente a cliente.
  dicen as (
    select g.company_id, g.gc_id gc_cliente_id, g.account_id, g.party_id, g.casado_por por from public.conta_gc_cliente g where g.party_id is not null
    union
    select c.company_id, c.gc_cliente_id, c.account_id, c.party_id, c.gc_casado_por from public.conta_cobro_cliente c where c.gc_cliente_id is not null),
  juntos as (
    select company_id, gc_cliente_id, min(account_id::text)::uuid account_id,
           array_agg(distinct party_id order by party_id) fichas,
           bool_or(por = 'persona') persona, bool_or(por = 'nif') nif
      from dicen group by company_id, gc_cliente_id)
select coalesce(m.company_id, j.company_id), coalesce(m.gc_cliente_id, j.gc_cliente_id), coalesce(m.account_id, j.account_id),
       case when m.party_id is not null then m.party_id when cardinality(j.fichas) = 1 then j.fichas[1] end,
       case when m.party_id is not null or j.persona then 'persona' when j.nif then 'nif' else 'correo' end,
       case when m.party_id is not null or cardinality(j.fichas) = 1 then 'atado' else 'conflicto' end,
       case when m.party_id is null and cardinality(j.fichas) > 1 then j.fichas else '{}'::uuid[] end,
       case when m.party_id is null and cardinality(j.fichas) > 1
            then 'Los dos enlaces de antes del G06 decían fichas distintas: lo decide una persona.' end,
       m.quien, m.quien_name, m.cuando
  from juntos j
  full join mano m on m.company_id = j.company_id and m.gc_cliente_id = j.gc_cliente_id
on conflict (company_id, gc_cliente_id) do nothing;
