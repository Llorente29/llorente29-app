-- scripts/e2e/carril/barrera.sql — la barrera de staging como RESERVA con latido
-- (Respuesta 4 al V04, 27/10). Lo corre carril.sh en llamadas cortas (una
-- transacción cada una): ninguna conexión se queda abierta sujetando nada.
--
-- POR QUÉ. Hasta hoy la barrera era un cerrojo consultivo (4202, 0) sujeto por
-- un psql en segundo plano. Con el pooler de Supabase, la sesión puede seguir
-- viva en el servidor cuando el cliente ya ha muerto, o morir sin decir nada;
-- y quien esperaba veía «La tienen: nadie». La noche del 27/10 (entera 969) el
-- guardián de d01/plataforma no se pudo terminar en el servidor y los dos
-- ficheros siguientes se quedaron sin barrera.
--
-- AHORA. Cada fichero (y el clon, y el borrado) reserva «lee»; quien aplica a
-- staging reserva «migra». La reserva tiene un LATIDO: carril.sh lo renueva
-- cada 15 s desde un proceso aparte. Si ese proceso muere, la reserva caduca
-- sola (CADUCA, 60 s por defecto) y la siguiente entra. Quien espera ve siempre
-- quién la tiene: está en la tabla, con su latido.
--   · «lee» entra si no hay ningún «migra» vivo (ni dentro ni esperando: no se
--     cuela nadie delante de quien quiere aplicar).
--   · «migra» entra si no hay ningún «lee» dentro ni otro «migra» dentro, y es
--     el «migra» más antiguo que espera.
-- Las operaciones van en fila (pg_advisory_xact_lock(4202, 1), solo mientras
-- dura la transacción): dos que entran a la vez no se cuelan entre sí.
--
-- Parámetros: :'op' (entrar | latir | salir | quien), :'id' (uuid de la reserva),
-- :'quien', :'modo' (lee | migra), :'caduca' (segundos).

begin;
select pg_advisory_xact_lock(4202, 1);
-- Guarda: al otro lado no hay producción (producción tiene siempre las dos).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'public') and to_regclass('public.accounts') is not null
     and exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Barrera ABORTADA: al otro lado hay cuentas de producción (Foodint o Folvy Interno).';
  end if;
end $$;
-- La tabla, la primera vez (después, nada: ni cerrojos de catálogo).
do $$ begin
  if to_regclass('e2e_carril.barrera') is null then
    create schema if not exists e2e_carril;
    create table e2e_carril.barrera (
      id         uuid primary key,
      quien      text not null,
      modo       text not null check (modo in ('lee', 'migra')),
      estado     text not null check (estado in ('espera', 'dentro')),
      desde      timestamptz not null default now(),
      latido_at  timestamptz not null default now()
    );
    comment on table e2e_carril.barrera is
      'SOLO STAGING. La barrera de las e2e: reservas con latido (scripts/e2e/carril/barrera.sql). Una reserva que no late ya no cuenta.';
  end if;
end $$;

-- Lo que no late, no cuenta: se quita.
delete from e2e_carril.barrera where latido_at < now() - make_interval(secs => :'caduca'::int);

\if :{?op}
\else
\set op quien
\endif

select :'op' = 'entrar' as es_entrar, :'op' = 'latir' as es_latir, :'op' = 'salir' as es_salir \gset
\if :es_entrar
insert into e2e_carril.barrera (id, quien, modo, estado) values (:'id'::uuid, :'quien', :'modo', 'espera')
  on conflict (id) do update set latido_at = now();
update e2e_carril.barrera b set estado = 'dentro', latido_at = now()
 where b.id = :'id'::uuid and b.estado = 'espera'
   and case b.modo
         when 'lee' then not exists (select 1 from e2e_carril.barrera m where m.modo = 'migra')
         else not exists (select 1 from e2e_carril.barrera o where o.id <> b.id and (o.estado = 'dentro'))
              and not exists (select 1 from e2e_carril.barrera o where o.id <> b.id and o.modo = 'migra' and o.estado = 'espera'
                                and (o.desde, o.id) < (b.desde, b.id))
       end;
select 'estado ' || estado from e2e_carril.barrera where id = :'id'::uuid;
\elif :es_latir
update e2e_carril.barrera set latido_at = now() where id = :'id'::uuid;
\elif :es_salir
delete from e2e_carril.barrera where id = :'id'::uuid;
\endif
-- Siempre: quién la tiene y quién espera (lo lee carril.sh para decirlo).
select 'hay ' || coalesce(string_agg(quien || ' · ' || modo || case when estado = 'espera' then ' (esperando)' else '' end
                                      || ' · latido hace ' || extract(epoch from now() - latido_at)::int || ' s', ' | ' order by desde), 'nadie')
  from e2e_carril.barrera where id <> coalesce(nullif(:'id', ''), '00000000-0000-0000-0000-000000000000')::uuid;
commit;
