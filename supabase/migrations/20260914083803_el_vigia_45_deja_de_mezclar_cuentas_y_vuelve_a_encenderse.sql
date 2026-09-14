-- ═══════════════════════════════════════════════════════════════════════════
-- EL VIGÍA 45 DEJA DE MEZCLAR CUENTAS, Y VUELVE A ENCENDERSE
-- 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- «El vigía 45» es el `jobid` 45, `last-catalog-watchdog` (`*/15 12-23 * * *`),
-- que vigila el espejo de disponibilidad de Last. Estaba APAGADO, sin que
-- nadie hubiera escrito por qué. Esta pieza cierra las dos mitades de #28: por
-- qué no se podía encender tal y como estaba, y por qué ya sí.
--
-- ── POR QUÉ NO SE APAGÓ POR ROMPERSE ───────────────────────────────────────
--
-- Medido en `cron.job_run_details`: 937 pasadas, CERO fallos, la última el
-- 11/09 a las 14:45. No se cayó: alguien lo apagó. Y no hay ningún sitio donde
-- eso quede escrito, que es justo la deuda que Julio anotó el 12/09.
--
-- ── 🔴 LO QUE HABRÍA MANDADO SI SE ENCIENDE TAL CUAL ───────────────────────
--
-- Tres de sus cuatro comprobaciones leen `external_catalog_product` SIN
-- `account_id`. Es la regla 9 en el sitio más caro que hay: un aviso.
--
--   Cuenta                   filas   los que avisaría
--   Folvy Interno (plantilla) 4.742       305
--   Foodint                   4.444       305
--   Kitchen Grill LstQ        3.043       179
--
-- O sea: **789 productos en UN SOLO aviso**, con sus nombres de producto y de
-- marca, mezclando el catálogo plantilla del sistema y EL DE OTRO CLIENTE con
-- el de Foodint. Y lo del cliente 2 es peor de lo que parece: sólo hay DOS
-- integraciones de Last activas --Folvy Interno y Foodint--, así que sus 179
-- entraban sin estar esa cuenta integrada siquiera. La consulta no miraba ni
-- la cuenta ni la integración.
--
-- No es un número equivocado: es contenido de catálogo de otro cliente dentro
-- del correo de éste.
--
-- ── Y EL UMBRAL TAMBIÉN ESTABA MAL, QUE ES OTRA COSA ───────────────────────
--
-- Aun bien filtrado, «305 productos agotados hace más de 3 h» cada 3 horas no
-- es una señal. Medido en Foodint:
--
--   menos de 1 día   115      entre 7 y 30 días  114
--   entre 1 y 7 días  69      más de 30 días       7
--
-- Los 121 que llevan más de una semana ahogan a los 115 de hoy. Así que el
-- aviso ORDENA: interrumpe sólo si hay alguno RECIENTE (24 h), enseña ésos, y
-- DICE cuántos viejos hay y cuál es el total. Nunca «0, sin alertas» habiendo
-- filas (regla 7): lo que no cabe en el aviso está en el parte que devuelve la
-- función, que es lo que se mira a propósito.
--
-- ── LO QUE CAMBIA, EN CORTO ────────────────────────────────────────────────
--
-- 1. Se recorre CUENTA POR CUENTA, y sólo las que tienen integración de Last
--    activa. Un aviso por cuenta, con su `account_id` puesto.
-- 2. Se deja de llamar al edge `system-alert` a pelo y se usa `encolar_alerta`,
--    que es la cola de la casa Y la única vía que sabe llevar la cuenta. Con
--    eso el antirruido pasa a ser por cuenta, no global: antes, un aviso de una
--    cuenta callaba el de la otra durante 3 horas.
-- 3. Se excluye la cuenta plantilla del sistema
--    (`00000000-0000-0000-0000-000000000001`). CLAUDE.md la define como el
--    catálogo plantilla, no como un cliente: nadie sirve esos 305 productos.
--    Se dice aquí y se dice en el parte, no se esconde.
-- 4. La función devuelve un PARTE en vez de `void`. Antes, una pasada que no
--    encontraba nada y una que no llegó a correr se leían exactamente igual.
-- 5. Y se vuelve a encender.
--
-- `last_catalog_alert_log` (96 filas) deja de usarse: el antirruido lo hace
-- `encolar_alerta`, y tener dos mecanismos es tener ninguno. No se borra --las
-- filas son historia-- y quitarla es otra decisión.
--
-- ── LA BANDA ───────────────────────────────────────────────────────────────
-- Un `create or replace` de función y un `cron.alter_job`. No se toma cierre
-- exclusivo sobre ninguna tabla: `external_catalog_product` se LEE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── DROP + CREATE, NO REPLACE, y por la razón de la regla 2 al revés ───────
--
-- La función pasa de devolver `void` a devolver un parte en `jsonb`, y eso
-- `create or replace` NO lo puede hacer: Postgres lo rechaza. La regla 2 está
-- escrita para cuando `replace` acepta un cambio que no debería --añadir un
-- parámetro y crear una sobrecarga en silencio--; aquí es el caso simétrico, y
-- se resuelve igual: se tira y se vuelve a crear.
--
-- Se puede tirar sin peligro porque lo único que la llama es el cron 45 y está
-- APAGADO ahora mismo; se enciende al final de esta misma migración, ya con la
-- función nueva puesta. Medido: 0 funciones más la nombran.
--
-- Y al tirarla se van los permisos, así que se vuelven a poner tal cual
-- estaban: `postgres` (dueño) y `service_role`. Ni `anon` ni `authenticated`,
-- que es como estaba y como tiene que seguir.
DROP FUNCTION IF EXISTS public.last_catalog_watchdog();

CREATE FUNCTION public.last_catalog_watchdog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  -- La cuenta plantilla del sistema. Comparte tablas Y nombres con producción
  -- (regla 9) y no la sirve nadie: no entra en los avisos.
  k_plantilla constant uuid := '00000000-0000-0000-0000-000000000001';
  -- «Reciente» es lo que hace que esto sea una señal y no una lista. Ver la
  -- cabecera: con 3 h, los 121 que llevan más de una semana tapan a los de hoy.
  k_reciente  constant interval := interval '24 hours';

  v_acc      record;
  v_list     text;
  v_n        int;
  v_recientes int;
  v_viejos   int;
  v_id       bigint;
  v_avisados int := 0;
  v_callados int := 0;
  v_cuentas  int := 0;
  v_parte    jsonb := '[]'::jsonb;
  v_de_esta  jsonb;
begin
  for v_acc in
    select ei.account_id, coalesce(max(a.name), ei.account_id::text) as cuenta
      from public.external_integration ei
      left join public.accounts a on a.id = ei.account_id
     where ei.source = 'lastapp' and ei.is_active = true
       and ei.account_id is not null
       and ei.account_id <> k_plantilla
     group by ei.account_id
     order by 2
  loop
    v_cuentas := v_cuentas + 1;
    v_de_esta := jsonb_build_object('cuenta', v_acc.cuenta, 'account_id', v_acc.account_id);

    -- ── 1 · EL ESPEJO RANCIO. Ésta ya iba por cuenta; ahora además sólo mira
    -- la suya. Es la que se pasó 52 días sin que nadie la viera (21/06→12/08).
    select string_agg(format('org %s - ultimo sync: %s', x.external_org_id,
                             coalesce(x.max_synced::text, 'nunca')),
                      chr(10) order by x.max_synced nulls first), count(*)
      into v_list, v_n
    from (
      select ei.external_org_id,
             (select max(ecp.last_synced_at) from public.external_catalog_product ecp
               where ecp.account_id = v_acc.account_id and ecp.source = 'lastapp'
                 and ecp.external_org_id = ei.external_org_id) as max_synced
        from public.external_integration ei
       where ei.source = 'lastapp' and ei.is_active = true
         and ei.account_id = v_acc.account_id
    ) x
    where x.max_synced is null or x.max_synced < now() - interval '3 hours';

    v_de_esta := v_de_esta || jsonb_build_object('espejo_rancio', coalesce(v_n, 0));
    if coalesce(v_n, 0) > 0 then
      v_id := public.encolar_alerta(
        p_kind    => 'last-catalog-sync',
        p_subject => format('%s: el espejo de Last lleva mas de 3 h sin refrescarse (%s org)',
                            v_acc.cuenta, v_n),
        p_message => format(
            'El espejo de disponibilidad de Last de %s no se refresca desde hace mas de 3 horas:%s%s%s%s'
         || 'Asi paso desapercibido 52 dias (21/06 a 12/08) la ultima vez. '
         || 'Revisar el cron last-catalog-sync-hourly y los registros de la funcion last-catalog-sync.',
            v_acc.cuenta, chr(10), chr(10), v_list, chr(10) || chr(10)),
        p_debounce_kind   => 'last-catalog-stale:' || v_acc.account_id,
        p_debounce_window => interval '3 hours',
        p_account_id      => v_acc.account_id,
        p_severity        => 'alto');
      if v_id is null then v_callados := v_callados + 1; else v_avisados := v_avisados + 1; end if;
    end if;

    -- ── 2 · PRODUCTOS AGOTADOS. Aqui estaba la fuga: sin `account_id`, sumaba
    -- las tres cuentas. Y aqui va el umbral que ORDENA: se avisa por los
    -- RECIENTES, y se dice cuantos viejos hay y cuantos son en total.
    select count(*) filter (where ecp.disabled_since > now() - k_reciente),
           count(*) filter (where ecp.disabled_since <= now() - k_reciente),
           count(*)
      into v_recientes, v_viejos, v_n
      from public.external_catalog_product ecp
     where ecp.account_id = v_acc.account_id
       and ecp.source = 'lastapp' and ecp.is_enabled = false and ecp.missing_since is null
       and ecp.disabled_since is not null and ecp.disabled_since < now() - interval '3 hours';

    v_de_esta := v_de_esta || jsonb_build_object(
      'agotados_total', coalesce(v_n, 0),
      'agotados_recientes', coalesce(v_recientes, 0),
      'agotados_de_mas_de_un_dia', coalesce(v_viejos, 0));

    if coalesce(v_recientes, 0) > 0 then
      select string_agg(format('%s (%s / %s) - agotado desde %s',
                               ecp.product_name,
                               coalesce(ecp.external_brand_name, '?'),
                               coalesce(ecp.external_channel, '?'),
                               ecp.disabled_since::text),
                        chr(10) order by ecp.disabled_since desc)
        into v_list
        from public.external_catalog_product ecp
       where ecp.account_id = v_acc.account_id
         and ecp.source = 'lastapp' and ecp.is_enabled = false and ecp.missing_since is null
         and ecp.disabled_since is not null
         and ecp.disabled_since < now() - interval '3 hours'
         and ecp.disabled_since > now() - k_reciente;

      v_id := public.encolar_alerta(
        p_kind    => 'last-catalog-sync',
        p_subject => format('%s: %s producto(s) agotados hoy en Last', v_acc.cuenta, v_recientes),
        p_message => format(
            'Agotados en las ultimas 24 horas en %s:%s%s%s%s'
         -- La cola del mensaje es la regla 7: lo que no se lista, SE CUENTA.
         -- Un aviso puede ordenar por lo urgente; lo que no puede es decir
         -- que son N cuando son mas.
         || 'Ademas hay %s que llevan agotados mas de un dia (en total, %s). '
         || 'Esos no se listan aqui para que no tapen a los de hoy: salen enteros en el parte del vigia.',
            v_acc.cuenta, chr(10), chr(10), left(v_list, 3000), chr(10) || chr(10),
            v_viejos, v_n),
        p_debounce_kind   => 'last-catalog-product-down:' || v_acc.account_id,
        p_debounce_window => interval '3 hours',
        p_account_id      => v_acc.account_id,
        p_severity        => 'aviso');
      if v_id is null then v_callados := v_callados + 1; else v_avisados := v_avisados + 1; end if;
    end if;

    -- ── 3 · MARCA ENTERA CAIDA. Sin `account_id` podia dar por caida una
    -- marca de otra cuenta. Se queda como estaba en criterio --3 o mas
    -- productos y TODOS apagados-- y cambia de alcance.
    select string_agg(format('%s (%s) org %s local %s - %s productos caidos',
                             y.external_brand_name, coalesce(y.external_channel, '?'),
                             y.external_org_id, y.external_location_id, y.n_down),
                      chr(10) order by y.n_down desc), count(*)
      into v_list, v_n
    from (
      select external_brand_name, external_channel, external_org_id, external_location_id,
             count(*) filter (where is_enabled = false) as n_down
        from public.external_catalog_product
       where account_id = v_acc.account_id
         and source = 'lastapp' and missing_since is null and external_brand_name is not null
       group by 1, 2, 3, 4
      having count(*) >= 3 and count(*) filter (where is_enabled = false) = count(*)
    ) y;

    v_de_esta := v_de_esta || jsonb_build_object('marcas_caidas', coalesce(v_n, 0));
    if coalesce(v_n, 0) > 0 then
      v_id := public.encolar_alerta(
        p_kind    => 'last-catalog-sync',
        p_subject => format('%s: %s marca(s) entera(s) caida(s) en Last', v_acc.cuenta, v_n),
        p_message => format(
            'Todos los productos de estas marcas/canal/local de %s estan apagados a la vez. '
         || 'Eso no es un agotado puntual: parece una caida de plataforma.%s%s%s',
            v_acc.cuenta, chr(10), chr(10), left(v_list, 3000)),
        p_debounce_kind   => 'last-catalog-brand-down:' || v_acc.account_id,
        p_debounce_window => interval '3 hours',
        p_account_id      => v_acc.account_id,
        p_severity        => 'critico');
      if v_id is null then v_callados := v_callados + 1; else v_avisados := v_avisados + 1; end if;
    end if;

    -- ── 4 · REFERENCIAS DESAPARECIDAS del catalogo, en las ultimas 3 h.
    select string_agg(format('%s (%s) - desaparecido %s', ecp.product_name,
                             coalesce(ecp.external_brand_name, '?'), ecp.missing_since::text),
                      chr(10) order by ecp.missing_since), count(*)
      into v_list, v_n
      from public.external_catalog_product ecp
     where ecp.account_id = v_acc.account_id
       and ecp.source = 'lastapp' and ecp.missing_since is not null
       and ecp.missing_since >= now() - interval '3 hours';

    v_de_esta := v_de_esta || jsonb_build_object('desaparecidos_3h', coalesce(v_n, 0));
    if coalesce(v_n, 0) > 0 then
      v_id := public.encolar_alerta(
        p_kind    => 'last-catalog-sync',
        p_subject => format('%s: %s referencia(s) han desaparecido del catalogo de Last',
                            v_acc.cuenta, v_n),
        p_message => format('Han dejado de venir en el catalogo de Last de %s:%s%s%s',
                            v_acc.cuenta, chr(10), chr(10), left(v_list, 3000)),
        p_debounce_kind   => 'last-catalog-missing:' || v_acc.account_id,
        p_debounce_window => interval '3 hours',
        p_account_id      => v_acc.account_id,
        p_severity        => 'aviso');
      if v_id is null then v_callados := v_callados + 1; else v_avisados := v_avisados + 1; end if;
    end if;

    v_parte := v_parte || jsonb_build_array(v_de_esta);
  end loop;

  -- EL PARTE. Antes esto devolvia `void`: una pasada que no encontraba nada y
  -- una que no llego a correr se leian igual (la familia de la regla 8).
  return jsonb_build_object(
    'ok', true,
    'cuentas_miradas', v_cuentas,
    'avisos_encolados', v_avisados,
    'avisos_callados_por_antirruido', v_callados,
    'plantilla_excluida', k_plantilla,
    'por_cuenta', v_parte);
end;
$fn$;

REVOKE ALL ON FUNCTION public.last_catalog_watchdog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.last_catalog_watchdog() TO service_role;

COMMENT ON FUNCTION public.last_catalog_watchdog() IS
  'Vigia del espejo de Last, CUENTA POR CUENTA (regla 9). Antes leia external_catalog_product sin account_id y mezclaba Foodint, la plantilla del sistema y el cliente 2 en un solo aviso: 789 productos medidos el 14/09. Avisa por la cola (encolar_alerta) con su account_id, y el aviso de agotados ordena por los de las ultimas 24 h diciendo cuantos viejos hay.';

-- ── SE VUELVE A ENCENDER, y se dice en qué estado se encontró ──────────────
--
-- 937 pasadas y cero fallos antes de que alguien lo apagara el 11/09 a las
-- 14:45. Lo que faltaba no era que funcionara: era que no mezclara cuentas.
SELECT cron.alter_job(45, active := true);

-- ── EL ENSAYO, EN ESTA MISMA TRANSACCIÓN ───────────────────────────────────
DO $ensayo$
DECLARE
  v_antes  bigint;
  v_ultimo bigint;
  v_parte  jsonb;
  v_acc    jsonb;
BEGIN
  -- La linea de base se toma AQUI, dentro (Julio, 13/09 21:05). Y se guarda el
  -- ultimo id para poder mirar SOLO lo que escriba esta pasada: comprobarlo
  -- sobre la tabla entera funcionaria hoy --hay 0 filas de esta clase-- y
  -- dejaria de funcionar el dia que haya una vieja. Eso es apoyarse en una
  -- premisa que caduca.
  SELECT count(*), coalesce(max(id), 0) INTO v_antes, v_ultimo
    FROM public.system_alert_queue;

  -- Se ejecuta DE VERDAD (regla 10: por su camino, no por su fórmula). Si
  -- encola algo, se vera en la diferencia y se deshace con la transaccion.
  v_parte := public.last_catalog_watchdog();

  IF (v_parte->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'El vigia no devuelve un parte: %', v_parte;
  END IF;

  -- Sólo las cuentas con integración activa, y la plantilla fuera. Hoy eso es
  -- exactamente UNA: Foodint (medido: 2 integraciones activas, una es la
  -- plantilla). Si mañana son dos, esto avisa de que el numero cambio.
  IF (v_parte->>'cuentas_miradas')::int <> 1 THEN
    RAISE EXCEPTION 'Se esperaba 1 cuenta con integracion de Last activa (sin la plantilla) y hay %. Eso es el hallazgo: mirar antes de seguir.',
      (v_parte->>'cuentas_miradas')::int;
  END IF;

  -- 🔴 LO QUE ESTA MIGRACION EXISTE PARA IMPEDIR: que un aviso salga sin decir
  -- de quien es. Todo lo que encole esta pasada lleva cuenta.
  IF EXISTS (SELECT 1 FROM public.system_alert_queue
              WHERE id > v_ultimo AND account_id IS NULL) THEN
    RAISE EXCEPTION 'Esta pasada ha encolado % aviso(s) sin decir de que cuenta son. Es justo lo que se venia a arreglar.',
      (SELECT count(*) FROM public.system_alert_queue WHERE id > v_ultimo AND account_id IS NULL);
  END IF;

  -- Y la plantilla no aparece por ningun lado.
  SELECT x INTO v_acc FROM jsonb_array_elements(v_parte->'por_cuenta') x
   WHERE x->>'account_id' = '00000000-0000-0000-0000-000000000001';
  IF v_acc IS NOT NULL THEN
    RAISE EXCEPTION 'La plantilla del sistema ha entrado en el parte.';
  END IF;

  -- El umbral ORDENA, no esconde: el total tiene que ser >= lo reciente, y los
  -- dos montones tienen que sumar el total. Si no, la frase del aviso mentiria.
  FOR v_acc IN SELECT x FROM jsonb_array_elements(v_parte->'por_cuenta') x LOOP
    IF (v_acc->>'agotados_recientes')::int + (v_acc->>'agotados_de_mas_de_un_dia')::int
       <> (v_acc->>'agotados_total')::int THEN
      RAISE EXCEPTION 'Los dos montones de % no suman el total: % + % <> %',
        v_acc->>'cuenta', v_acc->>'agotados_recientes',
        v_acc->>'agotados_de_mas_de_un_dia', v_acc->>'agotados_total';
    END IF;
  END LOOP;

  RAISE NOTICE 'ENSAYO OK · parte: % · avisos nuevos en esta pasada: %',
    v_parte, (SELECT count(*) FROM public.system_alert_queue) - v_antes;

  -- El ensayo NO deja avisos puestos: lo que haya encolado se va con el
  -- rollback de abajo. Lo que se aplica es la funcion, no su primera pasada.
  RAISE EXCEPTION 'FIN DEL ENSAYO';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'FIN DEL ENSAYO' THEN RAISE; END IF;
  RAISE NOTICE 'Ensayo revertido a proposito.';
END;
$ensayo$;
