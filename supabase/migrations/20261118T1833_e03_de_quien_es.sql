-- supabase/migrations/20261118T1833_e03_de_quien_es.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
--   (el CHECK de recipient_answer toma un instante el cierre exclusivo de
--   supplier_invoice: no es del camino del pedido y solo mira la columna nueva,
--   vacía al crearla.)
--
-- E03 · Sumied pregunta, no decide (respuesta E02 · 1, 18/11). 1 de 3: lo que
-- SOLO AÑADE (va de verdad a staging desde la rama, W05, para que su e2e lo use).
-- Los cambios en caliente van en la 1835; lo ya marcado que vuelve a ser pregunta,
-- en la 1836 (con «autorizo»).
--
--   1. supplier_invoice.recipient_answer / _answered_at / _answered_by_name: la
--      respuesta de una persona ('es_de_esta', 'deduce', 'no_deduce'), quién y
--      cuándo. Es lo que manda: el disparador y la pasada no la tocan nunca (1835).
--   2. _conta_de_quien(factura): a nombre de quién va, en cuatro casos —
--      otra_sociedad (el NIF es el de otra sociedad de la misma cuenta), fuera
--      (un NIF que no es de ninguna), sin_leer (no se leyó), empresa (nada que
--      preguntar) — y si hay pregunta, con su frase. sin_iva: va a otro pero no
--      lleva IVA, así que no hay nada que deducir. Sin caso: no sale de leer un
--      papel (lote, liquidación, traída), o la empresa no tiene NIF.
--   3. conta_de_quien_es(factura): lo mismo, para la pantalla (con su cuenta).
--   4. conta_recibida_de_quien(factura, respuesta, quien): contestar.
--   5. conta_recibida_pasar_a(factura, sociedad, quien): pasarla entera (la
--      factura, su llegada, su actividad) a otra sociedad de la misma cuenta,
--      sin asiento; solo si no tiene asiento validado ni pagos.
-- Se puede pasar dos veces (if not exists, create or replace).
-- sin hueco: al aplicarse no retira nada. Las funciones de contestar y de pasarla quitan, al llamarlas, el
--   asiento PROPUESTO (o borrador) de esa factura, como ya hace conta_recibida_iva_no_deducible: se
--   vuelve a proponer solo al abrir su ficha, con lo contestado. Uno validado no se toca nunca.
-- Vuelta atrás: supabase/vuelta-atras/20261118T1833_e03_de_quien_es.down.sql

-- 1 · La respuesta de una persona ---------------------------------------------------------------
alter table public.supplier_invoice add column if not exists recipient_answer text;
alter table public.supplier_invoice add column if not exists recipient_answered_at timestamptz;
alter table public.supplier_invoice add column if not exists recipient_answered_by_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_invoice_e03_respuesta') then
    alter table public.supplier_invoice add constraint supplier_invoice_e03_respuesta check (recipient_answer in ('es_de_esta', 'deduce', 'no_deduce'));
  end if;
end $$;
comment on column public.supplier_invoice.recipient_answer is
  'E03: lo que contestó una persona a «¿a nombre de quién va?»: es_de_esta (va a otra sociedad de la cuenta, pero es de esta), deduce o no_deduce. Manda: el disparador del IVA no deducible y «apunta sola» no la tocan.';
comment on column public.supplier_invoice.recipient_answered_at is 'E03: cuándo lo contestó.';
comment on column public.supplier_invoice.recipient_answered_by_name is 'E03: quién lo contestó.';

-- 2 · A nombre de quién va ------------------------------------------------------------------------
create or replace function public._conta_de_quien(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v public.supplier_invoice; c public.company; o public.company;
  v_emp text; v_dest text; v_nif text; v_nom text; v_caso text; v_validado boolean; v_pregunta boolean; v_frase text; v_corta text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null then return null; end if;
  if not (coalesce(v.reading, '{}'::jsonb) ? 'factura') or coalesce(v.source, '') in ('lote', 'liquidacion', 'traida')
     or v.status in ('anulada', 'descartada', 'repetida') then
    return jsonb_build_object('caso', null, 'pregunta', false);
  end if;
  select * into c from public.company where id = v.company_id and account_id = v.account_id;
  v_emp := public._conta_nif_clave(c.tax_id);
  if v_emp is null then return jsonb_build_object('caso', null, 'pregunta', false); end if;
  v_nif := nullif(btrim(v.reading->'factura'->'destinatario'->>'nif'), '');
  v_dest := public._conta_nif_clave(v_nif);
  v_nom := nullif(btrim(v.reading->'factura'->'destinatario'->>'nombre'), '');
  if v_dest = v_emp then
    v_caso := 'empresa';
  else
    if v_dest is not null then
      -- Regla 9: solo las sociedades de SU cuenta.
      select x.* into o from public.company x
       where x.account_id = v.account_id and x.id <> v.company_id and public._conta_nif_clave(x.tax_id) = v_dest
       order by x.created_at limit 1;
    end if;
    if o.id is not null then
      v_caso := 'otra_sociedad';
    elsif not exists (select 1 from public.supplier_invoice_tax t where t.supplier_invoice_id = v.id and coalesce(t.vat_pct, 0) > 0 and coalesce(t.vat_amount, 0) <> 0) then
      v_caso := 'sin_iva';
    elsif v_dest is null then
      v_caso := 'sin_leer';
    else
      v_caso := 'fuera';
    end if;
  end if;
  v_validado := exists (select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice'
                          and e.source_id = v.id and e.status = 'validado');
  -- Pregunta: no contestada, sin asiento validado. Fuera o sin leer, además, si nadie ha dicho ya por qué
  -- su IVA no se deduce (un ticket sin NIF, el ROI…); la otra sociedad se pregunta siempre.
  v_pregunta := not v_validado and v.recipient_answer is null
                and (v_caso = 'otra_sociedad' or (v_caso in ('fuera', 'sin_leer') and v.vat_non_deductible_reason is null));
  v_corta := case when o.id is not null then coalesce(nullif(btrim(o.trade_name), ''),
               regexp_replace(o.legal_name, ',?\s*(S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?\s?U?\.?|S\.?\s?C\.?\s?P\.?|C\.?\s?B\.?)\s*$', '', 'i')) end;
  -- Sin doble punto cuando el nombre ya acaba en punto («…, S.L.»).
  v_frase := case v_caso
    when 'otra_sociedad' then format('Esta factura va a nombre de %s, no de %s', o.legal_name, c.legal_name) || case when right(c.legal_name, 1) = '.' then '' else '.' end
    when 'fuera' then format('Esta factura va a nombre de %s, no de %s', coalesce(v_nom || ' (' || v_nif || ')', v_nif), c.legal_name)
                      || case when right(c.legal_name, 1) = '.' then '' else '.' end || ' Si no es vuestra, su IVA no se deduce.'
    when 'sin_leer' then 'No he podido leer a nombre de quién va esta factura. Míralo en el PDF.' end;
  return jsonb_build_object(
    'caso', v_caso, 'pregunta', v_pregunta, 'frase', v_frase,
    'empresa', c.legal_name, 'sociedad_id', o.id, 'sociedad', o.legal_name, 'sociedad_corta', v_corta,
    'nombre', v_nom, 'nif', v_nif,
    'respuesta', v.recipient_answer, 'quien', v.recipient_answered_by_name, 'cuando', v.recipient_answered_at,
    'validado', v_validado,
    -- Con su asiento validado y marcada «no va a nombre» sin que lo dijera nadie: lo marcó Sumied solo (S01o·2).
    'solo_sumied', v_validado and coalesce(v.vat_non_deductible, false) and v.vat_non_deductible_reason = 'no_a_nombre'
                   and v.recipient_answer is null
                   and not exists (select 1 from public.supplier_invoice_change h where h.supplier_invoice_id = v.id
                                     and h.cambios @> '[{"campo": "iva_no_deducible"}]'::jsonb));
end $function$;
comment on function public._conta_de_quien(uuid) is 'E03: a nombre de quién va una recibida (otra_sociedad, fuera, sin_leer, empresa, sin_iva) y si hay que preguntarlo, con su frase. Interna, solo lee.';
revoke all on function public._conta_de_quien(uuid) from public, anon, authenticated;
grant execute on function public._conta_de_quien(uuid) to service_role;

-- 3 · Para la pantalla ------------------------------------------------------------------------------
create or replace function public.conta_de_quien_es(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid;
begin
  select account_id into v_acc from public.supplier_invoice where id = p_invoice;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  return public._conta_de_quien(p_invoice);
end $function$;
comment on function public.conta_de_quien_es(uuid) is 'E03: a nombre de quién va una recibida de tu cuenta y si hay que preguntarlo. Solo lee.';
revoke all on function public.conta_de_quien_es(uuid) from public, anon;
grant execute on function public.conta_de_quien_es(uuid) to authenticated, service_role;

-- 4 · Contestar -----------------------------------------------------------------------------------------
create or replace function public.conta_recibida_de_quien(p_invoice uuid, p_respuesta text, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v public.supplier_invoice; q jsonb; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_nd boolean; v_motivo text; v_quitados int := 0; v_dia text := to_char(now() at time zone 'Europe/Madrid', 'DD/MM');
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v.account_id)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if p_respuesta is null or p_respuesta not in ('es_de_esta', 'deduce', 'no_deduce') then
    raise exception 'Di si su IVA se deduce o no.' using errcode = '22023';
  end if;
  if v.status in ('anulada', 'descartada') then raise exception 'Está %: no se cambia.', v.status using errcode = '22023'; end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice'
               and e.source_id = v.id and e.status = 'validado') then
    raise exception 'Ya está contabilizada: para cambiarlo, anula su asiento.' using errcode = '22023';
  end if;
  -- Lo que decide: no se deduce, «no va a nombre»; se deduce, se quita «no va a nombre» (otro motivo que ya
  -- tuviera, como el ROI o un ticket sin NIF, se queda: no es lo que se pregunta aquí).
  if p_respuesta = 'no_deduce' then
    v_nd := true; v_motivo := 'no_a_nombre';
  elsif coalesce(v.vat_non_deductible_reason, 'no_a_nombre') = 'no_a_nombre' then
    v_nd := false; v_motivo := null;
  else
    v_nd := v.vat_non_deductible; v_motivo := v.vat_non_deductible_reason;
  end if;
  update public.supplier_invoice
     set vat_non_deductible = v_nd, vat_non_deductible_reason = v_motivo,
         vat_non_deductible_note = case when v_motivo = 'otro' then vat_non_deductible_note end,
         recipient_answer = p_respuesta, recipient_answered_at = now(), recipient_answered_by_name = v_quien, updated_at = now()
   where id = v.id;
  -- Su asiento propuesto se rehace con lo contestado.
  delete from public.journal_entry e
   where e.account_id = v.account_id and e.source_type = 'supplier_invoice' and e.source_id = v.id and e.status in ('propuesto', 'borrador');
  get diagnostics v_quitados = row_count;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v.account_id, v.id, v_quien, 'guardar', jsonb_build_array(jsonb_build_object('campo', 'de_quien_es',
          'antes', jsonb_build_object('respuesta', v.recipient_answer, 'no_deducible', v.vat_non_deductible, 'motivo', v.vat_non_deductible_reason),
          'ahora', jsonb_build_object('respuesta', p_respuesta, 'no_deducible', v_nd, 'motivo', v_motivo))));
  return jsonb_build_object('respuesta', p_respuesta, 'no_deducible', v_nd, 'asiento_quitado', v_quitados > 0,
    'texto', case p_respuesta
               when 'no_deduce' then format('Apuntado: su IVA no se deduce y va al gasto. Lo decidió %s el %s.', v_quien, v_dia)
               when 'es_de_esta' then format('Apuntado: es de esta sociedad y su IVA se deduce. Lo decidió %s el %s.', v_quien, v_dia)
               else format('Apuntado: su IVA se deduce. Lo decidió %s el %s.', v_quien, v_dia) end
             || case when v_quitados > 0 then ' Su asiento propuesto se vuelve a proponer.' else '' end);
end $function$;
comment on function public.conta_recibida_de_quien(uuid, text, text) is 'E03: la respuesta de una persona a «¿a nombre de quién va?» (es_de_esta, deduce, no_deduce). Manda sobre lo que Sumied calcula.';
revoke all on function public.conta_recibida_de_quien(uuid, text, text) from public, anon;
grant execute on function public.conta_recibida_de_quien(uuid, text, text) to authenticated, service_role;

-- 5 · Pasarla a otra sociedad de la misma cuenta ---------------------------------------------------
create or replace function public.conta_recibida_pasar_a(p_invoice uuid, p_company uuid, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v public.supplier_invoice; d public.company; c public.company; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_traba text; v_quitados int := 0; v_llegadas int := 0;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v.account_id)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  -- Regla 9: la sociedad de destino, de LA MISMA cuenta.
  select * into d from public.company where id = p_company and account_id = v.account_id;
  if d.id is null then raise exception 'Esa sociedad no es de tu cuenta.' using errcode = '42501'; end if;
  if d.id = v.company_id then raise exception 'Ya está en %.', d.legal_name using errcode = '22023'; end if;
  select * into c from public.company where id = v.company_id;
  if v.status in ('anulada', 'descartada') then raise exception 'Está %: no se pasa.', v.status using errcode = '22023'; end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice'
               and e.source_id = v.id and e.status = 'validado') then
    raise exception 'Tiene su asiento validado: anula el asiento antes de pasarla a %.', d.legal_name using errcode = '22023';
  end if;
  -- Lo que ya se hizo con ella en esta sociedad no se mueve solo: se deshace antes.
  select string_agg(x, ', ') into v_traba from (
    select 'pagos' x where exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = v.id)
                          or exists (select 1 from public.conta_pago_salida p where p.invoice_id = v.id)
                          or exists (select 1 from public.conta_pago_remesa_linea p where p.invoice_id = v.id)
    union all select 'una casación con el banco' where exists (select 1 from public.bank_match_item b where b.supplier_invoice_id = v.id)
    union all select 'un impuesto presentado' where exists (select 1 from public.tax_return_line t where t.supplier_invoice_id = v.id)
    union all select 'una liquidación' where exists (select 1 from public.licensed_settlement l where l.received_invoice_id = v.id)
                                          or exists (select 1 from public.channel_settlement_invoice l where l.supplier_invoice_id = v.id)
    union all select 'su recepción' where exists (select 1 from public.goods_receipt_path g where g.supplier_invoice_id = v.id)
  ) t;
  if v_traba is not null then
    raise exception 'Ya tiene %: deshazlo antes de pasarla a %.', v_traba, d.legal_name using errcode = '22023';
  end if;
  delete from public.journal_entry e
   where e.account_id = v.account_id and e.source_type = 'supplier_invoice' and e.source_id = v.id and e.status in ('propuesto', 'borrador');
  get diagnostics v_quitados = row_count;
  update public.supplier_invoice
     set company_id = d.id,
         -- Su local, si es también de la otra sociedad; si no, sin local.
         location_id = case when exists (select 1 from public.location_company lc where lc.location_id = v.location_id and lc.company_id = d.id) then v.location_id end,
         vat_non_deductible = case when vat_non_deductible_reason = 'no_a_nombre' then false else vat_non_deductible end,
         vat_non_deductible_reason = case when vat_non_deductible_reason = 'no_a_nombre' then null else vat_non_deductible_reason end,
         recipient_answer = null, recipient_answered_at = null, recipient_answered_by_name = null,
         journal_entry_id = case when journal_entry_id is not null and not exists (select 1 from public.journal_entry e where e.id = v.journal_entry_id) then null else journal_entry_id end,
         updated_at = now()
   where id = v.id;
  update public.document_inbox set company_id = d.id, updated_at = now() where supplier_invoice_id = v.id and account_id = v.account_id;
  get diagnostics v_llegadas = row_count;
  update public.document_activity set company_id = d.id where supplier_invoice_id = v.id and account_id = v.account_id;
  update public.supplier_invoice_auto set company_id = d.id where invoice_id = v.id and account_id = v.account_id;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v.account_id, v.id, v_quien, 'guardar', jsonb_build_array(jsonb_build_object('campo', 'sociedad',
          'antes', jsonb_build_object('id', c.id, 'nombre', c.legal_name), 'ahora', jsonb_build_object('id', d.id, 'nombre', d.legal_name))));
  return jsonb_build_object('sociedad_id', d.id, 'sociedad', d.legal_name, 'llegadas', v_llegadas, 'asiento_quitado', v_quitados > 0,
    'texto', format('Pasada a %s, con su PDF. Ya no está en esta lista.', d.legal_name));
end $function$;
comment on function public.conta_recibida_pasar_a(uuid, uuid, text) is 'E03: pasa una recibida (con su llegada y su actividad) a otra sociedad de la misma cuenta, sin asiento. No si tiene asiento validado, pagos, banco, impuesto, liquidación o recepción. Lo apunta en supplier_invoice_change.';
revoke all on function public.conta_recibida_pasar_a(uuid, uuid, text) from public, anon;
grant execute on function public.conta_recibida_pasar_a(uuid, uuid, text) to authenticated, service_role;
