-- supabase/migrations/20261119T1930_n10_bancos_todo_lo_pagado.sql
-- cambia: public.bank_facturas_para_casar · prueba: supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
-- cambia: public.bank_facturas_recibidas_pendientes · prueba: supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
--
-- N10 · Parte 2. Bancos descuenta TODO lo pagado de una recibida, venga del banco o de un pago a mano,
-- igual que Pagos: una sola regla para las dos pantallas.
--
-- Las dos de Bancos (la propuesta de casar un movimiento con una factura y las pendientes) dan «total» y
-- «pagado», y la pantalla resta. Su «pagado» era solo lo casado en el banco (más lo pagado en el programa
-- de antes, N09): una recibida de 242,00 con 42,00 pagados a mano salía en Bancos por 242,00, y en Pagos
-- por 200,00.
--
-- Ahora «pagado» es el de la vista de Pagos (conta_recibida_pago): todos los pagos de la factura
-- (supplier_invoice_payment; casar en Bancos ya apunta el suyo, el disparador del PC01, y deshacer lo
-- quita) y lo pagado en el programa de antes. Y, para no dejar de contar nada de lo que hoy cuenta, lo
-- casado vivo en el banco que no tenga su pago apuntado (lo casado antes del PC01, si lo hubiera: la
-- cuenta de la tanda lo mide).
--
-- Cada función: misma firma, su respaldo antes y su trozo exacto (si no está una sola vez, para y no
-- toca nada). Si ya está pasada, no hace nada. No cambia ninguna fila. Nada en el camino del pedido.
-- banco_facturas_recibidas_pendientes no se toca: no la llama la aplicación.

select public._respaldar_funcion('public.bank_facturas_para_casar(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._respaldar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');

do $do$
declare
  f text; v_def text;
  v_viejo text := $v$         coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0)
         + case when si.source = 'traida' and si.import_pending is not null
                then greatest(coalesce(si.grand_total, 0) - si.import_pending, 0) else 0 end,  -- N09 · lo pagado en el programa de antes
$v$;
  v_nuevo text := $n$         coalesce((select r.pagado from public.conta_recibida_pago r where r.invoice_id = si.id), 0)
         + coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                      where i.supplier_invoice_id = si.id and b.status = 'vivo'
                        and not exists (select 1 from public.supplier_invoice_payment x where x.bank_match_id = i.match_id and x.invoice_id = si.id)), 0),  -- N10 · todo lo pagado, como Pagos
$n$;
begin
  foreach f in array array['public.bank_facturas_para_casar(uuid)', 'public.bank_facturas_recibidas_pendientes(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    continue when strpos(v_def, 'N10 · todo lo pagado, como Pagos') > 0;   -- ya pasada
    if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
      raise exception 'N10: % no es la medida (su trozo no está una sola vez): no se toca.', f;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $do$;
