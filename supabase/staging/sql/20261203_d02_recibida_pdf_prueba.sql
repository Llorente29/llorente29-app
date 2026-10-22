-- supabase/staging/sql/20261203_d02_recibida_pdf_prueba.sql
--
-- SOLO STAGING. Prueba de 20261203T0470_d02_recibida_pdf, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Datos de la empresa A de staging
-- (inventados); las fotos y los PDF son filas de storage.objects inventadas
-- dentro de la transacción (aquí no se sube nada: la conversión la prueban las
-- unitarias de tests/conta/d02).
--
--   (Empieza con la vuelta atrás, por si la 0470 ya estuviera.)
--   0. Lo de antes: conta_documento_factura_guardar es la de producción (md5
--      dbc3443e…), y el servidor no puede guardar con ella.
--   1. La 0470.
--   2. Lo que falta por convertir: una recibida de A con foto, sí; con PDF, no;
--      descartada, no. Solo el servidor: un usuario no lo ve.
--   3. Coger: la aparta 10 minutos; otra pasada no la coge.
--   4. Apuntar lo hecho: sin subir, con otra ruta o con otro tamaño, no; bien,
--      sí, y ya no falta. Otra vez lo mismo, vale; otro PDF, no.
--   5. Lo que falla: se reintenta a los 15 minutos; al tercero, no más.
--   6. Lo que falta por enlazar: el asiento validado de una recibida con su
--      PDF hecho, y el de una cuyo original ya es un PDF.
--   7. Enlazar: un usuario no; el servidor sí, con «automático», y despierta su
--      envío a Diez que esperaba por el documento. Otra vez, «ya estaba».
--      Y el administrador de A sigue guardando el suyo como antes.
--   8. Quién lee la tabla: A lo suyo, B nada. En staging no hay cron.
--   9. La vuelta atrás: con PDF hechos se da lo que la para; sin ellos, deja
--      la función byte a byte (md5 de producción) y nada de la 0470. Y otra vez
--      delante.
-- No toca coste ni stock: sin los cuatro caminos de la regla 10.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D02: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261203T0470_d02_recibida_pdf.down.sql

-- 0 · Lo de antes.
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)'::regprocedure)) into v_md5;
  if v_md5 <> 'dbc3443e216fe2a6b5131f40d2d04240' then raise exception 'PRUEBA D02 · 0: conta_documento_factura_guardar no es la de producción (%).', v_md5; end if;
end $$;

-- Las piezas, con nombre (como postgres: es la preparación).
create temp table _d02 (clave text primary key, id uuid) on commit drop;
grant select on _d02 to authenticated, service_role;
insert into _d02
select 'val', i.id from public.supplier_invoice i join public.journal_entry e on e.source_type = 'supplier_invoice' and e.source_id = i.id and e.account_id = i.account_id
 where i.account_id = 'c01a0000-0000-4000-8000-00000000000a' and e.status = 'validado' order by e.validated_at, e.id limit 1;
insert into _d02
select 'val2', i.id from public.supplier_invoice i join public.journal_entry e on e.source_type = 'supplier_invoice' and e.source_id = i.id and e.account_id = i.account_id
 where i.account_id = 'c01a0000-0000-4000-8000-00000000000a' and e.status = 'validado' and i.id not in (select id from _d02) order by e.validated_at, e.id limit 1;
insert into _d02
select k, id from (
  select i.id, row_number() over (order by i.created_at, i.id) n
    from public.supplier_invoice i
   where i.account_id = 'c01a0000-0000-4000-8000-00000000000a' and i.discarded_at is null and i.id not in (select id from _d02)
     and not exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status <> 'anulado')
) s join (values (1, 'foto'), (2, 'pdf'), (3, 'desc'), (4, 'otra')) v(n, k) on v.n = s.n;
do $$ begin
  if (select count(*) from _d02) <> 6 then raise exception 'PRUEBA D02 · 0: la empresa A no tiene en staging 2 recibidas validadas y 4 sin asiento (hay %).', (select count(*) from _d02); end if;
end $$;
-- Que las validadas no tengan ya su documento (en staging, ninguna lo tiene).
do $$ begin
  if exists (select 1 from public.journal_entry_document x join public.journal_entry e on e.id = x.entry_id join _d02 d on e.source_id = d.id and d.clave in ('val', 'val2')
              where e.source_type = 'supplier_invoice' and x.kind = 'factura_recibida') then
    raise exception 'PRUEBA D02 · 0: una validada de A ya tiene su documento.';
  end if;
end $$;
-- (Un asiento validado no se toca: journal_entry_inalterable. Los de A se validaron hace días.)
do $$ begin
  if exists (select 1 from public.journal_entry e join _d02 d on e.source_id = d.id and d.clave in ('val', 'val2')
              where e.source_type = 'supplier_invoice' and e.status = 'validado' and not (e.validated_at < now() - interval '2 minutes')) then
    raise exception 'PRUEBA D02 · 0: una validada de A es de hace menos de 2 minutos.';
  end if;
end $$;
-- Los originales: fotos y un PDF, inventados.
update public.supplier_invoice i set raw_document_url = 'c01a0000-0000-4000-8000-00000000000a/prueba-d02/' || d.clave || (case d.clave when 'pdf' then '.pdf' when 'val2' then '.pdf' else '.jpg' end)
  from _d02 d where i.id = d.id;
-- Una descartada, como se descarta (supplier_invoice_descartada_con_motivo).
update public.supplier_invoice i set status_before_discard = i.status, status = 'descartada', discarded_at = now(), discard_reason = 'Prueba D02'
  from _d02 d where i.id = d.id and d.clave = 'desc';
insert into storage.objects (bucket_id, name, metadata)
select 'receipt-uploads', i.raw_document_url, jsonb_build_object('mimetype', case when i.raw_document_url like '%.pdf' then 'application/pdf' else 'image/jpeg' end, 'size', 1000)
  from public.supplier_invoice i join _d02 d on d.id = i.id;
-- Que nada más de A estorbe en lo que coge la prueba: el resto de sus recibidas, sin original.
update public.supplier_invoice i set raw_document_url = null
 where i.account_id = 'c01a0000-0000-4000-8000-00000000000a' and i.id not in (select id from _d02) and i.raw_document_url is not null;

-- Sin la 0470, el servidor no guarda el documento de un asiento.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_e uuid;
begin
  select e.id into v_e from public.journal_entry e join _d02 d on e.source_id = d.id and d.clave = 'val' where e.source_type = 'supplier_invoice' and e.status = 'validado';
  begin
    perform public.conta_documento_factura_guardar(v_e, 'x', 'x.pdf', repeat('a', 64), 1, null);
    raise exception 'PRUEBA D02 · 0: el servidor ya guarda el documento antes de la 0470: ¿está ya aplicada?';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 1 · La 0470.
\i supabase/migrations/20261203T0470_d02_recibida_pdf.sql

-- 2 · Lo que falta por convertir.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform * from public.conta_recibida_pdf_por_hacer(50);
    raise exception 'PRUEBA D02 · 2: un usuario lee lo que falta por convertir.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_ids uuid[]; v_f jsonb;
begin
  select array_agg(p.invoice_id) into v_ids from public.conta_recibida_pdf_por_hacer(50) p where p.account_id = 'c01a0000-0000-4000-8000-00000000000a';
  if not (select id from _d02 where clave = 'foto') = any (v_ids) or not (select id from _d02 where clave = 'otra') = any (v_ids) then
    raise exception 'PRUEBA D02 · 2: no salen las dos fotos de A.';
  end if;
  if (select id from _d02 where clave = 'pdf') = any (v_ids) or (select id from _d02 where clave = 'desc') = any (v_ids) or (select id from _d02 where clave = 'val2') = any (v_ids) then
    raise exception 'PRUEBA D02 · 2: sale un PDF o una descartada como foto que convertir.';
  end if;
  select p.ficheros into v_f from public.conta_recibida_pdf_por_hacer(50) p where p.invoice_id = (select id from _d02 where clave = 'foto');
  if v_f <> jsonb_build_array(jsonb_build_object('bucket', 'receipt-uploads', 'ruta', 'c01a0000-0000-4000-8000-00000000000a/prueba-d02/foto.jpg')) then
    raise exception 'PRUEBA D02 · 2: los ficheros de la foto no son su original (%).', v_f;
  end if;
end $$;

-- 3 · Coger.
do $$
declare n int; v_r public.conta_recibida_pdf;
begin
  select count(*) into n from public.conta_recibida_pdf_reclamar(50) c where c.invoice_id in (select id from _d02 where clave in ('foto', 'otra'));
  if n <> 2 then raise exception 'PRUEBA D02 · 3: reclamar coge % de las 2 fotos.', n; end if;
  select * into v_r from public.conta_recibida_pdf where invoice_id = (select id from _d02 where clave = 'foto');
  if v_r.next_try_at < now() + interval '9 minutes' or v_r.storage_path is not null then raise exception 'PRUEBA D02 · 3: no la aparta 10 minutos.'; end if;
  select count(*) into n from public.conta_recibida_pdf_reclamar(50) c where c.invoice_id in (select id from _d02 where clave in ('foto', 'otra'));
  if n <> 0 then raise exception 'PRUEBA D02 · 3: otra pasada vuelve a coger % fotos apartadas.', n; end if;
end $$;
reset role;

-- 4 · Apuntar lo hecho. El PDF «subido», inventado.
select set_config('d02.sha', repeat('ab', 32), true);
select set_config('d02.ruta', 'c01a0000-0000-4000-8000-00000000000a/recibidas/' || (select id from _d02 where clave = 'foto') || '/' || repeat('ab', 8) || '.pdf', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare f uuid := (select id from _d02 where clave = 'foto');
begin
  begin
    perform public.conta_recibida_pdf_hecho(f, current_setting('d02.ruta'), current_setting('d02.sha'), 1234, 1);
    raise exception 'PRUEBA D02 · 4: apunta un PDF que no está subido.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
insert into storage.objects (bucket_id, name, metadata)
values ('conta-documentos', current_setting('d02.ruta'), '{"mimetype":"application/pdf","size":1234}');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare f uuid := (select id from _d02 where clave = 'foto'); v jsonb; v_r public.conta_recibida_pdf;
begin
  begin
    perform public.conta_recibida_pdf_hecho(f, replace(current_setting('d02.ruta'), '/recibidas/', '/otra/'), current_setting('d02.sha'), 1234, 1);
    raise exception 'PRUEBA D02 · 4: apunta un PDF en otra ruta.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_recibida_pdf_hecho(f, current_setting('d02.ruta'), current_setting('d02.sha'), 999, 1);
    raise exception 'PRUEBA D02 · 4: apunta un PDF con otro tamaño.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_recibida_pdf_hecho(f, current_setting('d02.ruta'), current_setting('d02.sha'), 1234, 1);
  if (v ->> 'ya_estaba')::boolean then raise exception 'PRUEBA D02 · 4: dice que ya estaba.'; end if;
  select * into v_r from public.conta_recibida_pdf where invoice_id = f;
  if v_r.storage_path <> current_setting('d02.ruta') or v_r.size_bytes <> 1234 or v_r.pages <> 1 or v_r.made_at is null or v_r.next_try_at is not null or v_r.last_error is not null then
    raise exception 'PRUEBA D02 · 4: la fila no dice lo hecho.';
  end if;
  if exists (select 1 from public.conta_recibida_pdf_por_hacer(50) p where p.invoice_id = f) then raise exception 'PRUEBA D02 · 4: con su PDF, sigue faltando.'; end if;
  v := public.conta_recibida_pdf_hecho(f, current_setting('d02.ruta'), current_setting('d02.sha'), 1234, 1);
  if not (v ->> 'ya_estaba')::boolean then raise exception 'PRUEBA D02 · 4: lo mismo otra vez no dice «ya estaba».'; end if;
end $$;
reset role;

-- 5 · Lo que falla (la otra foto).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare o uuid := (select id from _d02 where clave = 'otra'); v_r public.conta_recibida_pdf;
begin
  perform public.conta_recibida_pdf_fallo(o, 'la foto 1 es una foto HEIC (la de los iPhone) y solo sé convertir JPG y PNG', false);
  select * into v_r from public.conta_recibida_pdf where invoice_id = o;
  if v_r.attempts <> 1 or v_r.last_error not like 'la foto 1 es una foto HEIC%' or v_r.next_try_at < now() + interval '14 minutes' then
    raise exception 'PRUEBA D02 · 5: el fallo no queda apuntado con su reintento.';
  end if;
  if exists (select 1 from public.conta_recibida_pdf_por_hacer(50) p where p.invoice_id = o) then raise exception 'PRUEBA D02 · 5: se reintenta antes de tiempo.'; end if;
end $$;
reset role;
update public.conta_recibida_pdf set next_try_at = now() - interval '1 minute' where invoice_id = (select id from _d02 where clave = 'otra');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare o uuid := (select id from _d02 where clave = 'otra');
begin
  if not exists (select 1 from public.conta_recibida_pdf_por_hacer(50) p where p.invoice_id = o) then raise exception 'PRUEBA D02 · 5: con el reintento vencido, no vuelve.'; end if;
  perform public.conta_recibida_pdf_fallo(o, 'otra vez', false);
  perform public.conta_recibida_pdf_fallo(o, 'y otra', false);
end $$;
reset role;
update public.conta_recibida_pdf set next_try_at = now() - interval '1 minute' where invoice_id = (select id from _d02 where clave = 'otra');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if exists (select 1 from public.conta_recibida_pdf_por_hacer(50) p where p.invoice_id = (select id from _d02 where clave = 'otra')) then
    raise exception 'PRUEBA D02 · 5: con 3 intentos, se sigue intentando.';
  end if;
  if (select last_error from public.conta_recibida_pdf where invoice_id = (select id from _d02 where clave = 'otra')) <> 'y otra' then
    raise exception 'PRUEBA D02 · 5: no queda el último motivo.';
  end if;
end $$;
reset role;

-- 6 · Lo que falta por enlazar. La validada «val» tiene su foto ya convertida.
select set_config('d02.ruta_val', 'c01a0000-0000-4000-8000-00000000000a/recibidas/' || (select id from _d02 where clave = 'val') || '/' || repeat('cd', 8) || '.pdf', true);
insert into storage.objects (bucket_id, name, metadata)
values ('conta-documentos', current_setting('d02.ruta_val'), '{"mimetype":"application/pdf","size":2222}');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.conta_recibida_pdf_hecho((select id from _d02 where clave = 'val'), current_setting('d02.ruta_val'), repeat('cd', 32), 2222, 2) is not null as hecho_val;
do $$
declare v_val record; v_val2 record;
begin
  select * into v_val from public.conta_recibida_pdf_por_enlazar(50) p where p.invoice_id = (select id from _d02 where clave = 'val');
  select * into v_val2 from public.conta_recibida_pdf_por_enlazar(50) p where p.invoice_id = (select id from _d02 where clave = 'val2');
  if v_val.entry_id is null or v_val.bucket <> 'conta-documentos' or v_val.ruta <> current_setting('d02.ruta_val') or v_val.nombre not like '%.pdf' then
    raise exception 'PRUEBA D02 · 6: el asiento de la foto convertida no sale para enlazar con su PDF.';
  end if;
  if v_val2.entry_id is null or v_val2.bucket <> 'receipt-uploads' or v_val2.ruta <> 'c01a0000-0000-4000-8000-00000000000a/prueba-d02/val2.pdf' then
    raise exception 'PRUEBA D02 · 6: el asiento cuyo original ya es un PDF no sale con su original.';
  end if;
  if exists (select 1 from public.conta_recibida_pdf_por_enlazar(50) p where p.invoice_id in (select id from _d02 where clave in ('foto', 'pdf', 'otra', 'desc'))) then
    raise exception 'PRUEBA D02 · 6: sale para enlazar una recibida sin asiento validado.';
  end if;
  perform set_config('d02.asiento', v_val.entry_id::text, true);
  perform set_config('d02.asiento2', v_val2.entry_id::text, true);
end $$;
reset role;

-- 7 · Enlazar. El PDF, «copiado» a la ruta del asiento; y su envío a Diez, esperando por el documento.
select set_config('d02.ruta_asiento', 'c01a0000-0000-4000-8000-00000000000a/' || current_setting('d02.asiento') || '/' || repeat('cd', 8) || '.pdf', true);
insert into storage.objects (bucket_id, name, metadata)
values ('conta-documentos', current_setting('d02.ruta_asiento'), '{"mimetype":"application/pdf","size":2222}');
delete from public.external_send where entry_id = current_setting('d02.asiento')::uuid;
insert into public.external_send (entry_id, account_id, company_id, kind, payload_hash, status, attempts, last_error, next_try_at, updated_at)
select e.id, e.account_id, e.company_id, 'factura', 'sin-enviar', 'pendiente', 0, 'falta el documento', now() + interval '15 minutes', now() - interval '5 minutes'
  from public.journal_entry e where e.id = current_setting('d02.asiento')::uuid;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_recibida_pdf_enlazar(current_setting('d02.asiento')::uuid, current_setting('d02.ruta_asiento'), 'x.pdf', repeat('cd', 32), 2222);
    raise exception 'PRUEBA D02 · 7: un usuario enlaza por la puerta del servidor.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v jsonb; v_x public.journal_entry_document; v_s public.external_send;
begin
  v := public.conta_recibida_pdf_enlazar(current_setting('d02.asiento')::uuid, current_setting('d02.ruta_asiento'), 'Proveedor Inventado F-1.pdf', repeat('cd', 32), 2222);
  if (v ->> 'ya_estaba')::boolean then raise exception 'PRUEBA D02 · 7: dice que ya estaba.'; end if;
  select * into v_x from public.journal_entry_document where entry_id = current_setting('d02.asiento')::uuid and kind = 'factura_recibida';
  if v_x.id is null or v_x.storage_path <> current_setting('d02.ruta_asiento') or v_x.created_by is not null or v_x.created_by_name <> 'automático' or v_x.file_name !~ '^[A-Za-z0-9._-]+\.pdf$' then
    raise exception 'PRUEBA D02 · 7: el documento no queda enlazado como del servidor, con su nombre limpio.';
  end if;
  select * into v_s from public.external_send where entry_id = current_setting('d02.asiento')::uuid;
  if v_s.next_try_at > now() then raise exception 'PRUEBA D02 · 7: su envío a Diez no se despierta.'; end if;
  if v_s.updated_at > now() - interval '4 minutes' then raise exception 'PRUEBA D02 · 7: despertar el envío toca su updated_at (y la cola esperaría 2 minutos más).'; end if;
  if exists (select 1 from public.conta_recibida_pdf_por_enlazar(50) p where p.entry_id = current_setting('d02.asiento')::uuid) then
    raise exception 'PRUEBA D02 · 7: enlazado, sigue saliendo para enlazar.';
  end if;
  v := public.conta_recibida_pdf_enlazar(current_setting('d02.asiento')::uuid, current_setting('d02.ruta_asiento'), 'Proveedor Inventado F-1.pdf', repeat('cd', 32), 2222);
  if not (v ->> 'ya_estaba')::boolean then raise exception 'PRUEBA D02 · 7: lo mismo otra vez no dice «ya estaba».'; end if;
end $$;
reset role;
-- El administrador de A guarda el de la otra validada, como antes.
select set_config('d02.ruta_asiento2', 'c01a0000-0000-4000-8000-00000000000a/' || current_setting('d02.asiento2') || '/' || repeat('ef', 8) || '.pdf', true);
insert into storage.objects (bucket_id, name, metadata)
values ('conta-documentos', current_setting('d02.ruta_asiento2'), '{"mimetype":"application/pdf","size":3333}');
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select (public.conta_documento_factura_guardar(current_setting('d02.asiento2')::uuid, current_setting('d02.ruta_asiento2'), 'otra.pdf', repeat('ef', 32), 3333, 'Prueba D02') ->> 'ya_estaba') = 'false' as guarda_el_administrador;
reset role;
-- Un usuario de B no guarda en un asiento de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_documento_factura_guardar(current_setting('d02.asiento2')::uuid, current_setting('d02.ruta_asiento2'), 'otra.pdf', repeat('ef', 32), 3333, null);
    raise exception 'PRUEBA D02 · 7: un usuario de B guarda en un asiento de A.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 8 · Quién lee la tabla. Y en staging no hay cron.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.conta_recibida_pdf where invoice_id in (select id from _d02)) < 3 then raise exception 'PRUEBA D02 · 8: A no lee sus filas.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_recibida_pdf where account_id = 'c01a0000-0000-4000-8000-00000000000a') then raise exception 'PRUEBA D02 · 8: B lee las filas de A.'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret')
     and exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'conta-recibida-pdf-despertar') then
    raise exception 'PRUEBA D02 · 8: hay cron sin secreto.';
  end if;
end $$;

-- 9 · La vuelta atrás. Con PDF hechos se da lo que la hace parar (no se
-- ejecuta aquí: pararía la transacción entera); sin ellos, se ejecuta.
do $$ begin
  if (select count(*) from public.conta_recibida_pdf where storage_path is not null) < 2 then
    raise exception 'PRUEBA D02 · 9: no hay los 2 PDF hechos con los que pararía la vuelta atrás.';
  end if;
end $$;
delete from public.conta_recibida_pdf;
\i supabase/vuelta-atras/20261203T0470_d02_recibida_pdf.down.sql
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)'::regprocedure)) into v_md5;
  if v_md5 <> 'dbc3443e216fe2a6b5131f40d2d04240' then raise exception 'PRUEBA D02 · 9: la vuelta atrás no deja la función de producción (%).', v_md5; end if;
  if to_regclass('public.conta_recibida_pdf') is not null or to_regprocedure('public.conta_recibida_pdf_reclamar(integer)') is not null
     or to_regprocedure('public.conta_recibida_pdf_enlazar(uuid,text,text,text,integer)') is not null or to_regprocedure('public.conta_recibida_pdf_despertar()') is not null then
    raise exception 'PRUEBA D02 · 9: la vuelta atrás deja cosas de la 0470.';
  end if;
end $$;
\i supabase/migrations/20261203T0470_d02_recibida_pdf.sql

select 'PRUEBA D02 · todo bien' as resultado;
rollback;
