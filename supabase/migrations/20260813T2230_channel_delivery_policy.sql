-- 20260813T2230_channel_delivery_policy.sql
-- ENCARGO CODE (13/08 noche) fix/hubrise-service-type-reparto, Tramo 2 — "esto
-- es un SaaS que pretende ser serio": quién reparte (plataforma × tipo de
-- marca) pasa de ser una constante en el webhook a configuración visible y
-- editable en BBDD.
--
-- RECON verificado por MCP antes de escribir esto (13/08):
--   - No existía ninguna tabla parecida (channel_delivery_policy / dispatch
--     policy) — se busco con information_schema.tables, cero resultados.
--   - dispatch_rule es sobre QUIÉN de la flota propia reparte (zona/horario/
--     importe → carrier); no decide own_delivery vs platform_delivery. No se
--     toca.
--   - brand.ownership_type ya existe, CHECK ('own','licensed').
--   - Patrón RLS calcado de dispatch_rule (dr_select/dr_write): lectura para
--     cualquiera de la cuenta, escritura solo admin/manager.
--
-- Sin fila para (account_id, channel_slug, ownership_type) → el webhook usa
-- 'platform_delivery' (comportamiento seguro: no despachar es recuperable,
-- despachar de más cuesta dinero real).
create table public.channel_delivery_policy (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  channel_slug text not null,           -- 'uber' | 'justeat' | 'glovo' | 'deliveroo' (mismo slug que sales_channel/channelSlug() del webhook)
  ownership_type text not null check (ownership_type = any(array['own','licensed'])),
  service_type text not null check (service_type = any(array['own_delivery','platform_delivery'])),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  unique (account_id, channel_slug, ownership_type)
);

alter table public.channel_delivery_policy enable row level security;

create policy cdp_select on public.channel_delivery_policy
  for select using (belongs_to_account(account_id));
create policy cdp_write on public.channel_delivery_policy
  for all using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

grant select, insert, update, delete on public.channel_delivery_policy to authenticated;
grant select on public.channel_delivery_policy to anon, service_role;
grant insert, update, delete on public.channel_delivery_policy to service_role;

-- ── Siembra: los valores del §3 del encargo, para la única cuenta hoy en
--    HubRise (Foodint). ⚠️ Uber Eats reparte SIEMPRE Uber, también en marcas
--    propias (dato de Julio, 13/08) — nunca reparto propio, sería doble rider
--    y doble coste. Se siembran también las filas que ya coinciden con el
--    default de seguridad (platform_delivery): el objetivo es que la matriz
--    se VEA completa en la pantalla de Ajustes, no que dependa de un default
--    implícito invisible.
insert into public.channel_delivery_policy (account_id, channel_slug, ownership_type, service_type, notes) values
  ('51ad1792-6629-4ef7-833a-b57b09a86710', 'justeat', 'own',      'own_delivery',      'Just Eat, marca propia: la reparte Foodint (own_delivery).'),
  ('51ad1792-6629-4ef7-833a-b57b09a86710', 'justeat', 'licensed', 'platform_delivery', 'Just Eat, marca cedida (CTB): la reparte la plataforma.'),
  ('51ad1792-6629-4ef7-833a-b57b09a86710', 'uber',    'own',      'platform_delivery', 'Uber Eats reparte SIEMPRE Uber, también en marcas propias — nunca reparto propio (doble rider/coste).'),
  ('51ad1792-6629-4ef7-833a-b57b09a86710', 'uber',    'licensed', 'platform_delivery', 'Uber Eats, marca cedida: la reparte la plataforma.');
