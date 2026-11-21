-- supabase/migrations/20261117T2241_n06b_serie_y_listas.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.conta_pagos_lista · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.bank_facturas_para_casar · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.bank_facturas_recibidas_pendientes · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.banco_facturas_recibidas_pendientes · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.conta_factura_cobro · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
--
-- N06b · Darlo por bueno. 3 de 4: LA SERIE DE LO TRAÍDO Y LO QUE LEEN LAS LISTAS. Va después de la 2240
-- (_conta_traida_en_prueba).
--
--   1. journal_entry_series_check: admite la serie 8, SOLO para lo traído (source_type «migrated»): la
--      serie propia de lo traído, numerada del 1 en adelante al darlo por bueno (contestado en el #715).
--      El CHECK solo amplía: todas las filas de hoy siguen valiendo.
--   2. Pagos y Bancos no enseñan una recibida traída en prueba (respuesta N06a · 1, «no sé» 1): un trozo
--      en conta_pagos_lista, bank_facturas_para_casar, bank_facturas_recibidas_pendientes y
--      banco_facturas_recibidas_pendientes, con _conta_traida_en_prueba.
--   3. Facturas recibidas sí la enseña, con su estado «traida_en_prueba» (conta_documentos_recibidos),
--      que la pantalla lee «Traída · en prueba».
--   4. conta_factura_cobro (la vista de lo cobrado de cada emitida): en una emitida traída, lo cobrado
--      ALLÍ cuenta como cobrado (total − lo pendiente por el saldo, decisión 3 del N01). Sin esto, una
--      traída cobrada en ERP10 saldría por cobrar en Cobros al darla por buena. Para las demás emitidas,
--      la misma cifra que hoy (se suma 0).
--
-- Cada función: misma firma, su respaldo antes y su trozo exacto (si no está una sola vez, para y no
-- toca nada). La vista, igual, con su texto de antes en la vuelta atrás. No cambia ninguna fila. Nada
-- en el camino del pedido.

-- 1 · La serie de lo traído.
alter table public.journal_entry drop constraint if exists journal_entry_series_check;
alter table public.journal_entry add constraint journal_entry_series_check
  check (series = any (array[1, 2, 3, 4, 9]) or (series = 8 and source_type = 'migrated'));

select public._respaldar_funcion('public.conta_pagos_lista(uuid,date)', '20261117T2241_n06b_serie_y_listas');
select public._respaldar_funcion('public.bank_facturas_para_casar(uuid)', '20261117T2241_n06b_serie_y_listas');
select public._respaldar_funcion('public.bank_facturas_recibidas_pendientes(uuid)', '20261117T2241_n06b_serie_y_listas');
select public._respaldar_funcion('public.banco_facturas_recibidas_pendientes(uuid,date)', '20261117T2241_n06b_serie_y_listas');
select public._respaldar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261117T2241_n06b_serie_y_listas');

-- 2 y 3 · Un trozo en cada función.
do $do$
declare
  r record; v_def text; v_n int;
begin
  for r in select * from (values
    ('public.conta_pagos_lista(uuid,date)',
     $v$       and si.status in ('aprobada', 'pagada')
$v$,
     $n$       and si.status in ('aprobada', 'pagada')
       and not public._conta_traida_en_prueba(si.source, si.import_run_id, si.import_mark)  -- N06b · lo traído en prueba no se paga
$n$),
    ('public.bank_facturas_para_casar(uuid)',
     $v$   where si.status in ('aprobada', 'en_revision') and si.paid_at is null and coalesce(si.grand_total, 0) > 0
$v$,
     $n$   where si.status in ('aprobada', 'en_revision') and si.paid_at is null and coalesce(si.grand_total, 0) > 0
     and not public._conta_traida_en_prueba(si.source, si.import_run_id, si.import_mark)  -- N06b · lo traído en prueba no se casa
$n$),
    ('public.bank_facturas_recibidas_pendientes(uuid)',
     $v$   where si.status = 'aprobada' and si.paid_at is null and coalesce(si.grand_total, 0) > 0
$v$,
     $n$   where si.status = 'aprobada' and si.paid_at is null and coalesce(si.grand_total, 0) > 0
     and not public._conta_traida_en_prueba(si.source, si.import_run_id, si.import_mark)  -- N06b · lo traído en prueba no se casa
$n$),
    ('public.banco_facturas_recibidas_pendientes(uuid,date)',
     $v$     and i.status in ('en_revision', 'aprobada', 'con_discrepancias') and i.paid_at is null
$v$,
     $n$     and i.status in ('en_revision', 'aprobada', 'con_discrepancias') and i.paid_at is null
     and not public._conta_traida_en_prueba(i.source, i.import_run_id, i.import_mark)  -- N06b · lo traído en prueba no se casa
$n$),
    ('public.conta_documentos_recibidos(uuid,date,date)',
     $v$      'estado', case when f.status = 'descartada' then 'descartada'
$v$,
     $n$      'estado', case when f.status = 'descartada' then 'descartada'
                     when public._conta_traida_en_prueba(f.source, f.import_run_id, f.import_mark) then 'traida_en_prueba'  -- N06b
$n$)) t(firma, viejo, nuevo) loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    continue when strpos(v_def, split_part(r.nuevo, E'\n', 2)) > 0;   -- ya pasada
    v_n := (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo);
    if v_n <> 1 then
      raise exception 'N06b: % no es la medida (su trozo está % veces): no se toca nada.', r.firma, v_n;
    end if;
    execute replace(v_def, r.viejo, r.nuevo);
  end loop;
end $do$;

-- 4 · Lo cobrado allí cuenta como cobrado.
do $do$
declare
  v_def text := pg_get_viewdef('public.conta_factura_cobro'::regclass);
  v_viejo text := $v$                  WHERE (p.invoice_id = ci.id)), (0)::numeric))::numeric(14,2) AS cobrado,$v$;
  v_nuevo text := $n$                  WHERE (p.invoice_id = ci.id)), (0)::numeric) + CASE WHEN ci.origin = 'traida' AND ci.import_pending IS NOT NULL THEN GREATEST(ci.total - ci.import_pending, (0)::numeric) ELSE (0)::numeric END)::numeric(14,2) AS cobrado,$n$;
begin
  if strpos(v_def, 'ci.import_pending') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N06b: conta_factura_cobro no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute 'create or replace view public.conta_factura_cobro with (security_invoker = true) as ' || replace(v_def, v_viejo, v_nuevo);
end $do$;
