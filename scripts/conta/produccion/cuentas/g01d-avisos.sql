-- scripts/conta/produccion/cuentas/g01d-avisos.sql
--
-- G01d · Avisos al instante · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La misma vara a los dos lados (regla 31): las columnas nuevas se
-- leen con to_jsonb, así la consulta vale con ellas y sin ellas. Todas las
-- cuentas a propósito (la tanda es de las tablas enteras). Lo que lee datos,
-- con un corte fijo (antes del 08/11 a las 16:00 UTC), para que una lectura de
-- la noche o una persona a mitad del ensayo no lo pare (W06).
-- Lo que tiene que pasar:
--   1. La tabla conta_aviso: no → sí.
--   2. Columnas aviso_* en conta_crm / conta_cobro_gocardless: 0 / 0 → 5 / 5.
--   3. Las cinco funciones nuevas: 0 → 5.
--   4. El CHECK de conta_gestoria_lectura.por admite «aviso»: no → sí.
--   5. El repaso de cada 2 minutos (cron conta-avisos-repaso): 0 → 1.
--   6. Conexiones con «Al instante» encendido (CRM / GoCardless): 0 / 0 → 0 / 0 (apagado de serie).
--   7. Secretos de avisos en Vault: 0 → 0 (los pega una persona en Ajustes).
--   8. Lo que no se toca, igual a los dos lados: fichas / clientes /
--      diferencias vigentes de la gestoría: 1813 / 1535 / 619 → igual.
--   9. Lecturas por quién (persona / cada_noche / conexion / aviso):
--      16 / 25 / 3 / 0 → igual.
-- Medido antes el 08/11 a las 16:35Z (solo lectura): 1 a 7 salen como el
-- lado izquierdo de cada flecha.
select clave, valor from (
  select 1 o, 'La tabla conta_aviso' clave,
    (to_regclass('public.conta_aviso') is not null)::text valor union all
  select 2, 'Columnas aviso_* en conta_crm / conta_cobro_gocardless',
    (select concat_ws(' / ', count(*) filter (where table_name = 'conta_crm'), count(*) filter (where table_name = 'conta_cobro_gocardless'))
       from information_schema.columns where table_schema = 'public' and table_name in ('conta_crm', 'conta_cobro_gocardless') and column_name like 'aviso\_%') union all
  select 3, 'Funciones nuevas del G01d',
    (select count(*)::text from pg_catalog.pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('conta_aviso_configurar', 'conta_aviso_secreto', 'conta_crm_guardar_personas_de_contacto', 'conta_crm_renovar_pendientes', 'conta_avisos_despertar')) union all
  select 4, 'El CHECK de conta_gestoria_lectura.por admite «aviso»',
    (select coalesce(bool_or(pg_get_constraintdef(oid) like '%aviso%'), false)::text from pg_catalog.pg_constraint
       where conrelid = 'public.conta_gestoria_lectura'::regclass and conname = 'conta_gestoria_lectura_por_check') union all
  select 5, 'El repaso de los avisos (cron)',
    (select count(*)::text from cron.job where jobname = 'conta-avisos-repaso') union all
  select 6, 'Conexiones con «Al instante» encendido: CRM / GoCardless (todas las cuentas)',
    concat_ws(' / ',
      (select count(*) from public.conta_crm c where c.created_at < timestamptz '2026-11-08 16:00:00+00' and (to_jsonb(c)->>'aviso_encendido')::boolean is true),
      -- quieta: una conexión de GoCardless nueva entra apagada; la medida cuenta solo las encendidas, y la tanda no enciende ninguna
      (select count(*) from public.conta_cobro_gocardless g where (to_jsonb(g)->>'aviso_encendido')::boolean is true)) union all
  select 7, 'Secretos de avisos en Vault',
    -- quieta: solo los crea una persona desde Ajustes, con la tanda ya aplicada
    (select count(*)::text from vault.secrets where name like 'conta\_crm\_aviso:%' or name like 'conta\_gocardless\_aviso:%') union all
  select 8, 'Gestoría: fichas / clientes / diferencias vigentes (todas las cuentas)',
    concat_ws(' / ',
      (select count(*) from public.conta_gestoria_ficha where created_at < timestamptz '2026-11-08 16:00:00+00'),
      (select count(*) from public.conta_gestoria_cliente where created_at < timestamptz '2026-11-08 16:00:00+00'),
      (select count(*) from public.conta_gestoria_diferencia where vigente and created_at < timestamptz '2026-11-08 16:00:00+00')) union all
  select 9, 'Lecturas de la gestoría por quién: persona / cada_noche / conexion / aviso (todas las cuentas)',
    (select concat_ws(' / ', count(*) filter (where por = 'persona'), count(*) filter (where por = 'cada_noche'), count(*) filter (where por = 'conexion'), count(*) filter (where por = 'aviso'))
       from public.conta_gestoria_lectura where empezada_at < timestamptz '2026-11-08 16:00:00+00')
) q order by o;
