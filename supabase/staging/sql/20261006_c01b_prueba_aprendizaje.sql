-- supabase/staging/sql/20261006_c01b_prueba_aprendizaje.sql
--
-- C01b · Prueba de la 0130 en staging-conta, como el administrador de la
-- cuenta A (JWT de verdad, así pasa por la RLS) y como el de la B (no ve ni
-- toca nada de A). Termina en ROLLBACK: no deja nada.
--
--   1. sync: aprende, no repite el registro si no cambia, olvida lo que ya no sale.
--   2. fix: lo fijado a mano gana a lo aprendido y sync no lo pisa; devolverlo a Folvy.
--   3. «no es repetida».
--   4. RLS: B no ve lo de A ni puede escribirlo.
--   5. Vuelta atrás: el .down.sql quita todo lo suyo.

begin;

\echo '>>> 1-3. Como el administrador de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  ruiz constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  n int;
  v public.supplier_learning;
begin
  n := public.supplier_learning_sync(ruiz, jsonb_build_array(
    jsonb_build_object('campo', 'tax_rates', 'valor', '10,21', 'etiqueta', 'IVA al 10 % y al 21 %', 'porque', 'Así vienen todas sus facturas', 'veces', 3),
    jsonb_build_object('campo', 'payment', 'valor', 'transfer', 'etiqueta', 'Le pagas por transferencia', 'porque', 'Lo confirmaste tú 3 veces', 'veces', 3)));
  if n <> 2 then raise exception 'PRUEBA 0130: el primer sync tenía que apuntar 2 y apunta %', n; end if;
  -- Lo mismo otra vez: nada nuevo en el registro.
  n := public.supplier_learning_sync(ruiz, jsonb_build_array(
    jsonb_build_object('campo', 'tax_rates', 'valor', '10,21', 'etiqueta', 'IVA al 10 % y al 21 %', 'porque', 'Así vienen todas sus facturas', 'veces', 4),
    jsonb_build_object('campo', 'payment', 'valor', 'transfer', 'etiqueta', 'Le pagas por transferencia', 'porque', 'Lo confirmaste tú 3 veces', 'veces', 3)));
  if n <> 0 then raise exception 'PRUEBA 0130: un sync sin cambios apuntó % en el registro', n; end if;
  -- Ya no sale el pago: se olvida, y queda dicho.
  n := public.supplier_learning_sync(ruiz, jsonb_build_array(
    jsonb_build_object('campo', 'tax_rates', 'valor', '10,21', 'etiqueta', 'IVA al 10 % y al 21 %', 'porque', 'Así vienen todas sus facturas', 'veces', 4)));
  if n <> 1 or exists (select 1 from public.supplier_learning where supplier_id = ruiz and campo = 'payment')
     or not exists (select 1 from public.supplier_learning_log where supplier_id = ruiz and campo = 'payment' and que = 'olvidado') then
    raise exception 'PRUEBA 0130: el pago que ya no sale no se ha olvidado bien (n=%)', n;
  end if;
  -- 2. Fijado a mano: gana, y el sync no lo pisa.
  perform public.supplier_learning_fix(ruiz, 'tax_rates', '21', 'IVA al 21 %', 'Admin Norte');
  perform public.supplier_learning_sync(ruiz, jsonb_build_array(
    jsonb_build_object('campo', 'tax_rates', 'valor', '10,21', 'etiqueta', 'IVA al 10 % y al 21 %', 'porque', 'Así vienen todas sus facturas', 'veces', 5)));
  select * into v from public.supplier_learning where supplier_id = ruiz and campo = 'tax_rates';
  if not v.a_mano or v.valor <> '21' or v.porque <> 'Lo fijó Admin Norte a mano' then
    raise exception 'PRUEBA 0130: lo fijado a mano no ha ganado: % % %', v.a_mano, v.valor, v.porque;
  end if;
  perform public.supplier_learning_fix(ruiz, 'tax_rates', null, null, 'Admin Norte');
  if exists (select 1 from public.supplier_learning where supplier_id = ruiz and campo = 'tax_rates') then
    raise exception 'PRUEBA 0130: devolverlo a Folvy no ha quitado lo fijado a mano';
  end if;
  -- 3. «No es repetida».
  perform public.supplier_invoice_not_duplicate('c1b0a000-0000-4000-8000-000000000501', 'Admin Norte');
  if not exists (select 1 from public.supplier_invoice where id = 'c1b0a000-0000-4000-8000-000000000501'
                  and not_duplicate_confirmed_at is not null and not_duplicate_confirmed_by_name = 'Admin Norte') then
    raise exception 'PRUEBA 0130: «no es repetida» no ha quedado apuntado';
  end if;
  raise notice 'Aprender, olvidar, fijar a mano, devolver y «no es repetida»: OK.';
end $$;
reset role;

\echo '>>> 4. Como el administrador de B'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.supplier_learning_log where supplier_id = 'c01a0000-0000-4000-8000-0000000000a3') then
    raise exception 'PRUEBA 0130: B ve el registro de un proveedor de A.';
  end if;
  begin
    perform public.supplier_learning_sync('c01a0000-0000-4000-8000-0000000000a3', '[]'::jsonb);
    raise exception 'PRUEBA 0130: B ha podido sincronizar un proveedor de A.';
  exception when no_data_found then null;
  end;
  begin
    perform public.supplier_invoice_not_duplicate('c1b0a000-0000-4000-8000-000000000501', 'B');
    raise exception 'PRUEBA 0130: B ha podido tocar una factura de A.';
  exception when no_data_found then null;
  end;
  raise notice 'RLS: B no ve ni toca nada de A. OK.';
end $$;
reset role;

\echo '>>> 5. Vuelta atrás'
\ir ../../vuelta-atras/20261006T0130_c01b_aprendizaje.down.sql
do $$
begin
  if to_regclass('public.supplier_learning') is not null or to_regclass('public.supplier_learning_log') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name like 'not_duplicate%')
     or exists (select 1 from pg_proc where proname in ('supplier_learning_sync', 'supplier_learning_fix', 'supplier_invoice_not_duplicate')) then
    raise exception 'PRUEBA 0130: la vuelta atrás no ha quitado todo lo suyo.';
  end if;
  raise notice 'Vuelta atrás de la 0130: OK.';
end $$;

\echo '>>> TODO EN VERDE. ROLLBACK: no queda nada de la prueba.'
rollback;
