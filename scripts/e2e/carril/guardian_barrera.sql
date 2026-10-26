-- scripts/e2e/carril/guardian_barrera.sql — lo corre carril.sh barrera-entrar
-- en segundo plano, una vez por fichero de pruebas (y para el clon): mientras
-- viva esta conexión, nadie aplica nada a staging. Lo mata barrera-salir al
-- acabar el fichero. Cada línea que escribe la lee carril.sh.
-- Supavisor no pasa el application_name: se pone aquí, para saber de quién es.
set application_name = :'quien';
set statement_timeout = 0;
-- Lo que espera, como mucho, a que acabe de aplicarse algo (CARRIL_BARRERA_MIN).
set lock_timeout = :'espera';
-- El proceso en el servidor: carril.sh lo termina al salir.
select 'pid ' || pg_backend_pid();
select 'barrera-espera';
-- Compartido: entran todos los ficheros a la vez, de todas las e2e; quien
-- migra (exclusivo, guardian_migrar.sql) espera a que acaben los que están
-- corriendo, y mientras espera no empieza ninguno nuevo. Como mucho espera lo
-- que dura el fichero más largo, no una e2e entera.
select pg_advisory_lock_shared(4202, 0);
select 'dentro';
-- Y aquí se queda: carril.sh le añade latido.sql, tramos de 20 s. A tramos y
-- no de un tirón porque, con el pooler de Supabase, si el cliente muere la
-- consulta en marcha SIGUE en el servidor (medido el 16/10).
