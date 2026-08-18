-- ============================================================================
-- ENCARGO CODE "Cimientos del gestor de precios" (18/08/2026) — BLOQUE B
-- Declaracion de ruta de publicacion por (local, canal) — deuda B12.
-- ============================================================================
-- 100% ADITIVO. Tabla nueva. NADIE la consume todavia: se siembra ahora para que
-- el gestor de precios LEA la ruta en vez de deducirla de las ventas, y para que
-- el dia que Janaina active un bridge se cambie UNA FILA en vez de descubrirlo
-- semanas despues mirando por donde entraron los pedidos.
--
-- Hoy la unica forma de saber por donde se publica un canal de un local es mirar
-- las ventas del ultimo mes. Eso no es una fuente de verdad: es arqueologia.

-- (apply_migration envuelve en transaccion; sin BEGIN/COMMIT explicito)

-- ── B.1 · La tabla ──────────────────────────────────────────────────────────
create table if not exists public.channel_publish_route (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id),
  location_id      uuid not null references public.locations(id),
  channel_id       uuid not null references public.sales_channel(id),
  route            text not null check (route in ('lastapp','hubrise','none')),
  ownership_scope  text not null default 'own' check (ownership_scope in ('own','licensed')),
  effective_from   date not null,
  notes            text,
  updated_at       timestamptz not null default now(),
  unique (location_id, channel_id, ownership_scope, effective_from)
);

comment on table public.channel_publish_route is
  'Por donde se publica cada canal de cada local (deuda B12). Declarativa: nadie la consume todavia (18/08). Se cambia a mano cuando se activa o se apaga un bridge.';
comment on column public.channel_publish_route.effective_from is
  'Fecha de corte de la ruta. CENTINELA 2000-01-01 = "sin corte conocido, la ruta es la de siempre" (ver notes de esas filas).';
comment on column public.channel_publish_route.ownership_scope is
  'De momento solo marcas propias. Las licenciadas iran cuando se decida su ruta.';

alter table public.channel_publish_route enable row level security;

drop policy if exists channel_publish_route_read on public.channel_publish_route;
create policy channel_publish_route_read
  on public.channel_publish_route
  for select
  using (account_id = any (current_user_account_ids()));

drop policy if exists channel_publish_route_write on public.channel_publish_route;
create policy channel_publish_route_write
  on public.channel_publish_route
  for all
  using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));

revoke all on public.channel_publish_route from anon;
grant select, insert, update, delete on public.channel_publish_route to authenticated;
grant select, insert, update, delete on public.channel_publish_route to service_role;

-- ── B.2 · Siembra ───────────────────────────────────────────────────────────
-- Verificado contra las ventas de los ultimos 30 dias de marcas PROPIAS.
--
-- TRAMPA DE NOMBRES: "Foodint Alcala" y "Foodint Carabanchel" existen en las DOS
-- cuentas -- Foodint (produccion) y Folvy Interno (laboratorio). Resolver el
-- local solo por nombre insertaria 12 filas, seis de ellas en el laboratorio.
-- Por eso la cuenta va CLAVADA POR UUID y el local se resuelve por (nombre,
-- cuenta). Misma regla que en hubrise-catalog-create: jamas por nombre a secas.
do $$
declare
  v_account_id uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint (PRODUCCION)
  v_insertadas int;
begin
  if not exists (select 1 from public.accounts where id = v_account_id and name = 'Foodint') then
    raise exception 'La cuenta % no es Foodint. Abortado.', v_account_id;
  end if;

  insert into public.channel_publish_route
    (account_id, location_id, channel_id, route, ownership_scope, effective_from, notes)
  select v_account_id, l.id, sc.id, v.route, 'own', v.effective_from, v.notes
  from (values
      ('Foodint Alcalá',      'glovo',   'lastapp', date '2000-01-01',
       'Sin corte: 1.178 ventas por Last y 0 por HubRise en 30d. Fecha centinela.'),
      ('Foodint Alcalá',      'uber',    'hubrise', date '2026-08-06',
       'Corte verificado: Meraki Pita ultima por Last 05/08, primera por HubRise 06/08. Igual Milas, Milanesa House, Smash Brothers, Bendito Burrito, Dirty Burger, The Urban Kebab.'),
      ('Foodint Alcalá',      'justeat', 'hubrise', date '2026-08-13',
       'Corte verificado: Milas y Milanesa House ultima por Last 04-05/08, primera por HubRise 13/08.'),
      ('Foodint Carabanchel', 'glovo',   'lastapp', date '2000-01-01',
       'Sin corte: 640 ventas, todas por Last. Fecha centinela.'),
      ('Foodint Carabanchel', 'uber',    'lastapp', date '2000-01-01',
       'Sin corte: 273 ventas, todas por Last. Fecha centinela.'),
      ('Foodint Carabanchel', 'justeat', 'lastapp', date '2000-01-01',
       'Sin corte: 38 ventas, todas por Last. Fecha centinela.')
    ) as v(local, slug, route, effective_from, notes)
  join public.locations l
    on l.name = v.local and l.account_id = v_account_id
  join public.sales_channel sc
    on sc.slug = v.slug and sc.account_id = v_account_id
  on conflict (location_id, channel_id, ownership_scope, effective_from) do nothing;

  get diagnostics v_insertadas = row_count;
  if v_insertadas <> 6 then
    raise exception 'Se esperaban 6 filas sembradas y salieron %. Abortado.', v_insertadas;
  end if;
end $$;

