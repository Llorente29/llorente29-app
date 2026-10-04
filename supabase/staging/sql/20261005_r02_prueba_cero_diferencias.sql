-- ============================================================================
-- SOLO STAGING-CONTA · R02 · LA FOTO DE DESPUÉS Y LA COMPARACIÓN (2/2)
-- ----------------------------------------------------------------------------
-- Va después de los ficheros 20261005T0100…T0130. Hace EXACTAMENTE la misma
-- simulación que 20261005_r02_foto_antes.sql (la misma función, los mismos
-- casos, la misma clasificación: regla 31) y compara.
--
-- LO QUE TIENE QUE SALIR
--   · HubRise: 0 diferencias en «quién reparte», en todas las marcas,
--     plataformas y locales, con y sin dirección.
--   · Last: lo que el encargo cambia A PROPÓSITO (respuesta 1, punto 2: «la
--     regla nueva se aplica también a esos pedidos»): si Last manda una
--     modalidad que no es la de «Quién reparte», ahora manda «Quién reparte».
--     Esas diferencias se cuentan y se listan por separado; cualquier otra es
--     un fallo.
--   · Además, en las dos entradas: el service_type con el que queda el pedido
--     es exactamente el de resolve_delivery_by.
-- Si algo no cuadra, el fichero acaba en error y el workflow sale en rojo.
-- ============================================================================

delete from r02_prueba.foto where momento = 'despues';

with celdas as (
  select b.account_id, b.id as brand_id, b.name as marca, coalesce(b.ownership_type, 'own') as tipo,
         sc.id as channel_id, sc.slug as canal, l.id as location_id
    from public.brand b
    join public.sales_channel sc on sc.account_id = b.account_id and sc.channel_type = 'delivery'
                                and coalesce(btrim(sc.slug), '') <> ''
    join public.locations l on l.account_id = b.account_id
),
casos as (
  -- HubRise: el MISMO valor de entrada que en la foto de antes (el del webhook
  -- de hoy). El disparador de entrada tiene que corregirlo si hace falta.
  select c.*, 'hubrise'::text as entrada,
         coalesce((select pol.service_type from public.channel_delivery_policy pol
                    where pol.account_id = c.account_id and pol.channel_slug = c.canal
                      and pol.ownership_type = c.tipo and pol.location_id is null),
                  'platform_delivery') as st_entrada
    from celdas c
  union all
  select c.*, 'lastapp', st from celdas c cross join (values ('own_delivery'), ('platform_delivery')) v(st)
)
insert into r02_prueba.foto
select 'despues', k.account_id, k.brand_id, k.marca, k.canal, k.location_id, k.entrada, k.st_entrada, d.con_dir,
       s.st_final, s.carrier, s.reason,
       case when s.st_final = 'own_delivery' and s.carrier is not null then 'own'
            when s.st_final = 'own_delivery' and not d.con_dir then 'own_sin_dir'
            else 'platform' end
  from casos k
 cross join (values (true), (false)) d(con_dir)
 cross join lateral r02_prueba.simular(k.account_id, k.brand_id, k.channel_id, k.location_id,
                                       k.entrada, k.st_entrada, d.con_dir) s;

create temp table r02_comparacion on commit drop as
select a.marca, a.canal, l.name as local, a.entrada, a.st_entrada, a.con_dir,
       a.quien as antes, d.quien as despues,
       d.st_final, r.delivery_by as resolucion, r.source as origen
  from r02_prueba.foto a
  join r02_prueba.foto d
    on d.momento = 'despues' and d.brand_id = a.brand_id and d.canal = a.canal
   and d.location_id = a.location_id and d.entrada = a.entrada
   and d.st_entrada = a.st_entrada and d.con_dir = a.con_dir
  join public.locations l on l.id = a.location_id
 cross join lateral public.resolve_delivery_by(a.account_id, a.brand_id, a.canal, a.location_id) r
 where a.momento = 'antes';

\echo '== Resumen'
select entrada,
       count(*) as casos,
       count(*) filter (where antes = despues) as iguales,
       count(*) filter (where antes <> despues) as distintos,
       count(*) filter (where st_final <> case resolucion when 'own' then 'own_delivery' else 'platform_delivery' end)
         as service_type_distinto_de_la_resolucion
  from r02_comparacion
 group by entrada order by entrada;

\echo '== Diferencias (todas). En HubRise tiene que salir vacío.'
select entrada, local, marca, canal, st_entrada, con_dir, antes, despues, resolucion, origen
  from r02_comparacion
 where antes <> despues
 order by entrada, local, marca, canal, st_entrada, con_dir;

do $$
declare
  v_hub   int;
  v_st    int;
  v_last  int;
  v_total int;
begin
  select count(*) into v_total from r02_comparacion;
  select count(*) into v_hub  from r02_comparacion where entrada = 'hubrise' and antes <> despues;
  select count(*) into v_st   from r02_comparacion
   where st_final <> case resolucion when 'own' then 'own_delivery' else 'platform_delivery' end;
  -- En Last solo puede cambiar lo que Last mandaba distinto de la resolución.
  select count(*) into v_last from r02_comparacion
   where entrada = 'lastapp' and antes <> despues
     and st_entrada = case resolucion when 'own' then 'own_delivery' else 'platform_delivery' end;
  if v_total = 0 then raise exception 'R02: la comparación no tiene casos: no se ha medido nada'; end if;
  if v_hub > 0 then raise exception 'R02: % diferencias en HubRise (tienen que ser 0)', v_hub; end if;
  if v_st > 0 then raise exception 'R02: % pedidos con un service_type distinto de la resolución', v_st; end if;
  if v_last > 0 then raise exception 'R02: % diferencias en Last que no son a propósito', v_last; end if;
  raise notice 'R02 · 0 diferencias en HubRise sobre % casos; el service_type sale de la resolución en todos.', v_total;
end $$;
