-- supabase/staging/sql/20261113_b01r26_conta_pdf_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · el enlace permanente del PDF (1805). Todo
-- en una transacción con ROLLBACK, en la cuenta A, con un asiento, su documento
-- y un traspaso de mentira (no se sube ningún PDF: se prueba la base).
--   1. Sin traspaso confirmado no hay llaves (uno «con_fallos» para).
--   2. Con el traspaso confirmado: una llave por documento, de 32 hex; pedirla
--      otra vez da la misma.
--   3. Servir: «servido» con su ruta, y el acceso apuntado y contado.
--   4. El tope: a la petición 31 de la hora, «tope».
--   5. Una llave que no existe o mal formada: «no_existe», apuntado sin llave.
--   6. Retirar (un administrador, con motivo): «retirada»; sin motivo, para.
--   7. Nada de esto lo puede tocar un usuario por su cuenta (las tablas y las
--      funciones del servidor, sin permiso para authenticated).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 PDF: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
\i supabase/migrations/20261113T1805_b01r26_conta_pdf.sql

create temp table _r (clave text primary key, id uuid, x text) on commit drop;
grant all on _r to authenticated;

-- Siembra: un asiento a mano de octubre (el dueño lo escribe; lo valida el usuario de A).
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  c1 uuid; c2 uuid; v_y uuid; e uuid; v_admin uuid;
begin
  select id into c1 from public.company_account where company_id = emp and account_id = a and code like '572%' and status <> 'cerrada' order by code limit 1;
  select id into c2 from public.company_account where company_id = emp and account_id = a and code like '6%' and status <> 'cerrada' order by code limit 1;
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select up.user_id into v_admin from public.user_profiles up where up.account_id = a and up.role = 'admin' and up.active order by up.user_id limit 1;
  if c1 is null or c2 is null or v_y is null or v_admin is null then raise exception 'PRUEBA B01r26 PDF · siembra: a A le falta una 572, una 6, el ejercicio 2026 o un administrador.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-16', 'Prueba B01r26 PDF', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e, 1, c2, 4.56, 0, loc), (a, emp, e, 2, c1, 0, 4.56, loc);
  insert into _r values ('e', e, null), ('admin', v_admin, null);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.journal_entry_validar((select id from _r where clave = 'e'));
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  e uuid := (select id from _r where clave = 'e'); d uuid; t uuid; t2 uuid; k text; k2 text; r record; v_err text; i int;
begin
  if (select status from public.journal_entry where id = e) <> 'validado' then raise exception 'PRUEBA B01r26 PDF · siembra: el asiento no ha quedado validado.'; end if;
  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes)
  values (a, emp, e, 'factura_expedida', a || '/' || e || '/prueba-b01r26.pdf', 'prueba-b01r26.pdf', repeat('0', 64), 1) returning id into d;

  -- 1. Sin traspaso confirmado, nada.
  insert into public.conta_diez_traspaso (account_id, company_id, mes, estado) values (a, emp, date '2026-10-01', 'con_fallos') returning id into t;
  begin
    perform public.conta_pdf_llaves_del_traspaso(t);
    raise exception 'PRUEBA B01r26 PDF 1: ha dado llaves a un traspaso con fallos.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'traspaso confirmado' then raise; end if;
  end;

  -- 2. Confirmado: una llave por documento, la misma la segunda vez.
  update public.conta_diez_traspaso set estado = 'confirmado' where id = t;
  select x.llave into k from public.conta_pdf_llaves_del_traspaso(t) x where x.document_id = d;
  if k is null or k !~ '^[0-9a-f]{32}$' then raise exception 'PRUEBA B01r26 PDF 2: el documento del traspaso no tiene una llave de 32 hex (%).', k; end if;
  select x.llave into k2 from public.conta_pdf_llaves_del_traspaso(t) x where x.document_id = d;
  if k2 is distinct from k or (select count(*) from public.conta_pdf_llave where document_id = d) <> 1 then
    raise exception 'PRUEBA B01r26 PDF 2: pedirla otra vez no da la misma llave.';
  end if;

  -- 3. Servir.
  select * into r from public.conta_pdf_servir(k, 'abcdef0123456789');
  if r.resultado <> 'servido' or r.storage_path is distinct from a || '/' || e || '/prueba-b01r26.pdf' or r.file_name <> 'prueba-b01r26.pdf' then
    raise exception 'PRUEBA B01r26 PDF 3: no sirve el documento de la llave (%).', r.resultado;
  end if;
  if (select accesos from public.conta_pdf_llave where llave = k) <> 1
     or (select count(*) from public.conta_pdf_acceso x join public.conta_pdf_llave l on l.id = x.llave_id where l.llave = k and x.resultado = 'servido' and x.ip_hash = 'abcdef0123456789') <> 1 then
    raise exception 'PRUEBA B01r26 PDF 3: el acceso no queda apuntado y contado.';
  end if;

  -- 4. El tope: 30 por hora.
  for i in 2..30 loop perform public.conta_pdf_servir(k, null); end loop;
  select * into r from public.conta_pdf_servir(k, null);
  if r.resultado <> 'tope' or r.storage_path is not null then raise exception 'PRUEBA B01r26 PDF 4: la petición 31 de la hora no da «tope» (%).', r.resultado; end if;

  -- 5. No existe.
  select * into r from public.conta_pdf_servir(repeat('f', 32), null);
  if r.resultado <> 'no_existe' then raise exception 'PRUEBA B01r26 PDF 5: una llave que no existe da %.', r.resultado; end if;
  select * into r from public.conta_pdf_servir('../' || k, null);
  if r.resultado <> 'no_existe' then raise exception 'PRUEBA B01r26 PDF 5: una llave mal formada da %.', r.resultado; end if;
  if (select count(*) from public.conta_pdf_acceso where llave_id is null and resultado = 'no_existe' and en >= now() - interval '1 minute') < 2 then
    raise exception 'PRUEBA B01r26 PDF 5: las llaves que no existen no quedan apuntadas.';
  end if;
  insert into _r values ('k', null, k), ('t', t, null);
end $$;

-- 6. Retirar, como el administrador.
select set_config('request.jwt.claims', json_build_object('sub', (select id from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_err text; n int;
begin
  begin
    perform public.conta_pdf_retirar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', (select id from _r where clave = 'e'), '  ');
    raise exception 'PRUEBA B01r26 PDF 6: ha retirado sin motivo.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'motivo' then raise; end if;
  end;
  n := public.conta_pdf_retirar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', (select id from _r where clave = 'e'), 'PRUEBA: factura anulada');
  if n <> 1 then raise exception 'PRUEBA B01r26 PDF 6: retirar la del asiento ha retirado %.', n; end if;
  -- 7. Un usuario no lee las llaves ni sirve un PDF por su cuenta.
  begin
    perform 1 from public.conta_pdf_llave limit 1;
    raise exception 'PRUEBA B01r26 PDF 7: un usuario lee conta_pdf_llave.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_pdf_servir((select x from _r where clave = 'k'), null);
    raise exception 'PRUEBA B01r26 PDF 7: un usuario puede llamar a conta_pdf_servir.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_pdf_llaves_del_traspaso((select id from _r where clave = 't'));
    raise exception 'PRUEBA B01r26 PDF 7: un usuario puede pedir llaves.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare r record;
begin
  select * into r from public.conta_pdf_servir((select x from _r where clave = 'k'), null);
  if r.resultado <> 'retirada' or r.storage_path is not null then raise exception 'PRUEBA B01r26 PDF 6: una llave retirada da %.', r.resultado; end if;
end $$;

select 'PRUEBA B01r26 conta-pdf: en verde' as resultado;
rollback;
