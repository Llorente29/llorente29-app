-- B68 §3, corregido en el momento (05/09/2026).
--
-- LA PRIMERA VERSION NO SE PODIA NI VERIFICAR. Filtraba por
-- `belongs_to_account(s.account_id)`, que sin sesion devuelve false: la funcion
-- devolvia CERO FILAS a cualquiera que no fuera un usuario logueado. Ni un
-- informe, ni un cron, ni yo comprobandola podiamos leer el numero. Una metrica
-- que solo se ve desde el navegador no sirve para decidir si se abre un ticket
-- a HubRise.
--
-- Ahora sigue el patron que ya usa `sales_mapping_reliability` en este mismo
-- proyecto: la cuenta se pasa EXPLICITA y se comprueba el permiso. Regla 9
-- cumplida a la vista, no por efecto lateral.
--
-- DROP + CREATE y no REPLACE, porque cambia la firma (regla 2): un replace
-- dejaria DOS sobrecargas y las llamadas de un argumento pasarian a ser
-- ambiguas.

drop function if exists public.metrica_direcciones_de_reparto(int);

create or replace function public.metrica_direcciones_de_reparto(
  p_account_id uuid,
  p_dias int default 30
)
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
      coalesce(s.source, '(sin source)') as pasarela,
      coalesce(nullif(btrim(s.external_channel_text), ''), '(sin canal)') as canal,
      coalesce(btrim(s.delivery_address), '') = '' as sin_dir,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'delivery'->>'latitude', '') end as lat_delivery,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'customer'->>'latitude', '') end as lat_customer
    from public.sale s
    where s.account_id = p_account_id
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
end;
$function$;

comment on function public.metrica_direcciones_de_reparto(uuid, int) is
  'B68 §3: pedidos de reparto propio por pasarela y canal, cuantos sin delivery_address y cuantos de esos traen coordenadas. SOLO LEE, sin aviso ni umbral. Separa por `source` porque el mismo canal entra por dos puertas distintas: Last.app manda el bloque `delivery`, HubRise no. Dice ademas en QUE campo estan las coordenadas, porque resolve_dispatch solo mira `delivery` y por eso no calcula distancia para ninguno de HubRise.';

revoke all on function public.metrica_direcciones_de_reparto(uuid, int) from public, anon;
grant execute on function public.metrica_direcciones_de_reparto(uuid, int) to authenticated, service_role;

do $verif$
declare v_n int;
begin
  if has_function_privilege('anon','public.metrica_direcciones_de_reparto(uuid,int)','EXECUTE') then
    raise exception 'B68: la metrica esta abierta a anon.';
  end if;
  -- Que no quede la firma vieja creando ambiguedad (regla 2).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='metrica_direcciones_de_reparto';
  if v_n <> 1 then
    raise exception 'B68: hay % firmas de metrica_direcciones_de_reparto; deberia haber 1.', v_n;
  end if;
end
$verif$;
