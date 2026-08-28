-- 20260828T1251_scope_preview_core_channels_last_a_cero.sql
-- ============================================================================
-- REGISTRO DE LO QUE YA CORRE. Aplicado a mano en produccion el 28/08 ~12:50.
-- ============================================================================
-- Companera de 20260828T1250. Transcripcion de la definicion viva, no un cambio
-- nuevo. Reaplicar la version del repo encima lo retrocederia en silencio.
--
-- QUE HACE. El calculo de `channelsLast` queda cortocircuitado con `if false`
-- y devuelve 0 siempre. Folvy no escribe en Last desde el 30/07, asi que el
-- numero de canales de Last en el ensayo de alcance del 86 enganaba: prometia
-- un empuje que no iba a ocurrir.
--
-- MARCHA ATRAS: cambiar `if false then` por la condicion original,
--   if p_matriculas is not null and array_length(p_matriculas, 1) > 0 then
-- El bloque del count sigue entero debajo, sin tocar.
--
-- Verificado tras aplicarlo: el ensayo devuelve channelsLast: 0.
--
-- FIDELIDAD: salida literal de
--   SELECT pg_get_functiondef('public._scope_preview_core(uuid,text[],uuid[],uuid)'::regprocedure);
-- verificada byte a byte contra produccion: md5 b817264453c82047230bbcf88c4b770a
-- (1.889 caracteres). Aplicar este fichero hoy es un no-op.
--
-- OJO — DOS COSAS QUE CAMBIAN ADEMAS DEL FLAG, y conviene saberlas:
--
-- 1. La version viva esta REESCRITA EN COMPACTO (declaraciones y selects en una
--    sola linea) frente a la de 20260806T1700. No cambia el comportamiento,
--    pero explica por que el diff son 40 lineas y no 4.
--
-- 2. SE PIERDE EL COMENTARIO QUE EXPLICABA EL CONTRATO null vs 0:
--      «cada tramo se calcula en su propio bloque: un fallo en Last no debe
--       tapar un HubRise que si se pudo calcular (y viceversa). null = no se
--       pudo calcular ESE tramo; el caller lo pinta como "—", nunca como 0.»
--    Es justo la distincion que ahora importa mas, porque channelsLast pasa a
--    valer 0 SIEMPRE: 0 aqui significa "no hay empuje a Last", no "no se pudo
--    calcular". Quien lea la funcion sin ese comentario puede confundirlas.
--    No se re-anade aqui para que el fichero case byte a byte con lo vivo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._scope_preview_core(p_account_id uuid, p_matriculas text[], p_brand_ids uuid[], p_location_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ext_locs text[]; v_channels_last int; v_brands_hr int;
begin
  begin
    select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
    where elm.account_id = p_account_id and elm.source = 'lastapp' and elm.is_active
      and (p_location_id is null or elm.location_id = p_location_id);
    -- 28/08/2026 · Julio: LAST FUERA DEL 86. channelsLast forzado a 0.
    -- Folvy no escribe en Last desde el 30/07: el numero enganaba.
    -- Para revertir: "if false" -> la condicion original de p_matriculas.
    if false then
      select count(distinct ecp.external_channel) into v_channels_last from external_catalog_product ecp
      where ecp.account_id = p_account_id and ecp.organization_product_id::text = any(p_matriculas)
        and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    else v_channels_last := 0; end if;
  exception when others then
    v_channels_last := null;
    raise warning '_scope_preview_core: fallo calculando channelsLast: %', sqlerrm;
  end;

  begin
    if p_brand_ids is not null and array_length(p_brand_ids, 1) > 0 then
      select count(distinct bhc.brand_id) into v_brands_hr from brand_hubrise_catalog bhc
      where bhc.account_id = p_account_id and bhc.brand_id = any(p_brand_ids)
        and (p_location_id is null or bhc.location_id = p_location_id);
    else v_brands_hr := 0; end if;
  exception when others then
    v_brands_hr := null;
    raise warning '_scope_preview_core: fallo calculando brandsHubrise: %', sqlerrm;
  end;

  return jsonb_build_object('channelsLast', v_channels_last, 'brandsHubrise', v_brands_hr);
end;
$function$
;
