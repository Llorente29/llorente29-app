-- supabase/staging/sql/20261206_d03_recibida_guardar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261206T0790_d03_recibida_guardar, con \i dentro de
-- la transacción y ROLLBACK: staging no cambia. Datos de la empresa A de
-- staging; la factura, su asiento propuesto y el fichero subido son inventados
-- dentro de la transacción.
--
--   (La 0790 solo añade y se puede pasar dos veces: desde la rama, W05 la deja
--   de verdad en staging. Por eso no empieza con su vuelta atrás: se aplica
--   otra vez, encima.)
--   1. La 0790.
--   2. Como usuario de A, cada clave de p_cambios, y lo escrito: proveedor,
--      número, fecha, local, vence (con su registro de pagos), forma de pago,
--      IVA por tipos con recargo (y los totales), retención (y el total menos
--      ella), gasto repartido y asiento a mano. Su asiento propuesto se quita
--      (sin descartarlo) y lo dice. El historial, campo a campo.
--   3. Lo que no: una clave que no conoce, un asiento que no cuadra, una
--      cuenta que no está en el plan, un local de otra cuenta. Y guardar lo
--      mismo otra vez no escribe nada.
--   4. Poner su documento: limpia «Sin PDF» y reinicia su fila del D02; fuera
--      de la carpeta de la cuenta, o sin subir, no.
--   5. «Sin PDF»: con documento no; sin motivo no; con motivo sí; quitarlo.
--   6. B no guarda, no pone documento, no marca «Sin PDF» ni lee el historial
--      de A.
--   7. Una factura de A con su asiento VALIDADO no se deja cambiar ni cambiar
--      de documento.
--   8. La vuelta atrás: sin nada guardado, quita las tres funciones, las dos
--      tablas y las seis columnas. Y otra vez delante. (Que con algo guardado
--      para lo dice su primer bloque; verlo parar pediría un ROLLBACK a medias.)
-- No toca coste ni stock: las líneas de la factura no se tocan (sin los
-- cuatro caminos de la regla 10, que no pasan por aquí).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D03 guardar: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · La 0790.
\i supabase/migrations/20261206T0790_d03_recibida_guardar.sql

-- Las piezas (como postgres: es la preparación).
create temp table _g (clave text primary key, id uuid, txt text) on commit drop;
grant select on _g to authenticated;
insert into _g (clave, id) select 'prov', s.id from public.supplier s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' order by s.created_at, s.id limit 1;
insert into _g (clave, id) select 'prov2', s.id from public.supplier s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and s.id not in (select id from _g) order by s.created_at, s.id limit 1;
insert into _g (clave, id) select 'local', l.id from public.locations l where l.account_id = 'c01a0000-0000-4000-8000-00000000000a' order by l.created_at, l.id limit 1;
insert into _g (clave, id) select 'local_b', l.id from public.locations l where l.account_id <> 'c01a0000-0000-4000-8000-00000000000a' order by l.created_at, l.id limit 1;
insert into _g (clave, txt) select 'gasto1', a.code from public.company_account a
 where a.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and a.code like '62%' and a.status = 'activa' order by a.code limit 1;
insert into _g (clave, txt) select 'gasto2', a.code from public.company_account a
 where a.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and a.code like '6%' and a.status = 'activa' and a.code <> (select txt from _g where clave = 'gasto1') order by a.code limit 1;
insert into _g (clave, txt) select 'prov_cta', a.code from public.company_account a
 where a.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and a.code like '4%' and a.status = 'activa' order by a.code limit 1;
insert into _g (clave, id) select 'validada', i.id from public.supplier_invoice i
  join public.journal_entry e on e.source_type = 'supplier_invoice' and e.source_id = i.id and e.account_id = i.account_id
 where i.account_id = 'c01a0000-0000-4000-8000-00000000000a' and e.status = 'validado' and i.status not in ('anulada', 'descartada')
 order by e.validated_at, e.id limit 1;
do $$ begin
  if (select count(*) from _g where clave <> 'local_b' and (id is not null or txt is not null)) <> 7 then
    raise exception 'PRUEBA D03 guardar · 0: a la empresa A de staging le falta algo (2 proveedores, un local, tres cuentas del plan y una recibida con asiento validado): %.',
      (select string_agg(clave, ', ') from _g where id is not null or txt is not null);
  end if;
end $$;

-- La factura de la prueba, en revisión, con un tipo de IVA y su asiento propuesto.
insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source,
                                     tax_base_total, tax_total, grand_total, needs_review, created_by_name)
select 'd0300000-0000-4000-8000-000000000790', 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', p.id, 'invoice',
       'D03-GUARDAR-1', date '2026-10-19', date '2026-10-19', 'en_revision', 'manual', 100, 21, 121, false, 'prueba D03'
  from _g p where p.clave = 'prov';
insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
values ('c01a0000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000790', 21, 100, 21);
insert into storage.objects (bucket_id, name, metadata)
values ('receipt-uploads', 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/la-factura.jpg', '{"mimetype": "image/jpeg", "size": 1000}');
insert into public.conta_recibida_pdf (invoice_id, account_id, attempts, last_error, next_try_at)
values ('d0300000-0000-4000-8000-000000000790', 'c01a0000-0000-4000-8000-00000000000a', 3, 'prueba: la foto de antes no se pudo convertir', now() + interval '1 hour');

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('fecha', '2026-10-19', 'source_type', 'supplier_invoice', 'source_id', 'd0300000-0000-4000-8000-000000000790', 'series', 2,
                       'concepto', 'Prueba D03', 'confianza', 'probable', 'porque', 'Prueba D03 guardar.'),
    jsonb_build_array(jsonb_build_object('cuenta', (select txt from _g where clave = 'gasto1'), 'debe', 121, 'comun', true),
                      jsonb_build_object('cuenta', (select txt from _g where clave = 'prov_cta'), 'haber', 121, 'comun', true)),
    null, 'Prueba D03');
  if r ->> 'id' is null or coalesce((r ->> 'existente')::boolean, false) then raise exception 'PRUEBA D03 guardar · 0: no se ha propuesto su asiento (%).', r; end if;
end $$;

-- 2 · Cada clave, como usuario de A.
do $$
declare
  c_f constant uuid := 'd0300000-0000-4000-8000-000000000790';
  r jsonb; f public.supplier_invoice; v_ret uuid; v_n int;
begin
  r := public.conta_recibida_guardar(c_f, jsonb_build_object('vence', '2026-11-18', 'forma_pago', 'transfer'), 'Prueba D03');
  select * into f from public.supplier_invoice where id = c_f;
  if f.due_date <> date '2026-11-18' or f.payment_method <> 'transfer' or r -> 'guardado' <> '["forma_pago", "vence"]'::jsonb
     or coalesce((r ->> 'asiento_quitado')::boolean, true)
     or r ->> 'texto' <> 'Guardado: Forma de pago sin decir → Transferencia, Vence 19/10/2026 → 18/11/2026.' then
    raise exception 'PRUEBA D03 guardar · 2a: vence y forma de pago (% / % / %).', f.due_date, f.payment_method, r;
  end if;
  if not exists (select 1 from public.supplier_invoice_payment_log where invoice_id = c_f and action = 'due_date_changed' and due_date = date '2026-11-18') then
    raise exception 'PRUEBA D03 guardar · 2a: el vencimiento no deja su registro de pagos.';
  end if;
  if not exists (select 1 from public.journal_entry where source_type = 'supplier_invoice' and source_id = c_f and status = 'propuesto') then
    raise exception 'PRUEBA D03 guardar · 2a: vence y forma de pago no tocan el asiento, y se ha ido.';
  end if;
  raise notice '2a · %', r ->> 'texto';

  -- El 15 %: profesionales (uno solo de ese tanto).
  select id into v_ret from public.withholding_rate where code = 'profesional' and is_system;
  r := public.conta_recibida_guardar(c_f, jsonb_build_object(
    'proveedor', (select id from _g where clave = 'prov2'), 'numero', '  D03-GUARDAR-1B ', 'fecha', '2026-10-20', 'local', (select id from _g where clave = 'local'),
    'iva', jsonb_build_array(jsonb_build_object('tipo', 21, 'base', 100, 'cuota', 21, 'recargo_tipo', 5.2, 'recargo', 5.2),
                             jsonb_build_object('tipo', 10, 'base', 50, 'cuota', 5, 'recargo_tipo', 1.4, 'recargo', 0.7)),
    'retencion', jsonb_build_object('tipo', 15, 'base', 150, 'importe', 22.5),
    'gasto', jsonb_build_array(jsonb_build_object('cuenta', (select txt from _g where clave = 'gasto1'), 'local', (select id from _g where clave = 'local'), 'comun', false, 'importe', 100),
                               jsonb_build_object('cuenta', (select txt from _g where clave = 'gasto2'), 'local', null, 'comun', true, 'importe', 50)),
    'asiento_a_mano', jsonb_build_array(jsonb_build_object('posicion', 0, 'cuenta', (select txt from _g where clave = 'gasto1'), 'debe', 159.4, 'haber', 0),
                                        jsonb_build_object('posicion', 1, 'cuenta', (select txt from _g where clave = 'prov_cta'), 'debe', 0, 'haber', 159.4))), 'Prueba D03');
  select * into f from public.supplier_invoice where id = c_f;
  if f.supplier_id <> (select id from _g where clave = 'prov2') or f.invoice_number <> 'D03-GUARDAR-1B' or f.invoice_date <> date '2026-10-20'
     or f.location_id <> (select id from _g where clave = 'local') then
    raise exception 'PRUEBA D03 guardar · 2b: proveedor, número, fecha o local mal (% / % / % / %).', f.supplier_id, f.invoice_number, f.invoice_date, f.location_id;
  end if;
  if f.tax_base_total <> 150 or f.tax_total <> 26 or f.surcharge_total <> 5.9 or f.withholding_rate_id <> v_ret or f.withholding_amount <> 22.5
     or f.withholding_base <> 150 or f.grand_total <> 159.4 then
    raise exception 'PRUEBA D03 guardar · 2b: totales o retención mal (base % · IVA % · recargo % · retención % % · total %).',
      f.tax_base_total, f.tax_total, f.surcharge_total, f.withholding_amount, f.withholding_rate_id, f.grand_total;
  end if;
  if (select count(*) from public.supplier_invoice_tax where supplier_invoice_id = c_f) <> 2
     or not exists (select 1 from public.supplier_invoice_tax where supplier_invoice_id = c_f and vat_pct = 10 and base = 50 and vat_amount = 5 and surcharge_pct = 1.4 and surcharge_amount = 0.7) then
    raise exception 'PRUEBA D03 guardar · 2b: el IVA por tipos no se ha rehecho.';
  end if;
  if (select count(*) from public.supplier_invoice_expense where supplier_invoice_id = c_f) <> 2
     or not exists (select 1 from public.supplier_invoice_expense where supplier_invoice_id = c_f and position = 1 and account_code = (select txt from _g where clave = 'gasto2')
                     and location_id is null and is_common and amount = 50) then
    raise exception 'PRUEBA D03 guardar · 2b: el gasto repartido no está.';
  end if;
  if jsonb_array_length(f.entry_overrides) <> 2 or not coalesce((r ->> 'asiento_quitado')::boolean, false)
     or exists (select 1 from public.journal_entry where source_type = 'supplier_invoice' and source_id = c_f)
     or exists (select 1 from public.journal_dismissal where source_type = 'supplier_invoice' and source_key = c_f::text) then
    raise exception 'PRUEBA D03 guardar · 2b: el asiento a mano, o quitar el propuesto (sin descartarlo), mal (%).', r;
  end if;
  if r -> 'guardado' <> '["proveedor", "numero", "fecha", "local", "iva", "retencion", "gasto", "asiento_a_mano"]'::jsonb then
    raise exception 'PRUEBA D03 guardar · 2b: lo guardado no es lo cambiado (%).', r -> 'guardado';
  end if;
  select count(*) into v_n from public.supplier_invoice_change where supplier_invoice_id = c_f and what = 'guardar';
  if v_n <> 2 or not exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = c_f and what = 'guardar' and jsonb_array_length(cambios) = 8)
     or exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = c_f and by_name is distinct from 'Prueba D03') then
    raise exception 'PRUEBA D03 guardar · 2b: el historial no tiene sus dos guardados campo a campo (%).', v_n;
  end if;
  raise notice '2b · %', r ->> 'texto';
end $$;

-- 3 · Lo que no.
do $$
declare c_f constant uuid := 'd0300000-0000-4000-8000-000000000790'; r jsonb; v_n int;
begin
  begin perform public.conta_recibida_guardar(c_f, '{"proveedr": 1}', null); raise exception 'PRUEBA D03 guardar · 3: una clave que no conoce se calla.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.conta_recibida_guardar(c_f, jsonb_build_object('asiento_a_mano', jsonb_build_array(
      jsonb_build_object('cuenta', (select txt from _g where clave = 'gasto1'), 'debe', 10), jsonb_build_object('cuenta', (select txt from _g where clave = 'prov_cta'), 'haber', 9))), null);
    raise exception 'PRUEBA D03 guardar · 3: un asiento que no cuadra se ha guardado.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_recibida_guardar(c_f, '{"gasto": [{"cuenta": "99999999", "importe": 1}]}', null); raise exception 'PRUEBA D03 guardar · 3: una cuenta que no está en el plan.';
  exception when sqlstate '22023' then null; end;
  if exists (select 1 from _g where clave = 'local_b') then
    begin perform public.conta_recibida_guardar(c_f, jsonb_build_object('local', (select id from _g where clave = 'local_b')), null); raise exception 'PRUEBA D03 guardar · 3: un local de otra cuenta.';
    exception when insufficient_privilege then null; end;
  end if;
  select count(*) into v_n from public.supplier_invoice_change where supplier_invoice_id = c_f;
  r := public.conta_recibida_guardar(c_f, jsonb_build_object('numero', 'D03-GUARDAR-1B', 'vence', '2026-11-18',
    'iva', jsonb_build_array(jsonb_build_object('tipo', 10, 'base', 50, 'cuota', 5, 'recargo_tipo', 1.4, 'recargo', 0.7),
                             jsonb_build_object('tipo', 21, 'base', 100, 'cuota', 21, 'recargo_tipo', 5.2, 'recargo', 5.2))), null);
  if r -> 'guardado' <> '[]'::jsonb or (select count(*) from public.supplier_invoice_change where supplier_invoice_id = c_f) <> v_n then
    raise exception 'PRUEBA D03 guardar · 3: guardar lo mismo ha escrito algo (%).', r;
  end if;
  raise notice '3 · clave rara, asiento que no cuadra, cuenta fuera del plan y local de otra cuenta: no; lo mismo otra vez: «%»', r ->> 'texto';
end $$;

-- 4 y 5 · Su documento y «Sin PDF».
do $$
declare c_f constant uuid := 'd0300000-0000-4000-8000-000000000790'; r jsonb; f public.supplier_invoice;
begin
  begin perform public.conta_recibida_sin_papel(c_f, true, '  ', null); raise exception 'PRUEBA D03 guardar · 5: «Sin PDF» sin motivo.';
  exception when sqlstate '22023' then null; end;
  r := public.conta_recibida_sin_papel(c_f, true, 'El proveedor no la manda', 'Prueba D03');
  select * into f from public.supplier_invoice where id = c_f;
  if f.no_document_at is null or f.no_document_reason <> 'El proveedor no la manda' or f.no_document_by_name <> 'Prueba D03' then
    raise exception 'PRUEBA D03 guardar · 5: «Sin PDF» no se ha guardado (%).', r;
  end if;
  begin perform public.conta_recibida_papel_poner(c_f, 'c01a0000-0001-4000-8000-00000000000a/x.pdf', null, null); raise exception 'PRUEBA D03 guardar · 4: un documento fuera de la carpeta de la cuenta.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_recibida_papel_poner(c_f, 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/no-subida.pdf', null, null); raise exception 'PRUEBA D03 guardar · 4: un documento sin subir.';
  exception when sqlstate 'P0002' then null; end;
  r := public.conta_recibida_papel_poner(c_f, 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/la-factura.jpg', 'la-factura.jpg', 'Prueba D03');
  select * into f from public.supplier_invoice where id = c_f;
  if f.raw_document_url <> 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/la-factura.jpg' or f.no_document_at is not null or f.no_document_reason is not null
     or not coalesce((r ->> 'pdf_reiniciado')::boolean, false) then
    raise exception 'PRUEBA D03 guardar · 4: poner su documento no limpia «Sin PDF» o no reinicia el D02 (%).', r;
  end if;
  begin perform public.conta_recibida_sin_papel(c_f, true, 'otra vez', null); raise exception 'PRUEBA D03 guardar · 5: «Sin PDF» con documento.';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from public.supplier_invoice_change where supplier_invoice_id = c_f and what in ('papel', 'sin_papel')) <> 2 then
    raise exception 'PRUEBA D03 guardar · 4/5: el historial no tiene «Sin PDF» y el documento.';
  end if;
  raise notice '4/5 · «Sin PDF» con motivo y, al poner su documento, quitado: «%»', r ->> 'texto';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.conta_recibida_pdf where invoice_id = 'd0300000-0000-4000-8000-000000000790') then
    raise exception 'PRUEBA D03 guardar · 4: la fila del D02 de la foto de antes sigue ahí.';
  end if;
end $$;

-- 6 · B no.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare c_f constant uuid := 'd0300000-0000-4000-8000-000000000790';
begin
  begin perform public.conta_recibida_guardar(c_f, '{"numero": "B"}', null); raise exception 'PRUEBA D03 guardar · 6: B guarda en una factura de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_recibida_papel_poner(c_f, 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/la-factura.jpg', null, null); raise exception 'PRUEBA D03 guardar · 6: B pone el documento de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_recibida_sin_papel(c_f, false, null, null); raise exception 'PRUEBA D03 guardar · 6: B quita «Sin PDF» en A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = c_f)
     or exists (select 1 from public.supplier_invoice_expense where supplier_invoice_id = c_f) then
    raise exception 'PRUEBA D03 guardar · 6: B lee el historial o el gasto de A.';
  end if;
end $$;
reset role;

-- 7 · Con su asiento validado, no.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_f uuid := (select id from _g where clave = 'validada');
begin
  begin perform public.conta_recibida_guardar(v_f, '{"numero": "CAMBIADA"}', null); raise exception 'PRUEBA D03 guardar · 7: se ha cambiado una factura con su asiento validado.';
  exception when sqlstate '22023' then if sqlerrm not like 'Ya está contabilizada%' then raise; end if; end;
  begin perform public.conta_recibida_papel_poner(v_f, 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/la-factura.jpg', null, null); raise exception 'PRUEBA D03 guardar · 7: se ha cambiado el documento de una factura con su asiento validado.';
  exception when sqlstate '22023' then if sqlerrm not like 'Ya está contabilizada%' then raise; end if; end;
  raise notice '7 · con su asiento validado: ni guardar ni cambiar el documento';
end $$;
reset role;

-- 8 · La vuelta atrás. Con algo guardado PARA (lo comprueba su primer bloque; aquí
-- no se puede ver parar sin un ROLLBACK a medias, que staging-tanda no deja):
-- se vacía lo guardado en esta transacción y se aplica; quita todo. Y otra vez delante.
delete from public.supplier_invoice_change;
delete from public.supplier_invoice_expense;
update public.supplier_invoice set payment_method = null, no_document_at = null, no_document_reason = null, no_document_by_name = null,
       entry_overrides = null, withholding_base = null
 where payment_method is not null or no_document_at is not null or no_document_reason is not null or no_document_by_name is not null
    or entry_overrides is not null or withholding_base is not null;
\i supabase/vuelta-atras/20261206T0790_d03_recibida_guardar.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_guardar(uuid,jsonb,text)') is not null or to_regprocedure('public.conta_recibida_papel_poner(uuid,text,text,text)') is not null
     or to_regprocedure('public.conta_recibida_sin_papel(uuid,boolean,text,text)') is not null
     or to_regclass('public.supplier_invoice_expense') is not null or to_regclass('public.supplier_invoice_change') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice'
                 and column_name in ('payment_method', 'no_document_at', 'no_document_reason', 'no_document_by_name', 'entry_overrides', 'withholding_base')) then
    raise exception 'PRUEBA D03 guardar · 8: la vuelta atrás ha dejado algo de la 0790.';
  end if;
end $$;
\i supabase/migrations/20261206T0790_d03_recibida_guardar.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_guardar(uuid,jsonb,text)') is null or to_regclass('public.supplier_invoice_change') is null then
    raise exception 'PRUEBA D03 guardar · 8: otra vez delante no ha dejado la 0790.';
  end if;
  raise notice '8 · la vuelta atrás lo quita todo; y otra vez delante';
end $$;

rollback;
