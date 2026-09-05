-- Cerrar la puerta, no solo confiar en la guarda.
--
-- Postgres concede EXECUTE a PUBLIC por defecto en TODA funcion que se crea, asi
-- que `anon` heredaba la ejecucion de `report_sales` aunque yo solo hubiera
-- concedido a `authenticated`. La guarda de cuenta la rechaza —comprobado, y
-- `current_user_account_ids()` hace COALESCE a '{}' en las dos ramas, asi que no
-- hay agujero de logica de tres valores— pero eso es una guarda correcta HOY, no
-- una puerta cerrada MAÑANA. Regla 16.
--
-- El motor ya estaba cerrado desde su propia migracion. Aqui van las otras dos.
-- `_report_ventanas_validas` solo mira fechas y no toca datos, pero se cierra
-- igual: la excepcion se declara, no se deduce de que «no devuelve nada util».
revoke all on function public.report_sales(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], uuid[], uuid[], text, uuid[], text[], boolean) from public, anon;

revoke all on function public._report_ventanas_validas(timestamptz, timestamptz, timestamptz, timestamptz, boolean) from public, anon, authenticated;

-- Y se vuelve a conceder explicitamente lo unico que tiene que poder llamarla.
grant execute on function public.report_sales(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], uuid[], uuid[], text, uuid[], text[], boolean) to authenticated;
