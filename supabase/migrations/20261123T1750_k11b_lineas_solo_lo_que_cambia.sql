-- supabase/migrations/20261123T1750_k11b_lineas_solo_lo_que_cambia.sql
--
-- K11b · Los datos de cada línea de la recibida (concepto, marca y plataforma) se guardan por clave, no los tres juntos
-- (Julio, 23/11, después de la e2e 45225555049 y la #1790).
--
-- cambia: public.conta_recibida_otros_datos · prueba: supabase/staging/sql/20261123_k11b_lineas_solo_lo_que_cambia_prueba.sql
--   Hasta hoy, una línea de p_cambios -> 'lineas' escribía su concepto, su marca y su plataforma juntos (on conflict …
--   set concept, brand_id, channel_id): una llamada que no llevaba la marca la borraba. La ficha que eligió la
--   plataforma antes de que volviera la lectura de la marca dejó las tres líneas sin marca, y la analítica de
--   hostelería la necesita. Desde aquí, en cada línea:
--     · una clave que NO viene no se toca (se queda lo que hay: `v_l ? 'marca'`);
--     · una clave que viene con null (o vacía) SÍ lo borra.
--   Lo demás, igual: las mismas puertas, el mismo rastro en supplier_invoice_change (antes y ahora de la línea entera)
--   y el asiento propuesto que se quita si algo cambia. Una línea con las tres claves hace lo de siempre.
--
-- Con la MISMA firma y su cuerpo vigente (el de la 0839 con la 0922 del K11f1) con un trozo cambiado; respaldo antes,
-- para la vuelta atrás. Nada en el camino del pedido. No escribe en ninguna fila.

select public._respaldar_funcion('public.conta_recibida_otros_datos(uuid,jsonb,text)', '20261123T1750_k11b_lineas_solo_lo_que_cambia');

-- Cambia en la función el trozo dado (tiene que estar una sola vez), salvo si ya lleva su marca.
create or replace function pg_temp.k11b_trozo(p_firma text, p_marca text, p_viejo text, p_nuevo text) returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_firma::regprocedure);
begin
  if strpos(v_def, p_marca) > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo) <> 1 then
    raise exception 'K11b: % no es la medida (el trozo no está una sola vez): no se toca.', p_firma;
  end if;
  execute replace(v_def, p_viejo, p_nuevo);
end $$;

select pg_temp.k11b_trozo('public.conta_recibida_otros_datos(uuid,jsonb,text)', 'K11b: solo lo que viene',
  $v$v_ahora := jsonb_build_object('concepto', nullif(trim(v_l ->> 'concepto'), ''), 'marca', nullif(v_l ->> 'marca', '')::uuid, 'plataforma', nullif(v_l ->> 'plataforma', '')::uuid);$v$,
  $n$-- K11b: solo lo que viene. Una clave que no viene se queda como está; una que viene con null (o vacía), se borra.
      v_ahora := jsonb_build_object(
        'concepto', case when v_l ? 'concepto' then nullif(trim(v_l ->> 'concepto'), '') else v_antes ->> 'concepto' end,
        'marca', case when v_l ? 'marca' then nullif(v_l ->> 'marca', '')::uuid else (v_antes ->> 'marca')::uuid end,
        'plataforma', case when v_l ? 'plataforma' then nullif(v_l ->> 'plataforma', '')::uuid else (v_antes ->> 'plataforma')::uuid end);$n$);

comment on function public.conta_recibida_otros_datos(uuid, jsonb, text) is
  'K11a · Guarda «Otros datos» de una recibida sin contabilizar (tipo de factura, clave de régimen, no incluir en IVA, rectificación de deducciones, no incluir en 347, % de IVA deducible, K11f1: fecha contable y fiscal) y el concepto, la marca y la plataforma de sus líneas de gasto (K11b: en cada línea, solo las claves que vienen; null borra). Deja su rastro en supplier_invoice_change.';
