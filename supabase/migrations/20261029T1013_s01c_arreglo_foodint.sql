-- supabase/migrations/20261029T1013_s01c_arreglo_foodint.sql
--
-- S01c · LO QUE YA ESTÁ MAL EN FOODINT (decisiones de Julio al paso 0, 29/10).
-- Va después de la 1012 (usa su regla de la ficha). Solo Foodint (regla 9),
-- y cada cosa se ancla y se comprueba antes de tocarla: si no está como se
-- midió el 29/10, para.
--
--   1. FAC-00100 no era una factura: era el albarán 26/13028 de Olimpo,
--      convertido en factura por la regla de la 0120. Su asiento (2/3177) se
--      ANULA con journal_entry_anular, que hace el contraasiento validado y no
--      borra nada (lo hace como Julio, que la dio de alta: el contraasiento
--      queda a su nombre). La factura queda «anulada», con su motivo, y deja
--      de casar con ALB-00218.
--   2. ALB-00218 vuelve a «esperando factura»: su camino se recalcula con la
--      regla nueva (manda la ficha: «albarán y factura después»), sin factura.
--   3. Amirsa: sus facturas llegan «todas juntas a primeros del mes
--      siguiente». Sus albaranes sin factura se recalculan: la pregunta «papel
--      y ficha» se cierra sola (la regla nueva ya no la hace).
--   4. La dirección «documentos» foodint@entrada.folvy.app, apagada y sin
--      ningún correo, se borra: la de Foodint es facturas-foodint@.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_f public.supplier_invoice; v_e uuid; v_alb public.goods_receipt; c jsonb; v_amirsa uuid; v_n int;
begin
  -- Solo en producción: en staging no está Foodint, y no hay nada que arreglar.
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01c 1013: esta base no tiene a Foodint: no hay nada que arreglar.';
    return;
  end if;
  -- 1 · FAC-00100
  select * into v_f from public.supplier_invoice where account_id = v_acc and code = 'FAC-00100';
  if v_f.id is null then raise exception 'S01c 1013: FAC-00100 no está en Foodint.'; end if;
  if v_f.status = 'anulada' then
    raise notice 'S01c 1013: FAC-00100 ya estaba anulada: no se toca.';
  else
    if v_f.invoice_number <> '26/13028' or v_f.grand_total <> 363.67 or v_f.status <> 'aprobada' then
      raise exception 'S01c 1013: FAC-00100 no es como se midió (número %, total %, estado %).', v_f.invoice_number, v_f.grand_total, v_f.status;
    end if;
    if exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id where i.supplier_invoice_id = v_f.id and b.status = 'vivo') then
      raise exception 'S01c 1013: FAC-00100 tiene un pago casado en Bancos: se deshace antes.';
    end if;
    select id into v_e from public.journal_entry
     where account_id = v_acc and source_type = 'supplier_invoice' and source_id = v_f.id and status = 'validado';
    if v_e is null then raise exception 'S01c 1013: FAC-00100 no tiene su asiento validado (2/3177).'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_f.created_by, 'role', 'authenticated')::text, true);
    perform public.journal_entry_anular(v_e,
      'FAC-00100 no era una factura: era el albarán 26/13028 de Olimpo (S01c). La factura es la 1/26A/10966, que entra por correo.',
      null, 'Folvy · S01c, con el visto bueno de Julio');
    perform set_config('request.jwt.claims', '', true);
    update public.supplier_invoice
       set status = 'anulada', needs_review = false, updated_at = now(),
           notes = concat_ws(' ', notes, 'Anulada (S01c, 29/10): era el albarán 26/13028, no una factura. Su asiento 2/3177 está anulado con su contraasiento.')
     where id = v_f.id;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_acc, v_f.company_id, v_f.inbox_id, v_f.id, 'folvy', 'corregida',
            'Anulada: era el albarán 26/13028 de Olimpo, que factura aparte. Su asiento 2/3177 queda anulado con su contraasiento.');
    delete from public.supplier_invoice_receipt where supplier_invoice_id = v_f.id;
  end if;

  -- 2 · ALB-00218, otra vez esperando su factura
  select * into v_alb from public.goods_receipt where account_id = v_acc and code = 'ALB-00218';
  if v_alb.id is null or v_alb.supplier_doc_number <> '26/13028' then raise exception 'S01c 1013: ALB-00218 no es el 26/13028.'; end if;
  c := public._compras_camino_calcula(v_alb.id);
  if c->>'path' <> 'pendiente_factura' then raise exception 'S01c 1013: la regla nueva no deja ALB-00218 esperando factura (%).', c->>'path'; end if;
  update public.goods_receipt_path
     set path = c->>'path', reason = c->>'reason', question = c->>'question', question_detail = c->'question_detail',
         supplier_invoice_id = null, consumed_at = null, decided_at = now()
   where goods_receipt_id = v_alb.id and (supplier_invoice_id = v_f.id or supplier_invoice_id is null);
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'S01c 1013: el camino de ALB-00218 no es el de FAC-00100 (% filas).', v_n; end if;

  -- 3 · Amirsa
  select id into v_amirsa from public.supplier where account_id = v_acc and archived_at is null and name ilike 'AMIRSA%';
  if (select count(*) from public.supplier where account_id = v_acc and archived_at is null and name ilike 'AMIRSA%') <> 1 then
    raise exception 'S01c 1013: no hay una sola ficha de Amirsa en Foodint.';
  end if;
  update public.supplier set invoice_arrival = 'inicio_mes_siguiente', updated_at = now() where id = v_amirsa;
  update public.goods_receipt_path p
     set reason = x.c->>'reason', question = x.c->>'question', question_detail = x.c->'question_detail'
    from (select p2.id, public._compras_camino_calcula(p2.goods_receipt_id) c
            from public.goods_receipt_path p2 join public.goods_receipt g on g.id = p2.goods_receipt_id
           where p2.account_id = v_acc and g.supplier_id = v_amirsa and p2.consumed_at is null and p2.path = 'pendiente_factura') x
   where p.id = x.id and x.c->>'path' = 'pendiente_factura';

  -- 4 · La dirección «documentos», apagada y sin correos
  delete from public.company_inbound_address a
   where a.account_id = v_acc and a.kind = 'documentos' and a.local_part = 'foodint' and not a.active
     and not exists (select 1 from public.inbound_email_log l where lower(split_part(l.to_address, '@', 1)) = 'foodint')
     and not exists (select 1 from public.document_inbox d where lower(split_part(coalesce(d.email_to, ''), '@', 1)) = 'foodint');
end $$;
