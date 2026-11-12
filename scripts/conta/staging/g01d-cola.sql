-- scripts/conta/staging/g01d-cola.sql
--
-- G01d · Lo que ha pasado con los avisos de la cuenta de pruebas, SOLO LEE.
-- Solo ids y palabras del CRM o de GoCardless: ningún dato de cliente (T11).
-- Uso: psql "$DB_URL" -X -A -v cuenta=<uuid> -f este-fichero

select 'conexiones' as que,
  concat_ws(' · ',
    (select 'CRM: ' || case when c.aviso_encendido then 'encendido' else 'apagado' end || ', código ' || case when c.aviso_ref is null then 'no' else 'sí' end
            || ', último aviso ' || coalesce(to_char(c.aviso_ultimo_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS'), '—')
            || ', empresas leídas ' || coalesce(c.empresas_leidas::text, '—')
       from public.conta_crm c where c.account_id = :'cuenta'::uuid and c.crm = 'bitrix24'),
    (select 'GoCardless: ' || case when g.aviso_encendido then 'encendido' else 'apagado' end || ', secreto ' || case when g.aviso_ref is null then 'no' else 'sí' end
            || ', último aviso ' || coalesce(to_char(g.aviso_ultimo_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS'), '—')
            || ', mandatos activos ' || coalesce(g.mandatos_vivos::text, '—') || ', líneas activas ' || coalesce(g.lineas_activas::text, '—')
       from public.conta_cobro_gocardless g where g.account_id = :'cuenta'::uuid limit 1)) as detalle
union all
select 'avisos por estado', coalesce((select string_agg(origen || ' ' || estado || ' ' || n, ', ' order by origen, estado)
  from (select origen, estado, count(*) n from public.conta_aviso where account_id = :'cuenta'::uuid group by 1, 2) q), '—')
union all
select 'últimos avisos', coalesce((select string_agg(linea, E'\n' order by recibido_at desc) from (
  select recibido_at, to_char(recibido_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS') || ' · ' || origen || ' · ' || estado
         || ' · ' || coalesce(accion, recurso, '—') || ' ' || coalesce(tipo_ficha, '') || ' ' || coalesce(id_externo, '')
         || coalesce(' · ' || porque, '') || ' · intentos ' || intentos as linea
    from public.conta_aviso where account_id = :'cuenta'::uuid order by recibido_at desc limit 20) q), '—')
union all
select 'lecturas «por aviso»', coalesce((select string_agg(to_char(empezada_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS') || ' · ' || origen || ' · ' || coalesce(estado, 'en marcha')
         || ' · ' || coalesce(nuevos, 0) || '/' || coalesce(cambiados, 0) || '/' || coalesce(iguales, 0), E'\n' order by empezada_at desc)
  from (select * from public.conta_gestoria_lectura where account_id = :'cuenta'::uuid and por = 'aviso' order by empezada_at desc limit 10) q), '—')
union all
select 'clientes / fichas / pendientes de revisar', concat_ws(' / ',
  (select count(*) from public.conta_gestoria_cliente where account_id = :'cuenta'::uuid),
  (select count(*) from public.conta_gestoria_ficha where account_id = :'cuenta'::uuid),
  (select count(*) from public.conta_gestoria_diferencia where account_id = :'cuenta'::uuid and vigente));
