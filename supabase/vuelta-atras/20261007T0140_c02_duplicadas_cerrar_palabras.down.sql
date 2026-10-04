-- supabase/vuelta-atras/20261007T0140_c02_duplicadas_cerrar_palabras.down.sql
--
-- Deshace 20261007T0140: quita las tres funciones y deja el registro con sus
-- valores de la 0120. Si hubiera entradas de los valores nuevos, la restricción
-- no entra y no se deshace nada: se borran antes, contadas.
do $$
declare n int;
begin
  delete from public.company_account_log where que in ('borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave');
  get diagnostics n = row_count;
  raise notice 'Se borran % entradas del registro del plan (duplicadas, cerradas y palabras clave).', n;
end $$;
drop function if exists public.company_account_set_keywords(uuid, text[], text);
drop function if exists public.company_account_close(uuid, text);
drop function if exists public.company_account_merge(uuid, uuid, text);
alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada'));
