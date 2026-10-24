-- supabase/staging/sql/20261121_s01_factura_descartada_prueba.sql
--
-- SOLO STAGING. La 0160 del S01 («No es una factura»), por sus caminos. Cambia
-- supplier_invoice (su CHECK de status), tg_supplier_invoice_no_repetida y
-- conta_documentos_recibidos; añade conta_factura_descartar y
-- conta_factura_recuperar.
--   1. Si staging aún no la tiene, se aplica aquí, dentro de la transacción.
--   2. COMO USUARIO de A, una factura en revisión de su empresa, sin asiento ni
--      pago: se descarta con su motivo, quién y cuándo, y queda en
--      document_activity; en N22 (conta_documentos_recibidos) sale como
--      «descartada» con su porqué, no en «para mirar»; ya no está entre las
--      pendientes de Bancos; descartarla otra vez dice que ya lo estaba.
--   3. Repetidas: una factura nueva con el mismo proveedor, número y total entra
--      (la descartada no la bloquea); recuperar la descartada con esa otra viva
--      PARA (23505); sin ella, vuelve a «en revisión», sin motivo, y queda
--      «deshecha» en document_activity, enlazada a la «descartada».
--   4. B no descarta una factura de A; una factura con asiento vivo no se
--      descarta; sin motivo, tampoco.
--   5. La vuelta atrás: con una descartada PARA sin tocar nada; sin ninguna, deja
--      las dos funciones byte a byte como en producción (md5 ea1dd614… y
--      a69d2408…), sin las dos nuevas, sin columnas y con el CHECK de antes.
-- Todo acaba en ROLLBACK: staging no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 descartada: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 1 · La 0160, si falta.
select to_regprocedure('public.conta_factura_descartar(uuid,text,text)') is null as falta_0160 \gset
\if :falta_0160
\echo '>>> Staging aún no tiene la 0160 del S01: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261121T0160_s01_factura_descartada.sql
\endif

-- La factura de la prueba (como postgres): en revisión, de la empresa de A, con
-- proveedor, número y total, sin asiento vivo ni pago casado.
do $$
declare f uuid;
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  select i.id into f from public.supplier_invoice i
   where i.account_id = a and i.company_id = emp and i.status = 'en_revision' and i.supplier_id is not null
     and i.invoice_number is not null and i.grand_total is not null and i.not_duplicate_confirmed_at is null
     and not exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.bank_match_item m join public.bank_match b on b.id = m.match_id where m.supplier_invoice_id = i.id and b.status = 'vivo')
   order by i.invoice_date, i.id limit 1;
  if f is null then raise exception 'PRUEBA S01 descartada: A no tiene ninguna factura en revisión sin asiento ni pago.'; end if;
  perform set_config('prueba_descartada.f', f::text, true);
end $$;

-- 2 · Como usuario de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  f constant uuid := current_setting('prueba_descartada.f')::uuid;
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  r jsonb; v public.supplier_invoice; d jsonb; fila jsonb;
begin
  r := public.conta_factura_descartar(f, 'Es un presupuesto', 'Prueba S01');
  select * into v from public.supplier_invoice where id = f;
  if v.status <> 'descartada' or v.status_before_discard <> 'en_revision' or v.discard_reason <> 'Es un presupuesto'
     or v.discarded_by_name <> 'Prueba S01' or v.discarded_at is null or v.discarded_by <> 'c01a0000-0000-4000-8000-0000000000a1' then
    raise exception 'PRUEBA S01 descartada 2a: no ha quedado descartada con su motivo, quién y cuándo: % · % · %', v.status, v.discard_reason, v.discarded_by_name;
  end if;
  if not exists (select 1 from public.document_activity where id = (r->>'actividad')::uuid and supplier_invoice_id = f and action = 'descartada' and actor = 'persona') then
    raise exception 'PRUEBA S01 descartada 2a: no ha quedado en document_activity.';
  end if;
  raise notice 'S01 descartada 2a: descartada con su motivo, quién y cuándo, y apuntada en document_activity.';

  d := public.conta_documentos_recibidos(emp, v.invoice_date, v.invoice_date);
  select x into fila from jsonb_array_elements(d->'filas') x where x->>'id' = f::text;
  if fila is null or fila->>'estado' <> 'descartada' or fila->>'porque' not like 'No es una factura: Es un presupuesto (Prueba S01, %' then
    raise exception 'PRUEBA S01 descartada 2b: en N22 tenía que salir «descartada» con su porqué; sale %', coalesce(fila::text, 'nada');
  end if;
  raise notice 'S01 descartada 2b: en N22 sale «descartada» con su porqué (no se esconde, no está «para mirar»).';

  if exists (select 1 from public.banco_facturas_recibidas_pendientes(emp) where invoice_id = f) then
    raise exception 'PRUEBA S01 descartada 2c: sigue entre las pendientes de Bancos.';
  end if;
  raise notice 'S01 descartada 2c: ya no está entre las pendientes de Bancos.';

  begin
    perform public.conta_factura_descartar(f, 'Otra vez', 'Prueba S01');
    raise exception 'PRUEBA S01 descartada 2d: se ha descartado dos veces.';
  exception when invalid_parameter_value then raise notice 'S01 descartada 2d: descartarla otra vez dice que ya lo estaba.';
  end;
end $$;
reset role;

-- 3 · Repetidas. La copia, como postgres (es la preparación).
do $$
declare v public.supplier_invoice; c uuid;
begin
  select * into v from public.supplier_invoice where id = current_setting('prueba_descartada.f')::uuid;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (v.account_id, v.company_id, v.supplier_id, v.invoice_number, v.invoice_date, v.grand_total, 'en_revision') returning id into c;
  perform set_config('prueba_descartada.copia', c::text, true);
  raise notice 'S01 descartada 3a: la factura buena con el mismo proveedor, número y total entra (la descartada no la bloquea).';
end $$;

set local role authenticated;
do $$
declare f constant uuid := current_setting('prueba_descartada.f')::uuid;
begin
  begin
    perform public.conta_factura_recuperar(f, 'Prueba S01');
    raise exception 'PRUEBA S01 descartada 3b: se ha recuperado con otra igual viva.';
  exception when unique_violation then raise notice 'S01 descartada 3b: con otra igual viva, recuperarla para (Repetida, 23505).';
  end;
end $$;
reset role;
delete from public.supplier_invoice where id = current_setting('prueba_descartada.copia')::uuid;

set local role authenticated;
do $$
declare f constant uuid := current_setting('prueba_descartada.f')::uuid; v public.supplier_invoice;
begin
  perform public.conta_factura_recuperar(f, 'Prueba S01');
  select * into v from public.supplier_invoice where id = f;
  if v.status <> 'en_revision' or v.discard_reason is not null or v.discarded_at is not null or v.status_before_discard is not null then
    raise exception 'PRUEBA S01 descartada 3c: no ha vuelto a «en revisión» limpia: % · %', v.status, v.discard_reason;
  end if;
  if not exists (select 1 from public.document_activity d join public.document_activity o on o.id = d.undo_of
                  where d.supplier_invoice_id = f and d.action = 'deshecha' and o.action = 'descartada') then
    raise exception 'PRUEBA S01 descartada 3c: la recuperación no ha quedado en document_activity enlazada a la descartada.';
  end if;
  raise notice 'S01 descartada 3c: recuperada a «en revisión», y «deshecha» en document_activity, enlazada a la «descartada».';
  begin
    perform public.conta_factura_descartar(f, '   ', 'Prueba S01');
    raise exception 'PRUEBA S01 descartada 4c: se ha descartado sin motivo.';
  exception when invalid_parameter_value then raise notice 'S01 descartada 4c: sin motivo no se descarta.';
  end;
end $$;
reset role;

-- 4 · B no descarta una factura de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.conta_factura_descartar(current_setting('prueba_descartada.f')::uuid, 'Intruso', 'B');
    raise exception 'PRUEBA S01 descartada 4a: B ha descartado una factura de A.';
  exception when no_data_found then raise notice 'S01 descartada 4a: B no descarta una factura de A (P0002).';
  end;
end $$;
reset role;

-- Con asiento vivo, no (el asiento, en borrador, como postgres).
do $$
declare v public.supplier_invoice; v_y uuid;
begin
  select * into v from public.supplier_invoice where id = current_setting('prueba_descartada.f')::uuid;
  select id into v_y from public.fiscal_year where company_id = v.company_id and code = '2026' and status = 'open';
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id)
  values (v.account_id, v.company_id, v_y, 2, '2026-10-13', 'Prueba 0160', 'supplier_invoice', v.id) returning id into v_y;
  perform set_config('prueba_descartada.asiento', v_y::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.conta_factura_descartar(current_setting('prueba_descartada.f')::uuid, 'Es un albarán', 'Prueba S01');
    raise exception 'PRUEBA S01 descartada 4b: se ha descartado una factura con asiento vivo.';
  exception when invalid_parameter_value then raise notice 'S01 descartada 4b: con asiento vivo no se descarta.';
  end;
end $$;
reset role;
delete from public.journal_entry where id = current_setting('prueba_descartada.asiento')::uuid;

-- 5 · La vuelta atrás. La guarda: con una descartada, PARA sin tocar nada.
set local role authenticated;
do $$ begin perform public.conta_factura_descartar(current_setting('prueba_descartada.f')::uuid, 'Es un albarán', 'Prueba S01'); end $$;
reset role;
savepoint guarda;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261121T0160_s01_factura_descartada.down.sql
\set guarda_fallo :ERROR
\set ON_ERROR_STOP 1
rollback to savepoint guarda;
\if :guarda_fallo
\echo 'S01 descartada 5 guarda: con una descartada, la vuelta atrás para y no toca nada.'
\else
do $$ begin raise exception 'PRUEBA S01 descartada 5: con una descartada, la vuelta atrás no ha parado.'; end $$;
\endif
set local role authenticated;
do $$ begin perform public.conta_factura_recuperar(current_setting('prueba_descartada.f')::uuid, 'Prueba S01'); end $$;
reset role;
\i supabase/vuelta-atras/20261121T0160_s01_factura_descartada.down.sql
do $$
declare h1 text := md5(pg_get_functiondef('public.conta_documentos_recibidos(uuid,date,date)'::regprocedure));
        h2 text := md5(pg_get_functiondef('public.tg_supplier_invoice_no_repetida()'::regprocedure));
begin
  if h1 <> 'ea1dd614f285494f8fd9efeebac705cd' or h2 <> 'a69d2408680fc99d020a7d1e8e0bd03e' then
    raise exception 'PRUEBA S01 descartada 5: la vuelta atrás no deja las funciones como en producción (md5 % y %).', h1, h2;
  end if;
  if to_regprocedure('public.conta_factura_descartar(uuid,text,text)') is not null or to_regprocedure('public.conta_factura_recuperar(uuid,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name in ('discarded_at', 'discard_reason', 'status_before_discard'))
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'supplier_invoice_status_check') like '%descartada%' then
    raise exception 'PRUEBA S01 descartada 5: la vuelta atrás no lo ha quitado todo.';
  end if;
  raise notice 'S01 descartada 5: vuelta atrás, las dos funciones byte a byte como en producción, sin las nuevas, sin columnas y con el CHECK de antes.';
end $$;

rollback;
