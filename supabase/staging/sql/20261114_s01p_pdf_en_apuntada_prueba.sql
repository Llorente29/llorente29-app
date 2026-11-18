-- supabase/staging/sql/20261114_s01p_pdf_en_apuntada_prueba.sql
--
-- SOLO STAGING. Prueba de la 0831 (S01p·22: subir el PDF a una recibida ya apuntada que no lo
-- tiene), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A, una
-- recibida SIN documento con su asiento VALIDADO, como la GLOVOAPP I170326000585810 de Foodint.
--
--   1. Sin la 0831 (quitada con su vuelta atrás si el workflow ya la pasó): ponerle el PDF falla
--      con «Ya está contabilizada», como hoy en Foodint.
--   2. Con la 0831: se le pone el PDF, lo dice, y el asiento no cambia (mismo estado, número y apuntes).
--   3. Cambiar el PDF de una apuntada que ya lo tiene sigue sin dejarse.
--   4. La vuelta atrás: conta_recibida_papel_poner como estaba.
--
-- Nombra lo que toca, para el analizador: conta_recibida_papel_poner, supplier_invoice, journal_entry,
-- journal_line, storage.objects.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·22: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '30s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); el PDF se pone con «role authenticated» y los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

select strpos(pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure), 'S01p·22') > 0 as ya_esta \gset

-- La base local del W09 no trae el almacén de Supabase: ahí, una tabla mínima con lo que mira
-- la función (bucket y nombre). En staging existe y esto no hace nada.
do $$ begin
  if to_regclass('storage.objects') is null then
    create schema if not exists storage;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
  end if;
end $$;

-- La recibida de la prueba, sin documento, y su asiento validado (como postgres: es la preparación).
create temp table _p (clave text primary key, v uuid, t text) on commit drop;
grant select on _p to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; s uuid; e uuid; x record;
  v_f constant uuid := 'c01a2200-0000-4000-8000-000000000001';
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select id into s from public.supplier where account_id = v_acc order by created_at, id limit 1;
  if c is null or s is null then raise exception 'PRUEBA S01p·22: a la cuenta A le falta la empresa o un proveedor.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-31' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  update public.fiscal_year set status = 'open' where id = y;
  delete from public.fiscal_period_lock where company_id = c and month = '2026-10-01';
  for x in select * from (values ('62900096', '629'), ('57200096', '572')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p·22 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name)
  values (v_f, v_acc, c, s, 'invoice', 'PRUEBA-S01P22-1', date '2026-10-31', date '2026-10-31', 'en_revision', 'manual', 10, 0, 10, false, 'prueba S01p·22');
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status)
  values (v_acc, c, y, 2, '2026-10-31', 'PRUEBA S01p·22 factura recibida', 'supplier_invoice', v_f, 'borrador') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select v_acc, c, e, v.pos, a.id, v.debe, v.haber, true
    from (values (1, '62900096', 10.00, 0.00), (2, '57200096', 0.00, 10.00)) v(pos, code, debe, haber)
    join public.company_account a on a.company_id = c and a.code = v.code;
  perform public.journal_entry_validar(e, 'PRUEBA S01p·22');
  update public.supplier_invoice set status = 'aprobada', journal_entry_id = e where id = v_f;
  if (select status from public.journal_entry where id = e) <> 'validado' then raise exception 'PRUEBA S01p·22 · siembra: el asiento no queda validado.'; end if;
  insert into storage.objects (bucket_id, name, metadata) values
    ('receipt-uploads', v_acc || '/prueba-s01p22/la-factura.pdf', '{"mimetype": "application/pdf", "size": 1000}'),
    ('receipt-uploads', v_acc || '/prueba-s01p22/otra.pdf', '{"mimetype": "application/pdf", "size": 1000}');
  insert into _p values ('factura', v_f, null), ('asiento', e, null),
    ('huella', null, (select md5(string_agg(position || ':' || company_account_id || ':' || debit || ':' || credit, ',' order by position)) || '|' || je.status || '|' || je.number
                        from public.journal_line l join public.journal_entry je on je.id = l.entry_id where l.entry_id = e group by je.status, je.number));
end $$;

-- 1. Sin la 0831: falla como en Foodint.
\if :ya_esta
\i supabase/vuelta-atras/20261114T0831_s01p_pdf_en_apuntada.down.sql
\endif
set local role authenticated;
do $$ begin
  begin
    perform public.conta_recibida_papel_poner((select v from _p where clave = 'factura'), 'c01a0000-0000-4000-8000-00000000000a/prueba-s01p22/la-factura.pdf', 'la-factura.pdf', 'Prueba');
    raise exception 'PRUEBA S01p·22 · 1: sin la 0831 se deja poner: esta prueba no ve el caso de Foodint.';
  exception when sqlstate '22023' then
    if sqlerrm not like 'Ya está contabilizada%' then raise; end if;
    raise notice '1 · sin la 0831, falla como en Foodint: «%»', sqlerrm;
  end;
end $$;
reset role;
\i supabase/migrations/20261114T0831_s01p_pdf_en_apuntada.sql

-- 2. Con la 0831: se pone, lo dice, y el asiento no cambia.
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_recibida_papel_poner((select v from _p where clave = 'factura'), 'c01a0000-0000-4000-8000-00000000000a/prueba-s01p22/la-factura.pdf', 'la-factura.pdf', 'Prueba');
  if r->>'texto' <> 'Documento puesto: «la-factura.pdf».' then raise exception 'PRUEBA S01p·22 · 2: dice «%».', r->>'texto'; end if;
  raise notice '2 · %', r->>'texto';
end $$;
reset role;
do $$ begin
  if (select raw_document_url from public.supplier_invoice where id = (select v from _p where clave = 'factura')) <> 'c01a0000-0000-4000-8000-00000000000a/prueba-s01p22/la-factura.pdf' then
    raise exception 'PRUEBA S01p·22 · 2: la factura no tiene su PDF.';
  end if;
  if (select md5(string_agg(position || ':' || company_account_id || ':' || debit || ':' || credit, ',' order by position)) || '|' || je.status || '|' || je.number
        from public.journal_line l join public.journal_entry je on je.id = l.entry_id where l.entry_id = (select v from _p where clave = 'asiento') group by je.status, je.number)
     <> (select t from _p where clave = 'huella') then
    raise exception 'PRUEBA S01p·22 · 2: el asiento cambió.';
  end if;
  raise notice '2 · y el asiento sigue igual: validado, mismo número y mismos apuntes';
end $$;

-- 3. Cambiar el PDF de una apuntada que ya lo tiene, no.
set local role authenticated;
do $$ begin
  begin
    perform public.conta_recibida_papel_poner((select v from _p where clave = 'factura'), 'c01a0000-0000-4000-8000-00000000000a/prueba-s01p22/otra.pdf', 'otra.pdf', 'Prueba');
    raise exception 'PRUEBA S01p·22 · 3: se ha cambiado el PDF de una apuntada.';
  exception when sqlstate '22023' then
    if sqlerrm not like 'Ya está contabilizada%' then raise; end if;
    raise notice '3 · cambiar el PDF de una apuntada sigue sin dejarse: «%»', sqlerrm;
  end;
end $$;
reset role;

-- 4. La vuelta atrás.
\i supabase/vuelta-atras/20261114T0831_s01p_pdf_en_apuntada.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure), 'S01p·22') > 0 then
    raise exception 'PRUEBA S01p·22 · 4: conta_recibida_papel_poner sigue cambiada.';
  end if;
  raise notice '4 · la vuelta atrás: conta_recibida_papel_poner como estaba';
end $$;

rollback;
