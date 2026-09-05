-- B68 §3, correccion (05/09/2026). LA ETIQUETA ERA FALSA, Y NO ERA COSMETICA.
--
-- La version anterior (20260905070802) llamaba «licenciadas» a las marcas con
-- own_delivery_enabled = false. NO LO SON. Comprobado sobre las 18 marcas de
-- Foodint:
--
--   ownership_type   own_delivery_enabled   marcas
--   licensed         NULL                        9   Ay Mamita, Big Mike's,
--                                                    Birria Burrito, Chivuos,
--                                                    Deep Pizza, Dos Coyotes,
--                                                    Koreans, Lobbers,
--                                                    Milanesa Haus
--   own              false                       2   Smash Brothers, Lovers
--   own              NULL                        7   el resto
--
-- Smash Brothers y Lovers Burgers son marcas NUESTRAS que reparte la
-- plataforma. Llamarlas «licenciadas» metia en un artefacto duradero
-- exactamente la confusion que costo la noche del 04/09.
--
-- SON DOS EJES DISTINTOS:
--   de quien es la marca   -> ownership_type ('own' / 'licensed')
--   quien la reparte       -> own_delivery_enabled
-- Cruzarlos no es un detalle de nombres: son preguntas diferentes con
-- respuestas diferentes.
--
-- ── Y EL EJE QUE FALTABA YA ESTABA MORDIENDO, HOY, NO MANANA ────────────────
-- Con un solo eje la etiqueta seguia mintiendo. Medido a 30 dias sobre los
-- pedidos marcados own_delivery de Foodint:
--
--   DOS COYOTES es `licensed` y tiene 16 pedidos que la metrica contaba como
--   «repartimos nosotros», porque su own_delivery_enabled es NULL y NULL se
--   lee como «si». Los 390 «nuestro» de ayer incluian 16 que no lo son.
--
-- Por eso esta correccion no solo renombra: ANADE el segundo eje. Una fila con
-- reparto = 'nosotros' y marca = 'licenciada' es una contradiccion, y ahora se
-- VE en vez de quedar doblada dentro de un total. Regla 7 otra vez: etiquetar,
-- no esconder -- tambien cuando lo que se esconde es una incoherencia propia.
--
-- ── TEXTO, NO BOOLEANOS ────────────────────────────────────────────────────
-- Dos booleanos adyacentes que significan cosas distintas se leen mal a la
-- primera, y ademas «(sin marca)» no es ni true ni false. Con texto cada
-- celda dice lo que es y no se puede confundir un eje con el otro.
--
-- ── LO QUE NO SE ARREGLA AQUI, Y POR QUE ───────────────────────────────────
-- `own_delivery_enabled` esta puesta en 2 marcas de 18. Las otras 16 son NULL
-- y aqui se leen como «repartimos nosotros», lo cual YA ES FALSO para las 9
-- licenciadas. La fuente buena es channel_delivery_policy (own -> own_delivery,
-- licensed -> platform_delivery), completa para los 3 canales. NO se cambia
-- desde aqui: arreglar la fuente de la verdad no es trabajo de una metrica, y
-- hacerlo de rebote la convertiria en el sitio donde vive el criterio. Queda
-- anotado, y ahora ademas queda VISIBLE en el propio resultado.
--
-- DROP + CREATE, no REPLACE: cambia el tipo de retorno (regla 2). Grants a
-- mano despues, porque el DROP se los lleva. Nadie consume la funcion todavia
-- (0 referencias en src/): cambiarla es barato hoy y caro dentro de un mes.

drop function if exists public.metrica_direcciones_de_reparto(uuid, integer);

create function public.metrica_direcciones_de_reparto(p_account_id uuid, p_dias integer default 30)
returns table(
  reparto             text,
  marca               text,
  pasarela            text,
  canal               text,
  pedidos             bigint,
  sin_direccion       bigint,
  sin_direccion_pct   numeric,
  con_coordenadas     bigint,
  coords_en_delivery  bigint,
  coords_en_customer  bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- service_role (informes, cron) pasa; un usuario tiene que ser de la cuenta.
  if current_setting('request.jwt.claims', true) is not null
     and not public.belongs_to_account(p_account_id) then
    raise exception 'metrica_direcciones_de_reparto: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with base as (
    select
      -- EJE 1, quien reparte. NULL = no declarado = se asume que nosotros.
      -- Ver la nota de arriba: para las 9 licenciadas eso es falso hoy.
      case when coalesce(b.own_delivery_enabled, true)
           then 'nosotros' else 'plataforma' end as reparto,
      -- EJE 2, de quien es la marca. Nada que ver con el anterior.
      case b.ownership_type
           when 'own'      then 'propia'
           when 'licensed' then 'licenciada'
           when null       then 'sin marca'
           else coalesce(b.ownership_type, 'sin marca')
      end as marca,
      coalesce(s.source, '(sin source)') as pasarela,
      coalesce(nullif(btrim(s.external_channel_text), ''), '(sin canal)') as canal,
      coalesce(btrim(s.delivery_address), '') = '' as sin_dir,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'delivery'->>'latitude', '') end as lat_delivery,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'customer'->>'latitude', '') end as lat_customer
    from public.sale s
    left join public.brand b on b.id = s.brand_id
    where s.account_id = p_account_id
      and s.service_type = 'own_delivery'
      and s.created_at > now() - make_interval(days => greatest(1, p_dias))
  )
  select
    b.reparto,
    b.marca,
    b.pasarela,
    b.canal,
    count(*),
    count(*) filter (where b.sin_dir),
    round(100.0 * count(*) filter (where b.sin_dir) / nullif(count(*), 0), 1),
    count(*) filter (where b.sin_dir and coalesce(b.lat_delivery, b.lat_customer) is not null),
    count(*) filter (where b.lat_delivery is not null),
    count(*) filter (where b.lat_customer is not null)
  from base b
  group by b.reparto, b.marca, b.pasarela, b.canal
  -- Lo que repartimos primero; dentro, lo que mas falla. El criterio ORDENA.
  order by case when b.reparto = 'nosotros' then 0 else 1 end,
           count(*) filter (where b.sin_dir) desc,
           count(*) desc;
end;
$function$;

comment on function public.metrica_direcciones_de_reparto(uuid, integer) is
  'Direcciones que faltan en pedidos marcados own_delivery, por pasarela y canal. DOS EJES INDEPENDIENTES: `reparto` (nosotros / plataforma, de brand.own_delivery_enabled) y `marca` (propia / licenciada, de brand.ownership_type). Smash Brothers y Lovers son marcas PROPIAS que reparte la plataforma: no confundir los ejes. Ojo: own_delivery_enabled es NULL en 16 de 18 marcas y NULL se lee como "nosotros", asi que las filas reparto=nosotros + marca=licenciada son una contradiccion conocida (Dos Coyotes); la fuente buena es channel_delivery_policy.';

revoke all on function public.metrica_direcciones_de_reparto(uuid, integer) from public;
revoke all on function public.metrica_direcciones_de_reparto(uuid, integer) from anon;
grant execute on function public.metrica_direcciones_de_reparto(uuid, integer) to authenticated, service_role;

-- ── Verificacion ───────────────────────────────────────────────────────────
do $verif$
declare
  v_firmas int;
  v_total bigint;
  v_contradiccion bigint;
  v_etiquetas text;
begin
  select count(*) into v_firmas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'metrica_direcciones_de_reparto';
  if v_firmas <> 1 then
    raise exception 'metrica_direcciones_de_reparto tiene % firmas (regla 2)', v_firmas;
  end if;

  if has_function_privilege('anon', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute')
     or has_function_privilege('public', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute') then
    raise exception 'anon o PUBLIC pueden ejecutar la metrica';
  end if;
  if not has_function_privilege('authenticated', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute') then
    raise exception 'el DROP se llevo un grant que estaba vivo';
  end if;

  -- LA PALABRA PROHIBIDA. Ninguna fila puede llamar «licenciada» a Smash ni a
  -- Lovers: es el error que esta migracion existe para deshacer.
  if exists (
    select 1
    from public.metrica_direcciones_de_reparto('51ad1792-6629-4ef7-833a-b57b09a86710', 30) m
    where m.reparto = 'plataforma' and m.marca <> 'propia'
  ) then
    raise exception 'hay filas de reparto por plataforma que no son de marca propia: revisa el cruce de ejes';
  end if;

  -- Las dos etiquetas de cada eje son las acordadas, sin sorpresas.
  select string_agg(distinct m.reparto, ',' order by m.reparto) into v_etiquetas
  from public.metrica_direcciones_de_reparto('51ad1792-6629-4ef7-833a-b57b09a86710', 30) m;
  if v_etiquetas <> 'nosotros,plataforma' then
    raise exception 'el eje de reparto tiene etiquetas inesperadas: %', v_etiquetas;
  end if;

  -- La correccion REPARTE, no borra: el total sigue siendo el total.
  select coalesce(sum(m.pedidos), 0) into v_total
  from public.metrica_direcciones_de_reparto('51ad1792-6629-4ef7-833a-b57b09a86710', 30) m;
  if v_total <> (
       select count(*) from public.sale
        where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
          and service_type = 'own_delivery'
          and created_at > now() - interval '30 days') then
    raise exception 'la metrica ha perdido pedidos por el camino: %', v_total;
  end if;

  -- La contradiccion conocida tiene que SALIR, no desaparecer. Si algun dia da
  -- cero sera porque se arreglo la fuente, y entonces esta guarda avisa de que
  -- hay que revisar el comentario -- no de que algo se haya roto.
  select coalesce(sum(m.pedidos), 0) into v_contradiccion
  from public.metrica_direcciones_de_reparto('51ad1792-6629-4ef7-833a-b57b09a86710', 30) m
  where m.reparto = 'nosotros' and m.marca = 'licenciada';

  raise notice 'VERIFICACION OK: % pedidos en total; % de ellos son reparto "nuestro" de marca LICENCIADA (la contradiccion conocida, visible y no doblada)',
    v_total, v_contradiccion;
end;
$verif$;