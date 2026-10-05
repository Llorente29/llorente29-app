-- supabase/vuelta-atras/20261007T0170_c02_elimina.down.sql
--
-- Deshace 20261007T0170_c02_elimina.sql: vuelve a crear
-- supplier.ledger_account_code (text, como era) y le devuelve los valores que
-- copió la 0170. Comprueba que todo ha vuelto antes de quitar la copia.

alter table public.supplier add column if not exists ledger_account_code text;

update public.supplier s set ledger_account_code = c.ledger_account_code
  from public.c02_columnas_eliminadas c where c.supplier_id = s.id;

do $$
declare v_falta int;
begin
  select count(*) into v_falta from public.c02_columnas_eliminadas c
   where not exists (select 1 from public.supplier s where s.id = c.supplier_id and s.ledger_account_code = c.ledger_account_code);
  if v_falta > 0 then raise exception 'Vuelta atrás 0170: % proveedores no han recuperado su cuenta. No se quita la copia.', v_falta; end if;
end $$;

drop table public.c02_columnas_eliminadas;
