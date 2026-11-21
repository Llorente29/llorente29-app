-- supabase/migrations/20261113T1914_s01p_liquidacion_repetida_local.sql
--
-- S01p·21b · «Dejar solo esta» falla en Foodint (Julio, 13/11). Al pulsarlo en el 1T, sobre la
-- 4/1016, salió: «No se valida: apunte 1 (47000000): falta el local (o marcarlo como común);
-- apuntes 2 a 7 igual (47200000, 47700000)». No quedó nada: ni asiento ni enlace del 303 (la
-- función va entera en una transacción).
--
-- Por qué: el contraasiento copia los apuntes de la traída de Diez, y en Foodint ninguno lleva
-- local ni está marcado como común (los 12 de 9/2 y 9/3, medido en solo lectura). Con el eje
-- «local» encendido, la regla del local (conta_motivos_para_validar, 0140) los para. La prueba de
-- la 1822 sembraba los apuntes ya marcados como comunes, y por eso no lo vio.
--
-- El arreglo: una liquidación de IVA es de toda la empresa. En el contraasiento, el apunte que no
-- lleva local va marcado como común; el que sí lo lleva, lo conserva. La traída no se toca.
--
-- cambia: public.conta_liquidacion_dejar_esta · prueba: supabase/staging/sql/20261113_s01p_liquidacion_repetida_local_prueba.sql
--   Con la MISMA firma y el cuerpo vigente con un solo trozo cambiado (reemplazo exacto: si el
--   trozo no está una sola vez, no se toca nada). Respaldo antes, para la vuelta atrás.
--
-- No toca ningún dato. Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_liquidacion_dejar_esta(uuid,uuid,text)', '20261113T1914_s01p_liquidacion_repetida_local');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_liquidacion_dejar_esta(uuid,uuid,text)'::regprocedure);
  v_viejo text := $viejo$    select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
           location_id, is_common, brand_id,$viejo$;
  v_nuevo text := $nuevo$    -- S01p·21b: una liquidación es de toda la empresa: sin local, el apunte va como común.
    select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
           location_id, (is_common or location_id is null), brand_id,$nuevo$;
begin
  if strpos(v_def, 'S01p·21b') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·21b: conta_liquidacion_dejar_esta no es la medida (la copia de los apuntes no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;
