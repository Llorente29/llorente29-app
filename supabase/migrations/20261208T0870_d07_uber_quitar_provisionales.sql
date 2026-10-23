-- supabase/migrations/20261208T0870_d07_uber_quitar_provisionales.sql
--
-- D07 · DATOS: las facturas de comisión PROVISIONALES de Uber salen de
-- «Facturas recibidas» (Julio, 23/10, camino B). Pide autorizo.
--
-- Medido en producción el 23/10 (solo lectura): 8 facturas de Foodint con
-- source 'liquidacion' — FAC-00007 y FAC-00091 a FAC-00097, de PORTIER EATS
-- SPAIN, S.L. — todas «en_revision», sin número, sin PDF y sin asiento, nacidas
-- al leer el correo de su liquidación. Cuelgan de ellas 13 líneas, 8 filas de
-- IVA y los 8 enlaces channel_settlement.commission_invoice_id; nada más (ni
-- cobros casados, ni bandeja, ni 303, ni historial, ni pagos).
--
-- Qué hace: las guarda enteras en public.conta_respaldo_d07_provisionales (la
-- factura, sus líneas, su IVA y, de cada liquidación enlazada, su enlace y su
-- marca de revisar), quita el enlace de sus liquidaciones, las borra (sus
-- líneas y su IVA se van en cascada) y vuelve a marcar cada liquidación
-- (_conta_liquidacion_marcar): queda esperando su factura de la semana. Las
-- liquidaciones siguen en Compras › Liquidaciones como liquidaciones de
-- plataforma; cuando llegue la factura de comisión de verdad, con su PDF, se
-- enlaza con ellas (conta_liquidacion_enlazar_factura, la 0860).
--
-- PARA si: no hay ninguna; son más de 20; alguna tiene número, PDF, asiento,
-- otro estado, cobros casados, pagos, historial o cualquier otra fila que la
-- nombre; o si hay alguna factura de liquidación en Foodint que no es una
-- provisional así (no se toca ninguna a medias). Anclado por cuenta (regla 9).
-- En staging, nada. No toca el camino del pedido, ni coste ni stock.
-- Va DESPUÉS de la 0860 (que deja de crearlas).
-- Vuelta atrás: supabase/vuelta-atras/20261208T0870_d07_uber_quitar_provisionales.down.sql
create table if not exists public.conta_respaldo_d07_provisionales (
  tabla text not null,
  id uuid not null,
  fila jsonb not null,
  guardado_at timestamptz not null default now(),
  primary key (tabla, id)
);
comment on table public.conta_respaldo_d07_provisionales is
  'D07 (0870). Las facturas de comisión provisionales de Uber que se quitaron de Facturas recibidas, con sus líneas, su IVA y sus enlaces, para su vuelta atrás.';
alter table public.conta_respaldo_d07_provisionales enable row level security;
revoke all on table public.conta_respaldo_d07_provisionales from anon, authenticated;

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_n int; v_todas int; v_otras int; v_cs int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'D07 0870: esta base no tiene la cuenta de Foodint (staging): no hay provisionales que quitar.';
    return;
  end if;
  create temp table _d07_prov on commit drop as
  select si.id from public.supplier_invoice si
   where si.account_id = v_acc and si.source = 'liquidacion' and si.invoice_number is null and si.raw_document_url is null
     and si.status = 'en_revision' and si.no_document_at is null
     and not exists (select 1 from public.journal_entry e where e.account_id = v_acc and e.source_type = 'supplier_invoice' and e.source_id = si.id);
  select count(*) into v_n from _d07_prov;
  select count(*) into v_todas from public.supplier_invoice where account_id = v_acc and source = 'liquidacion';
  if v_n = 0 then raise exception 'D07 0870: no hay ninguna factura de comisión provisional en Foodint. No se cambia nada: vuelve a medir.'; end if;
  if v_n > 20 then raise exception 'D07 0870: son % (más de 20): no es lo medido. No se cambia nada.', v_n; end if;
  if v_todas <> v_n then
    raise exception 'D07 0870: hay % facturas de liquidación en Foodint y solo % son provisionales sin número, PDF ni asiento. No se toca ninguna.', v_todas, v_n;
  end if;
  select (select count(*) from public.bank_match_item x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_invoice_payment_log x where x.invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_invoice_change x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_invoice_expense x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_invoice_receipt x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.conta_recibida_pdf x where x.invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_batch_issue x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_batch_order x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.document_activity x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.document_inbox x where x.supplier_invoice_id in (select id from _d07_prov) or x.duplicate_of_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.goods_receipt_path x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.licensed_settlement x where x.received_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.tax_return_line x where x.supplier_invoice_id in (select id from _d07_prov))
       + (select count(*) from public.supplier_invoice x where x.corrects_invoice_id in (select id from _d07_prov))
    into v_otras;
  if v_otras > 0 then
    raise exception 'D07 0870: % filas de otras tablas nombran estas facturas (cobros, pagos, historial, bandeja…): no es lo medido. No se cambia nada.', v_otras;
  end if;

  -- El respaldo, entero.
  insert into public.conta_respaldo_d07_provisionales (tabla, id, fila)
  select 'supplier_invoice', si.id, to_jsonb(si) from public.supplier_invoice si where si.id in (select id from _d07_prov)
  union all
  select 'supplier_invoice_line', l.id, to_jsonb(l) from public.supplier_invoice_line l where l.supplier_invoice_id in (select id from _d07_prov)
  union all
  select 'supplier_invoice_tax', t.id, to_jsonb(t) from public.supplier_invoice_tax t where t.supplier_invoice_id in (select id from _d07_prov)
  union all
  select 'channel_settlement', cs.id, jsonb_build_object('commission_invoice_id', cs.commission_invoice_id, 'needs_review', cs.needs_review,
         'review_note', cs.review_note, 'updated_at', cs.updated_at)
    from public.channel_settlement cs where cs.account_id = v_acc and cs.commission_invoice_id in (select id from _d07_prov)
  on conflict (tabla, id) do nothing;

  -- Sus liquidaciones, sin enlace; las facturas, fuera (líneas e IVA en cascada).
  update public.channel_settlement set commission_invoice_id = null, updated_at = now()
   where account_id = v_acc and commission_invoice_id in (select id from _d07_prov);
  get diagnostics v_cs = row_count;
  delete from public.supplier_invoice where account_id = v_acc and id in (select id from _d07_prov);
  get diagnostics v_n = row_count;
  perform public._conta_liquidacion_marcar(r.id)
     from public.conta_respaldo_d07_provisionales r where r.tabla = 'channel_settlement';
  raise notice 'D07 0870: % facturas de comisión provisionales fuera de Facturas recibidas; % liquidaciones esperan su factura de la semana.', v_n, v_cs;
end $$;
