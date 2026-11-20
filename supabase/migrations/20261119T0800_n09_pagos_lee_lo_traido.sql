-- supabase/migrations/20261119T0800_n09_pagos_lee_lo_traido.sql
-- cambia: public.conta_recibida_pago · prueba: supabase/staging/sql/20261119_n09_pagos_lee_lo_traido_prueba.sql
-- cambia: public.bank_facturas_para_casar · prueba: supabase/staging/sql/20261119_n09_pagos_lee_lo_traido_prueba.sql
-- cambia: public.bank_facturas_recibidas_pendientes · prueba: supabase/staging/sql/20261119_n09_pagos_lee_lo_traido_prueba.sql
--
-- N09 · Pagos y Bancos leen lo que ya está pagado en el programa de antes (respuesta N09 · 1, decisión 1).
--
-- Al traer de ERP10, lo que le queda a cada recibida se guarda en supplier_invoice.import_pending (N06a),
-- casado pago a pago desde el N09. Cobros ya lo lee desde la 2241 del N06b (conta_factura_cobro). Pagos
-- y Bancos no: calculaban lo pendiente como el total menos lo pagado en Sumied, y una recibida traída con
-- pago parcial salía con su total entero (la B-7 del ejemplo, 341,00 en vez de 241,00; el alquiler, con
-- la retención, 1.210,00 en vez de 1.020,00).
--
-- En una recibida traída (source «traida») con lo pendiente guardado, lo pagado ALLÍ cuenta como pagado:
-- total − import_pending, que en el alquiler incluye la retención, que no se paga al proveedor. Para las
-- demás, la misma cifra que hoy (se suma 0). Tres sitios:
--   1. conta_recibida_pago, la vista de Pagos (conta_pagos_lista, el pago a mano, las remesas y «por
--      revisar» la leen);
--   2. bank_facturas_para_casar, la propuesta de casar un movimiento con una factura en Bancos;
--   3. bank_facturas_recibidas_pendientes, las facturas pendientes de Bancos.
-- Las dos de Bancos dan «total» y «pagado», y la pantalla resta. banco_facturas_recibidas_pendientes no
-- se toca: no la llama la aplicación.
--
-- La vista y cada función: misma firma y mismas columnas, el respaldo de las funciones antes, y su trozo
-- exacto (si no está una sola vez, para y no toca nada). Si ya está pasada, no hace nada. No cambia
-- ninguna fila. Nada en el camino del pedido.

select public._respaldar_funcion('public.bank_facturas_para_casar(uuid)', '20261119T0800_n09_pagos_lee_lo_traido');
select public._respaldar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261119T0800_n09_pagos_lee_lo_traido');

-- 1 · La vista de Pagos.
do $do$
declare
  v_def text := pg_get_viewdef('public.conta_recibida_pago'::regclass);
  v_viejo text := $v$                  WHERE (x.invoice_id = si.id)), (0)::numeric))::numeric(14,2) AS pagado$v$;
  v_nuevo text := $n$                  WHERE (x.invoice_id = si.id)), (0)::numeric) + CASE WHEN ((si.source = 'traida'::text) AND (si.import_pending IS NOT NULL)) THEN GREATEST((COALESCE(si.grand_total, (0)::numeric) - si.import_pending), (0)::numeric) ELSE (0)::numeric END)::numeric(14,2) AS pagado$n$;
begin
  if strpos(v_def, 'import_pending') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N09: conta_recibida_pago no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute 'create or replace view public.conta_recibida_pago with (security_invoker = true) as ' || replace(v_def, v_viejo, v_nuevo);
end $do$;

-- 2 y 3 · Lo pagado de las dos de Bancos.
do $do$
declare
  f text; v_def text;
  v_viejo text := $v$                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0),
$v$;
  v_nuevo text := $n$                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0)
         + case when si.source = 'traida' and si.import_pending is not null
                then greatest(coalesce(si.grand_total, 0) - si.import_pending, 0) else 0 end,  -- N09 · lo pagado en el programa de antes
$n$;
begin
  foreach f in array array['public.bank_facturas_para_casar(uuid)', 'public.bank_facturas_recibidas_pendientes(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    continue when strpos(v_def, 'N09 · lo pagado en el programa de antes') > 0;   -- ya pasada
    if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
      raise exception 'N09: % no es la medida (su trozo no está una sola vez): no se toca.', f;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $do$;
