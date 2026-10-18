-- supabase/staging/sql/20261122_s01d_documento_expedida_prueba.sql
--
-- SOLO STAGING. La 0160 del S01d (el PDF de la factura expedida), por sus caminos:
--   1. Si staging aún no la tiene, se aplica aquí, dentro de la transacción.
--   2. El CHECK de journal_entry_document.kind solo amplía: los dos de antes y
--      'factura_expedida'.
--   3. COMO USUARIO de A (administrador de A), con una expedida a mano (serie
--      1, source_type 'manual') validada: en borrador no; en otro tipo de
--      asiento no; sin fichero subido no; con el PDF subido sí
--      (kind factura_expedida); la segunda vez dice «ya estaba»; con otro
--      fichero, no se cambia.
--   4. COMO USUARIO de B: ni guarda en A.
--   5. La vuelta atrás, de verdad: con un PDF enlazado PARA sin tocar nada; sin
--      él, sin función y con el CHECK de antes. Y se vuelve a aplicar.
--
-- Cambia: public.journal_entry_document (su CHECK de kind) y la función
-- conta_documento_expedida_guardar. Todo acaba en ROLLBACK: staging no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01d 0160: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · La 0160, si falta.
select to_regprocedure('public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text)') is null as falta_0160 \gset
\if :falta_0160
\echo '>>> Staging aún no tiene la 0160 del S01d: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261122T0160_s01d_documento_expedida.sql
\endif

-- 2 · El CHECK.
do $$ begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'journal_entry_document_kind_check')
     <> 'CHECK ((kind = ANY (ARRAY[''resumen_ventas''::text, ''factura_recibida''::text, ''factura_expedida''::text])))' then
    raise exception 'PRUEBA S01d 0160 · 2: el CHECK de kind no es el pedido: %', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'journal_entry_document_kind_check');
  end if;
  raise notice 'PRUEBA S01d 0160 · 2: kind admite resumen_ventas, factura_recibida y factura_expedida.';
end $$;

-- Una expedida a mano de A, validada, otra en borrador y un cobro validado
-- (preparados sin rol: lo que se prueba es la función, no el validar; los
-- disparadores de journal_entry son de cambio y borrado, no de alta).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_ej uuid; v_val uuid; v_bor uuid; v_otro uuid; v_num int;
begin
  select fiscal_year_id into v_ej from public.journal_entry where company_id = v_e and fiscal_year_id is not null limit 1;
  -- Validado lleva número (journal_entry_numero_al_validar): uno libre, muy por encima de los de la semilla.
  select coalesce(max(number), 0) + 1000 into v_num from public.journal_entry where company_id = v_e;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, number, entry_date, concept, source_type, status, created_by_name)
  values (v_acc, v_e, v_ej, 1, v_num, '2026-10-15', 'Factura expedida Prueba S01d', 'manual', 'validado', 'Prueba S01d') returning id into v_val;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  values (v_acc, v_e, v_ej, 1, '2026-10-16', 'Factura expedida Prueba S01d (borrador)', 'manual', 'borrador', 'Prueba S01d') returning id into v_bor;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, number, entry_date, concept, source_type, status, created_by_name)
  values (v_acc, v_e, v_ej, 3, v_num + 1, '2026-10-16', 'Cobro Prueba S01d', 'manual', 'validado', 'Prueba S01d') returning id into v_otro;
  perform set_config('prueba.val', v_val::text, true);
  perform set_config('prueba.bor', v_bor::text, true);
  perform set_config('prueba.otro', v_otro::text, true);
end $$;

-- 3 · Como A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant text := 'c01a0000-0000-4000-8000-00000000000a';
  v_val uuid := current_setting('prueba.val')::uuid;
  v_ruta text := v_acc || '/' || current_setting('prueba.val') || '/0123456789abcdef.pdf';
  r jsonb;
begin
  begin
    perform public.conta_documento_expedida_guardar(current_setting('prueba.bor')::uuid, v_acc || '/' || current_setting('prueba.bor') || '/0123456789abcdef.pdf', 'f.pdf', repeat('ab', 32), 1234, 'Prueba');
    raise exception 'PRUEBA S01d 0160 · 3: ha guardado un PDF en un borrador.';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.conta_documento_expedida_guardar(current_setting('prueba.otro')::uuid, v_acc || '/' || current_setting('prueba.otro') || '/0123456789abcdef.pdf', 'f.pdf', repeat('ab', 32), 1234, 'Prueba');
    raise exception 'PRUEBA S01d 0160 · 3: ha guardado una factura en un asiento que no es una expedida.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.conta_documento_expedida_guardar(v_val, v_ruta, 'expedida.pdf', repeat('ab', 32), 1234, 'Prueba');
    raise exception 'PRUEBA S01d 0160 · 3: ha enlazado un PDF que no está subido.';
  exception when sqlstate 'P0002' then null; end;
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  r := public.conta_documento_expedida_guardar(v_val, v_ruta, 'expedida.pdf', repeat('ab', 32), 1234, 'Prueba');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA S01d 0160 · 3: la primera vez dice que ya estaba.'; end if;
  r := public.conta_documento_expedida_guardar(v_val, v_ruta, 'expedida.pdf', repeat('ab', 32), 1234, 'Prueba');
  if not (r->>'ya_estaba')::boolean then raise exception 'PRUEBA S01d 0160 · 3: la segunda vez ha hecho otro.'; end if;
  begin
    perform public.conta_documento_expedida_guardar(v_val, v_ruta, 'otra.pdf', repeat('cd', 32), 1234, 'Prueba');
    raise exception 'PRUEBA S01d 0160 · 3: ha cambiado el PDF de una expedida que ya lo tenía.';
  exception when unique_violation then null; end;
  if (select kind from public.journal_entry_document where entry_id = v_val) <> 'factura_expedida' then
    raise exception 'PRUEBA S01d 0160 · 3: no es kind factura_expedida.';
  end if;
  raise notice 'PRUEBA S01d 0160 · 3: borrador no, cobro no, sin fichero no; con el PDF sí (factura_expedida), la segunda vez «ya estaba» y otro no lo cambia.';
end $$;
reset role;

-- 4 · Como B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_documento_expedida_guardar(current_setting('prueba.val')::uuid, 'x', 'x.pdf', repeat('ab', 32), 1, 'B');
    raise exception 'PRUEBA S01d 0160 · 4: B ha guardado en A.';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PRUEBA S01d 0160 · 4: B no guarda documentos en A.';
end $$;
reset role;

-- 5 · La vuelta atrás, de verdad.
-- 5a · Con un PDF de expedida enlazado, PARA sin tocar nada.
savepoint con_pdf;
\set ON_ERROR_STOP off
\i supabase/vuelta-atras/20261122T0160_s01d_documento_expedida.down.sql
\set ON_ERROR_STOP on
rollback to savepoint con_pdf;
do $$ begin
  if to_regprocedure('public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text)') is null then
    raise exception 'PRUEBA S01d 0160 · 5a: con un PDF enlazado, la vuelta atrás ha quitado la función.';
  end if;
  raise notice 'PRUEBA S01d 0160 · 5a: con un PDF de expedida enlazado, la vuelta atrás para y no toca nada.';
end $$;
-- 5b · Sin él: la función fuera y el CHECK de antes.
delete from public.journal_entry_document where kind = 'factura_expedida';
\i supabase/vuelta-atras/20261122T0160_s01d_documento_expedida.down.sql
do $$ begin
  if to_regprocedure('public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text)') is not null then
    raise exception 'PRUEBA S01d 0160 · 5b: la función sigue.';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'journal_entry_document_kind_check')
     <> 'CHECK ((kind = ANY (ARRAY[''resumen_ventas''::text, ''factura_recibida''::text])))' then
    raise exception 'PRUEBA S01d 0160 · 5b: el CHECK no ha vuelto al de antes.';
  end if;
  raise notice 'PRUEBA S01d 0160 · 5b: sin PDF de expedidas, la vuelta atrás quita la función y deja el CHECK de antes.';
end $$;
-- 5c · Y se vuelve a aplicar.
\i supabase/migrations/20261122T0160_s01d_documento_expedida.sql
do $$ begin
  if to_regprocedure('public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text)') is null then
    raise exception 'PRUEBA S01d 0160 · 5c: no se ha podido volver a aplicar.';
  end if;
  raise notice 'PRUEBA S01d 0160 · 5c: se vuelve a aplicar.';
end $$;

rollback;
