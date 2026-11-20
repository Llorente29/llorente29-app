-- scripts/e2e/carril/guardian_e2e.sql — lo corre carril.sh coger en segundo
-- plano y se queda dormido: mientras viva esta conexión, la e2e tiene su carril.
-- Ya no coge la barrera de migrar (4202,0): esa la coge cada fichero de
-- pruebas mientras corre (guardian_barrera.sql; V03, respuesta 6, 26/10).
-- Cada línea que escribe la lee carril.sh.
-- Supavisor no pasa el application_name: se pone aquí, para saber de quién es.
set application_name = :'quien';
set statement_timeout = 0;
set lock_timeout = :'espera';
-- El proceso en el servidor: carril.sh lo termina al soltar (ver el final).
select 'pid ' || pg_backend_pid();
-- El primer carril libre de 1 a :max. Si están todos cogidos, ESPERA su turno
-- (cada 15 s, hasta :'espera') en vez de fallar: con el tope bajo (2 en la
-- Micro, W02 17/10) el tercer trozo espera a que acabe uno, no cae en rojo.
-- 0 solo si se acaba la espera. Escribe «carril-espera» la primera vez que no
-- hay ninguno, para que el log diga que estuvo en cola.
-- N11 (20/11): libre es SIN cerrojo Y sin reserva viva en e2e_carril.carril (reserva_carril.sql):
-- tras un reinicio de staging los cerrojos se pierden, las reservas no. Primero la reserva y solo
-- después el cerrojo (el case lo obliga), para no quedarse con el cerrojo de uno ajeno. Al cogerlo
-- escribe la suya, en la misma llamada: nadie más puede coger ese número mientras tenga el cerrojo.
create function pg_temp.coger_carril(p_max int, p_espera interval, p_id uuid, p_quien text, p_caduca int) returns int
language plpgsql as $f$
declare n int; hasta timestamptz := clock_timestamp() + p_espera;
begin
  loop
    select c into n from generate_series(1, p_max) c
     where case when exists (select 1 from e2e_carril.carril r
                              where r.numero = c and r.latido_at >= clock_timestamp() - make_interval(secs => p_caduca))
                then false else pg_try_advisory_lock(4203, c) end
     limit 1;
    if n is not null then
      insert into e2e_carril.carril (numero, id, quien, desde, latido_at) values (n, p_id, p_quien, clock_timestamp(), clock_timestamp())
        on conflict (numero) do update set id = excluded.id, quien = excluded.quien, desde = excluded.desde, latido_at = excluded.latido_at;
      return n;
    end if;
    if clock_timestamp() >= hasta then return 0; end if;
    perform pg_sleep(15);
  end loop;
end $f$;
select 'carril-espera ' || :max where not exists (
  select 1 from generate_series(1, :max) c
   where not exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.classid = 4203 and l.objid = c and l.granted)
     and not exists (select 1 from e2e_carril.carril r where r.numero = c and r.latido_at >= now() - make_interval(secs => :'caduca_carril'::int)));
select 'carril ' || pg_temp.coger_carril(:max, :'espera', :'id'::uuid, :'dueno', :'caduca_carril'::int);
-- Y aquí se queda: carril.sh le añade latido.sql, tramos de 20 s durante
-- dos horas. A tramos y no de un tirón porque, con el pooler de Supabase, si
-- el cliente muere la consulta en marcha SIGUE en el servidor (medido el 16/10:
-- un pg_sleep(7200) huérfano con los cerrojos cogidos); con tramos, como mucho
-- uno.
