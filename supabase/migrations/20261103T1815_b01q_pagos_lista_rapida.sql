-- ============================================================================
-- B01 · Respuesta 15 (03/11) · COMPRAS › PAGOS NO ABRÍA EN PRODUCCIÓN
-- cambia: public.conta_pagos_lista · prueba: supabase/staging/sql/20261103_b01q_pagos_lista_prueba.sql
-- cambia: public.conta_pagos_por_revisar · prueba: supabase/staging/sql/20261103_b01q_pagos_lista_prueba.sql
-- ----------------------------------------------------------------------------
-- «No se han podido leer los pagos: Está tardando más de lo normal», siempre.
-- conta_pagos_lista(Foodint) tardaba 22,8 s como Julio (el límite de un
-- usuario es 8 s); 27 ms sin RLS. Las dos leen la vista conta_recibida_pago
-- (security_invoker) unida a supplier_invoice: con la RLS de quien llama
-- (belongs_to_account, que no es leakproof y, para un administrador de la
-- plataforma, arma la lista de todas las cuentas en cada llamada) la vista se
-- recorre entera una vez por factura (Seq Scan … loops=272, 81.056 filas
-- quitadas). Crece con las facturas al cuadrado.
--
-- Arreglo: las dos pasan a SECURITY DEFINER (como conta_pago_quien) con UNA
-- sola comprobación de la cuenta, al leer la empresa:
--   (select c.account_id from public.company c where c.id = p_company
--      and public.belongs_to_account(c.account_id))
-- Si quien llama no es de la cuenta de la empresa, la cuenta sale nula y no
-- hay ninguna fila: lo mismo que antes hacía la RLS. Todas las tablas que leen
-- (supplier_invoice, supplier_invoice_payment, supplier, locations, company,
-- company_account_link, conta_pago_remesa*) filtran solo por la cuenta: nada
-- de lo que ve un usuario cambia. El cuerpo es el de antes, letra a letra,
-- salvo esa línea y el desempate del orden (f.id: dos facturas con el mismo
-- vencimiento y la misma fecha salían en un orden que dependía del plan; Pagos
-- las vuelve a ordenar en pantalla). Mismas firmas: create or replace (regla 2:
-- no cambia ningún parámetro).
--
-- Los permisos, los de conta_pagos_por_revisar para las dos: authenticated y
-- service_role (conta_pagos_lista se podía llamar también como anon y PUBLIC).
--
-- Medido como Julio, en transacción revertida: ver el parte del PR.
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261103T1815_b01q_pagos_lista_rapida.down.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.conta_pagos_lista(p_company uuid, p_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
     where si.account_id = (select c.account_id from public.company c where c.id = p_company and public.belongs_to_account(c.account_id))
       and coalesce(si.company_id, p_company) = p_company
       and si.status in ('aprobada', 'pagada')
       -- S01i · Lo que se compensa (comisiones de plataformas, abonos) no se paga por banco: no sale en Pagos.
       and si.payment_method is distinct from 'compensation' and si.paid_method is distinct from 'compensation'
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha, f.id) from f), '[]'::jsonb),
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
 STABLE SECURITY DEFINER
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
     where si.account_id = (select c.account_id from public.company c where c.id = p_company and public.belongs_to_account(c.account_id))
       and coalesce(si.company_id, p_company) = p_company
       and si.status = 'en_revision' and si.paid_at is null and si.discarded_at is null
       and si.payment_method is distinct from 'compensation'
  )
  select coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha, f.id) from f), '[]'::jsonb)
$function$;

revoke all on function public.conta_pagos_lista(uuid, date) from public, anon;
revoke all on function public.conta_pagos_por_revisar(uuid) from public, anon;
grant execute on function public.conta_pagos_lista(uuid, date) to authenticated, service_role;
grant execute on function public.conta_pagos_por_revisar(uuid) to authenticated, service_role;

comment on function public.conta_pagos_lista(uuid, date) is 'B01·15 (03/11) · Compras › Pagos: las facturas por pagar de una empresa, con lo pagado y su estado (conta_recibida_pago). SECURITY DEFINER con una sola comprobación de la cuenta (belongs_to_account) al leer la empresa: antes, con la RLS fila a fila, tardaba 22,8 s en Foodint.';
comment on function public.conta_pagos_por_revisar(uuid) is 'B01·15 (03/11) · Compras › Pagos: las facturas en revisión y sin pagar, para enseñarlas sin poder marcarlas. SECURITY DEFINER con una sola comprobación de la cuenta, como conta_pagos_lista.';
