-- supabase/migrations/20261125T1206_x33_freno_en_la_salida.sql
--
-- X33 · El freno «Las facturas las emite Cegid» (1205) en la salida a ERP10. Las tres funciones que eligen lo validado
-- que sale tienen cada una su consulta, y en las tres va la misma condición:
--
-- cambia: public.conta_erp10_por_salir(uuid,date) · prueba: supabase/staging/sql/20261125_x33_qbo_a_erp10_prueba.sql
-- cambia: public.conta_erp10_cola(integer) · prueba: supabase/staging/sql/20261125_x33_qbo_a_erp10_prueba.sql
-- cambia: public.conta_erp10_atascados(uuid) · prueba: supabase/staging/sql/20261125_x33_qbo_a_erp10_prueba.sql
--
--   · conta_erp10_por_salir: lo que sale este mes (la pantalla, el Excel y la conexión, que leen de aquí sus
--     recibidas, emitidas y asientos);
--   · conta_erp10_cola: lo que sale solo;
--   · conta_erp10_atascados: lo que lleva más de una hora sin salir (la barra de abajo). Una factura frenada no está
--     atascada: no sale porque no tiene que salir.
--
-- Detrás de «and e.external_program is null and e.import_run_id is null», que está una sola vez en cada una (medido en
-- producción el 25/11), se añade «and not public._conta_erp10_factura_frenada(e.company_id, e.id)». Con el ajuste
-- apagado (todas las empresas menos las dos de QBO) dan exactamente lo mismo que antes.
--
-- Con la MISMA firma y su cuerpo vigente; respaldo antes, para la vuelta atrás. Nada en el camino del pedido. No
-- escribe en ninguna fila.

select public._respaldar_funcion('public.conta_erp10_por_salir(uuid,date)', '20261125T1206_x33_freno_en_la_salida');
select public._respaldar_funcion('public.conta_erp10_cola(integer)', '20261125T1206_x33_freno_en_la_salida');
select public._respaldar_funcion('public.conta_erp10_atascados(uuid)', '20261125T1206_x33_freno_en_la_salida');

do $$
declare
  v_firma text;
  v_def text;
  v_viejo constant text := 'and e.external_program is null and e.import_run_id is null';
  v_nuevo constant text := 'and e.external_program is null and e.import_run_id is null
     and not public._conta_erp10_factura_frenada(e.company_id, e.id)';
  v_n int;
begin
  foreach v_firma in array array['public.conta_erp10_por_salir(uuid,date)', 'public.conta_erp10_cola(integer)', 'public.conta_erp10_atascados(uuid)'] loop
    v_def := pg_get_functiondef(v_firma::regprocedure);
    if strpos(v_def, '_conta_erp10_factura_frenada') > 0 then continue; end if;   -- ya pasada
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
      raise exception 'X33: % no es la medida (% veces el filtro de lo traído, y era 1): no se toca.', v_firma, v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $$;
