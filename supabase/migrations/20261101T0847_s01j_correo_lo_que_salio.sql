-- supabase/migrations/20261101T0847_s01j_correo_lo_que_salio.sql
-- cambia: public.conta_correo_facturas · prueba: supabase/staging/sql/20261101_s01j_correo_prueba.sql
--
-- S01j · «Correo de facturas» dice qué salió de cada correo (maqueta 1, aprobada
-- por Julio el 01/11): además de lo de siempre, cada llegada trae su email_id
-- (para «Volver a leer») y las liquidaciones que salieron de él (Glovo por su
-- Excel, Just Eat por su cuerpo): plataforma, tienda, periodo y lo que paga.
-- Lo demás, igual que el cuerpo de producción del 01/11 (md5 del cuerpo
-- cc4eb4ba0b2703507253e73bce23fd07). Misma firma: create or replace (regla 2).

select public._respaldar_funcion('public.conta_correo_facturas(uuid)', '20261101T0847_s01j_correo_lo_que_salio');

create or replace function public.conta_correo_facturas(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a company_inbound_address; v_conf inbound_email_log; v_ult timestamptz; v_lleg jsonb;
begin
  if not exists (select 1 from company c where c.id = p_company and public.belongs_to_account(c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  select * into a from company_inbound_address where company_id = p_company and kind = 'facturas';
  if a.id is null then return jsonb_build_object('direccion', null); end if;
  select max(received_at) into v_ult from inbound_email_log
   where company_id = p_company and lower(split_part(to_address, '@', 1)) = lower(a.local_part);
  select * into v_conf from inbound_email_log
   where company_id = p_company and outcome = 'confirmacion' and lower(split_part(to_address, '@', 1)) = lower(a.local_part)
   order by received_at desc limit 1;
  select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]') into v_lleg from (
    select jsonb_build_object('fecha', l.received_at, 'de', l.from_address, 'asunto', l.subject, 'resultado', l.outcome,
             'llegada', d.status, 'motivo', d.reason,
             'factura', case when si.id is not null then jsonb_build_object('id', si.id, 'codigo', si.code, 'numero', si.invoice_number, 'total', si.grand_total,
                                                                         'proveedor', sp.name, 'casada', exists (select 1 from supplier_invoice_receipt r where r.supplier_invoice_id = si.id)) end,
             'dicho', (select da.text from document_activity da where da.supplier_invoice_id = coalesce(d.supplier_invoice_id, d.duplicate_of_invoice_id)
                         and da.action in ('casada', 'propuesta') order by da.created_at desc limit 1),
             -- S01j · Para «Volver a leer», y lo que salió del correo: sus liquidaciones (y la factura de comisión de Just Eat).
             'email_id', l.email_id,
             'liquidaciones', (select coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'plataforma', sc.name,
                                  'tienda', regexp_replace(coalesce(ps.external_text, cs.external_location_text, ''), '\s*\(.*$', ''),
                                  'local', lo.name, 'desde', cs.period_from, 'hasta', cs.period_to, 'neto', cs.net_payout,
                                  'pago_el', cs.settlement_date) order by cs.period_from), '[]'::jsonb)
                                 from channel_settlement cs left join sales_channel sc on sc.id = cs.channel_id
                                 left join platform_store ps on ps.id = cs.store_id left join locations lo on lo.id = coalesce(cs.location_id, ps.location_id)
                                where cs.account_id = l.account_id and cs.inbound_email_id = l.email_id),
             'factura_comision', case when l.detail ? 'factura_id' then (select jsonb_build_object('id', fi.id, 'codigo', fi.code, 'numero', fi.invoice_number,
                                  'total', fi.grand_total, 'en_revision', fi.needs_review, 'nota', fi.notes)
                                 from supplier_invoice fi where fi.id = nullif(l.detail->>'factura_id', '')::uuid and fi.account_id = l.account_id) end) x
      from inbound_email_log l
      left join document_inbox d on d.email_id = l.email_id and d.company_id = p_company
      left join supplier_invoice si on si.id = coalesce(d.supplier_invoice_id, d.duplicate_of_invoice_id)
      left join supplier sp on sp.id = si.supplier_id
     where l.company_id = p_company and lower(split_part(l.to_address, '@', 1)) = lower(a.local_part)
     order by l.received_at desc limit 30) y;
  return jsonb_build_object('direccion', a.local_part || '@' || a.domain, 'activa', a.active, 'ultimo', v_ult,
    'confirmacion', case when v_conf.id is not null then jsonb_build_object('fecha', v_conf.received_at, 'codigo', v_conf.detail->>'codigo', 'enlace', v_conf.detail->>'enlace') end,
    'llegadas', v_lleg);
end $$;
