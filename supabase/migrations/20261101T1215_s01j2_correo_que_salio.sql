-- supabase/migrations/20261101T1215_s01j2_correo_que_salio.sql
-- cambia: public.conta_correo_facturas · prueba: supabase/staging/sql/20261101_s01j2_correo_prueba.sql
--
-- S01j·2 · «Correo de facturas» dice de cada correo qué salió (maquetas 1 y 2,
-- aprobadas por Julio el 01/11). Además de lo de la 0847:
--   · las liquidaciones que ya habían entrado con otro correo (medido en
--     Foodint el 01/11: 36 correos de Glovo con el mismo Excel reenviado,
--     «ya_estaba», que hoy no dicen nada), marcadas «otro_correo»;
--   · «plataforma» (glovo, justeat), para «Volver a leer todo lo de…»;
--   · «excel»: leído; sin leer (9 correos llegaron antes de que se leyera el
--     Excel y lo dejaron como «no es un PDF»: hay que volver a leerlos); o no
--     venía (35 correos de Glovo solo traían el PDF).
-- Parte del cuerpo de producción del 01/11 (md5 68d34fa3…, el de la 0847).
-- Misma firma: create or replace (regla 2).

select public._respaldar_funcion('public.conta_correo_facturas(uuid)', '20261101T1215_s01j2_correo_que_salio');

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
                                  'pago_el', cs.settlement_date,
                                  -- S01j·2 · Una liquidación que ya había entrado con otro correo (el mismo Excel reenviado dos veces).
                                  'otro_correo', cs.inbound_email_id is distinct from l.email_id) order by cs.period_from), '[]'::jsonb)
                                 from channel_settlement cs left join sales_channel sc on sc.id = cs.channel_id
                                 left join platform_store ps on ps.id = cs.store_id left join locations lo on lo.id = coalesce(cs.location_id, ps.location_id)
                                where cs.account_id = l.account_id
                                  and (cs.inbound_email_id = l.email_id
                                       or cs.id::text in (select x->>'id' from jsonb_array_elements(case when jsonb_typeof(l.detail->'liquidaciones') = 'array' then l.detail->'liquidaciones' else '[]'::jsonb end) x))),
             -- S01j·2 · De qué plataforma es (para «Volver a leer todo lo de…») y qué pasó con su Excel:
             -- leído; sin leer (llegó antes de que se leyeran: se dejó como «no es un PDF»); o no venía.
             'plataforma', case when l.from_address ~* 'glovo' or l.subject ~* 'glovo' then 'glovo'
                                when l.from_address ~* 'just-?eat' or l.subject ~* 'just-?eat' then 'justeat' end,
             'excel', case when jsonb_typeof(l.detail->'liquidaciones') = 'array' then 'leido'
                           when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(l.detail->'dejados') = 'array' then l.detail->'dejados' else '[]'::jsonb end) x
                                         where x->>'nombre' ~* '\.xlsx?$') then 'sin_leer'
                           when (l.from_address ~* 'glovo' or l.subject ~* 'glovo') and l.outcome <> 'confirmacion' then 'no_traia' end,
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
