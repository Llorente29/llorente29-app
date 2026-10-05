-- supabase/vuelta-atras/20261007T0189_c02_renombrar_subcuenta.down.sql
--
-- Deshace 20261007T0189: quita la función y devuelve el CHECK del registro al
-- de la 0160. Los nombres cambiados se quedan como están (son el nombre
-- vigente); se pierden sus entradas «renombrada» del registro, contadas.
do $$
declare n int;
begin
  delete from public.company_account_log where que = 'renombrada';
  get diagnostics n = row_count;
  raise notice 'Se borran % entradas «renombrada» del registro.', n;
end $$;
drop function if exists public.company_account_rename(uuid, text, text);
alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado',
                 'enlace_quitado'));
