-- scripts/conta/produccion/cuentas/c12b-foodint-mensual.sql
--
-- C12b (24/10) · LO QUE CUENTA EL PASO DE FOODINT A MENSUAL, antes y después.
-- SOLO LEE. Todo de Foodint (regla 9), salvo lo que dice «tabla entera».
--
-- Después del real: Foodint en mensual (1); 0 pendientes con reintento; los
-- pendientes y lo que está en Diez, el mismo número que antes (no se envía ni
-- se borra nada); y los cierres del día de octubre sin enviar, contados (van en
-- el primer traspaso).
-- Y la huella (C12c): con la tanda, la empresa cambia, los pendientes sin
-- reintento pasan a ser todos y la copia existe; con la tanda y su vuelta
-- atrás, todo igual que antes y sin copia.
select clave, valor from (
  select 1 o, 'Foodint · empresas en modo mensual' clave,
         (select count(*) from public.conta_diez_envio_empresa where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and modo = 'mensual')::text valor union all
  select 2, 'conta_diez_envio_empresa · empresas en modo mensual (tabla entera)',
         (select count(*) from public.conta_diez_envio_empresa where modo = 'mensual')::text union all
  select 3, 'Foodint · envíos pendientes',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pendiente')::text union all
  select 4, 'Foodint · envíos pendientes con reintento puesto',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pendiente' and next_try_at is not null)::text union all
  select 5, 'Foodint · en Diez (enviado o enlazado)',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status in ('enviado', 'enlazado'))::text union all
  select 6, 'Foodint · cierres del día validados de octubre sin estar en Diez',
         (select count(*) from public.journal_entry e
           where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'sales_day' and e.status = 'validado'
             and e.entry_date >= '2026-10-01'
             and not exists (select 1 from public.external_send s where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado')))::text union all
  select 7, 'Foodint · validados de octubre que van en el traspaso',
         (select count(*) from public.journal_entry e
           where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.status = 'validado' and e.entry_date >= '2026-10-01'
             and e.source_type not in ('migrated', 'opening', 'closing', 'template')
             and not exists (select 1 from public.external_send s where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado'))
             and (e.reverses_entry_id is null or exists (select 1 from public.external_send x where x.entry_id = e.reverses_entry_id and x.account_id = e.account_id and x.status in ('enviado', 'enlazado'))))::text
  union all
  -- C12c (25/10): la huella de lo que la 1631 toca y nadie más mueve, para que
  -- «tanda y vuelta atrás» se compare también en las fechas. Solo la empresa y
  -- los pendientes SIN reintento: los que tienen reintento los reescribe la cola
  -- en cada pasada (next_try_at, updated_at), y el «antes» se mide minutos
  -- antes que el ensayo. Su exactitud la mide la prueba de staging.
  select 8, 'Foodint · huella de la empresa (modo, cambiado_por_nombre, cambiado_en)',
         (select md5(coalesce(string_agg(company_id::text || '|' || coalesce(modo, '-') || '|' || coalesce(cambiado_por_nombre, '-') || '|' || cambiado_en::text, ',' order by company_id), ''))
            from public.conta_diez_envio_empresa where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 9, 'Foodint · huella de los pendientes sin reintento (id, updated_at)',
         (select md5(coalesce(string_agg(id::text || '|' || updated_at::text, ',' order by id), ''))
            from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pendiente' and next_try_at is null) union all
  select 10, 'conta_c12b_antes (la copia de antes) · existe',
         (to_regclass('public.conta_c12b_antes') is not null)::text
) t order by o;
