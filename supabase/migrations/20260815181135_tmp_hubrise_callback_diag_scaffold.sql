-- TEMPORAL -- diagnostico del fallo de 2.6 (15/08/2026). DISPARADOR DE
-- BORRADO: DROP TABLE en cuanto los experimentos 1/2 concluyan.
create table if not exists public._tmp_hubrise_callback_diag (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  method text,
  headers jsonb,
  body jsonb
);
revoke all on public._tmp_hubrise_callback_diag from anon, authenticated;