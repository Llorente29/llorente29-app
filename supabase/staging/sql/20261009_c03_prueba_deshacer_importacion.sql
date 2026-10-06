-- ============================================================================
-- C03 · Prueba en staging-conta de 20261009T0160 (deshacer el plan traído con
-- el C03 dentro). Todo en una transacción que acaba en ROLLBACK.
--
--   1. Con el texto de ANTES (vuelta atrás de la 0160): una importación con
--      dos fichas nuevas NO se deshace («ya se ha usado … party_role»). Es el
--      fallo que cazó el e2e del C02c (run 37461486783): se reproduce.
--   2. Con la 0160: la misma se deshace; se van las fichas y sus terceros.
--   3. Si el tercero de una ficha traída tiene ya otro papel (cliente), no se
--      deshace, y lo dice.
-- Empresa de prueba nueva en la cuenta A, como su administrador.
-- ============================================================================
begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.preparar(p_n text, p_nif text) returns uuid language plpgsql as $$
declare v_emp uuid; v_imp uuid;
begin
  insert into public.company (account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
  values ('c01a0000-0000-4000-8000-00000000000a', 'Prueba 0160 ' || p_n, p_nif, 'nif_es', 'company', 'hecho', now())
  returning id into v_emp;
  insert into public.company_chart_import (account_id, company_id, program, file_sha256, digits, plan, status)
  values ('c01a0000-0000-4000-8000-00000000000a', v_emp, 'diez', repeat('0', 64), 8, 'pymes', 'traida')
  returning id into v_imp;
  insert into public.supplier (account_id, name, import_id, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'Traída 0160 ' || p_n || ' uno', v_imp, 'prueba 0160'),
         ('c01a0000-0000-4000-8000-00000000000a', 'Traída 0160 ' || p_n || ' dos', v_imp, 'prueba 0160');
  return v_imp;
end $$;

\echo '>>> 1. Con el texto de antes: no se deshace (se reproduce el fallo)'
\ir ../../vuelta-atras/20261009T0160_c03_deshacer_importacion.down.sql
do $$
declare v_imp uuid := pg_temp.preparar('A', 'B91030064');
begin
  if (select count(*) from public.party_role r join public.supplier s on s.id = r.supplier_id where s.import_id = v_imp) <> 2 then
    raise exception 'PRUEBA 1: cada ficha traída debería tener su tercero (lo pone el disparador del C03).';
  end if;
  begin
    perform public.company_chart_import_undo(v_imp, 'prueba 0160');
    raise exception 'PRUEBA 1: con el texto de antes se ha deshecho; el fallo no se reproduce.';
  exception when sqlstate '23514' then
    if sqlerrm not like '%party_role%' then raise exception 'PRUEBA 1: falla por otra cosa: %', sqlerrm; end if;
    raise notice 'PRUEBA 1 ok (se reproduce): %', sqlerrm;
  end;
end $$;

\echo '>>> 2. Con la 0160: se deshace y se van fichas y terceros'
\ir ../../migrations/20261009T0160_c03_deshacer_importacion.sql
do $$
declare v_imp uuid := pg_temp.preparar('B', 'B91030072'); v_terceros uuid[]; r jsonb;
begin
  select array_agg(r2.party_id) into v_terceros from public.party_role r2 join public.supplier s on s.id = r2.supplier_id where s.import_id = v_imp;
  r := public.company_chart_import_undo(v_imp, 'prueba 0160');
  if (r ->> 'fichas')::int <> 2 then raise exception 'PRUEBA 2: esperaba 2 fichas borradas y dice %', r; end if;
  if exists (select 1 from public.supplier where import_id = v_imp) then raise exception 'PRUEBA 2: quedan fichas.'; end if;
  if exists (select 1 from public.party where id = any(v_terceros)) then raise exception 'PRUEBA 2: quedan terceros sin papel.'; end if;
  if (select status from public.company_chart_import where id = v_imp) <> 'deshecha' then raise exception 'PRUEBA 2: la importación no está deshecha.'; end if;
  raise notice 'PRUEBA 2 ok: %', r;
end $$;

\echo '>>> 3. Un tercero traído con otro papel: no se deshace, y lo dice'
do $$
declare v_imp uuid := pg_temp.preparar('C', 'B91030080'); v_tercero uuid;
begin
  select r.party_id into v_tercero from public.party_role r join public.supplier s on s.id = r.supplier_id where s.import_id = v_imp limit 1;
  perform public.party_add_role(v_tercero, 'customer', '{}'::jsonb);
  begin
    perform public.company_chart_import_undo(v_imp, 'prueba 0160');
    raise exception 'PRUEBA 3: se ha deshecho borrando un tercero que ya es cliente.';
  exception when sqlstate '23514' then
    if sqlerrm not like '%1 con otro papel en Clientes y proveedores%' then raise exception 'PRUEBA 3: falla por otra cosa: %', sqlerrm; end if;
    raise notice 'PRUEBA 3 ok: %', sqlerrm;
  end;
end $$;

\echo '>>> Prueba de la 0160 en verde. ROLLBACK: no queda nada.'
rollback;
