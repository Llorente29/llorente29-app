-- supabase/vuelta-atras/20261117T2241_n06b_serie_y_listas.down.sql
--
-- N06b · la vuelta atrás de la serie y las listas: las cinco funciones desde su respaldo, la vista con su
-- texto de antes y el CHECK sin la serie 8. Si ya hay asientos en la serie de lo traído, para: no se
-- quitan a escondidas.
do $$ begin
  if exists (select 1 from public.journal_entry where series = 8) then
    raise exception 'N06b: hay asientos en la serie de lo traído; la vuelta atrás de la serie no se hace con ellos dentro.';
  end if;
end $$;
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261117T2241_n06b_serie_y_listas');
select public._restaurar_funcion('public.banco_facturas_recibidas_pendientes(uuid,date)', '20261117T2241_n06b_serie_y_listas');
select public._restaurar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261117T2241_n06b_serie_y_listas');
select public._restaurar_funcion('public.bank_facturas_para_casar(uuid)', '20261117T2241_n06b_serie_y_listas');
select public._restaurar_funcion('public.conta_pagos_lista(uuid,date)', '20261117T2241_n06b_serie_y_listas');
-- La vista, con su definición de antes de la N06b, entera (la de pg_get_viewdef del 17/11).
create or replace view public.conta_factura_cobro with (security_invoker = true) as
 WITH c AS (
         SELECT ci.id,
            ci.account_id,
            ci.company_id,
            ci.status,
            ci.total,
            ci.due_date,
            (COALESCE(( SELECT sum(p.amount) AS sum
                   FROM customer_invoice_payment p
                  WHERE (p.invoice_id = ci.id)), (0)::numeric))::numeric(14,2) AS cobrado,
            conta_factura_es_de_plataforma(ci.id) AS de_plataforma
           FROM customer_invoice ci
        )
 SELECT id AS invoice_id,
    account_id,
    company_id,
    total,
    cobrado,
    ((total - cobrado))::numeric(14,2) AS pendiente,
    due_date AS vence,
    de_plataforma,
        CASE
            WHEN (status = 'borrador'::text) THEN 'borrador'::text
            WHEN (status = 'anulada'::text) THEN 'anulada'::text
            WHEN (total < (0)::numeric) THEN
            CASE
                WHEN (abs((total - cobrado)) < 0.005) THEN 'cobrada'::text
                ELSE 'emitida'::text
            END
            WHEN (total = (0)::numeric) THEN 'emitida'::text
            WHEN ((total - cobrado) < 0.005) THEN 'cobrada'::text
            WHEN ((due_date IS NOT NULL) AND (due_date < conta_hoy())) THEN
            CASE
                WHEN (de_plataforma AND (NOT conta_factura_tiene_liquidacion(id))) THEN 'falta_liquidacion'::text
                ELSE 'vencida'::text
            END
            WHEN (cobrado > (0)::numeric) THEN 'cobrada_parte'::text
            WHEN de_plataforma THEN 'esperando_liquidacion'::text
            WHEN ((due_date IS NOT NULL) AND (due_date <= (conta_hoy() + 7))) THEN 'vence_semana'::text
            ELSE 'por_cobrar'::text
        END AS estado,
        CASE
            WHEN ((due_date IS NOT NULL) AND (due_date < conta_hoy()) AND ((total - cobrado) >= 0.005) AND (status = 'emitida'::text)) THEN (conta_hoy() - due_date)
            ELSE NULL::integer
        END AS dias_vencida
   FROM c;

alter table public.journal_entry drop constraint if exists journal_entry_series_check;
alter table public.journal_entry add constraint journal_entry_series_check check (series = any (array[1, 2, 3, 4, 9]));
