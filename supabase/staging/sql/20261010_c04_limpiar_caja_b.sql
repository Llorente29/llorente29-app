-- supabase/staging/sql/20261010_c04_limpiar_caja_b.sql
--
-- SOLO STAGING. La prueba e2e del C00 «cuenta B: añadir una caja y borrarla»
-- crea «Caja del local (prueba)» y la borra al acabar. La ejecución 120 del
-- e2e la creó a las 06:04:02 del 07/10 y la canceló la 121 (concurrencia del
-- workflow) antes de borrarla: la 121 falló porque B ya tenía una caja. Se
-- quita esa fila y nada más, si nada la usa.
do $$
declare n int;
begin
  if exists (select 1 from public.accounts where id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'Esta base tiene cuentas de producción: no se toca nada.';
  end if;
  delete from public.treasury_account t
   where t.account_id = 'c01b0000-0000-4000-8000-00000000000b' and t.name = 'Caja del local (prueba)'
     and not exists (select 1 from public.company_account_link l where l.entity = 'bank_account' and l.entity_id = t.id);
  get diagnostics n = row_count;
  raise notice 'Limpieza C04: % caja(s) de prueba sobrantes quitadas de la cuenta B.', n;
end $$;
