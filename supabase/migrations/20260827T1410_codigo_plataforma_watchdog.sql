-- 20260827T1410_codigo_plataforma_watchdog.sql
-- PROPUESTA. Revisar antes de ejecutar.
--
-- VIGIA: UNA FRONTERA QUE DEJA DE GUARDAR EL CODIGO DE PEDIDO.
-- ============================================================================
-- POR QUE EXISTE. El 13/08 por la noche un despliegue de hubrise-webhook borro
-- la captura de `collection_code` -> `platform_order_code`. Estuvo 14 dias
-- rota, 148 pedidos sin el codigo que el cliente ve, y no salto NADA: los
-- vigias miraban que entraran pedidos, no que entraran COMPLETOS. Un pedido sin
-- codigo entra, se cocina y se cobra igual; solo se nota cuando alguien
-- reclama y no hay por donde cruzarlo.
--
-- ── LA REGLA, SIN LISTA DE FUENTES A MANO ────────────────────────────────
-- No se codifica "lastapp y hubrise son plataformas". Se usa la propia
-- historia: una fuente es CANDIDATA si en 90 dias trajo >=20 ventas CON
-- codigo. Es decir, si ya demostro que sabe traerlo. Asi entra sola cualquier
-- frontera nueva (Glovo directo, Deliveroo) y nunca entra el TPV propio
-- (`folvy_pos`, 0 codigos de siempre: sus pedidos no tienen codigo de
-- plataforma porque no vienen de ninguna).
--
-- Se avisa si, en las ultimas 24 h, esa fuente trajo >=5 ventas y menos de la
-- mitad llevan codigo:   0 %  -> CRITICO (la captura esta rota)
--                       <50 % -> ALTO    (se rompio a medias)
--
-- ── COMPROBADO CONTRA LOS DATOS DE HOY (27-08) ───────────────────────────
--   (Foodint, hubrise) 20 ventas / 0 con codigo ....... CRITICO  <- la regresion
--   (Foodint, lastapp) 28 ventas / 28 con codigo ...... callado
--   (2a cuenta, lastapp) 5 ventas / 5 con codigo ...... callado
--   folvy_pos / manual ............................... nunca candidatas
-- Es decir: si este vigia hubiera existido el 14/08, habria avisado ese mismo
-- dia en vez de 14 dias despues.
--
-- OJO AL DESPLEGAR: seguira avisando (con razon) hasta que se despliegue
-- hubrise-webhook con buildPlatformCodes(). El relleno historico solo arregla
-- lo viejo; los pedidos nuevos siguen entrando sin codigo hasta el deploy.
--
-- ── DEBOUNCE ─────────────────────────────────────────────────────────────
-- Via _queue_system_alert, ventana 20 h y clave por (cuenta, fuente,
-- severidad, dia): un aviso al dia por fuente rota. La severidad va en la
-- clave, asi que pasar de ALTO a CRITICO rompe el silencio.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.codigo_plataforma_watchdog(
  p_min_ventas integer DEFAULT 5,
  p_pct_minimo numeric DEFAULT 50,
  p_debounce_window interval DEFAULT interval '20 hours')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_n integer := 0; v_sev text; v_pct numeric;
BEGIN
  FOR r IN
    WITH candidata AS (
      SELECT s.account_id, s.source
        FROM public.sale s
       WHERE s.sold_at >= now() - interval '90 days'
         AND s.platform_order_code IS NOT NULL
       GROUP BY s.account_id, s.source
      HAVING count(*) >= 20
    )
    SELECT c.account_id, c.source,
           count(s.*)                          AS ventas,
           count(s.platform_order_code)        AS con_codigo,
           max(s.sold_at)                      AS ultima
      FROM candidata c
      JOIN public.sale s
        ON s.account_id = c.account_id
       AND s.source     = c.source
       AND s.sold_at   >= now() - interval '24 hours'
     GROUP BY c.account_id, c.source
    HAVING count(s.*) >= greatest(coalesce(p_min_ventas, 5), 1)
       AND 100.0 * count(s.platform_order_code) / count(s.*) < coalesce(p_pct_minimo, 50)
  LOOP
    v_pct := round(100.0 * r.con_codigo / r.ventas, 1);
    v_sev := CASE WHEN r.con_codigo = 0 THEN 'CRITICO' ELSE 'ALTO' END;

    PERFORM public._queue_system_alert(
      'codigo_plataforma_perdido',
      v_sev || ': ' || r.source || ' entra sin el codigo de pedido ('
        || r.con_codigo::text || ' de ' || r.ventas::text || ' en 24 h)',
      'Los pedidos de ' || r.source || ' estan entrando SIN `platform_order_code`: '
        || 'solo ' || v_pct::text || ' % lo trae en las ultimas 24 horas ('
        || r.con_codigo::text || ' de ' || r.ventas::text || ').' || chr(10) || chr(10)
        || 'Ese es el codigo que ve el cliente y que enseña la plataforma. Sin el, '
        || 'cocina no puede cruzar un pedido con Uber/Glovo/Just Eat y una '
        || 'reclamacion no se puede rastrear.' || chr(10) || chr(10)
        || 'Casi siempre es un despliegue de la frontera de ' || r.source
        || ' que se ha llevado por delante la captura del codigo. Comprueba que la '
        || 'funcion desplegada coincide con el repositorio.' || chr(10)
        || 'Ultimo pedido: '
        || to_char(r.ultima at time zone 'Europe/Madrid', 'DD/MM HH24:MI') || ' (Madrid).',
      'codigo_plataforma_' || r.account_id::text || '_' || r.source || '_' || v_sev
        || '_' || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
      p_debounce_window
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.codigo_plataforma_watchdog(integer, numeric, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codigo_plataforma_watchdog(integer, numeric, interval)
  TO service_role;

-- Cada hora en el minuto 25 (fuera de los minutos donde ya se agolpan otros cron).
SELECT cron.schedule('codigo-plataforma-watchdog', '25 * * * *',
                     'select public.codigo_plataforma_watchdog();');

NOTIFY pgrst, 'reload schema';
