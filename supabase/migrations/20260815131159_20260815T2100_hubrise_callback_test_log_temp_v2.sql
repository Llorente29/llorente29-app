-- TEMPORAL — re-test 2.bis (F0.2, con segundo cliente real: OrderLine).
-- Se borra en cuanto el resultado quede escrito en folvy_mapa_sistema.md.
create table if not exists public.hubrise_callback_test_log (
  id bigint generated always as identity primary key,
  headers jsonb,
  payload jsonb,
  received_at timestamptz not null default now()
);
