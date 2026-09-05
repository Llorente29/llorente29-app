-- 20260813T2330_channel_delivery_policy_location.sql
-- ENCARGO CODE (13/08 noche) feat/channel-delivery-policy-por-local — la
-- politica de "quien reparte" (channel_delivery_policy, PR #67) no tenia
-- local: era identica para todos los locales de la cuenta. Medido por MCP
-- (7 dias): Foodint Alcala 77 pedidos con carrier_code, Foodint Carabanchel 0
-- — los dos locales reparten distinto y no se podia expresar.
--
-- Decision de Julio: CUENTA POR DEFECTO, EXCEPCION POR LOCAL. Mismo patron
-- que dispatch_rule (location_id NULL = aplica a todos los locales; con
-- valor = solo ese local). RECON verificado por MCP antes de escribir esto:
--   - channel_delivery_policy no tenia location_id (confirmado por
--     information_schema.columns).
--   - dispatch_rule usa location_id NULL como comodin en su resolve_dispatch
--     ("r.location_id IS NULL OR r.location_id = v_sale.location_id"), sin
--     UNIQUE que involucre location_id (es una tabla de reglas priorizadas,
--     no de lookup exacto) — no hay un indice UNICO con NULL-como-comodin
--     que copiar literal de ahi; el patron que SI se copia es el criterio de
--     resolucion (NULL = comodin, valor = mas especifico y gana).
--   - Aparte, resolveAutoAccept en el propio hubrise-webhook YA resuelve por
--     especificidad (mas especifico gana, NULL = comodin) — mismo criterio,
--     aqui con dos niveles (local > cuenta) en vez de cuatro.
--
-- Aditiva: NO se toca ninguna fila existente. Las ya sembradas se quedan con
-- location_id NULL (regla de cuenta) — comportamiento actual intacto,
-- verificado por dry-run antes de aplicar (BEGIN/ROLLBACK con las 5 filas
-- vivas de la cuenta, incluida la que Julio anadio a mano desde la pantalla).
--
-- NULL no colisiona en un UNIQUE normal (Postgres trata cada NULL como
-- distinto de cualquier otro NULL) — por eso DOS indices UNICOS PARCIALES en
-- vez de una unica constraint, patron estandar y portable (no depende de
-- UNIQUE NULLS NOT DISTINCT, aunque PG 17 lo soportaria):
--   1) unicidad de la fila de CUENTA (location_id IS NULL) por combinacion.
--   2) unicidad de la fila de LOCAL (location_id IS NOT NULL) por combinacion+local.
alter table public.channel_delivery_policy
  add column location_id uuid null references public.locations(id) on delete cascade;

alter table public.channel_delivery_policy
  drop constraint channel_delivery_policy_account_id_channel_slug_ownership_t_key;

create unique index channel_delivery_policy_account_wide_uk
  on public.channel_delivery_policy (account_id, channel_slug, ownership_type)
  where location_id is null;

create unique index channel_delivery_policy_per_location_uk
  on public.channel_delivery_policy (account_id, channel_slug, ownership_type, location_id)
  where location_id is not null;
