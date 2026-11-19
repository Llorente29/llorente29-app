-- supabase/vuelta-atras/20261119T0800_n09_pagos_lee_lo_traido.down.sql
--
-- N09 · la vuelta atrás de «Pagos y Bancos leen lo pagado en el programa de antes»: las dos funciones de
-- Bancos desde su respaldo y la vista de Pagos con su texto de antes, entero (el de pg_get_viewdef del
-- 19/11 en la estructura de staging). No cambia ninguna fila.
select public._restaurar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261119T0800_n09_pagos_lee_lo_traido');
select public._restaurar_funcion('public.bank_facturas_para_casar(uuid)', '20261119T0800_n09_pagos_lee_lo_traido');
create or replace view public.conta_recibida_pago with (security_invoker = true) as
 WITH p AS (
         SELECT si.id,
            si.account_id,
            si.company_id,
            si.status,
            COALESCE(si.grand_total, (0)::numeric) AS total,
            si.due_date,
            (COALESCE(( SELECT sum(x.amount) AS sum
                   FROM supplier_invoice_payment x
                  WHERE (x.invoice_id = si.id)), (0)::numeric))::numeric(14,2) AS pagado
           FROM supplier_invoice si
        )
 SELECT id AS invoice_id,
    account_id,
    company_id,
    total,
    pagado,
    (GREATEST((total - pagado), (0)::numeric))::numeric(14,2) AS pendiente,
    due_date AS vence,
        CASE
            WHEN (status = 'pagada'::text) THEN 'pagada'::text
            WHEN (status <> 'aprobada'::text) THEN status
            WHEN ((total - pagado) < 0.005) THEN 'pagada'::text
            WHEN ((due_date IS NOT NULL) AND (due_date < conta_hoy())) THEN 'vencida'::text
            WHEN (pagado > (0)::numeric) THEN 'pagada_parte'::text
            WHEN (due_date IS NULL) THEN 'sin_vencimiento'::text
            WHEN (due_date <= (conta_hoy() + 7)) THEN 'vence_semana'::text
            ELSE 'por_pagar'::text
        END AS estado,
        CASE
            WHEN ((status = 'aprobada'::text) AND (due_date IS NOT NULL) AND (due_date < conta_hoy()) AND ((total - pagado) >= 0.005)) THEN (conta_hoy() - due_date)
            ELSE NULL::integer
        END AS dias_vencida
   FROM p;
