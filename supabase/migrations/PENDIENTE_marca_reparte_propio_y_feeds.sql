-- ══════════════════════════════════════════════════════════════════════════
-- KDS · «no aplica» no es «ha fallado» — una sola definición de quién reparte
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Nombre provisional: se renombra a la versión que registre la
-- base (regla 17). Va ANTES del bundle: el front de este arreglo lee un campo
-- que sale de aquí. Si se publica el bundle sin aplicar esto, el campo llega
-- `undefined` y la pantalla se queda como está (no rompe, pero no arregla).
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────────────────
--
-- El KDS pinta «⚠️ NO SE PUDO DESPACHAR + Reintentar» en pedidos de marcas que
-- NO hacen reparto propio. El despacho hace lo correcto (no manda una cedida a
-- la flota); lo que está mal es la pantalla. Medido: 69 pedidos, 46 con banner
-- rojo y 23 con un botón azul «Despachar reparto» que tampoco puede funcionar.
-- Ver `docs/RECON_kds_despacho_no_aplica_20260908.md`.
--
-- La UI no puede arreglarlo sola porque el dato con el que decidir NO LE LLEGA:
-- `orders_feed` expone `brand_ownership_type` pero no el interruptor de reparto.
--
-- ── LA REGLA VIVÍA DOS VECES. AHORA VIVE UNA ──────────────────────────────
--
-- Antes de esto, «¿esta marca reparte?» estaba escrito en DOS sitios:
--
--   SQL  · resolve_dispatch:      coalesce(b.own_delivery_enabled, b.ownership_type = 'own')
--   TS   · brandDeliveryService:  ownDeliveryEnabled ?? (ownershipType === 'own')
--
-- Hoy coinciden. Coincidían también las dos implementaciones del descubrimiento
-- de catálogos, hasta que una se arregló y la otra no: 27 días con el importador
-- devolviendo cero. Dos caminos para la misma regla no es duplicación, es una
-- fecha de caducidad.
--
-- Por eso el arreglo NO añade un tercer sitio en el KDS. Crea `marca_reparte_
-- propio(brand)` como LA definición, la mete en el resolutor y la sirve por los
-- feeds, y el front pasa a LEER LA RESPUESTA en vez de recalcularla.
--
-- Se declara con el TIPO DE FILA `brand` (no con un uuid) a propósito, y son
-- dos ventajas por el mismo precio:
--   1. UNA sola firma. Si hubiera `(uuid)` y `(brand)` habría sobrecarga, que
--      es justo lo que la regla 2 no quiere ver nunca más.
--   2. PostgREST la expone como COLUMNA CALCULADA de `brand`, así que la
--      pantalla de ajustes puede pedir `marca_reparte_propio` en su `select`
--      en vez de repetir el `??`. (No lo hace este fichero; queda el camino.)
--
-- ── POR QUÉ ESTE FICHERO NO REESCRIBE LOS CUERPOS ENTEROS ─────────────────
--
-- Las tres funciones suman ~22.000 caracteres y el cambio real son TRES LÍNEAS.
-- Copiarlas aquí a mano metería 22.000 caracteres de riesgo de transcripción
-- para cambiar tres, y perder un `SECURITY DEFINER` o un `search_path` al
-- copiar sería una regresión de seguridad silenciosa.
--
-- Así que cada bloque hace lo mismo: coge la definición VIVA, sustituye un
-- ancla EXACTA —que está escrita aquí, entera, para que se lea— y la ejecuta.
-- Lo que hay que revisar es el ancla y el texto que la sustituye, que es el
-- cambio de verdad. Cada bloque aborta si el ancla no aparece exactamente una
-- vez, y la guarda de más abajo aborta si el cuerpo vivo no es el que se leyó.
--
-- Compensación honesta: así NO se lee el resultado final antes de ejecutarlo.
-- A cambio no puede haber una errata mía, ni puede perderse un atributo de la
-- función. Para VER el resultado antes de confirmar, ejecutar el fichero sin el
-- `commit;` final y mirar:
--
--   select pg_get_functiondef(oid) from pg_proc
--    where pronamespace='public'::regnamespace and proname='resolve_dispatch';
--
-- ── HUELLAS DE PARTIDA (medidas el 08/09) ─────────────────────────────────
--
--   resolve_dispatch      37d1483117c5cab68f9b353a970e051f   4685 chars
--   orders_feed           65b1733292456e718fb241a374fa97bf   8987 chars
--   orders_feed_by_token  c4f2fdd7c0bf6f1f2622b15a3ab9932a   8362 chars
--
-- ── LO QUE NO CAMBIA, Y ES DELIBERADO ─────────────────────────────────────
--
--   · El COMPORTAMIENTO del despacho. `marca_reparte_propio(b)` es literalmente
--     el mismo `coalesce` que ya estaba dentro del resolutor: mismo resultado
--     para toda fila. Esto no despacha ni deja de despachar nada nuevo.
--   · La firma de `resolve_dispatch` sigue siendo `(uuid) → TABLE(carrier,
--     reason)`. NO se le añade el código de motivo estructurado: cambiar un
--     `RETURNS TABLE` es DROP + CREATE con sus llamadores delante (regla 2), y
--     resulta que ESTE arreglo no lo necesita — el criterio es la marca, no el
--     texto del motivo. Queda como deuda declarada, con su razón: hoy «no
--     aplica» y un fallo de verdad comparten la columna `sale.dispatch_error`
--     y sólo los distingue la prosa de dentro.
--   · La alarma de quien SÍ reparte y de verdad falló. Intacta.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── Guarda: que las tres funciones sean las que se leyeron ────────────────
do $guarda$
declare
  r record;
  v_esperado jsonb := jsonb_build_object(
    'resolve_dispatch',     '37d1483117c5cab68f9b353a970e051f',
    'orders_feed',          '65b1733292456e718fb241a374fa97bf',
    'orders_feed_by_token', 'c4f2fdd7c0bf6f1f2622b15a3ab9932a'
  );
  v_n integer;
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'marca_reparte_propio') then
    raise exception 'ABORTA: ya existe public.marca_reparte_propio. Crear otra firma seria una SOBRECARGA (regla 2). Revisar antes.';
  end if;

  for r in select key as nombre, value #>> '{}' as md5_esperado from jsonb_each(v_esperado) loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.nombre;
    if v_n <> 1 then
      raise exception 'ABORTA: public.% tiene % firmas, deberia tener 1.', r.nombre, v_n;
    end if;

    if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.nombre) <> r.md5_esperado then
      raise exception 'ABORTA: el cuerpo vivo de public.% no es el leido el 08/09. Releerlo antes de tocarlo (regla 1: hay correcciones que solo viven en el desplegado).', r.nombre;
    end if;
  end loop;

  raise notice 'Guarda OK: las tres funciones son las leidas el 08/09.';
end
$guarda$;

-- ── 1) LA definición. Una, con tipo de fila, sin sobrecargas ──────────────
create function public.marca_reparte_propio(b public.brand)
returns boolean
language sql
stable
as $fn$
  -- NULL en el interruptor = «no lo han tocado» → se deriva del tipo de marca:
  -- una marca PROPIA reparte por defecto, una CEDIDA no. Que la cedida esté
  -- apagada sin que nadie tenga que acordarse es lo que hace que esto aguante.
  select coalesce(b.own_delivery_enabled, b.ownership_type = 'own');
$fn$;

comment on function public.marca_reparte_propio(public.brand) is
  'LA definicion de «esta marca hace reparto propio». La usan resolve_dispatch '
  '(para no despachar) y orders_feed/orders_feed_by_token (para que el KDS no '
  'pinte como averia lo que es normal). Se declara con el tipo de fila brand '
  'para tener UNA sola firma y para que PostgREST la sirva como columna '
  'calculada. Antes esta regla estaba escrita dos veces —dentro del resolutor y '
  'en brandDeliveryService.ts—; dos caminos para la misma regla no es '
  'duplicacion, es una fecha de caducidad.';

-- ── 2) El resolutor deja de llevar su copia de la regla ───────────────────
do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_dispatch';

  v_new := replace(
    v_def,
    'coalesce(b.own_delivery_enabled, b.ownership_type = ''own'')',
    'public.marca_reparte_propio(b)'
  );

  if v_new = v_def then
    raise exception 'ABORTA: el ancla del interruptor no aparece en resolve_dispatch.';
  end if;

  execute v_new;
end
$mig$;

-- ── 3) Los dos feeds sirven la respuesta al KDS ───────────────────────────
-- Basta con añadirlo al CTE `tickets`: el JSON se arma con `to_jsonb(t)`, asi
-- que todo lo que entra en el select del CTE sale en el pedido. Y `b` ya esta
-- en el `left join brand b on b.id = v.brand_id` de ese mismo CTE.
do $mig$
declare
  f      text;
  v_def  text;
  v_new  text;
  ancla  text := '           b.ownership_type as brand_ownership_type,';
  nuevo  text := '           b.ownership_type as brand_ownership_type,'
               || chr(10)
               || '           public.marca_reparte_propio(b) as brand_own_delivery,';
begin
  foreach f in array array['orders_feed', 'orders_feed_by_token'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;

    if (length(v_def) - length(replace(v_def, ancla, ''))) / length(ancla) <> 1 then
      raise exception 'ABORTA: el ancla aparece % veces en public.% (deberia ser 1).',
        (length(v_def) - length(replace(v_def, ancla, ''))) / length(ancla), f;
    end if;

    v_new := replace(v_def, ancla, nuevo);
    execute v_new;
  end loop;
end
$mig$;

-- ── 4) Que haya pasado lo que se dice que pasa ────────────────────────────
do $verif$
declare
  v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('resolve_dispatch', 'orders_feed', 'orders_feed_by_token')
     and p.prosrc like '%marca_reparte_propio%';
  if v_n <> 3 then
    raise exception 'ABORTA: solo % de 3 funciones usan marca_reparte_propio.', v_n;
  end if;

  -- Y que no se haya perdido por el camino lo que las hace seguras.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('resolve_dispatch', 'orders_feed', 'orders_feed_by_token')
     and p.prosecdef and p.proconfig @> array['search_path=public'];
  if v_n <> 3 then
    raise exception 'ABORTA: alguna de las tres ha perdido SECURITY DEFINER o el search_path.';
  end if;

  -- El resolutor ya no lleva su copia de la regla.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='resolve_dispatch'
       and p.prosrc like '%coalesce(b.own_delivery_enabled%'
  ) then
    raise exception 'ABORTA: resolve_dispatch sigue llevando el coalesce dentro.';
  end if;

  raise notice 'Verificacion OK: las tres usan marca_reparte_propio, conservan SECURITY DEFINER y search_path, y el resolutor ya no duplica la regla.';
end
$verif$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR — pegar el resultado, no el resumen (regla 5)
-- ══════════════════════════════════════════════════════════════════════════
--
-- 1) Que el comportamiento del despacho NO ha cambiado: la nueva funcion debe
--    dar exactamente lo mismo que el coalesce viejo, en TODA marca de TODA
--    cuenta. Tiene que devolver 0 filas.
--
--   select b.account_id, b.name, b.ownership_type, b.own_delivery_enabled,
--          public.marca_reparte_propio(b) as ahora,
--          coalesce(b.own_delivery_enabled, b.ownership_type = 'own') as antes
--     from public.brand b
--    where public.marca_reparte_propio(b)
--          is distinct from coalesce(b.own_delivery_enabled, b.ownership_type = 'own');
--
-- 2) Que el feed sirve el campo (con un local de Foodint que tenga pedidos):
--
--   select o->>'brand', o->>'brand_ownership_type', o->>'brand_own_delivery'
--     from jsonb_array_elements(
--            public.orders_feed('38158159-cd71-4056-950b-53425afac1ce')->'orders'
--          ) as o;
--
-- 3) Las tres huellas nuevas, para el registro:
--
--   select proname, md5(prosrc), length(prosrc) from pg_proc
--    where pronamespace='public'::regnamespace
--      and proname in ('resolve_dispatch','orders_feed','orders_feed_by_token')
--    order by 1;
-- ══════════════════════════════════════════════════════════════════════════
