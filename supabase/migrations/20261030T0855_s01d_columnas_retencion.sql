-- supabase/migrations/20261030T0855_s01d_columnas_retencion.sql
--
-- S01d · Las dos columnas de las retenciones, solas: solo añade (admiten
-- nulos y se pueden pasar dos veces), para que staging las tenga de verdad
-- desde la rama y la pantalla del asiento las pueda leer en la e2e. Lo que
-- las usa va en la 0900.
alter table public.journal_line add column if not exists withholding_period text
  check (withholding_period ~ '^[0-9]{4}-([1-4]T|0[1-9]|1[0-2]|0A)$');
comment on column public.journal_line.withholding_period is
  'S01d. El periodo del modelo que paga, compensa o devuelve este apunte de la 4751 («2026-3T», «2026-01» o «2026-0A»), con withholding_model y sin withholding_rate_id. Nulo en la retención que nace.';
alter table public.company_account add column if not exists withholding_model text
  check (withholding_model in ('111', '115', '123'));
comment on column public.company_account.withholding_model is
  'S01d. El modelo de una subcuenta de la 4751 (111, 115 o 123): de ahí sale el modelo al pagar desde Bancos.';

