-- supabase/migrations/20261101T1540_s01j3_comision_con_signo.sql
-- cambia: public.conta_liquidacion_registrar · prueba: supabase/staging/sql/20261101_s01j3_comision_prueba.sql
--
-- S01j·3 · La comisión de Just Eat se guarda con su signo. La factura de
-- comisión de Just Eat puede ser un ABONO (total negativo: la «Campaña costes
-- envío gratis JET+ asumidos por Just-eat»), y conta_liquidacion_registrar la
-- guardaba con -abs(): le daba la vuelta. Medido en Foodint el 01/11 (sesión
-- principal, solo lectura): 5 de las 33 de Just Eat no cuadraban por eso (4 con
-- ventas 0 y factura de −2,99 o −5,98; y una de ventas 42,31 y factura −6,80).
--
-- Solo para Just Eat: Uber manda su comisión ya negativa y Glovo el total de su
-- factura en positivo, y los dos siguen con -abs() (las 104 de Glovo cuadran).
-- Para Just Eat, la comisión es −(total de su factura): un cargo, negativo; un
-- abono, positivo.
--
-- Misma firma. El cambio se hace sobre la definición VIVA (pg_get_functiondef),
-- reemplazando el trozo exacto, y para si no está una sola vez: así no pisa
-- nada de lo que tenga producción que no esté en el repositorio. Antes, su
-- respaldo; la vuelta atrás la restaura byte a byte.

select public._respaldar_funcion('public.conta_liquidacion_registrar(uuid,jsonb,text)', '20261101T1540_s01j3_comision_con_signo');

do $$
declare
  v_def text := pg_get_functiondef('public.conta_liquidacion_registrar(uuid,jsonb,text)'::regprocedure);
  v_antes constant text := '-abs(nullif(p->>''comision'', '''')::numeric)';
  v_ahora constant text := 'case when v_prov = ''justeat'' then -nullif(p->>''comision'', '''')::numeric else -abs(nullif(p->>''comision'', '''')::numeric) end';
  v_n int;
begin
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then
    raise exception 'S01j·3: conta_liquidacion_registrar no tiene una sola vez «%» (la tiene % veces): no se cambia nada.', v_antes, v_n;
  end if;
  if position('v_prov text' in v_def) = 0 then
    raise exception 'S01j·3: conta_liquidacion_registrar no tiene v_prov: no se cambia nada.';
  end if;
  execute replace(v_def, v_antes, v_ahora);
end $$;
