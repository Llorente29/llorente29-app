-- supabase/staging/sql/20261006_c01b_prueba_elimina.sql
--
-- C01b, tarea 6 · Prueba de la eliminación (0140) en staging-conta, ENTERA
-- dentro de una transacción que termina en ROLLBACK: staging se queda con las
-- columnas viejas, como producción hasta su tanda.
--
--   1. Foto de las cuatro columnas viejas, proveedor a proveedor.
--   2. Se aplica la 0140: pasan sus guardas, y las columnas ya no están.
--   3. Los lectores siguen funcionando sin ellas: compliance_docs_due y el
--      clonado de la plantilla (migrate_kitchen_core).
--   4. Vuelta atrás: las columnas vuelven con su tipo y CADA valor de la foto
--      está igual (misma vara antes y después, regla 31).

begin;

\echo '>>> 1. Foto de antes'
create temp table foto as
select id, email, phone, address, usual_vat_rates from public.supplier;
select count(*) filter (where email is not null) as con_email, count(*) filter (where phone is not null) as con_tel,
       count(*) filter (where address is not null) as con_dir, count(*) filter (where cardinality(usual_vat_rates) > 0) as con_iva
  from foto;

\echo '>>> 2. La eliminación'
\ir ../../migrations/20261006T0140_c01b_elimina.sql
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier'
              and column_name in ('email', 'phone', 'address', 'usual_vat_rates')) then
    raise exception 'PRUEBA 0140: siguen columnas viejas en supplier.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'notify_group') then
    raise exception 'PRUEBA 0140: notify_group tenía que quedarse (decisión 2).';
  end if;
  raise notice 'Eliminación: OK (las cuatro fuera, notify_group se queda).';
end $$;

\echo '>>> 3. Los lectores, sin las columnas'
select count(*) as documentos_que_caducan from public.compliance_docs_due(30);
insert into public.accounts (id, name, slug, status, business_type)
values ('c1b0f000-0000-4000-8000-0000000000f3', 'Clon tras eliminar C01b', 'clon-tras-eliminar-c01b', 'active', 'restaurante');
select * from public.migrate_kitchen_core('c01a0000-0000-4000-8000-00000000000a', 'c1b0f000-0000-4000-8000-0000000000f3', true);
do $$
begin
  if (select count(*) from public.supplier where account_id = 'c1b0f000-0000-4000-8000-0000000000f3') = 0 then
    raise exception 'PRUEBA 0140: tras eliminar, el clonado no copia ningún proveedor.';
  end if;
  raise notice 'Lectores sin las columnas: OK.';
end $$;
-- La cuenta clonada no se borra a mano: su borrado en cascada recalcula
-- costes de artículos ya borrados y falla. La quita el ROLLBACK final.

\echo '>>> 4. Vuelta atrás'
\ir ../../vuelta-atras/20261006T0140_c01b_elimina.down.sql
do $$
declare v_dif int;
begin
  select count(*) into v_dif from foto f join public.supplier s on s.id = f.id
   where s.email is distinct from f.email or s.phone is distinct from f.phone
      or s.address is distinct from f.address or s.usual_vat_rates is distinct from f.usual_vat_rates;
  if v_dif > 0 then raise exception 'PRUEBA 0140: tras la vuelta atrás, % proveedores no son como antes.', v_dif; end if;
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'usual_vat_rates') <> 'NO' then
    raise exception 'PRUEBA 0140: usual_vat_rates no ha vuelto como NOT NULL.';
  end if;
  raise notice 'Vuelta atrás de la 0140: OK, mismos valores que en la foto.';
end $$;

\echo '>>> TODO EN VERDE. ROLLBACK: no queda nada de la prueba.'
rollback;
