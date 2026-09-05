-- TEMPORAL — solo para el test 2.bis (F0.2, callback de cuenta vs local).
-- Se borra al cerrar el test. NO forma parte del módulo.
create table if not exists public.hubrise_callback_test_log (
  id bigint generated always as identity primary key,
  headers jsonb,
  payload jsonb,
  received_at timestamptz not null default now()
);
