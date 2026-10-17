-- scripts/e2e/carril/guardian_e2e.sql — lo corre carril.sh coger en segundo
-- plano y se queda dormido: mientras viva esta conexión, la e2e tiene su carril
-- y nadie migra staging. Cada línea que escribe la lee carril.sh.
-- Supavisor no pasa el application_name: se pone aquí, para saber de quién es.
set application_name = :'quien';
set statement_timeout = 0;
set lock_timeout = :'espera';
-- El proceso en el servidor: carril.sh lo termina al soltar (ver el final).
select 'pid ' || pg_backend_pid();
select 'migrar-espera';
-- Compartido: entran todas las e2e a la vez; quien migra (exclusivo) espera a
-- que acaben, y mientras espera no entra ninguna nueva.
select pg_advisory_lock_shared(4202, 0);
select 'migrar-libre';
-- El primer carril libre de 1 a :max. Si están todos cogidos, ESPERA su turno
-- (cada 15 s, hasta :'espera') en vez de fallar: con el tope bajo (2 en la
-- Micro, W02 17/10) el tercer trozo espera a que acabe uno, no cae en rojo.
-- 0 solo si se acaba la espera. Escribe «carril-espera» la primera vez que no
-- hay ninguno, para que el log diga que estuvo en cola.
create function pg_temp.coger_carril(p_max int, p_espera interval) returns int
language plpgsql as $f$
declare n int; hasta timestamptz := clock_timestamp() + p_espera;
begin
  loop
    select c into n from generate_series(1, p_max) c where pg_try_advisory_lock(4203, c) limit 1;
    if n is not null then return n; end if;
    if clock_timestamp() >= hasta then return 0; end if;
    perform pg_sleep(15);
  end loop;
end $f$;
select 'carril-espera ' || :max where not exists (
  select 1 from generate_series(1, :max) c
   where not exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.classid = 4203 and l.objid = c and l.granted));
select 'carril ' || pg_temp.coger_carril(:max, :'espera');
-- Y aquí se queda: carril.sh le añade latido.sql, tramos de 20 s durante
-- dos horas. A tramos y no de un tirón porque, con el pooler de Supabase, si
-- el cliente muere la consulta en marcha SIGUE en el servidor (medido el 16/10:
-- un pg_sleep(7200) huérfano con los cerrojos cogidos); con tramos, como mucho
-- uno.
