-- supabase/staging/sql/20261120_k07_cambiar_documento_prueba.sql
--
-- SOLO STAGING. Prueba del K07 (20261120T2004_k07_cambiar_documento), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción
-- con ROLLBACK: staging no cambia. Nombra los objetos nuevos:
-- public.journal_entry_document_anterior y
-- public.conta_recibida_documento_cambiar(uuid,text,text,text). No cambia
-- ninguno que exista.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. La
-- recibida, su asiento y los ficheros son inventados, dentro de la
-- transacción (T11).
--
--   0. La 2004 está delante; conta_recibida_papel_poner y
--      conta_documento_factura_guardar, las de siempre (md5 al empezar y al acabar).
--   1. Una recibida contabilizada con su documento enlazado al asiento: el
--      asiento validado (journal_entry_validar), el documento de la factura y
--      el del asiento (journal_entry_document).
--   2. Cambiarlo (el camino de «Cambiar el documento»):
--      a. la factura con el nuevo, su traza en supplier_invoice_change con el
--         de antes, y la frase;
--      b. el del asiento, guardado tal cual en journal_entry_document_anterior
--         (quién y cuándo) y sin enlace: la pasada del minuto lo enlaza
--         (conta_recibida_pdf_por_enlazar lo propone con el nuevo);
--      c. el asiento no cambia (sus apuntes y su estado);
--      d. los ficheros no se borran.
--   3. Lo que no cambia, con su frase: una sin contabilizar (va por la ficha),
--      el mismo documento, un fichero que no está subido, uno de otra carpeta.
--   4. Deshacer: la vuelta atrás quita la función y deja la tabla (ya guarda
--      uno: es su historial).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K07: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Lo de antes.
create temp table _k07 (clave text primary key, valor text) on commit drop;
grant select, insert on _k07 to authenticated;
insert into _k07 values ('md5', md5(pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure)
                                    || pg_get_functiondef('public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)'::regprocedure)));
do $$ begin
  if to_regprocedure('public.conta_recibida_documento_cambiar(uuid,text,text,text)') is null or to_regclass('public.journal_entry_document_anterior') is null then
    raise exception 'PRUEBA K07 · 0: falta la 2004 delante (la pone el ensayo de staging).';
  end if;
  if not exists (select 1 from public.company where id = 'c0e20000-0000-4000-8000-0000000000e3') then
    raise exception 'PRUEBA K07 · 0: falta la gestoría del núcleo (seed_k02_nucleo_staging.sql).';
  end if;
  raise notice '0 · la 2004 delante; conta_recibida_papel_poner y conta_documento_factura_guardar medidas (md5).';
end $$;

-- 1 · Lo inventado: dos recibidas del Proveedor de Prueba Ficha Uno (su 40000071), una contabilizada y otra no, y tres ficheros.
insert into storage.objects (bucket_id, name, metadata) values
  ('receipt-uploads', 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/antes.pdf', '{"size": 1234, "mimetype": "application/pdf"}'),
  ('receipt-uploads', 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf', '{"size": 2345, "mimetype": "application/pdf"}'),
  ('receipt-uploads', 'c0e20000-0000-4000-8000-0000000000e9/k07-prueba/ajeno.pdf', '{"size": 99, "mimetype": "application/pdf"}');
insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                     tax_base_total, tax_total, grand_total, needs_review, raw_document_url, created_by_name)
select x.id::uuid, 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', 'c0e40000-0000-4000-8000-0000000000a1', 'invoice',
       x.numero, date '2026-10-20', x.estado, 'manual', 100, 21, 121, false, 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/antes.pdf', 'prueba K07'
  from (values ('c0e70000-0000-4000-8000-0000000000f1', 'K07-PRUEBA-1', 'aprobada'),
               ('c0e70000-0000-4000-8000-0000000000f2', 'K07-PRUEBA-2', 'en_revision')) x(id, numero, estado);
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-10-20' between starts_on and ends_on;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, document_ref)
  values (a, emp, v_y, 2, '2026-10-20', 'K07-PRUEBA-1-Proveedor de Prueba Ficha Uno, S.L.', 'supplier_invoice', 'c0e70000-0000-4000-8000-0000000000f1', 'K07-PRUEBA-1')
  returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
  select a, emp, v_e, x.p, c.id, x.d, x.h
    from (values (1, '60000000', 121, 0), (2, '40000071', 0, 121)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  insert into _k07 values ('asiento', v_e::text);
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid := (select valor::uuid from _k07 where clave = 'asiento');
begin
  perform public.journal_entry_validar(v_e, 'Prueba K07');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K07 · 1: el asiento no ha quedado validado'; end if;
end $$;
reset role;
-- Su documento enlazado al asiento, como lo deja la pasada del minuto.
insert into storage.objects (bucket_id, name, metadata)
select 'conta-documentos', 'c0e20000-0000-4000-8000-0000000000e0/' || valor || '/0123456789abcdef0123.pdf', '{"size": 1234, "mimetype": "application/pdf"}' from _k07 where clave = 'asiento';
insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by_name)
select 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', valor::uuid, 'factura_recibida',
       'c0e20000-0000-4000-8000-0000000000e0/' || valor || '/0123456789abcdef0123.pdf', 'K07-PRUEBA-1.pdf', repeat('a', 64), 1234, 'automático'
  from _k07 where clave = 'asiento';
insert into _k07 select 'apuntes', string_agg(c.code || ':' || l.debit || ':' || l.credit, ' ' order by l.position)
  from public.journal_line l join public.company_account c on c.id = l.company_account_id where l.entry_id = (select valor::uuid from _k07 where clave = 'asiento');
do $$ begin raise notice '1 · la K07-PRUEBA-1 contabilizada (%), con su documento en la factura y enlazado a su asiento.', (select valor from _k07 where clave = 'apuntes'); end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 2 · Cambiarlo.
do $$
declare
  r jsonb; v_e uuid := (select valor::uuid from _k07 where clave = 'asiento');
  v_doc text; v_n int; v_ap text; v_x record;
begin
  r := public.conta_recibida_documento_cambiar('c0e70000-0000-4000-8000-0000000000f1', 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf', 'nuevo.pdf', 'Prueba K07');
  -- a · La factura, con el nuevo y su traza.
  select raw_document_url into v_doc from public.supplier_invoice where id = 'c0e70000-0000-4000-8000-0000000000f1';
  if v_doc <> 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf' then raise exception 'PRUEBA K07 · 2a: la factura tiene %', v_doc; end if;
  select count(*) into v_n from public.supplier_invoice_change c
   where c.supplier_invoice_id = 'c0e70000-0000-4000-8000-0000000000f1' and c.what = 'papel' and c.by_name = 'Prueba K07'
     and c.cambios -> 0 ->> 'antes' = 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/antes.pdf'
     and c.cambios -> 0 ->> 'ahora' = 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf'
     and (c.cambios -> 0 ->> 'contabilizada')::boolean;
  if v_n <> 1 then raise exception 'PRUEBA K07 · 2a: la traza del cambio no está (%)', v_n; end if;
  if r->>'texto' !~ '^Documento cambiado: «nuevo\.pdf»\. El de antes queda en su historial; el asiento no cambia\.' then
    raise exception 'PRUEBA K07 · 2a: la frase es «%»', r->>'texto';
  end if;
  raise notice '2a · %', r->>'texto';
  -- b · El del asiento, guardado y sin enlace; la pasada del minuto lo enlazaría con el nuevo.
  select * into v_x from public.journal_entry_document_anterior where entry_id = v_e;
  if v_x.id is null or v_x.file_name <> 'K07-PRUEBA-1.pdf' or v_x.replaced_by_name <> 'Prueba K07' or v_x.replaced_with <> 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf' then
    raise exception 'PRUEBA K07 · 2b: el del asiento no se ha guardado como era';
  end if;
  if exists (select 1 from public.journal_entry_document where entry_id = v_e) then raise exception 'PRUEBA K07 · 2b: el asiento sigue con el de antes enlazado'; end if;
  raise notice '2b · el del asiento, en journal_entry_document_anterior (%, por %); sin enlace.', v_x.file_name, v_x.replaced_by_name;
  -- c · El asiento no cambia.
  select string_agg(c.code || ':' || l.debit || ':' || l.credit, ' ' order by l.position) into v_ap
    from public.journal_line l join public.company_account c on c.id = l.company_account_id where l.entry_id = v_e;
  if v_ap <> (select valor from _k07 where clave = 'apuntes') or (select status from public.journal_entry where id = v_e) <> 'validado' then
    raise exception 'PRUEBA K07 · 2c: el asiento ha cambiado (%)', v_ap;
  end if;
  raise notice '2c · el asiento, igual: % y validado.', v_ap;
end $$;
reset role;
do $$
declare v_e uuid := (select valor::uuid from _k07 where clave = 'asiento'); v_r text;
begin
  -- b · Lo que mira la pasada del minuto (conta_recibida_pdf_por_enlazar), salvo sus 2 minutos desde que se validó
  --     (un asiento validado no se toca para adelantarlos): validado, sin documento enlazado y la factura con un PDF.
  select i.raw_document_url into v_r
    from public.journal_entry e join public.supplier_invoice i on i.id = e.source_id and i.account_id = e.account_id
   where e.id = v_e and e.status = 'validado' and e.source_type = 'supplier_invoice'
     and not exists (select 1 from public.journal_entry_document x where x.entry_id = e.id and x.kind = 'factura_recibida')
     and not exists (select 1 from public.conta_recibida_pdf r where r.invoice_id = i.id)
     and i.raw_document_url ~* '\.pdf$';
  if v_r is distinct from 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf' then raise exception 'PRUEBA K07 · 2b: la pasada del minuto enlazaría %', coalesce(v_r, 'nada'); end if;
  -- d · Los ficheros no se borran.
  if (select count(*) from storage.objects where bucket_id in ('receipt-uploads', 'conta-documentos')
        and (name like 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/%' or name like 'c0e20000-0000-4000-8000-0000000000e0/' || v_e || '/%')) <> 3 then
    raise exception 'PRUEBA K07 · 2d: falta algún fichero';
  end if;
  raise notice '2b/d · la pasada del minuto enlazaría el nuevo (a sus 2 minutos); los tres ficheros siguen.';
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
-- 3 · Lo que no cambia, con su frase.
do $$
declare x record;
begin
  for x in select * from (values
      ('sin contabilizar', 'c0e70000-0000-4000-8000-0000000000f2', 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf', '22023', 'No está contabilizada'),
      ('no subido', 'c0e70000-0000-4000-8000-0000000000f1', 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/no-esta.pdf', 'P0002', 'no está subido'),
      ('otra carpeta', 'c0e70000-0000-4000-8000-0000000000f1', 'c0e20000-0000-4000-8000-0000000000e9/k07-prueba/ajeno.pdf', '22023', 'carpeta de esta cuenta')) t(que, factura, ruta, codigo, frase) loop
    begin
      perform public.conta_recibida_documento_cambiar(x.factura::uuid, x.ruta, null, 'Prueba K07');
      raise exception 'PRUEBA K07 · 3 (%): se ha cambiado', x.que;
    exception when others then
      if sqlerrm like 'PRUEBA K07%' then raise; end if;
      if sqlstate <> x.codigo or sqlerrm not like '%' || x.frase || '%' then raise exception 'PRUEBA K07 · 3 (%): % «%»', x.que, sqlstate, sqlerrm; end if;
      raise notice '3 · %: %', x.que, sqlerrm;
    end;
  end loop;
  if (public.conta_recibida_documento_cambiar('c0e70000-0000-4000-8000-0000000000f1', 'c0e20000-0000-4000-8000-0000000000e0/k07-prueba/nuevo.pdf', null, 'Prueba K07')->>'ya_estaba')::boolean is not true then
    raise exception 'PRUEBA K07 · 3: el mismo documento no dice que ya era el suyo';
  end if;
  if (select count(*) from public.journal_entry_document_anterior) <> 1 then raise exception 'PRUEBA K07 · 3: ha guardado más de uno'; end if;
  raise notice '3 · el mismo documento: «ya era el suyo», sin guardar otro.';
end $$;
reset role;

-- 4 · Deshacer: la vuelta atrás quita la función; la tabla se queda (ya es historial).
\i supabase/vuelta-atras/20261120T2004_k07_cambiar_documento.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_documento_cambiar(uuid,text,text,text)') is not null then raise exception 'PRUEBA K07 · 4: la vuelta atrás no quita la función'; end if;
  if to_regclass('public.journal_entry_document_anterior') is null then raise exception 'PRUEBA K07 · 4: la vuelta atrás ha quitado el historial'; end if;
  if md5(pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure)
         || pg_get_functiondef('public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)'::regprocedure)) <> (select valor from _k07 where clave = 'md5') then
    raise exception 'PRUEBA K07 · 4: conta_recibida_papel_poner o conta_documento_factura_guardar han cambiado';
  end if;
  raise notice '4 · la vuelta atrás quita la función y deja el historial; las dos de siempre, iguales (md5).';
end $$;

rollback;
