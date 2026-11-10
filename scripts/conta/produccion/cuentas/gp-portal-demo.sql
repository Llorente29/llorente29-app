-- scripts/conta/produccion/cuentas/gp-portal-demo.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 2240, antes y después. SOLO LEE.
--   1. La función nueva (conta_portal_demo_preparar): 0 → 1.
--   2. Lo sembrado en el portal de «Gestoría Demo» (ajustes, acceso, mensaje y
--      petición de la siembra): 0 → 4 donde está la demo con Talleres Ruiz.
select clave, valor from (
  select 1 o, 'Función conta_portal_demo_preparar' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'conta_portal_demo_preparar') valor union all
  select 2, 'Lo sembrado en el portal de la demo',
    -- quieta: solo lo escriben esta tanda y el botón «Preparar el portal de la demo» de la propia demo; la vuelta atrás lo quita igual.
    ((select count(*) from public.conta_portal_ajustes where account_id = 'de000000-0000-4000-8000-0000000000a0' and updated_by_name = 'Preparación de la demo')
   + (select count(*) from public.conta_portal_acceso where account_id = 'de000000-0000-4000-8000-0000000000a0' and invitado_por_name = 'Preparación de la demo' and user_id is null and lower(correo) = 'tomas.ruiz@talleresruiz.example')
   + (select count(*) from public.conta_portal_mensaje where account_id = 'de000000-0000-4000-8000-0000000000a0' and de = 'gestoria' and autor is null and autor_nombre = 'Gestoría Demo' and leido_at is null and texto like 'Hola, Tomás: ya tienes aquí tu espacio.%')
   + (select count(*) from public.conta_portal_peticion where account_id = 'de000000-0000-4000-8000-0000000000a0' and creada_por_name = 'Gestoría Demo' and estado = 'pendiente' and tipo = 'subir' and titulo like 'Facturas de gasto de %'))::text
) q order by o;
