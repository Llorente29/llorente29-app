-- ============================================================================
-- Políticas de lectura de contabilidad, una vez por consulta — 2 · sales_day_summary
-- ----------------------------------------------------------------------------
-- cambia: public.sales_day_summary · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
--
-- El libro diario no cargaba en producción: «conta_dias_por_asentar: canceling
-- statement due to statement timeout». El explain midió 18,0 s contra el
-- límite de 8 s. Los dos «not exists» (sobre sales_day_summary y sobre
-- journal_dismissal) llamaban a belongs_to_account(account_id) —SQL, security
-- definer, que el planificador no puede desplegar— UNA VEZ POR FILA: unos
-- 0,37 ms por llamada, 33.840 + 13.818 llamadas.
--
-- Las 49 políticas de SELECT de las tablas que crearon C00 a C05 (todas las
-- que usan belongs_to_account; lista de pg_policies, igual en producción y en
-- staging el 09/10: tests/conta/produccion/politicas-c00-c05-produccion-
-- 20261009.json) pasan a
--     account_id = any ((select public.current_user_account_ids()))
-- El «(select …)» la convierte en un InitPlan: se calcula UNA vez por
-- consulta, no una por fila.
--
-- Mismo resultado sobre los datos reales: belongs_to_account(p) es
-- «p = any(current_user_account_ids()) or current_user_is_admin()», y para un
-- superadmin current_user_account_ids() ya devuelve TODAS las cuentas. Solo
-- diferirían las filas con account_id fuera de accounts, o nulo fuera de
-- «is_system» / «account_id is null»: medido en producción el 09/10, 0 en las
-- 49 tablas. Se conservan el nombre, el rol (authenticated o public) y la
-- parte «is_system or» / «account_id is null or» de cada una.
--
-- Las de UPDATE/DELETE (current_user_is_admin_or_manager_of) se quedan: no
-- hay pantalla ni función que las ejerza sobre muchas filas (informe del PR).
--
-- En dos ficheros porque el analizador pone sales_day_summary en el camino
-- del pedido (CAMINO_TABLAS: «sales_.*»): 0100 lleva las otras 48 y «sigue»;
-- 0110 lleva solo sales_day_summary y pide «autorizo». Las dos hacen falta
-- para que el libro diario baje del límite.
--
-- sales_day_summary es del módulo de contabilidad (la creó el C04: el resumen
-- de ventas de cada día que se lleva al libro). La escribe el proponedor del
-- libro diario, no el pedido; el analizador la pone en el camino por el
-- nombre. Cambia solo QUIÉN la lee, y lo lee igual: ninguna escritura del
-- pedido pasa por su política de SELECT.
--
-- Guarda: PARA si la política no está exactamente como se midió.
-- Vuelta atrás: supabase/vuelta-atras/20261015T0110_politicas_una_vez_resumen.down.sql
-- ============================================================================

do $$
declare n int;
begin
  -- Cada política, con su nombre, su rol y su texto exactos de antes.
  select count(*) into n
    from (values
      ('sales_day_summary', 'sales_day_summary_select', 'public', 'belongs_to_account(account_id)')
    ) e(t, p, roles, qual)
    join pg_policies x on x.schemaname = 'public' and x.tablename = e.t and x.policyname = e.p
                      and x.cmd = 'SELECT' and x.permissive = 'PERMISSIVE'
                      and array_to_string(x.roles, ',') = e.roles and x.qual = e.qual;
  if n <> 1 then
    raise exception 'Políticas de conta: % de 1 están como se midieron el 09/10. No se toca nada.', n;
  end if;
end $$;

drop policy if exists sales_day_summary_select on public.sales_day_summary;
create policy sales_day_summary_select on public.sales_day_summary as permissive for select to public using (account_id = any ((select public.current_user_account_ids())));

-- Comprobación: con la forma nueva y ninguna con belongs_to_account.
do $$
declare n int; v int;
begin
  select count(*) filter (where qual like '%SELECT current_user_account_ids()%' and qual not like '%belongs_to_account%'),
         count(*) filter (where qual like '%belongs_to_account%')
    into n, v
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT'
     and tablename in (
      'sales_day_summary');
  if n <> 1 or v <> 0 then
    raise exception 'Políticas de conta: después del cambio hay % con la forma nueva y % con belongs_to_account (espero 1 y 0).', n, v;
  end if;
end $$;
