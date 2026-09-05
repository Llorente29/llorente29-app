-- B68 §1 (05/09/2026). El cartel deja de afirmar quién reparte.
--
-- QUE SE CAMBIA: UNA CADENA. Nada mas.
--   antes  'sin dirección: este pedido no lo repartimos nosotros'
--   ahora  'sin dirección de entrega: la plataforma no la ha enviado'
--
-- POR QUE: la segunda mitad de la frase vieja era FALSA. El pedido G569
-- (101763565060, Milanesa House Alcala, 05/09 00:44) es `own_delivery` — lo
-- reparte el local — y Glovo NO mando la direccion. La frase contradecia a la
-- propia fila. Venia de dar por buena una ley inducida de dos marcas: «en Glovo
-- la direccion la manda cuando reparte el local». No es cierta.
--
-- LA RED DE SEGURIDAD NO SE TOCA: sin direccion sigue sin haber despacho
-- automatico. Lo que se cae es la AFIRMACION sobre quien reparte, no la guarda.
--
-- SE COMPROBO ANTES QUE EL MOTIVO ES TEXTO Y NO LLAVE, porque cambiar una llave
-- rompe en silencio:
--   repo entero (src/, supabase/, scripts/)  no lo compara; solo un comentario.
--   dispatch_watchdog_scan  decide por `if v_carrier is null`, y el codigo va en
--                           delivery_alarm_kind ('no_despachado' / 'no_rider').
--                           El reason solo se concatena en dispatch_error.
--   tg_auto_dispatch        declara v_reason, lo lee y NO LO USA NUNCA.
--   hubrise-webhook         solo lo nombra en un comentario que dice que no la toca.
--
-- SIN EL NOMBRE DEL CANAL, y se dice por que: el encargo pedia «Glovo no ha
-- enviado…» con el canal que tocara. Nombrarlo obliga a leer
-- `s.external_channel_text` dentro del resolutor, y eso es UNA LINEA DE LOGICA
-- en la guarda del despacho a la 1:40 de la madrugada con Alcala repartiendo.
-- El criterio de aceptacion era «una cadena cambiada y nada mas», asi que la
-- base dice «la plataforma» y el canal lo pone la web, que ya lo tiene.
--
-- CIRUGIA SOBRE LA DEFINICION VIVA (regla F5), no reescritura: se lee lo que hay,
-- se sustituye la cadena, se exige que aparezca EXACTAMENTE UNA VEZ y se vuelve
-- a crear. Asi es imposible que se cuele otro cambio de paso.

do $cirugia$
declare
  v_def   text;
  v_veces int;
  v_viejo text := 'sin dirección: este pedido no lo repartimos nosotros';
  v_nuevo text := 'sin dirección de entrega: la plataforma no la ha enviado';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_dispatch';

  if v_def is null then
    raise exception 'B68: resolve_dispatch no existe.';
  end if;

  select count(*) into v_veces
    from regexp_matches(v_def, replace(v_viejo, '.', '\.'), 'g');
  if v_veces <> 1 then
    raise exception 'B68: la frase vieja aparece % veces, se esperaba 1. No se toca nada.', v_veces;
  end if;

  v_def := replace(v_def, v_viejo, v_nuevo);
  execute v_def;
end
$cirugia$;

do $verif$
declare v_def text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_dispatch';

  -- La frase nueva esta.
  if v_def not like '%sin dirección de entrega: la plataforma no la ha enviado%' then
    raise exception 'B68: la frase nueva no quedo puesta.';
  end if;
  -- La vieja no.
  if v_def like '%no lo repartimos nosotros%' then
    raise exception 'B68: la frase vieja sigue ahi.';
  end if;
  -- Y NADA MAS ha cambiado: las otras siete ramas siguen en su sitio.
  select count(*) into v_n from regexp_matches(v_def, 'RETURN QUERY', 'g');
  if v_n <> 8 then
    raise exception 'B68: hay % ramas RETURN QUERY y habia 8. Se ha movido logica.', v_n;
  end if;
  foreach v_def in array array[v_def] loop null; end loop;
end
$verif$;

do $verif2$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_dispatch';
  -- Los otros siete motivos, uno por uno, intactos.
  if v_def not like '%venta no encontrada%'
     or v_def not like '%marca sin reparto propio (interruptor apagado)%'
     or v_def not like '%sin regla -> broker por defecto%'
     or v_def not like '%sin cadena -> broker por defecto%'
     or v_def not like '%en turno%'
     or v_def not like '%(cadena)%'
     or v_def not like '%cadena agotada; broker por defecto%' then
    raise exception 'B68: falta alguno de los otros siete motivos.';
  end if;
  -- Y la guarda de la direccion sigue cortando antes de mirar reglas.
  if v_def not like '%IF coalesce(btrim(v_sale.delivery_address), %' then
    raise exception 'B68: la guarda de la direccion ya no esta donde estaba.';
  end if;
end
$verif2$;
