-- supabase/staging/sql/20261005_e2e_quitar_actividades_repetidas.sql
--
-- Solo staging. El 04/10 a las 23:07 y 23:25 (UTC) la e2e de «Tu empresa»
-- contó las actividades de A con el esqueleto delante, vio 0 y añadió
-- «Restaurante» dos veces más, como no principal (corregida en la misma tanda:
-- ahora espera a que la tarjeta cargue). Se quitan esas dos: las de la cuenta A,
-- de Taberna de Prueba Norte, no principales, creadas esa noche. La principal
-- (02/10) se queda. Comprueba que quita exactamente dos.
do $$
declare n int;
begin
  delete from public.company_activity
   where account_id = 'c01a0000-0000-4000-8000-00000000000a'
     and company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
     and description = 'Restaurante' and not is_main and ended_on is null
     and created_at between '2026-10-04 23:00:00+00' and '2026-10-04 23:59:59+00';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'Esperaba quitar 2 actividades repetidas y son %', n; end if;
  raise notice 'Quitadas % actividades repetidas por la e2e.', n;
end $$;
