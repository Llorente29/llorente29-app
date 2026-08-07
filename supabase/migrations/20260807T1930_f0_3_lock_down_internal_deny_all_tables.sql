-- Aplicada: 2026-08-07 por MCP. Verificado: anon/auth sin SELECT, service_role conservado, documentadas.
-- F0.3 · Tablas internas (tokens, sesiones, oauth, logs, poll) en deny-all por RLS: se retira el grant
-- residual a anon/authenticated (defensa en profundidad; no cambia comportamiento, ya estaba denegado)
-- y se documenta que el acceso es solo vía Edge/SECURITY DEFINER (service_role/owner).
revoke all on public.customer_otp              from anon, authenticated;
revoke all on public.customer_session          from anon, authenticated;
revoke all on public.platform_api_token        from anon, authenticated;
revoke all on public.external_webhook_log      from anon, authenticated;
revoke all on public.weather_poll              from anon, authenticated;
revoke all on public.hubrise_oauth_state       from anon, authenticated;
revoke all on public.hubrise_writer_connection from anon, authenticated;

comment on table public.customer_otp              is 'RLS deny-all intencional. Acceso solo vía Edge/SECURITY DEFINER. Sin grant a anon/authenticated (F0.3).';
comment on table public.customer_session          is 'RLS deny-all intencional (sesión de comensal por token propio). Acceso solo vía Edge/SECURITY DEFINER (F0.3).';
comment on table public.platform_api_token        is 'RLS deny-all intencional (secretos). Acceso solo vía Edge/SECURITY DEFINER (F0.3).';
comment on table public.external_webhook_log      is 'RLS deny-all intencional (log interno). Acceso solo vía Edge/SECURITY DEFINER (F0.3).';
comment on table public.weather_poll              is 'RLS deny-all intencional (caché interna). Acceso solo vía Edge/SECURITY DEFINER (F0.3).';
comment on table public.hubrise_oauth_state       is 'RLS deny-all intencional (estado OAuth). Acceso solo vía Edge/SECURITY DEFINER (F0.3).';
comment on table public.hubrise_writer_connection is 'RLS deny-all intencional (conexión escritora HubRise). Acceso solo vía Edge/SECURITY DEFINER (F0.3).';
