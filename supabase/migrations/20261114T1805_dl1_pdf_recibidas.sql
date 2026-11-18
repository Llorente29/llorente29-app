-- supabase/migrations/20261114T1805_dl1_pdf_recibidas.sql
--
-- DL1 · los PDF de 44 facturas recibidas, enlazados como lo hace «Subir el PDF»
-- (Julio, 14/11). Nada en el camino del pedido. Sin tocar asientos ni importes.
-- Julio subió los 44 ficheros a receipt-uploads, en
-- 51ad1792-6629-4ef7-833a-b57b09a86710/dl1-glovo-39/<número>.pdf:
--   - las 39 de Glovo del 1T y el 2T de la 1210 (#683), 4 de ellas notas de crédito;
--   - las 3 de Just Eat del 01–15/10 de la 1615: 4126341, 4126364 y 4126424;
--   - las 2 de Cloudtown Brands: FV-02927 y FV-02931.
-- Cada una pasa por conta_recibida_papel_poner, la de «Subir el PDF», como si la
-- subiera Julio: pone raw_document_url, deja su traza en supplier_invoice_change y
-- reinicia la lectura del PDF. Una factura apuntada sin documento admite su PDF sin
-- que cambie su asiento (S01p·22).
--
-- sin hueco: no retira ningún asiento ni resumen del día; solo pone el documento a 44 facturas.
--
-- SIN VUELTA ATRÁS, a propósito: el documento de una factura con asiento validado
-- ya no se cambia (va con el asiento).

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_dir constant text := '51ad1792-6629-4ef7-833a-b57b09a86710/dl1-glovo-39/';
  v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true);
  r record; v_res jsonb; v_k int := 0; v_debe numeric; v_debe_despues numeric;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 PDF recibidas: sin la cuenta de Foodint, no hay nada que poner.';
    return;
  end if;
  create temp table dl1_pdf on commit drop as
    select o.name ruta, regexp_replace(regexp_replace(o.name, '^.*/', ''), '\.pdf$', '') num,
           (select s.id from public.supplier_invoice s where s.account_id = v_acc and s.invoice_number = regexp_replace(regexp_replace(o.name, '^.*/', ''), '\.pdf$', '')
             and s.status not in ('anulada', 'descartada')) factura,
           (select count(*) from public.supplier_invoice s where s.account_id = v_acc and s.invoice_number = regexp_replace(regexp_replace(o.name, '^.*/', ''), '\.pdf$', '')
             and s.status not in ('anulada', 'descartada')) n
      from storage.objects o
     where o.bucket_id = 'receipt-uploads' and o.name like v_dir || '%.pdf';
  if (select count(*) from dl1_pdf) <> 44 or exists (select 1 from dl1_pdf where n <> 1)
     or exists (select 1 from dl1_pdf p join public.supplier_invoice s on s.id = p.factura where s.raw_document_url is not null) then
    raise exception 'DL1 PDF recibidas: no están los 44 ficheros con una sola factura viva cada uno y sin PDF (% ficheros): no se pone nada.', (select count(*) from dl1_pdf);
  end if;
  select sum(l.debit) into v_debe from dl1_pdf p join public.supplier_invoice s on s.id = p.factura join public.journal_line l on l.entry_id = s.journal_entry_id;

  -- Como si los subiera Julio con «Subir el PDF»: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', v_julio, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_julio::text || ':' || v_acc::text, true);
  for r in select * from dl1_pdf order by num loop
    v_k := v_k + 1;
    begin
      v_res := public.conta_recibida_papel_poner(r.factura, r.ruta, r.num || '.pdf', 'Julio (tanda DL1)');
    exception when others then
      raise exception using errcode = format('P%s%s', lpad(v_k::text, 2, '0'), left(sqlstate, 2)), message = format('%s: %s', r.num, sqlerrm);
    end;
    if coalesce((v_res->>'ya_estaba')::boolean, false) or v_res->>'documento' is distinct from r.ruta then
      raise exception 'DL1 PDF recibidas: la % no ha quedado con su PDF (%).', r.num, v_res;
    end if;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);

  select sum(l.debit) into v_debe_despues from dl1_pdf p join public.supplier_invoice s on s.id = p.factura join public.journal_line l on l.entry_id = s.journal_entry_id;
  if v_debe_despues is distinct from v_debe then
    raise exception 'DL1 PDF recibidas: los asientos de las 44 han cambiado (% antes, % después).', v_debe, v_debe_despues;
  end if;
  raise notice 'DL1 PDF recibidas: % facturas con su PDF; sus asientos, igual (% al Debe).', v_k, v_debe;
end $$;
