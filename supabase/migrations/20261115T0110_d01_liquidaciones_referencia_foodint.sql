-- supabase/migrations/20261115T0110_d01_liquidaciones_referencia_foodint.sql
--
-- D01 · Liquidaciones por correo · Los datos de Foodint: las 7 liquidaciones de
-- agosto que entraron ANTES del corte por fecha (la 0100 del 15) pasan a «de
-- referencia», y sus 7 facturas de comisión en revisión se quitan (Julio, 16/10).
-- La liquidación se queda entera: sirve para contrastar, y su cobro se casa.
--
-- Freno, antes de tocar nada (si algo no es así, para y dice qué ha visto):
--   · el corte de Foodint es el 01/10/2026 (el de Bancos);
--   · hay exactamente 7 liquidaciones del correo de Foodint que acaban antes del
--     corte, y las 7 tienen factura de comisión;
--   · las 7 facturas son de una liquidación, en revisión, sin número, sin
--     asiento, sin pago y sin nada más colgando (cobros casados, recepción,
--     bandeja, actividad, lotes);
--   · cada una tiene su línea y su IVA, que se guardan con ella.
-- Lo que hace:
--   1. guarda las 7 facturas enteras (con sus líneas y su IVA) en
--      conta_respaldo_liquidacion_factura, para la vuelta atrás;
--   2. las desengancha de su liquidación y marca la liquidación de referencia;
--   3. borra las 7 facturas (sus líneas y su IVA se van con ellas);
--   4. vuelve a decir lo que queda por aclarar de cada una (_conta_liquidacion_marcar):
--      el solape de Smash (27/07–02/08 con 27/07–09/08) se sigue diciendo.
-- Después comprueba: 7 de referencia, 0 facturas de comisión de antes del corte,
-- la de octubre (Bendito Burrito, 05–11/10) sigue con la suya, y los dos
-- solapes siguen «por aclarar».
-- Vuelta atrás: supabase/vuelta-atras/20261115T0110_d01_liquidaciones_referencia_foodint.down.sql

create table if not exists public.conta_respaldo_liquidacion_factura (
  id uuid primary key default gen_random_uuid(),
  tanda text not null,
  settlement_id uuid not null,
  invoice_id uuid not null,
  invoice jsonb not null,
  lines jsonb not null,
  taxes jsonb not null,
  saved_at timestamptz not null default now()
);
comment on table public.conta_respaldo_liquidacion_factura is
  'D01 · Copia de las facturas de comisión que una tanda quitó (para su vuelta atrás). Solo la tocan las tandas.';
alter table public.conta_respaldo_liquidacion_factura enable row level security;
revoke all on public.conta_respaldo_liquidacion_factura from public, anon, authenticated;

do $$
declare
  acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  emp constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_tanda constant text := '20261115T0110_d01_liquidaciones_referencia_foodint';
  v_corte date; n_liq int; n_fac int; n_mal int; n_colgando int; n_solape_antes int; n_solape_despues int; n int; r record;
begin
  if not exists (select 1 from public.company where id = emp and account_id = acc) then
    raise notice 'Liquidaciones de referencia: esta base no tiene a Foodint; no se toca nada.';
    return;
  end if;
  v_corte := public._conta_corte(emp);
  if v_corte is distinct from date '2026-10-01' then
    raise exception 'REFERENCIA PARADA: el corte de Foodint es %, no el 01/10/2026. No se toca nada.', v_corte using errcode = 'P0001';
  end if;

  create temp table _ref on commit drop as
    select s.id settlement_id, s.commission_invoice_id invoice_id
      from public.channel_settlement s
     where s.account_id = acc and s.source like 'correo\_%' and s.period_to < v_corte;
  select count(*), count(invoice_id) into n_liq, n_fac from _ref;
  select count(*) into n_mal from _ref x left join public.supplier_invoice i on i.id = x.invoice_id
   where i.id is null or i.account_id <> acc or i.source <> 'liquidacion' or i.status <> 'en_revision' or i.invoice_number is not null
      or i.journal_entry_id is not null or i.payment_entry_id is not null or i.paid_at is not null;
  select (select count(*) from public.bank_match_item b join _ref x on x.invoice_id = b.supplier_invoice_id)
       + (select count(*) from public.supplier_invoice_receipt b join _ref x on x.invoice_id = b.supplier_invoice_id)
       + (select count(*) from public.supplier_invoice_payment_log b join _ref x on x.invoice_id = b.invoice_id)
       + (select count(*) from public.document_inbox b join _ref x on x.invoice_id in (b.supplier_invoice_id, b.duplicate_of_invoice_id))
       + (select count(*) from public.document_activity b join _ref x on x.invoice_id = b.supplier_invoice_id)
       + (select count(*) from public.supplier_batch_order b join _ref x on x.invoice_id = b.supplier_invoice_id)
       + (select count(*) from public.supplier_batch_issue b join _ref x on x.invoice_id = b.supplier_invoice_id)
       + (select count(*) from public.goods_receipt_path b join _ref x on x.invoice_id = b.supplier_invoice_id)
       + (select count(*) from public.licensed_settlement b join _ref x on x.invoice_id = b.received_invoice_id)
       + (select count(*) from public.supplier_invoice b join _ref x on x.invoice_id = b.corrects_invoice_id)
    into n_colgando;
  if n_liq <> 7 or n_fac <> 7 or n_mal <> 0 or n_colgando <> 0 then
    raise exception 'REFERENCIA PARADA: % liquidación(es) antes del corte, % con factura, % factura(s) que no son una de comisión en revisión sin número ni asiento, % cosa(s) colgando de ellas. Se esperaban 7, 7, 0 y 0. No se toca nada.',
      n_liq, n_fac, n_mal, n_colgando using errcode = 'P0001';
  end if;
  if exists (select 1 from _ref x where (select count(*) from public.supplier_invoice_line l where l.supplier_invoice_id = x.invoice_id) = 0
                                      or (select count(*) from public.supplier_invoice_tax t where t.supplier_invoice_id = x.invoice_id) = 0) then
    raise exception 'REFERENCIA PARADA: alguna de las 7 facturas no tiene su línea o su IVA. No se toca nada.' using errcode = 'P0001';
  end if;
  select count(*) into n_solape_antes from public.channel_settlement where account_id = acc and source like 'correo\_%' and review_note like '%Se solapa con%';

  -- 1 · la copia
  insert into public.conta_respaldo_liquidacion_factura (tanda, settlement_id, invoice_id, invoice, lines, taxes)
  select v_tanda, x.settlement_id, x.invoice_id, to_jsonb(i),
         coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from public.supplier_invoice_line l where l.supplier_invoice_id = i.id), '[]'::jsonb),
         coalesce((select jsonb_agg(to_jsonb(t)) from public.supplier_invoice_tax t where t.supplier_invoice_id = i.id), '[]'::jsonb)
    from _ref x join public.supplier_invoice i on i.id = x.invoice_id;
  -- 2 · desenganchar y marcar de referencia
  update public.channel_settlement s set commission_invoice_id = null, is_reference = true, updated_at = now()
    from _ref x where s.id = x.settlement_id;
  -- 3 · quitar las facturas (líneas e IVA, en cascada)
  delete from public.supplier_invoice i using _ref x where i.id = x.invoice_id;
  get diagnostics n = row_count;
  if n <> 7 then raise exception 'REFERENCIA: se esperaban quitar 7 facturas y se han quitado %. Se deshace todo.', n using errcode = 'P0001'; end if;
  -- 4 · lo que queda por aclarar, dicho otra vez
  for r in select settlement_id from _ref loop perform public._conta_liquidacion_marcar(r.settlement_id); end loop;

  -- Después
  select count(*) into n from public.channel_settlement where account_id = acc and source like 'correo\_%' and is_reference;
  if n <> 7 then raise exception 'REFERENCIA: quedan % de referencia, no 7. Se deshace todo.', n using errcode = 'P0001'; end if;
  if exists (select 1 from public.supplier_invoice where account_id = acc and source = 'liquidacion' and invoice_date < v_corte) then
    raise exception 'REFERENCIA: sigue habiendo facturas de comisión de antes del corte. Se deshace todo.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.channel_settlement where account_id = acc and source like 'correo\_%' and period_to >= v_corte and commission_invoice_id is null) then
    raise exception 'REFERENCIA: una liquidación desde el corte se ha quedado sin su factura. Se deshace todo.' using errcode = 'P0001';
  end if;
  select count(*) into n_solape_despues from public.channel_settlement where account_id = acc and source like 'correo\_%' and review_note like '%Se solapa con%';
  if n_solape_despues <> n_solape_antes or n_solape_despues < 2 then
    raise exception 'REFERENCIA: los solapes por aclarar eran % y ahora son % (el de Smash tiene que seguir diciéndose). Se deshace todo.', n_solape_antes, n_solape_despues using errcode = 'P0001';
  end if;
end $$;
