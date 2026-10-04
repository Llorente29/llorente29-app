-- supabase/vuelta-atras/20261006T0140_c01b_elimina.down.sql
--
-- Deshace 20261006T0140_c01b_elimina.sql: vuelve a crear supplier.email,
-- phone, address y usual_vat_rates con los MISMOS tipos de antes y les
-- devuelve los valores que copió la 0140. Después quita la copia.
-- Comprueba que todo lo copiado ha vuelto antes de quitarla.

alter table public.supplier
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists usual_vat_rates numeric[] not null default '{}';

update public.supplier s
   set email = c.email, phone = c.phone, address = c.address, usual_vat_rates = coalesce(c.usual_vat_rates, '{}')
  from public.c01b_columnas_eliminadas c
 where c.supplier_id = s.id;

do $$
declare v_falta int;
begin
  select count(*) into v_falta from public.c01b_columnas_eliminadas c
   where not exists (select 1 from public.supplier s where s.id = c.supplier_id
                       and s.email is not distinct from c.email and s.phone is not distinct from c.phone
                       and s.address is not distinct from c.address and s.usual_vat_rates = coalesce(c.usual_vat_rates, '{}'));
  if v_falta > 0 then raise exception 'Vuelta atrás 0140: % proveedores no han recuperado sus columnas. No se quita la copia.', v_falta; end if;
end $$;

drop table public.c01b_columnas_eliminadas;
