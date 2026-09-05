-- TEMPORAL -- amplia la tabla de diagnostico con el body crudo y el veredicto
-- de HMAC calculado dentro de la propia funcion (los secretos nunca salen de
-- Deno.env). Mismo disparador de borrado que la tabla original.
alter table public._tmp_hubrise_callback_diag add column if not exists raw_body text;
alter table public._tmp_hubrise_callback_diag add column if not exists header_sig text;
alter table public._tmp_hubrise_callback_diag add column if not exists computed_sig_webhook_secret text;
alter table public._tmp_hubrise_callback_diag add column if not exists computed_sig_client_secret text;
alter table public._tmp_hubrise_callback_diag add column if not exists match_webhook_secret boolean;
alter table public._tmp_hubrise_callback_diag add column if not exists match_client_secret boolean;