-- B68 §3 (05/09/2026). El contador que decide si hay caso contra HubRise.
--
-- SOLO LEE. Sin aviso, sin umbral, sin vigia. Con UN caso en dos semanas no hay
-- umbral que calibrar, y un vigia mas hoy seria ruido (regla 23, B62). Cuando
-- haya serie se decide el umbral con datos. Esto solo pone el numero donde se
-- pueda consultar.
--
-- LO QUE MIDE, y por que separado por PASARELA y no solo por canal: el mismo
-- canal «Glovo» entra por dos puertas y se comportan distinto.
--   Last.app  manda el bloque `delivery` con la direccion dentro.
--   HubRise   (Glovo Bridge) NO manda `delivery`, y deja la direccion colgando
--             de `customer.address_1`, que puede venir vacio.
-- Medido a 30 dias en Foodint: Last.app 1 de 247 sin direccion (0,4 %);
-- HubRise 24 de 148 (16,2 %). Esa diferencia ES el caso, y por eso el corte va
-- por `source`.
--
-- DONDE ESTAN LAS COORDENADAS, que no es un detalle: Last.app las pone en
-- `delivery.latitude` y HubRise en `customer.latitude`. Se miran LAS DOS, y la
-- funcion DICE en cual estaban -- porque `resolve_dispatch` hoy solo mira la
-- primera, y por eso no calcula distancia para ni uno de los 148 de HubRise.
--
-- REGLA 9: filtra por cuenta via belongs_to_account. Un recuento sin cuenta no
-- da un numero equivocado, da un numero que no es de nadie.

create or replace function public.metrica_direcciones_de_reparto(p_dias int default 30)
returns table (
  pasarela              text,
  canal                 text,
  reparto_propio        bigint,
  sin_direccion         bigint,
  sin_direccion_pct     numeric,
  con_coordenadas       bigint,
  coords_en_delivery    bigint,
  coords_en_customer    bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select
      coalesce(s.source, '(sin source)') as pasarela,
      coalesce(nullif(btrim(s.external_channel_text), ''), '(sin canal)') as canal,
      coalesce(btrim(s.delivery_address), '') = '' as sin_dir,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'delivery'->>'latitude', '') end as lat_delivery,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'customer'->>'latitude', '') end as lat_customer
    from public.sale s
    where public.belongs_to_account(s.account_id)
      and s.service_type = 'own_delivery'
      and s.created_at > now() - make_interval(days => greatest(1, p_dias))
  )
  select
    b.pasarela,
    b.canal,
    count(*),
    count(*) filter (where b.sin_dir),
    round(100.0 * count(*) filter (where b.sin_dir) / nullif(count(*), 0), 1),
    count(*) filter (where b.sin_dir and coalesce(b.lat_delivery, b.lat_customer) is not null),
    count(*) filter (where b.lat_delivery is not null),
    count(*) filter (where b.lat_customer is not null)
  from base b
  group by b.pasarela, b.canal
  order by count(*) filter (where b.sin_dir) desc, count(*) desc;
$function$;

comment on function public.metrica_direcciones_de_reparto(int) is
  'B68 §3: pedidos de reparto propio por pasarela y canal, cuantos sin delivery_address y cuantos de esos traen coordenadas. Solo lee, sin aviso. Separa por `source` porque el mismo canal entra por dos puertas que se comportan distinto: Last.app manda el bloque `delivery`, HubRise no. Dice tambien en QUE campo estan las coordenadas, porque resolve_dispatch solo mira `delivery`.';

revoke all on function public.metrica_direcciones_de_reparto(int) from public, anon;
grant execute on function public.metrica_direcciones_de_reparto(int) to authenticated, service_role;

do $verif$
begin
  if has_function_privilege('anon','public.metrica_direcciones_de_reparto(int)','EXECUTE') then
    raise exception 'B68: la metrica esta abierta a anon.';
  end if;
end
$verif$;
