-- scripts/e2e/carril/reserva_carril.sql — de quién es cada carril, en una TABLA con latido
-- (N11, 20/11). Lo corre carril.sh en llamadas cortas, una transacción cada una.
--
-- POR QUÉ. Hasta hoy un carril era SOLO el cerrojo consultivo (4203, N) que sujeta la conexión
-- del guardián. Si staging se reinicia, mueren todas las conexiones y con ellas los cerrojos,
-- pero las pruebas siguen corriendo en su carril. La noche del 19/11 staging se reinició a las
-- 22:22 («the database system is starting up»): el carril 1 de la entera de r08 (44615857390)
-- se quedó sin dueño, a las 22:32 lo cogió la e2e de x10d (44629118563), lo borró (25417 filas)
-- y desde ahí ningún usuario del carril 1 entraba («HTTP 400»): una docena de ficheros en rojo.
--
-- AHORA. El carril es de quien tiene su fila viva en e2e_carril.carril: la escribe el guardián
-- al cogerlo y carril.sh la renueva cada CARRIL_LATIDO_S desde un proceso aparte, con llamadas
-- cortas que sobreviven a un reinicio. Si el job muere, deja de latir y caduca sola
-- (CARRIL_RESERVA_CADUCA_S, 300 s): un reinicio de un minuto no la tira. El cerrojo (4203, N)
-- se queda, para que las ramas de antes (que solo miran el cerrojo) sigan viéndolo cogido.
--
-- Parámetros: :'op' (preparar | latir | salir | mio | quien), :'id' (uuid de la reserva),
-- :'numero', :'quien', :'caduca' (segundos).

begin;
-- Guarda: al otro lado no hay producción (producción tiene siempre las dos).
do $$ begin
  if to_regclass('public.accounts') is not null
     and exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Carril ABORTADO: al otro lado hay cuentas de producción (Foodint o Folvy Interno).';
  end if;
end $$;
-- La tabla, la primera vez (después, nada: ni cerrojos de catálogo).
do $$ begin
  if to_regclass('e2e_carril.carril') is null then
    create schema if not exists e2e_carril;
    create table e2e_carril.carril (
      numero     int primary key,
      id         uuid not null,
      quien      text not null,
      desde      timestamptz not null default now(),
      latido_at  timestamptz not null default now()
    );
    comment on table e2e_carril.carril is
      'SOLO STAGING. De quién es cada carril de las e2e: una reserva con latido (scripts/e2e/carril/reserva_carril.sql). Una que no late ya no cuenta.';
  end if;
end $$;

\if :{?op}
\else
\set op quien
\endif
select :'op' = 'latir' as es_latir, :'op' = 'salir' as es_salir, :'op' = 'mio' as es_mio, :'op' = 'quien' as es_quien \gset

\if :es_latir
-- La suya, renovada. Si ya no está (caducó: un corte de más de :caduca s), la recupera solo si
-- nadie la ha cogido entretanto; si la tiene otro, lo dice: «perdido».
with renovada as (
  update e2e_carril.carril set latido_at = now() where numero = :'numero'::int and id = :'id'::uuid returning 1
), recuperada as (
  insert into e2e_carril.carril (numero, id, quien)
  select :'numero'::int, :'id'::uuid, :'quien' where not exists (select 1 from renovada)
  on conflict (numero) do update set id = excluded.id, quien = excluded.quien, desde = now(), latido_at = now()
   where e2e_carril.carril.latido_at < now() - make_interval(secs => :'caduca'::int)
  returning 1
)
select case when exists (select 1 from renovada) then 'latido'
            when exists (select 1 from recuperada) then 'recuperado'
            else 'perdido ' || coalesce((select quien from e2e_carril.carril where numero = :'numero'::int), '?') end;
\elif :es_salir
delete from e2e_carril.carril where numero = :'numero'::int and id = :'id'::uuid;
\elif :es_mio
-- ¿Sigue siendo suyo? mio | ajeno <quién> | libre (caducada y nadie la ha cogido).
select coalesce((select case when id = :'id'::uuid then 'mio' else 'ajeno ' || quien end
                   from e2e_carril.carril
                  where numero = :'numero'::int
                    and (id = :'id'::uuid or latido_at >= now() - make_interval(secs => :'caduca'::int))), 'libre');
\elif :es_quien
select 'hay ' || coalesce(string_agg('carril ' || numero || ': ' || quien || ' · latido hace '
                                     || extract(epoch from now() - latido_at)::int || ' s', ' | ' order by numero), 'nadie')
  from e2e_carril.carril where latido_at >= now() - make_interval(secs => :'caduca'::int);
\endif
commit;
