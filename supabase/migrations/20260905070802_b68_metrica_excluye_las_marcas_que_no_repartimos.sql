-- B68 §3 (05/09/2026). El denominador estaba sucio, y la conclusion invertida.
--
-- LO QUE CAZO JULIO. La metrica contaba como «reparto propio» pedidos de marcas
-- LICENCIADAS a terceros: reparto de plataforma mal clasificado en su dia, ya
-- corregido en el origen desde el 01/09 23:11 (desde entonces entran como
-- platform_delivery). Pero los 30 dias hacia atras siguen dentro, y con ellos la
-- metrica canta una tasa de fallo que no es de nadie -- el mismo error de la
-- regla 9, esta vez por marca en vez de por cuenta.
--
-- MEDIDO HOY, 30 dias, cuenta Foodint (51ad1792-6629-4ef7-833a-b57b09a86710):
--
--   marca                    own_delivery_enabled   pedidos   sin direccion
--   Smash Brothers Burgers   false                       35              21
--   Lovers Burgers           false                        2               2
--   ---- las otras 9 marcas  NULL                       390               4
--   TOTAL                                               427              27
--
-- O sea: 27 de 427 (6,3 %) se convierte en 4 de 390 (1,0 %) en cuanto se saca
-- lo que no es reparto nuestro. 23 de las 27 «direcciones que faltan» eran de
-- pedidos que no repartimos.
--
-- ── POR QUE NO SE BORRAN LAS FILAS, SE ETIQUETAN (regla 7) ──────────────────
-- El encargo decia «excluir». Excluir a secas las haria DESAPARECER, y entonces
-- la metrica callaria que existen 23 pedidos mal clasificados. Regla 7: un
-- umbral (o aqui un criterio) ORDENA y ETIQUETA, no decide la EXISTENCIA de la
-- fila. Asi que la funcion gana una columna `marca_reparte` y AGRUPA por ella:
-- las licenciadas siguen saliendo, marcadas como lo que son, y la tasa de
-- Foodint se lee en las filas con marca_reparte = true. Nada se esconde y el
-- numero deja de mentir.
--
-- ── LA DEBILIDAD DE LA GUARDA, DICHA EN ALTO ───────────────────────────────
-- `brand.own_delivery_enabled` esta puesta en 2 marcas DE 18; las otras 16 son
-- NULL. Aqui NULL se lee como «si repartimos», que hoy es cierto, pero significa
-- que la guarda se apoya en una columna que casi nadie rellena: si manana entra
-- otra marca licenciada sin ese flag a false, la metrica vuelve a ensuciarse EN
-- SILENCIO. La fuente robusta seria channel_delivery_policy (own -> own_delivery,
-- licensed -> platform_delivery), que hoy si esta completa para los 3 canales.
-- No se cambia aqui porque el encargo nombra own_delivery_enabled y porque
-- cambiar la fuente de la verdad no es un arreglo de metrica. Queda anotado.
--
-- ── DROP + CREATE, NO REPLACE (regla 2) ────────────────────────────────────
-- Cambia el tipo de retorno (columna nueva), y Postgres no deja hacerlo con
-- REPLACE. Se rehacen los grants a mano DESPUES, porque un DROP se los lleva:
-- vivos hoy son authenticated y service_role; anon y PUBLIC NO.
--
-- Nadie la consume todavia: 0 referencias en src/. Cambiar su forma no rompe
-- ninguna pantalla.

drop function if exists public.metrica_direcciones_de_reparto(uuid, integer);

create function public.metrica_direcciones_de_reparto(p_account_id uuid, p_dias integer default 30)
returns table(
  marca_reparte       boolean,
  pasarela            text,
  canal               text,
  reparto_propio      bigint,
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
      -- NULL = «no se ha declarado» = si repartimos. Ver la nota de arriba:
      -- solo 2 marcas de 18 tienen esta columna puesta, y las dos a false.
      coalesce(b.own_delivery_enabled, true) as marca_reparte,
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
    b.marca_reparte,
    b.pasarela,
    b.canal,
    count(*),
    count(*) filter (where b.sin_dir),
    round(100.0 * count(*) filter (where b.sin_dir) / nullif(count(*), 0), 1),
    count(*) filter (where b.sin_dir and coalesce(b.lat_delivery, b.lat_customer) is not null),
    count(*) filter (where b.lat_delivery is not null),
    count(*) filter (where b.lat_customer is not null)
  from base b
  group by b.marca_reparte, b.pasarela, b.canal
  -- Lo nuestro primero; dentro, lo que mas falla arriba. El criterio ORDENA.
  order by b.marca_reparte desc,
           count(*) filter (where b.sin_dir) desc,
           count(*) desc;
end;
$function$;

comment on function public.metrica_direcciones_de_reparto(uuid, integer) is
  'Direcciones que faltan en pedidos marcados own_delivery, por pasarela y canal. `marca_reparte` = false son marcas LICENCIADAS (brand.own_delivery_enabled = false): reparto de plataforma mal clasificado antes del 01/09 23:11. No se excluyen, se etiquetan (regla 7): la tasa de Foodint se lee en las filas true.';

revoke all on function public.metrica_direcciones_de_reparto(uuid, integer) from public;
revoke all on function public.metrica_direcciones_de_reparto(uuid, integer) from anon;
grant execute on function public.metrica_direcciones_de_reparto(uuid, integer) to authenticated, service_role;

-- ── Verificacion ───────────────────────────────────────────────────────────
do $verif$
declare
  v_firmas int;
  v_true_ped bigint; v_true_sin bigint;
  v_false_ped bigint; v_false_sin bigint;
begin
  -- Regla 2: el DROP + CREATE no puede haber dejado dos firmas.
  select count(*) into v_firmas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'metrica_direcciones_de_reparto';
  if v_firmas <> 1 then
    raise exception 'metrica_direcciones_de_reparto tiene % firmas (regla 2)', v_firmas;
  end if;

  -- Los permisos, al MOTOR, no al texto del ACL (regla 16).
  if has_function_privilege('anon', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute') then
    raise exception 'anon puede ejecutar la metrica';
  end if;
  if has_function_privilege('public', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute') then
    raise exception 'PUBLIC puede ejecutar la metrica';
  end if;
  if not has_function_privilege('authenticated', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.metrica_direcciones_de_reparto(uuid,integer)', 'execute') then
    raise exception 'el DROP se llevo un grant que estaba vivo';
  end if;

  -- El contenido, con la cuenta explicita (regla 9).
  select coalesce(sum(reparto_propio),0), coalesce(sum(sin_direccion),0)
    into v_true_ped, v_true_sin
  from public.metrica_direcciones_de_reparto('51ad1792-6629-4ef7-833a-b57b09a86710', 30)
  where marca_reparte;

  select coalesce(sum(reparto_propio),0), coalesce(sum(sin_direccion),0)
    into v_false_ped, v_false_sin
  from public.metrica_direcciones_de_reparto('51ad1792-6629-4ef7-833a-b57b09a86710', 30)
  where not marca_reparte;

  -- Las licenciadas SIGUEN SALIENDO. Si esto da 0 es que se han escondido, que
  -- es justo lo que la regla 7 prohibe.
  if v_false_ped = 0 then
    raise exception 'las marcas licenciadas han desaparecido de la metrica en vez de quedar etiquetadas';
  end if;

  -- Y la suma de las dos poblaciones tiene que ser el total de antes: la
  -- correccion reparte, no borra.
  if v_true_ped + v_false_ped <> (
       select count(*) from public.sale
        where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
          and service_type = 'own_delivery'
          and created_at > now() - interval '30 days') then
    raise exception 'la metrica ha perdido pedidos por el camino: % + % no es el total',
      v_true_ped, v_false_ped;
  end if;

  raise notice 'VERIFICACION OK: reparto nuestro % pedidos / % sin direccion; licenciadas % / % (etiquetadas, no borradas)',
    v_true_ped, v_true_sin, v_false_ped, v_false_sin;
end;
$verif$;
