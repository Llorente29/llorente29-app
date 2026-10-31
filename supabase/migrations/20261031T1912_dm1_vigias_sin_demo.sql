-- cambia: public.codigo_plataforma_watchdog · prueba: supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
-- cambia: public.kds_device_stale_bundle_check · prueba: supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
-- cambia: public.sales_unmapped_watchdog · prueba: supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
-- cambia: public.modifier_incomplete_impact_watchdog · prueba: supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
-- cambia: public.modifier_zero_cost_watchdog · prueba: supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
-- cambia: public._generate_daily_count_core · prueba: supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
--
-- supabase/migrations/20261031T1912_dm1_vigias_sin_demo.sql
--
-- DM1 · PR 2a · Una demo no cuenta en los vigías (31/10/2026).
-- Los vigías que recorren todas las cuentas encolan con _queue_system_alert,
-- que no lleva cuenta, así que la 1713 (encolar_alerta) no los ve. Aquí cada
-- uno salta la cuenta de demo donde ya la tiene a mano: el bucle por cuenta
-- (cinco) o el aviso del autocierre de _generate_daily_count_core (uno).
-- Para las demás cuentas, idénticas: es el texto de producción del 31/10 con
-- una sola línea más (o un IF alrededor del aviso).
--
-- Lo que NO se toca, y por qué:
--   · system_alert_queue_drain: su único aviso es del canal de alertas, sin
--     cuenta; es de la plataforma.
--   · el aviso del candado de modifier_incomplete_impact_watchdog: es de la
--     tabla, no de una cuenta.
--
-- Guarda: cada una tiene que ser la medida el 31/10 en producción (su md5);
-- si no, para antes de tocar ninguna. Cada una se respalda antes.
--
-- Vuelta atrás: supabase/vuelta-atras/20261031T1912_dm1_vigias_sin_demo.down.sql

do $$
begin
  if md5(pg_get_functiondef('public.codigo_plataforma_watchdog(integer,numeric,interval)'::regprocedure)) <> '97c8bbbd42511394efa7bd918d042a22' then
    raise exception 'DM1 vigías PARADA: codigo_plataforma_watchdog no es la medida el 31/10 (md5 97c8bbbd…). Reescribirla pisaría ese cambio.';
  end if;
  if md5(pg_get_functiondef('public.kds_device_stale_bundle_check()'::regprocedure)) <> '1d3e5faaacc2daffaac86d0ad32a2c93' then
    raise exception 'DM1 vigías PARADA: kds_device_stale_bundle_check no es la medida el 31/10 (md5 1d3e5faa…). Reescribirla pisaría ese cambio.';
  end if;
  if md5(pg_get_functiondef('public.sales_unmapped_watchdog(integer,integer)'::regprocedure)) <> 'b4d0108303df9c1f5ff5889392cdd13a' then
    raise exception 'DM1 vigías PARADA: sales_unmapped_watchdog no es la medida el 31/10 (md5 b4d01083…). Reescribirla pisaría ese cambio.';
  end if;
  if md5(pg_get_functiondef('public.modifier_incomplete_impact_watchdog(interval)'::regprocedure)) <> '25c481f76d3d117ea7de939287ad0fd8' then
    raise exception 'DM1 vigías PARADA: modifier_incomplete_impact_watchdog no es la medida el 31/10 (md5 25c481f7…). Reescribirla pisaría ese cambio.';
  end if;
  if md5(pg_get_functiondef('public.modifier_zero_cost_watchdog(interval,interval)'::regprocedure)) <> '12b36c4157797a06219378fe9c72d4f7' then
    raise exception 'DM1 vigías PARADA: modifier_zero_cost_watchdog no es la medida el 31/10 (md5 12b36c41…). Reescribirla pisaría ese cambio.';
  end if;
  if md5(pg_get_functiondef('public._generate_daily_count_core(uuid,uuid,uuid[],integer,numeric,boolean)'::regprocedure)) <> '73a3fd629d6e25a33b754cee8fc116e4' then
    raise exception 'DM1 vigías PARADA: _generate_daily_count_core no es la medida el 31/10 (md5 73a3fd62…). Reescribirla pisaría ese cambio.';
  end if;
end $$;

select public._respaldar_funcion('public.codigo_plataforma_watchdog(integer,numeric,interval)', '20261031T1912_dm1_vigias_sin_demo');
select public._respaldar_funcion('public.kds_device_stale_bundle_check()', '20261031T1912_dm1_vigias_sin_demo');
select public._respaldar_funcion('public.sales_unmapped_watchdog(integer,integer)', '20261031T1912_dm1_vigias_sin_demo');
select public._respaldar_funcion('public.modifier_incomplete_impact_watchdog(interval)', '20261031T1912_dm1_vigias_sin_demo');
select public._respaldar_funcion('public.modifier_zero_cost_watchdog(interval,interval)', '20261031T1912_dm1_vigias_sin_demo');
select public._respaldar_funcion('public._generate_daily_count_core(uuid,uuid,uuid[],integer,numeric,boolean)', '20261031T1912_dm1_vigias_sin_demo');

CREATE OR REPLACE FUNCTION public.codigo_plataforma_watchdog(p_min_ventas integer DEFAULT 5, p_pct_minimo numeric DEFAULT 50, p_debounce_window interval DEFAULT '20:00:00'::interval)
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
    -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los vigías.
    CONTINUE WHEN NOT public.cuenta_puede_salir(r.account_id);
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

CREATE OR REPLACE FUNCTION public.kds_device_stale_bundle_check()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
declare
  v_ultimo int;
  v_d      record;
  v_n      int := 0;
  v_txt    text;
begin
  select b.bundle_id into v_ultimo from public._ultimo_bundle_publicado() b;
  if v_ultimo is null then
    raise warning 'kds_device_stale_bundle_check: no hay ningun bundle en el bucket apps';
    return 0;
  end if;

  for v_d in
    select dev.id, dev.label, coalesce(l.name,'sin local') as loc, dev.account_id,
           dev.app_version,
           (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int as b_actual,
           (dev.app_version is not null and dev.app_version !~ '· bundle \d+') as es_builtin
    from kds_device dev
    left join locations l on l.id = dev.location_id
    where dev.is_active
      and dev.app_version is not null
  loop
    -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los vigías.
    continue when not public.cuenta_puede_salir(v_d.account_id);
    v_txt := null;

    if v_d.es_builtin then
      v_txt := 'Nunca ha aplicado ninguna actualizacion: sigue con el codigo empotrado en el APK. '
            || 'Es la version mas antigua que puede correr un aparato.';
    elsif v_d.b_actual is null then
      v_txt := 'No se ha podido leer que version corre (reporta "' || v_d.app_version || '"). '
            || 'Mientras no se pueda leer, este aparato NO esta vigilado.';
    elsif v_d.b_actual < v_ultimo then
      declare v_h int;
      begin
        select round(extract(epoch from (now() - min(o.created_at)))/3600)::int into v_h
        from storage.objects o
        where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
          and (regexp_replace(o.name,'\D','','g'))::int > v_d.b_actual;
        if v_h >= 24 then
          v_txt := 'Corre el bundle ' || v_d.b_actual || ' y el ultimo publicado es el ' || v_ultimo
                || ' (' || (v_ultimo - v_d.b_actual) || ' por detras). '
                || 'Hay version mas nueva desde hace ' || v_h || ' horas y no la ha cogido.';
        end if;
      end;
    end if;

    continue when v_txt is null;

    v_n := v_n + 1;
    raise warning 'kds_device_stale_bundle_check: % (%) desfasado', v_d.label, v_d.loc;

    perform public._queue_system_alert(
      'kds_device_desfasado',
      'Tablet con codigo viejo: ' || v_d.label || ' (' || v_d.loc || ')',
      'La tablet "' || v_d.label || '" del local ' || v_d.loc || ' esta sirviendo comandas con '
      || 'codigo antiguo. ' || v_txt || ' '
      || 'Late y contesta con normalidad, que es lo que hace esto dificil de notar. '
      || 'Suele bastar con dejarla encendida y con red un rato fuera de servicio: la '
      || 'actualizacion se aplica sola en ventana segura, nunca en mitad de un pedido.',
      'kds_desfasado_' || v_d.id::text,
      interval '20 hours'
    );
  end loop;

  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_unmapped_watchdog(p_days integer DEFAULT 30, p_min_catalogo integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record; v_n integer := 0; v_prod integer; v_eur numeric; v_lin integer;
  v_casan integer; v_top text; v_top_eur numeric; v_sev text; fmt text; v_cat integer;
BEGIN
  FOR a IN SELECT DISTINCT s.account_id FROM public.sale s
            WHERE s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
  LOOP
    -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los vigías.
    CONTINUE WHEN NOT public.cuenta_puede_salir(a.account_id);
    -- Sin carta montada no hay nada que avisar: todo estaria sin casar.
    SELECT count(*)::integer INTO v_cat
      FROM public.menu_item mi
     WHERE mi.account_id = a.account_id AND mi.archived_at IS NULL;
    CONTINUE WHEN coalesce(v_cat,0) < greatest(coalesce(p_min_catalogo,10), 1);

    SELECT count(*)::integer, coalesce(sum(u.euros),0), coalesce(sum(u.lineas),0)::integer,
           count(*) FILTER (WHERE u.diagnostico = 'casa_solo')::integer
      INTO v_prod, v_eur, v_lin, v_casan
      FROM public._sales_unmapped_products_raw(a.account_id, p_days) u;

    CONTINUE WHEN coalesce(v_prod,0) = 0;

    SELECT u.product_name, u.euros INTO v_top, v_top_eur
      FROM public._sales_unmapped_products_raw(a.account_id, p_days) u
     ORDER BY u.euros DESC LIMIT 1;

    v_sev := CASE WHEN v_eur >= 5000 THEN 'CRITICO'
                  WHEN v_eur >= 1000 THEN 'ALTO' ELSE 'AVISO' END;
    fmt := translate(to_char(v_eur, 'FM999G999G990D00'), ',.', '.,');

    PERFORM public._queue_system_alert(
      'venta_producto_sin_casar',
      v_sev || ': ' || v_prod::text || ' productos vendidos sin catalogo (' || fmt || ' EUR)',
      v_prod::text || ' productos distintos se han vendido en los ultimos ' || p_days::text
        || ' dias sin estar casados con la carta: ' || v_lin::text || ' lineas y ' || fmt || ' EUR. '
        || 'Su stock NO se ha descontado. El mayor es "' || coalesce(v_top,'?') || '" con '
        || translate(to_char(coalesce(v_top_eur,0), 'FM999G999G990D00'), ',.', '.,') || ' EUR. '
        || v_casan::text || ' de ellos tienen un unico candidato en su marca y se pueden casar de un clic. '
        || 'Bandeja: Productos sin catalogar.',
      -- La severidad va en la clave: un empeoramiento rompe el silencio, un
      -- estado estable no vuelve a sonar en 20 h.
      'venta_sin_casar_' || a.account_id::text || '_' || v_sev || '_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD')
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.modifier_incomplete_impact_watchdog(p_debounce_window interval DEFAULT '20:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r         record;
  v_avisos  integer := 0;
  v_candado boolean;
begin
  -- ¿Sigue puesto el candado? Es la explicacion de como puede haber filas, y
  -- por eso se mira ANTES: sin el, la cifra de abajo solo dice que ya ha
  -- pasado.
  select c.convalidated into v_candado
    from pg_constraint c
   where c.conrelid = 'public.modifier_recipe_impact'::regclass
     and c.conname  = 'impacto_confirmado_completo';

  if v_candado is null or not v_candado then
    perform public._queue_system_alert(
      'ficha_a_medias_candado_caido',
      'El candado que impide fichas a medias ya no esta puesto',
      'La tabla `modifier_recipe_impact` tenia un candado --`impacto_confirmado_completo`-- '
      || 'que impedia guardar una decision confirmada que no descuenta nada: un «anade» sin '
      || 'articulo, una cantidad a cero, una ficha sin cantidad.' || chr(10) || chr(10)
      || case when v_candado is null
              then 'Ahora **no existe**.'
              else 'Ahora existe pero **no esta validado**, o sea que no dice nada de las filas que ya hay.' end
      || chr(10) || chr(10)
      || 'Mientras no este, las tres puertas de pantalla siguen preguntando, pero una escritura '
      || 'directa a la tabla puede volver a dejar respuestas que la pantalla da por decididas y '
      || 'que descuentan cero del almacen.',
      'ficha_a_medias_candado_caido_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
      p_debounce_window);
    v_avisos := v_avisos + 1;
    raise warning 'modifier_incomplete_impact_watchdog: EL CANDADO NO ESTA PUESTO.';
  end if;

  -- Y las filas, por cuenta (regla 9: una cifra sin cuenta no es de nadie).
  for r in
    select i.account_id,
           coalesce(a.name, '(cuenta sin nombre)') as cuenta,
           count(*)::int as filas,
           count(distinct i.modifier_option_id)::int as respuestas,
           count(*) filter (where coalesce(o.is_active, true))::int as vivas,
           string_agg(distinct coalesce(o.name, '(sin nombre)'), ', '
                      order by coalesce(o.name, '(sin nombre)')) as cuales
      from public.modifier_recipe_impact i
      left join public.modifier_option o on o.id = i.modifier_option_id
      left join public.accounts a on a.id = i.account_id
     where i.status = 'confirmed'
       and not public._impacto_completo(i.impact_type, i.target_recipe_item_id, i.quantity)
     group by i.account_id, a.name
  loop
    -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los vigías.
    continue when not public.cuenta_puede_salir(r.account_id);
    perform public._queue_system_alert(
      'modificador_ficha_a_medias',
      'Hay ' || r.respuestas::text || ' respuestas con ficha a medias en ' || r.cuenta,
      'En ' || r.cuenta || ' hay **' || r.respuestas::text || ' respuestas de modificador cuya '
      || 'ficha esta confirmada y NO DESCUENTA NADA** (' || r.vivas::text || ' de ellas siguen '
      || 'encendidas). La pantalla las da por decididas; el almacen no ve salir nada.'
      || chr(10) || chr(10)
      || 'Son: ' || r.cuales || '.' || chr(10) || chr(10)
      || 'Esto no deberia poder pasar: desde el 13/09 la propia tabla lo prohibe. Si hay filas, '
      || 'o se han escrito rodeando la tabla, o el candado se ha caido.' || chr(10) || chr(10)
      || 'Se arregla en Folvy Kitchen -> Modificadores -> la pregunta -> la respuesta, poniendo '
      || 'el articulo y la cantidad.',
      'modificador_ficha_a_medias_' || r.account_id::text || '_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
      p_debounce_window);
    v_avisos := v_avisos + 1;
    raise warning 'modifier_incomplete_impact_watchdog: % — % filas a medias en % respuestas (% vivas).',
      r.cuenta, r.filas, r.respuestas, r.vivas;
  end loop;

  if v_avisos = 0 then
    -- Un vigia que calla no se distingue de uno roto (regla 8).
    raise warning 'modifier_incomplete_impact_watchdog: candado puesto y validado, cero fichas a medias.';
  end if;

  return v_avisos;
end;
$function$;

CREATE OR REPLACE FUNCTION public.modifier_zero_cost_watchdog(p_ventana interval DEFAULT '30 days'::interval, p_debounce_window interval DEFAULT '20:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r        record;
  v_base   record;
  v_avisos integer := 0;
begin
  for r in
    with cero as (
      -- Una opcion ACTIVA que cobra dinero y cuyos impactos confirmados suman
      -- exactamente 0 EUR. Devolver 0 no es «no inventar»: es afirmar que no
      -- cuesta nada. Incluye tanto las que tienen impacto roto (sin unidad, sin
      -- destino, no convertible) como las que no tienen NINGUN impacto — que es
      -- el caso de «Si, con patatas» de Lovers Burgers, 27 lineas en agosto.
      select mo.account_id, mo.id
        from modifier_option mo
       where mo.is_active
         and coalesce(mo.price_impact, 0) > 0
         and coalesce((select sum(case when i.impact_type in ('add_item','bundle','replace_item')
                                       then public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id)
                                       else 0 end)
                         from modifier_recipe_impact i
                        where i.modifier_option_id = mo.id
                          and i.status = 'confirmed'), 0) = 0
    ),
    vivas as (
      -- Las que ademas SE ESTAN VENDIENDO. Una opcion muerta que vale cero es
      -- deuda; una que vende es dinero saliendo hoy.
      select distinct c.account_id, c.id
        from cero c
        join sale_line m on m.modifier_option_id = c.id and m.line_type = 'modifier'
        join sale s on s.id = m.sale_id
                   and s.account_id = c.account_id          -- regla 9, tambien aqui
                   and s.sold_at >= now() - coalesce(p_ventana, interval '30 days')
                   and coalesce(s.status, '') <> 'cancelled'
    )
    select c.account_id,
           coalesce(a.name, '(cuenta sin nombre)') as cuenta,
           count(distinct c.id)::int as total,
           count(distinct v.id)::int as vivas
      from cero c
      left join vivas v on v.id = c.id
      left join accounts a on a.id = c.account_id
     group by c.account_id, a.name
  loop
    -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los vigías.
    -- Tampoco se siembra ni se mueve su marca: al quitarle la demo, empieza de cero.
    continue when not public.cuenta_puede_salir(r.account_id);
    select * into v_base from public.modifier_zero_cost_baseline where account_id = r.account_id;

    if not found then
      -- Primera vez: se siembra la marca con lo que hay y NO se avisa. Avisar de
      -- un pasivo que ya existia no le dice a nadie que ha pasado algo hoy.
      insert into public.modifier_zero_cost_baseline (account_id, vivas, total)
      values (r.account_id, r.vivas, r.total);
      raise warning 'modifier_zero_cost_watchdog: % — marca sembrada en % vivas de % que cobran y valen 0 EUR.',
        r.cuenta, r.vivas, r.total;

    elsif r.vivas > v_base.vivas then
      -- HA SUBIDO. Un aviso por cuenta, con los dos numeros absolutos delante.
      perform public._queue_system_alert(
        'modificador_sin_coste',
        'Hay ' || r.vivas::text || ' modificadores que cobran y cuestan 0 EUR en ' || r.cuenta
          || ' (eran ' || v_base.vivas::text || ')',
        'En ' || r.cuenta || ' hay ahora **' || r.vivas::text || ' opciones de modificador que '
          || 'COBRAN dinero, se han vendido en los ultimos '
          || extract(day from coalesce(p_ventana, interval '30 days'))::int::text
          || ' dias y aportan 0,00 EUR al coste**. Antes eran ' || v_base.vivas::text || '.'
          || chr(10) || chr(10)
          || 'En total, contando tambien las que no se venden, son ' || r.total::text
          || ' opciones en esa situacion.' || chr(10) || chr(10)
          || 'Aportar cero no es «no inventar un coste»: es afirmar que no cuesta nada, y eso '
          || 'baja el food cost de todo lo que las lleve. Las causas de siempre son tres: al '
          || 'impacto le falta la unidad, le falta el destino, o la opcion NO TIENE impacto '
          || 'ninguno (pasa cuando una marca se sustituye por otra y la nueva se queda sin '
          || 'configurar).' || chr(10) || chr(10)
          || 'Se revisa en Folvy Kitchen -> Cartas -> el producto -> pestaña «Modificadores» '
          || '-> bloque «Impacto en coste».',
        'modificador_sin_coste_' || r.account_id::text || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_avisos := v_avisos + 1;
      raise warning 'modifier_zero_cost_watchdog: % — SUBE de % a % vivas (total %). Aviso encolado.',
        r.cuenta, v_base.vivas, r.vivas, r.total;

    elsif r.vivas < v_base.vivas then
      -- Ha bajado: se consolida. El trinquete solo gira en un sentido.
      update public.modifier_zero_cost_baseline
         set vivas = r.vivas, total = r.total, updated_at = now()
       where account_id = r.account_id;
      raise warning 'modifier_zero_cost_watchdog: % — BAJA de % a % vivas (total %). Marca consolidada.',
        r.cuenta, v_base.vivas, r.vivas, r.total;

    else
      -- Igual. Se dice igualmente: un vigia que calla no se distingue de uno roto.
      update public.modifier_zero_cost_baseline
         set total = r.total, updated_at = now()
       where account_id = r.account_id;
      raise warning 'modifier_zero_cost_watchdog: % — sin cambio: % vivas de % que cobran y valen 0 EUR.',
        r.cuenta, r.vivas, r.total;
    end if;
  end loop;

  return v_avisos;
end;
$function$;

CREATE OR REPLACE FUNCTION public._generate_daily_count_core(p_account_id uuid, p_location_id uuid, p_employee_ids uuid[] DEFAULT NULL::uuid[], p_per_person integer DEFAULT 8, p_coverage_target numeric DEFAULT 80, p_ignore_freshness boolean DEFAULT false)
 RETURNS TABLE(count_id uuid, lines_created integer, already_existed boolean, coverage_before numeric, coverage_after numeric, per_person_today integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_count_id uuid;
  v_n_people integer;
  v_per_today integer;
  v_cap integer;
  v_total_value numeric;
  v_fresh_before numeric;
  v_cov_before numeric;
  v_cov_after numeric;
  v_created integer := 0;
  v_stale_id uuid;
  v_recuentos integer := 0;
BEGIN
  FOR v_stale_id IN
    SELECT id FROM public.inventory_count
    WHERE account_id = p_account_id AND location_id = p_location_id
      AND kind = 'cycle' AND status IN ('abierto','contando')
      AND created_at::date < current_date
  LOOP
    -- EL AUTOCIERRE NO PUEDE TUMBAR LA GENERACION (29/08/2026).
    BEGIN
      PERFORM public.autoclose_daily_count(v_stale_id);
    EXCEPTION WHEN OTHERS THEN
      -- DM1 · PR 2a (31/10): una cuenta de demo no avisa; el rezagado se queda igual.
      IF public.cuenta_puede_salir(p_account_id) THEN
      PERFORM public._queue_system_alert(
        'autoinventario',
        'Autoinventario: no se pudo autocerrar un conteo rezagado',
        format('Conteo %s del local %s: %s. El conteo de hoy SI se ha generado; '
               'el rezagado sigue abierto y hay que cerrarlo a mano.',
               v_stale_id, p_location_id, sqlerrm),
        'autoinventario_autocierre');
      END IF;
    END;
  END LOOP;

  SELECT id INTO v_existing FROM public.inventory_count
   WHERE account_id = p_account_id AND location_id = p_location_id
     AND kind = 'cycle' AND status <> 'anulado' AND created_at::date = current_date
   ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing,
      (SELECT count(*)::int FROM public.inventory_count_line WHERE inventory_count_id = v_existing),
      true, NULL::numeric, NULL::numeric, NULL::integer;
    RETURN;
  END IF;

  v_n_people := COALESCE(array_length(p_employee_ids, 1), 0);

  WITH sel AS (
    SELECT q.recipe_item_id, q.stock_value, q.abc_rich,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  public._count_cadence_days(p_account_id, q.recipe_item_id, q.abc_rich)) ) AS is_stale
    FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT DISTINCT ON (icl.recipe_item_id)
             icl.recipe_item_id,
             ic.approved_at AS last_approved,
             -- UNA APERTURA NO ES PRUEBA DE NADA (10/09, noche). Este
             -- COALESCE convertía un NULL en `true`, o sea en «el último
             -- recuento cuadró», y con la apertura del packaging habría
             -- dicho eso de 59 artículos que nadie ha comprobado nunca.
             -- NULL se propaga: `NOT NULL` es NULL, así que la línea deja de
             -- opinar y la rotación decide por EDAD, que es lo único que una
             -- apertura sí demuestra.
             CASE WHEN COALESCE(ic.is_opening, false) THEN NULL
                  ELSE COALESCE(icl.within_tolerance,
                         (ABS(COALESCE(icl.variance_value,0)) < 5
                          AND ABS(COALESCE(icl.variance_pct,0)) < 3))
             END AS last_ok
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      ORDER BY icl.recipe_item_id, ic.approved_at DESC
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  )
  SELECT COALESCE(SUM(stock_value),0),
         COALESCE(SUM(stock_value) FILTER (WHERE NOT is_stale),0)
    INTO v_total_value, v_fresh_before
  FROM sel;

  v_cov_before := CASE WHEN v_total_value > 0 THEN ROUND(v_fresh_before / v_total_value * 100, 1) ELSE 0 END;

  v_per_today := CASE
    WHEN v_cov_before < 40 THEN CEIL(p_per_person * 1.5)::int
    WHEN v_cov_before <= 75 THEN p_per_person
    ELSE GREATEST(1, FLOOR(p_per_person * 0.5)::int)
  END;
  v_cap := GREATEST(v_per_today, v_n_people * v_per_today);

  CREATE TEMP TABLE _daily_pick ON COMMIT DROP AS
  WITH sel AS (
    SELECT q.recipe_item_id, q.qty_on_hand, q.stock_value, q.abc_rich, q.must_count, q.rank,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  public._count_cadence_days(p_account_id, q.recipe_item_id, q.abc_rich)) ) AS is_stale
    FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT DISTINCT ON (icl.recipe_item_id)
             icl.recipe_item_id,
             ic.approved_at AS last_approved,
             -- UNA APERTURA NO ES PRUEBA DE NADA (10/09, noche). Este
             -- COALESCE convertía un NULL en `true`, o sea en «el último
             -- recuento cuadró», y con la apertura del packaging habría
             -- dicho eso de 59 artículos que nadie ha comprobado nunca.
             -- NULL se propaga: `NOT NULL` es NULL, así que la línea deja de
             -- opinar y la rotación decide por EDAD, que es lo único que una
             -- apertura sí demuestra.
             CASE WHEN COALESCE(ic.is_opening, false) THEN NULL
                  ELSE COALESCE(icl.within_tolerance,
                         (ABS(COALESCE(icl.variance_value,0)) < 5
                          AND ABS(COALESCE(icl.variance_pct,0)) < 3))
             END AS last_ok
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      ORDER BY icl.recipe_item_id, ic.approved_at DESC
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  ),
  ranked AS (
    SELECT s.*, ROW_NUMBER() OVER w AS pickn
    FROM sel s
    WHERE s.is_stale
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_count ic2
        JOIN public.inventory_count_line icl2 ON icl2.inventory_count_id = ic2.id
        WHERE ic2.account_id = p_account_id
          AND ic2.location_id = p_location_id
          AND ic2.kind IN ('full','audit')
          AND ic2.status IN ('contando','en_revision')
          AND icl2.recipe_item_id = s.recipe_item_id
      )
    WINDOW w AS (ORDER BY s.must_count DESC, s.stock_value DESC, s.last_approved ASC NULLS FIRST, s.rank ASC)
  )
  SELECT r.recipe_item_id, r.qty_on_hand, r.abc_rich, r.must_count, r.pickn
  FROM ranked r
  WHERE r.must_count = true OR r.pickn <= v_cap;

  SELECT count(*)::int INTO v_created FROM _daily_pick;

  -- ── RECUENTOS PEDIDOS (NUEVO 10/09) ───────────────────────────────────
  -- Peticiones de `request_recount` de este local que aún no tienen línea hija.
  CREATE TEMP TABLE _recount_pick ON COMMIT DROP AS
  SELECT DISTINCT ON (l.recipe_item_id)
         l.id AS origen_id, l.recipe_item_id, l.abc_class, l.recount_assign_to
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.account_id = p_account_id
     AND ic.location_id = p_location_id
     AND l.recount_requested_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inventory_count_line h WHERE h.recount_of = l.id)
   ORDER BY l.recipe_item_id, l.recount_requested_at DESC;

  SELECT count(*)::int INTO v_recuentos FROM _recount_pick;

  IF v_created = 0 AND v_recuentos = 0 THEN
    DROP TABLE IF EXISTS _daily_pick;
    DROP TABLE IF EXISTS _recount_pick;
    RETURN QUERY SELECT NULL::uuid, 0, false, v_cov_before, v_cov_before, v_per_today;
    RETURN;
  END IF;

  INSERT INTO public.inventory_count(account_id, location_id, kind, status, blind, is_opening, started_at, notes)
  VALUES (p_account_id, p_location_id, 'cycle', 'contando', true, false, now(), 'Autoinventario del día')
  RETURNING id INTO v_count_id;

  -- Los recuentos pedidos van PRIMEROS: posición negativa, para que quien los
  -- vea sepa que alguien los ha pedido a mano y no salgan detrás de la cola.
  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to, recount_of)
  SELECT p_account_id, v_count_id, rp.recipe_item_id, NULL,
         -1000 + (ROW_NUMBER() OVER (ORDER BY rp.recipe_item_id))::int,
         public.theoretical_qty_at(rp.recipe_item_id, p_location_id, now()),
         NULL, rp.abc_class,
         -- Si no se decidió a quién, entra en el round-robin como una más.
         COALESCE(rp.recount_assign_to,
                  CASE WHEN v_n_people > 0
                       THEN p_employee_ids[((ROW_NUMBER() OVER (ORDER BY rp.recipe_item_id))::int - 1) % v_n_people + 1]
                       ELSE NULL END),
         rp.origen_id
    FROM _recount_pick rp;

  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to)
  SELECT p_account_id, v_count_id, p.recipe_item_id, NULL, p.pickn::int,
         COALESCE(p.qty_on_hand, 0), NULL, p.abc_rich,
         CASE WHEN v_n_people > 0 THEN p_employee_ids[((p.pickn - 1) % v_n_people) + 1] ELSE NULL END
  FROM _daily_pick p
  -- Un artículo que ya entra como recuento pedido no entra dos veces.
  WHERE NOT EXISTS (SELECT 1 FROM _recount_pick rp WHERE rp.recipe_item_id = p.recipe_item_id);

  SELECT count(*)::int INTO v_created
    FROM public.inventory_count_line WHERE inventory_count_id = v_count_id;

  SELECT CASE WHEN v_total_value > 0
    THEN ROUND((v_fresh_before + COALESCE(SUM(ric.stock_value),0)) / v_total_value * 100, 1)
    ELSE 100 END
  INTO v_cov_after
  FROM public.inventory_count_line l
  JOIN public.recipe_item_location_stock ric
    ON ric.recipe_item_id = l.recipe_item_id AND ric.account_id = p_account_id AND ric.location_id = p_location_id
  WHERE l.inventory_count_id = v_count_id;
  v_cov_after := COALESCE(v_cov_after, v_cov_before);

  DROP TABLE IF EXISTS _daily_pick;
  DROP TABLE IF EXISTS _recount_pick;

  RETURN QUERY SELECT v_count_id, v_created, false, v_cov_before, v_cov_after, v_per_today;
END;
$function$;
