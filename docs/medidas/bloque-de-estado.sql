-- docs/medidas/bloque-de-estado.sql
--
-- EL BLOQUE DE ESTADO DE UN PARTE SALE DE AQUÍ, NO DE LA MEMORIA · 15/09/2026
--
-- Por qué existe este fichero, dicho sin adornos: cuatro veces en dos días he
-- escrito en un parte una línea de estado que NO había medido --la hora en
-- Madrid, el paquete de las tablets, en qué rama estaba el commit, y hoy
-- «`pase_activo` en false en los siete locales» cuando llevaba encendido en
-- Alcalá desde las 09:10--. Las cuatro las cazó otro. El fallo no es de
-- conocimiento: es de procedimiento --arrastrar la línea del parte anterior en
-- vez de volver a medirla--, y un procedimiento se arregla con una consulta,
-- no con buena intención.
--
-- SE EJECUTA ENTERA Y SE PEGA. Las dos cifras de git no salen de aquí, salen
-- de `bloque-de-estado.sh`, que es el otro lado del mismo bloque.
--
-- ⚠️ TODO LLEVA CUENTA (regla 9). La cuenta plantilla tiene locales con los
-- MISMOS NOMBRES que producción --«Foodint Alcalá» existe dos veces-- y una
-- consulta sin `account_id` los suma. Comprobado hoy en este mismo fichero:
-- agrupando sólo por nombre salían «dos estaciones de salida por local», y son
-- una por local en dos cuentas distintas.

with el_pase as (
  select
    1 as n,
    'PASE · ' || l.name || ' (' ||
      case when l.account_id = '00000000-0000-0000-0000-000000000001'
           then 'PLANTILLA' else left(l.account_id::text, 8) end || ')' as que,
    case when k.pase_activo then 'ENCENDIDO' else 'apagado' end ||
    coalesce(' · ' || to_char(k.pase_activo_at at time zone 'Europe/Madrid',
                              'DD/MM HH24:MI') || ' Madrid', '') ||
    coalesce(' · desde ' || k.pase_activo_desde, '') ||
    coalesce(' · por ' || left(k.pase_activo_por::text, 8), '') ||
    coalesce(' · motivo «' || k.pase_apagado_motivo || '»', '') as valor
  from kitchen_time_config k
  join locations l on l.id = k.location_id
),
la_migracion as (
  select 2 as n, 'ÚLTIMA MIGRACIÓN REGISTRADA' as que,
         version || ' · ' || name as valor
  from supabase_migrations.schema_migrations
  order by version desc limit 1
),
las_tablets as (
  -- Sólo las ACTIVAS: una tablet apagada sin paquete no es una tablet
  -- atrasada. Y el minuto de la última señal va al lado, porque un paquete
  -- viejo con señal de hace dos días no es lo mismo que uno con señal de hace
  -- un minuto.
  select 3 as n,
         'TABLET · ' || l.name || ' · ' || d.label as que,
         'paquete ' || coalesce(d.bundle_applied::text, 'ninguno') ||
         coalesce(' · aplicado ' || to_char(d.bundle_applied_at at time zone 'Europe/Madrid',
                                            'DD/MM HH24:MI'), '') ||
         ' · última señal hace ' ||
         coalesce(extract(epoch from (now() - d.last_seen_at))::int / 60 || ' min', 'NUNCA') as valor
  from kds_device d
  join locations l on l.id = d.location_id
  where d.is_active
),
el_reloj as (
  select 0 as n, 'AHORA, EN MADRID' as que,
         to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') ||
         case when (now() at time zone 'Europe/Madrid')::time between '12:15' and '23:45'
              then '  ⚠️ EN BANDA DE SERVICIO' else '  (fuera de banda)' end as valor
  from generate_series(1,1)
)
select que, valor from (
  select * from el_reloj
  union all select * from el_pase
  union all select * from la_migracion
  union all select * from las_tablets
) t
order by n, que;
