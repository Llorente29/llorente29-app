-- scripts/e2e/carril/guardian_migrar.sql — lo corre carril.sh migrar-coger
-- (aplicar-staging-conta) en segundo plano: espera a que acaben las e2e de
-- carril que están tocando staging y, mientras viva, no deja empezar ninguna.
-- Supavisor no pasa el application_name: se pone aquí, para saber de quién es.
set application_name = :'quien';
set statement_timeout = 0;
set lock_timeout = :'espera';
-- El proceso en el servidor: carril.sh lo termina al soltar (ver el final).
select 'pid ' || pg_backend_pid();
select 'migrar-espera';
select pg_advisory_lock(4202, 0);
select 'migrar-cogido';
-- Y aquí se queda: carril.sh le añade latido.sql, tramos de 20 s durante
-- dos horas. A tramos y no de un tirón porque, con el pooler de Supabase, si
-- el cliente muere la consulta en marcha SIGUE en el servidor (medido el 16/10:
-- un pg_sleep(7200) huérfano con los cerrojos cogidos); con tramos, como mucho
-- uno.
