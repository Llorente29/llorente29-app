-- Segunda mitad del bug de app_settings (ver 20260807T2800_fix_app_settings_rls_global_row.sql para el
-- SELECT). El UPDATE tambien estaba roto para la fila global, pero de forma mas sutil: SI funcionaba para
-- Julio (platform admin: current_user_is_admin_of(NULL) cae en su propio "OR current_user_is_admin()"),
-- pero NO para el admin de una cuenta cliente (verificado en vivo: llorente29food@gmail.com, admin de
-- Foodint, guarda cambios en /configuracion/avisos y el PATCH devuelve 204 pero CERO filas tocadas -
-- reproducido tambien por SQL simulando su JWT). current_user_is_admin_of(account_id) con account_id=NULL
-- solo pasa para admins de PLATAFORMA, no para admins de cuenta -- pero esta pantalla la usa el admin del
-- CLIENTE, no Julio, asi que en la practica nadie con acceso real a la pantalla podia guardar.
--
-- Fix: para la fila global (account_id NULL) basta con ser admin de CUALQUIER cuenta (hoy solo hay un
-- cliente real usando esto). Las filas por-cuenta futuras (deuda declarada en la migracion de F8) siguen
-- exigiendo current_user_is_admin_of(esa cuenta) exactamente como antes -- este cambio no afloja nada ahi.
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to authenticated
  using (
    current_user_is_admin_of(account_id)
    or (account_id is null and exists (
      select 1 from public.user_profiles
      where user_id = auth.uid() and role = 'admin' and active = true
    ))
  )
  with check (
    current_user_is_admin_of(account_id)
    or (account_id is null and exists (
      select 1 from public.user_profiles
      where user_id = auth.uid() and role = 'admin' and active = true
    ))
  );
