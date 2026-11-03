-- ============================================================================
-- Vuelta atrás de 20261103T1815_b01q_pagos_lista_rapida.sql: las dos funciones
-- como estaban en producción el 03/11 (pg_get_functiondef, letra a letra: md5
-- 72fee864… y 0f60410c…), sin SECURITY DEFINER, con sus permisos de antes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.conta_pagos_lista(p_company uuid, p_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with f as (
    select si.id, si.supplier_id, s.name as proveedor, si.invoice_number as numero, si.invoice_date as fecha, rp.vence, rp.total, rp.pagado, rp.pendiente,
           rp.estado, rp.dias_vencida, coalesce(si.payment_method, s.payment_method) as forma, si.location_id, lo.name as local,
           right(public._pc01e2_iban(s.iban), 4) as iban4, (public._pc01e2_iban(s.iban) is not null) as con_iban,
           (s.iban_unconfirmed_invoice_id is not null) as iban_sin_confirmar, right(public._pc01e2_iban(si.read_iban), 4) as iban_leido4,
           (public._pc01e2_iban(si.read_iban) is not null and si.iban_decision is null and public._pc01e2_iban(s.iban) is not null
              and public._pc01e2_iban(si.read_iban) <> public._pc01e2_iban(s.iban)) as iban_distinto,
           exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal') as con_cuenta,
           s.payment_terms_days as plazo,
           (select jsonb_build_object('id', r.id, 'codigo', r.code, 'importe', sum(l.amount))
              from public.conta_pago_remesa_linea_estado l join public.conta_pago_remesa r on r.id = l.remesa_id
             where l.invoice_id = si.id and l.estado in ('pendiente', 'por_confirmar') group by r.id, r.code order by r.code desc limit 1) as remesa
      from public.supplier_invoice si
      join public.conta_recibida_pago rp on rp.invoice_id = si.id
      left join public.supplier s on s.id = si.supplier_id
      left join public.locations lo on lo.id = si.location_id
     where si.account_id = (select account_id from public.company where id = p_company)
       and coalesce(si.company_id, p_company) = p_company
       and si.status in ('aprobada', 'pagada')
       -- S01i · Lo que se compensa (comisiones de plataformas, abonos) no se paga por banco: no sale en Pagos.
       and si.payment_method is distinct from 'compensation' and si.paid_method is distinct from 'compensation'
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha) from f), '[]'::jsonb),
    'pagado_mes', (select coalesce(sum(p.amount), 0) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                    where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'pagadas_mes', (select count(distinct p.invoice_id) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                     where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'sin_plazo', coalesce((select jsonb_agg(distinct jsonb_build_object('id', f.supplier_id, 'nombre', f.proveedor))
                            from f where f.estado = 'sin_vencimiento' and f.plazo is null and f.supplier_id is not null), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.conta_pagos_por_revisar(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with f as (
    select si.id, si.supplier_id, s.name as proveedor, si.invoice_number as numero, si.invoice_date as fecha, rp.vence, rp.total, rp.pagado, rp.pendiente,
           rp.estado, rp.dias_vencida, coalesce(si.payment_method, s.payment_method) as forma, si.location_id, lo.name as local,
           right(public._pc01e2_iban(s.iban), 4) as iban4, (public._pc01e2_iban(s.iban) is not null) as con_iban,
           (s.iban_unconfirmed_invoice_id is not null) as iban_sin_confirmar, right(public._pc01e2_iban(si.read_iban), 4) as iban_leido4,
           false as iban_distinto, true as con_cuenta, null::jsonb as remesa, true as por_revisar
      from public.supplier_invoice si
      join public.conta_recibida_pago rp on rp.invoice_id = si.id
      left join public.supplier s on s.id = si.supplier_id
      left join public.locations lo on lo.id = si.location_id
     where si.account_id = (select account_id from public.company where id = p_company)
       and coalesce(si.company_id, p_company) = p_company
       and si.status = 'en_revision' and si.paid_at is null and si.discarded_at is null
       and si.payment_method is distinct from 'compensation'
  )
  select coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha) from f), '[]'::jsonb)
$function$;

grant execute on function public.conta_pagos_lista(uuid, date) to public, anon, authenticated, service_role;
revoke all on function public.conta_pagos_por_revisar(uuid) from public, anon;
grant execute on function public.conta_pagos_por_revisar(uuid) to authenticated, service_role;
comment on function public.conta_pagos_lista(uuid, date) is null;
comment on function public.conta_pagos_por_revisar(uuid) is null;
