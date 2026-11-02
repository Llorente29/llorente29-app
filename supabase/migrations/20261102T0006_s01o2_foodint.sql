-- supabase/migrations/20261102T0006_s01o2_foodint.sql
--
-- S01o·2 · Foodint (Julio, 01/11, respuestas 5 y 6). Mueve filas: va con «autorizo».
-- Filtra siempre por la cuenta de Foodint (regla 9).
--   1. EL ROI: Foodint NO está en el ROI (decidido por Julio, 01/11; no es una
--      pregunta). company_tax_profile.en_roi = false.
--   2. ANTHROPIC IRELAND LIMITED: su NIF en la ficha, el de verdad, «IE4276970QH»
--      (desde las 14:08 del 01/11 guardaba «EUVATIE4276970QH», sin registro de
--      quién), y su cuenta de gasto, la 62900005 (la de Vercel).
--   3. LAS 4 DE ANTHROPIC SIN PROVEEDOR (dos números, cada uno leído como factura y
--      como recibo): de cada par se queda la factura («Invoice-…»), ligada a su
--      proveedor y con la confianza de su lectura (seguro: lo que dudó fue no
--      conocer al proveedor). El recibo («Receipt-…») queda como «Repetida» de
--      su factura, con ella como justificante del pago, y su factura repetida, descartada.
--   4. El IVA no deducible de las de Anthropic, con su motivo (2212), si una
--      persona no lo ha decidido ya.
-- Vuelta atrás: supabase/vuelta-atras/20261102T0006_s01o2_foodint.down.sql

create table if not exists public.s01o2_foodint_antes (
  tabla text not null, fila uuid not null, datos jsonb not null, primary key (tabla, fila)
);
alter table public.s01o2_foodint_antes enable row level security;
revoke all on public.s01o2_foodint_antes from public, anon, authenticated;

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_sup uuid; v_cta uuid; v_n int; x record; v_buena uuid; v_id uuid;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'S01o·2: esta base no tiene Foodint: no se toca nada.';
    return;
  end if;
  -- 1 · El ROI.
  insert into public.s01o2_foodint_antes select 'company_tax_profile', p.company_id, to_jsonb(p) from public.company_tax_profile p
   where p.company_id = v_e and p.account_id = v_acc on conflict do nothing;
  update public.company_tax_profile set en_roi = false, updated_at = now() where company_id = v_e and account_id = v_acc;
  if not found then raise exception 'S01o·2 · 1: Foodint no tiene su perfil fiscal: no se puede decir que no está en el ROI.'; end if;

  -- 2 · La ficha de Anthropic.
  select s.id into v_sup from public.supplier s where s.account_id = v_acc and s.archived_at is null and public._conta_nif_clave(s.tax_id) = 'IE4276970QH';
  if v_sup is null then raise exception 'S01o·2 · 2: no está ANTHROPIC IRELAND LIMITED (NIF IE4276970QH) en Foodint.'; end if;
  insert into public.s01o2_foodint_antes select 'supplier', s.id, to_jsonb(s) from public.supplier s where s.id = v_sup on conflict do nothing;
  update public.supplier set tax_id = 'IE4276970QH', updated_at = now() where id = v_sup and tax_id is distinct from 'IE4276970QH';
  select a.id into v_cta from public.company_account a where a.company_id = v_e and a.account_id = v_acc and a.code = '62900005';
  if v_cta is null then raise exception 'S01o·2 · 2: Foodint no tiene la 62900005.'; end if;
  if not exists (select 1 from public.company_account_link k where k.company_id = v_e and k.entity = 'supplier' and k.entity_id = v_sup::text and k.role = 'gasto') then
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_acc, v_e, v_cta, 'supplier', v_sup::text, 'gasto', 'manual') returning id into v_id;
    insert into public.s01o2_foodint_antes values ('company_account_link', v_id, '{"nuevo":true}'::jsonb);
  end if;

  -- 3 · Las 4 sin proveedor: de cada número, la factura se queda; el recibo, «Repetida» con ella.
  v_n := 0;
  for x in
    select si.id, si.invoice_number, si.grand_total, d.id as inbox, d.file_name
      from public.supplier_invoice si join public.document_inbox d on d.supplier_invoice_id = si.id and d.account_id = si.account_id
     where si.account_id = v_acc and si.supplier_id is null and si.status in ('en_revision', 'aprobada')
       and public._conta_nif_clave(si.reading->'factura'->'proveedor'->>'nif') = 'IE4276970QH'
     order by si.invoice_number, (d.file_name ilike 'Invoice%') desc
  loop
    insert into public.s01o2_foodint_antes select 'supplier_invoice', si.id, to_jsonb(si) from public.supplier_invoice si where si.id = x.id on conflict do nothing;
    insert into public.s01o2_foodint_antes select 'document_inbox', d.id, to_jsonb(d) from public.document_inbox d where d.id = x.inbox on conflict do nothing;
    if x.file_name ilike 'Invoice%' then
      update public.supplier_invoice set supplier_id = v_sup, reading_confidence = coalesce(reading->>'confianza', reading_confidence), updated_at = now() where id = x.id;
      v_n := v_n + 1;
    else
      select si.id into v_buena from public.supplier_invoice si join public.document_inbox d on d.supplier_invoice_id = si.id
       where si.account_id = v_acc and d.file_name ilike 'Invoice%' and si.invoice_number = x.invoice_number and round(si.grand_total * 100) = round(x.grand_total * 100)
         and public._conta_nif_clave(si.reading->'factura'->'proveedor'->>'nif') = 'IE4276970QH';
      if v_buena is null then raise exception 'S01o·2 · 3: el recibo % no tiene su factura («Invoice-…») con el mismo número y total.', x.file_name; end if;
      update public.supplier_invoice set status_before_discard = status, status = 'descartada', discarded_at = now(), discarded_by_name = 'Sumied (S01o·2)',
             discard_reason = format('Repetida: es el recibo de la factura %s (mismo NIF, número y total). Queda con ella como justificante del pago.', x.invoice_number), updated_at = now()
       where id = x.id;
      update public.document_inbox set status = 'repetida', duplicate_of_invoice_id = v_buena,
             reason = format('El recibo de la factura %s: queda con ella como justificante del pago.', x.invoice_number), updated_at = now()
       where id = x.inbox;
      insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
      values (v_acc, v_e, x.inbox, v_buena, 'folvy', 'repetida', format('Su recibo (%s) era la misma factura leída dos veces: queda con ella como justificante del pago.', x.file_name),
              jsonb_build_object('s01o2', true, 'recibo', x.id));
    end if;
  end loop;
  if v_n <> 2 then raise exception 'S01o·2 · 3: esperaba ligar 2 facturas de Anthropic y han sido %.', v_n; end if;

  -- 4 · El IVA no deducible de las de Anthropic, con su motivo, si nadie lo ha decidido.
  for x in select si.id from public.supplier_invoice si
            where si.account_id = v_acc and si.supplier_id = v_sup and si.status in ('en_revision', 'aprobada') and si.vat_non_deductible_reason is null loop
    insert into public.s01o2_foodint_antes select 'supplier_invoice', si.id, to_jsonb(si) from public.supplier_invoice si where si.id = x.id on conflict do nothing;
    update public.supplier_invoice set vat_non_deductible = true,
           vat_non_deductible_reason = (public._conta_iva_no_deducible_auto(x.id)->'motivos'->0->>'motivo'), updated_at = now()
     where id = x.id and coalesce((public._conta_iva_no_deducible_auto(x.id)->>'no_deducible')::boolean, false);
  end loop;
  raise notice 'S01o·2: ROI no; Anthropic con su NIF y la 62900005; % facturas ligadas y sus recibos como repetidas.', v_n;
end $$;
