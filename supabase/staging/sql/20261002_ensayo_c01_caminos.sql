-- SOLO STAGING-CONTA. ENSAYO de los caminos del C01, que NO deja nada escrito.
--
-- Todo el trabajo va dentro de un sub-bloque que acaba en `raise exception`.
-- Al capturarla, PostgreSQL deshace el sub-bloque entero (es un punto de
-- guardado): el documento de cumplimiento, los pagos, el rastro y también el
-- cambio de rol a `authenticated`. Fuera queda solo el texto del resultado,
-- que sale como NOTICE en el log del workflow. Y una guarda final comprueba
-- que de verdad no ha quedado nada.
--
-- Qué ensaya (regla 10 de CLAUDE.md: por sus caminos, no por su fórmula):
--   1     compliance_docs_due lee el email del CONTACTO PRINCIPAL
--   2     qué ve el admin de A (y que de B no ve nada)
--   3-6   marcar pagada / deshacer / cambiar vencimiento, con su rastro
--   7-15  lo que A NO puede hacer sobre B (RPC, RLS y el disparador de cuenta)
--   16    refresh_supplier_proposals sin lecturas automáticas
--   17    qué ve el admin de B
do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  a_ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  b_carnes constant uuid := 'c01b0000-0000-4000-8000-0000000000b3';
  a_fac uuid; b_fac uuid; b_contacto uuid;
  r text := ''; n int; t text;
  c_marca constant text := 'ENSAYO-C01-FIN';
begin
  begin
  select id into a_fac from supplier_invoice where account_id = a_cuenta;
  select id into b_fac from supplier_invoice where account_id = b_cuenta;
  select id into b_contacto from supplier_contact where account_id = b_cuenta;

  -- 1 · Aviso de cumplimiento: lee el email del contacto principal.
  insert into compliance_document (account_id, supplier_id, doc_family, title, file_path, expires_at)
  values (a_cuenta, a_ruiz, 'bank_ownership_certificate', 'Certificado banco (ensayo)', 'ensayo/x.pdf', current_date + 10);
  select string_agg(supplier_name||' → '||coalesce(supplier_email,'SIN EMAIL'), ', ') into t from compliance_docs_due(30);
  r := r || E'\n1 aviso: ' || coalesce(t,'nada');

  -- 2 · Como A.
  perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  r := r || E'\n2 A ve: proveedores=' || (select count(*) from supplier)
          || ' contactos=' || (select count(*) from supplier_contact)
          || ' propuestas=' || (select count(*) from supplier_proposal)
          || ' facturas=' || (select count(*) from supplier_invoice)
          || ' tipos_gasto=' || (select count(*) from expense_category)
          || ' | de B: proveedores=' || (select count(*) from supplier where account_id = b_cuenta)
          || ' contactos=' || (select count(*) from supplier_contact where account_id = b_cuenta);

  -- 3 · Pagar, deshacer, vencimiento.
  perform mark_supplier_invoice_paid(a_fac, date '2026-10-01', 'transfer');
  select status||' paid_at='||paid_at||' metodo='||paid_method||' por='||coalesce(paid_by_name,'?') into t from supplier_invoice where id = a_fac;
  r := r || E'\n3 pagada: ' || t;
  perform unmark_supplier_invoice_paid(a_fac);
  select status||' paid_at='||coalesce(paid_at::text,'null')||' metodo='||coalesce(paid_method,'null') into t from supplier_invoice where id = a_fac;
  r := r || E'\n4 deshecha: ' || t;
  perform set_supplier_invoice_due_date(a_fac, date '2026-10-24');
  select due_date||' por='||coalesce(due_date_set_name,'?') into t from supplier_invoice where id = a_fac;
  r := r || E'\n5 vencimiento: ' || t;
  select string_agg(action||'/'||coalesce(actor_name,'?'), ', ' order by created_at, action) into t from supplier_invoice_payment_log;
  r := r || E'\n6 rastro visto por A: ' || coalesce(t,'nada');

  -- 4 · Lo que A NO puede hacer con B.
  begin perform mark_supplier_invoice_paid(b_fac, current_date, 'cash'); r := r || E'\n7 pagar factura de B: ¡ENTRÓ!';
  exception when others then r := r || E'\n7 pagar factura de B: rechazado (' || sqlerrm || ')'; end;
  begin perform unmark_supplier_invoice_paid(b_fac); r := r || E'\n8 deshacer de B: ¡ENTRÓ!';
  exception when others then r := r || E'\n8 deshacer de B: rechazado (' || sqlerrm || ')'; end;
  begin perform set_supplier_invoice_due_date(b_fac, current_date); r := r || E'\n9 vencimiento de B: ¡ENTRÓ!';
  exception when others then r := r || E'\n9 vencimiento de B: rechazado (' || sqlerrm || ')'; end;
  update supplier_contact set name = 'pirata' where id = b_contacto; get diagnostics n = row_count;
  r := r || E'\n10 editar contacto de B: filas=' || n;
  delete from supplier_contact where id = b_contacto; get diagnostics n = row_count;
  r := r || E'\n11 borrar contacto de B: filas=' || n;
  begin insert into supplier_contact (account_id, supplier_id, name) values (b_cuenta, b_carnes, 'pirata'); r := r || E'\n12 crear contacto en B: ¡ENTRÓ!';
  exception when others then r := r || E'\n12 crear contacto en B: rechazado (' || sqlerrm || ')'; end;
  begin insert into supplier_contact (account_id, supplier_id, name) values (a_cuenta, b_carnes, 'pirata'); r := r || E'\n13 contacto de A colgado de proveedor de B: ¡ENTRÓ!';
  exception when others then r := r || E'\n13 contacto de A colgado de proveedor de B: rechazado (' || sqlerrm || ')'; end;
  begin insert into supplier_invoice_payment_log (account_id, invoice_id, action) values (a_cuenta, a_fac, 'paid'); r := r || E'\n14 escribir el rastro a mano: ¡ENTRÓ!';
  exception when others then r := r || E'\n14 escribir el rastro a mano: rechazado (' || sqlerrm || ')'; end;
  begin insert into supplier_proposal (account_id, supplier_id, field, value, source) values (b_cuenta, b_carnes, 'tax_id', '"X"', 'legacy_address'); r := r || E'\n15 propuesta en B: ¡ENTRÓ!';
  exception when others then r := r || E'\n15 propuesta en B: rechazado (' || sqlerrm || ')'; end;
  r := r || E'\n16 refresh_supplier_proposals(Ruiz) sin lecturas: ' || refresh_supplier_proposals(a_ruiz);

  -- 5 · Como B.
  perform set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
  r := r || E'\n17 B ve: proveedores=' || (select count(*) from supplier)
          || ' contactos=' || (select count(*) from supplier_contact)
          || ' propuestas=' || (select count(*) from supplier_proposal)
          || ' rastro=' || (select count(*) from supplier_invoice_payment_log)
          || ' | contacto de B intacto: ' || (select name from supplier_contact where id = b_contacto);

    raise exception '%', c_marca;
  exception when others then
    if sqlerrm <> c_marca then raise; end if;   -- un error de verdad, se propaga
  end;

  -- Guarda: el sub-bloque se ha deshecho de verdad.
  if exists (select 1 from compliance_document where title = 'Certificado banco (ensayo)')
     or exists (select 1 from supplier_invoice_payment_log)
     or exists (select 1 from supplier_invoice where status <> 'aprobada' or due_date is not null or paid_at is not null)
     or current_user <> session_user then
    raise exception 'ENSAYO: ha quedado algo escrito o el rol no ha vuelto. Revertido.';
  end if;

  raise notice E'ENSAYO C01 (nada escrito, comprobado):%', r;
end $$;
