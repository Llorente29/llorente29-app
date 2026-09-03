-- B50 · 03/09/2026 — DOS PUERTAS ABIERTAS DE LA FAMILIA B38.
-- ===========================================================================
-- (1) lastapp_webhook_log — LA GRAVE.
--     Politica `lastapp_webhook_log_read`: SELECT, rol `public` (anon incluido),
--     USING (true). La tabla guarda `headers` y `payload` en crudo.
--     MEDIDO: 39.244 filas; 39.243 llevan cabecera `authorization`, TODAS con
--     EL MISMO valor de 36 caracteres, desde el 28/05 hasta hoy. Es el secreto
--     vivo con el que Last.app llama al webhook, en texto plano, legible por
--     cualquiera que tenga la anon key — que viaja en el bundle del front.
--     Se cierra la lectura. `service_role` sigue entrando (no depende de RLS).
--     ⚠️ ESTO NO BASTA: el valor sigue escrito en 39.243 filas. Hay que ROTAR
--     el secreto en Last.app y decidir si se limpia la columna (dato de
--     produccion -> decision de Julio). Y como en B38: no se puede demostrar
--     que nadie lo leyera.
--
-- (2) team_labor_model — politica `tlm_write`: cmd ALL, rol `authenticated`,
--     USING (true) WITH CHECK (true). La tabla TIENE account_id y location_id.
--     Cualquier usuario logueado de CUALQUIER cuenta podia leer, modificar y
--     borrar el modelo de personal de las demas. Es la forma exacta de B38b.
--     Hoy son 2 filas de 1 cuenta: el dano real es cero y la puerta es real.
--     Se cambia por el patron que ya usa el resto de la casa.
--
-- NO SE TOCA, a proposito: business_hours / business_hours_exception tienen
--   SELECT true para `public`, pero el escaparate publico (folvy_shop) necesita
--   ensenar los horarios sin sesion. Queda anotado, no es un descuido.

-- (1) ---------------------------------------------------------------------
drop policy if exists lastapp_webhook_log_read on public.lastapp_webhook_log;
revoke all on public.lastapp_webhook_log from anon, authenticated;

-- (2) ---------------------------------------------------------------------
drop policy if exists tlm_write on public.team_labor_model;
drop policy if exists tlm_read  on public.team_labor_model;

create policy tlm_read on public.team_labor_model
  for select to authenticated
  using (public.belongs_to_account(account_id));

create policy tlm_write on public.team_labor_model
  for all to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id))
  with check (public.current_user_is_admin_or_manager_of(account_id));
