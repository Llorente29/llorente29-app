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
-- El primer carril libre de 1 a :max (0 si no queda ninguno).
select 'carril ' || coalesce((select n from generate_series(1, :max) n where pg_try_advisory_lock(4203, n) limit 1), 0);
-- Y aquí se queda: carril.sh le añade latido.sql, tramos de 20 s durante
-- dos horas. A tramos y no de un tirón porque, con el pooler de Supabase, si
-- el cliente muere la consulta en marcha SIGUE en el servidor (medido el 16/10:
-- un pg_sleep(7200) huérfano con los cerrojos cogidos); con tramos, como mucho
-- uno.
