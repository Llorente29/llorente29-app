-- supabase/migrations/20261119T1930_n10_bancos_todo_lo_pagado.sql
-- cambia: public.bank_facturas_para_casar · prueba: supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
-- cambia: public.bank_facturas_recibidas_pendientes · prueba: supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
-- cambia: public._bank_casar_nucleo · prueba: supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
-- cambia: public._bank_factura_aprobada_con_pago · prueba: supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql
--
-- N10 · Parte 2. Bancos cuenta TODO lo pagado de una recibida, venga del banco o de un pago a mano, igual
-- que Pagos: una sola regla, escrita una vez (_bank_recibida_pagado) y leída en los cuatro sitios de Bancos
-- que la calculaban con lo casado en el banco solamente.
--
-- Una recibida de 242,00 con 42,00 pagados a mano (una compensación, con su asiento) salía en Bancos por
-- 242,00 y en Pagos por 200,00; y al casar desde Bancos los 200,00 que le quedan, Bancos creía que llevaba
-- 200 de 242 y no la daba por pagada (lo sacó la prueba de la regla 10, staging 1426 y 1428).
--
-- Lo pagado (_bank_recibida_pagado, nueva): el «pagado» de la vista de Pagos (conta_recibida_pago: todos
-- los pagos de la factura —casar en Bancos ya apunta el suyo, el disparador del PC01, y deshacer lo quita—
-- y lo pagado en el programa de antes, N09), más lo casado vivo en el banco que no tenga su pago apuntado
-- (lo casado antes del PC01, si lo hubiera: así no deja de contar nada de lo que hoy cuenta; la cuenta de
-- la tanda lo mide).
--   1. bank_facturas_para_casar y bank_facturas_recibidas_pendientes: su «pagado» (la pantalla resta);
--   2. _bank_casar_nucleo (bank_casar): el freno «este pago la pasaría» y la marca de pagada;
--   3. _bank_factura_aprobada_con_pago (al aprobarla, pagada si lo casado la cubre): lo pagado, y solo si
--      hay algo casado en el banco (de ahí salen el día y la forma de pago, como hoy).
-- conta_factura_descartar no se toca (mira si hay algo casado, no cuánto). banco_facturas_recibidas_pendientes
-- tampoco: no la llama la aplicación.
--
-- Cada función: misma firma, su respaldo antes y sus trozos exactos (si alguno no está una sola vez, para y
-- no toca nada). Si ya está pasada, no hace nada. No cambia ninguna fila. Nada en el camino del pedido.

create or replace function public._bank_recibida_pagado(p_invoice uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $f$
  select (coalesce((select r.pagado from public.conta_recibida_pago r where r.invoice_id = p_invoice), 0)
        + coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                     where i.supplier_invoice_id = p_invoice and b.status = 'vivo'
                       and not exists (select 1 from public.supplier_invoice_payment x where x.bank_match_id = i.match_id and x.invoice_id = p_invoice)), 0))::numeric(14,2)
$f$;
comment on function public._bank_recibida_pagado(uuid) is
  'N10 · Lo pagado de una recibida para Bancos, la misma regla que Pagos: el «pagado» de conta_recibida_pago (todos sus pagos y lo traído) más lo casado vivo en el banco sin su pago apuntado.';
revoke all on function public._bank_recibida_pagado(uuid) from public, anon;
grant execute on function public._bank_recibida_pagado(uuid) to authenticated, service_role;

select public._respaldar_funcion('public.bank_facturas_para_casar(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._respaldar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._respaldar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261119T1930_n10_bancos_todo_lo_pagado');
select public._respaldar_funcion('public._bank_factura_aprobada_con_pago()', '20261119T1930_n10_bancos_todo_lo_pagado');

do $do$
declare
  r record; v_def text; k int;
  -- 1 · Las dos que proponen: lo que dejó la 0800 del N09.
  v_lista_viejo text := $v$         coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0)
         + case when si.source = 'traida' and si.import_pending is not null
                then greatest(coalesce(si.grand_total, 0) - si.import_pending, 0) else 0 end,  -- N09 · lo pagado en el programa de antes
$v$;
  v_lista_nuevo text := $n$         public._bank_recibida_pagado(si.id),  -- N10 · todo lo pagado, como Pagos
$n$;
  -- 2 · El casado: el freno y la marca.
  v_freno_viejo text := $v$      select coalesce(sum(i.amount), 0) into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';
      if v_pagado + (v_f->>'importe')::numeric > coalesce(v_inv.grand_total, 0) + 0.005 then
        raise exception 'La factura % ya tiene casados % de %: este pago la pasaría.'$v$;
  v_freno_nuevo text := $n$      v_pagado := public._bank_recibida_pagado(v_inv.id);  -- N10 · todo lo pagado, como Pagos
      if v_pagado + (v_f->>'importe')::numeric > coalesce(v_inv.grand_total, 0) + 0.005 then
        raise exception 'La factura % ya tiene pagados % de %: este pago la pasaría.'$n$;
  v_marca_viejo text := $v$      select coalesce(sum(i.amount), 0) + (v_f->>'importe')::numeric into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';$v$;
  v_marca_nuevo text := $n$      v_pagado := public._bank_recibida_pagado(v_inv.id) + (v_f->>'importe')::numeric;  -- N10 · todo lo pagado, como Pagos$n$;
  -- 3 · Al aprobarla.
  v_aprob_viejo text := $v$  select coalesce(sum(i.amount), 0) into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
   where i.supplier_invoice_id = new.id and b.status = 'vivo';
  if v_pagado = 0 or v_pagado < coalesce(new.grand_total, 0) - 0.005 then return null; end if;$v$;
  v_aprob_nuevo text := $n$  -- N10 · todo lo pagado, como Pagos; y solo si hay algo casado en el banco (de ahí salen el día y la forma).
  if not exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                  where i.supplier_invoice_id = new.id and b.status = 'vivo') then return null; end if;
  v_pagado := public._bank_recibida_pagado(new.id);
  if v_pagado < coalesce(new.grand_total, 0) - 0.005 then return null; end if;$n$;
begin
  for r in select * from (values
      ('public.bank_facturas_para_casar(uuid)', array[v_lista_viejo], array[v_lista_nuevo]),
      ('public.bank_facturas_recibidas_pendientes(uuid)', array[v_lista_viejo], array[v_lista_nuevo]),
      ('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', array[v_freno_viejo, v_marca_viejo], array[v_freno_nuevo, v_marca_nuevo]),
      ('public._bank_factura_aprobada_con_pago()', array[v_aprob_viejo], array[v_aprob_nuevo])) t(firma, viejos, nuevos) loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    continue when strpos(v_def, 'N10 · todo lo pagado, como Pagos') > 0;   -- ya pasada
    for k in 1 .. array_length(r.viejos, 1) loop
      if (length(v_def) - length(replace(v_def, r.viejos[k], ''))) / length(r.viejos[k]) <> 1 then
        raise exception 'N10: % no es la medida (su trozo % no está una sola vez): no se toca.', r.firma, k;
      end if;
    end loop;
    for k in 1 .. array_length(r.viejos, 1) loop
      v_def := replace(v_def, r.viejos[k], r.nuevos[k]);
    end loop;
    execute v_def;
  end loop;
end $do$;
