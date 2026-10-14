-- scripts/conta/produccion/cuentas/diez-pdf-pendiente.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE LA RESPUESTA 7 (20261111T0700 y 0710),
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES (conta_diez_autorizo aún no existe: se mira con
-- to_regclass y se cuenta por query_to_xml solo si existe) y DESPUÉS de
-- deshacerla: tiene que salir igual que antes.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): external_send y account_connector
-- se cuentan enteras (hoy, 0 envíos y 0 conexiones de Diez en producción); lo
-- de Foodint, con su account_id.
select clave, valor from (
  select 1 o, 'envíos a Diez (external_send, tabla entera)' clave, (select count(*) from public.external_send)::text valor union all
  select 2, 'envíos con el PDF pendiente en Diez', (select count(*) from public.external_send where document_status::text = 'pendiente_diez')::text union all
  select 3, 'restricción de document_status', (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.external_send'::regclass and conname = 'external_send_document_status_check') union all
  select 4, 'columnas document_attached_* en external_send', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'external_send' and column_name like 'document\_attached\_%')::text union all
  select 5, 'tabla conta_diez_autorizo', (to_regclass('public.conta_diez_autorizo') is not null)::text union all
  select 6, 'autorizaciones de Foodint para Diez real', case when to_regclass('public.conta_diez_autorizo') is null then 'sin tabla'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_diez_autorizo where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 7, 'función conta_diez_adjunto_a_mano', (to_regprocedure('public.conta_diez_adjunto_a_mano(uuid, text)') is not null)::text union all
  select 8, 'conexiones de Diez (tabla entera)', (select count(*) from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'diez')::text union all
  select 9, 'asientos de Foodint (no se tocan)', (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
