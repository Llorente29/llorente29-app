-- ============================================================================
-- B01 · Cola 1e · PAGOS ENSEÑA TAMBIÉN LO QUE ESTÁ POR REVISAR (solo añade)
-- ----------------------------------------------------------------------------
-- Julio (02/11, maqueta v2 de Pagar, respuesta B01·7): arriba de Pagos, «Por
-- revisar» es una de las cuatro cifras, y una factura en revisión sale en la
-- lista con su vencimiento guardado, sin poder marcarse («apruébala para
-- pagarla»). conta_pagos_lista solo trae las aprobadas y las pagadas, y no se
-- toca: esta función NUEVA trae las que están en revisión y sin pagar, con las
-- mismas columnas y «por_revisar» a true, y el front las junta.
--
-- Como conta_pagos_lista: de seguridad del que llama (lee con su RLS) y sin lo
-- que se compensa. Solo añade y se puede pasar dos veces. No toca datos ni nada
-- del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261102T2115_b01p_pagos_por_revisar.down.sql
-- Prueba: supabase/staging/sql/20261102_b01p_pagar_prueba.sql
-- ============================================================================

create or replace function public.conta_pagos_por_revisar(p_company uuid)
returns jsonb language sql stable set search_path = public as $$
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
$$;
revoke all on function public.conta_pagos_por_revisar(uuid) from public, anon;
grant execute on function public.conta_pagos_por_revisar(uuid) to authenticated;
comment on function public.conta_pagos_por_revisar(uuid) is 'B01 · Cola 1e (02/11). Las facturas recibidas en revisión y sin pagar, con las columnas de conta_pagos_lista y por_revisar = true: Pagos las enseña con su vencimiento, sin poder marcarlas.';
