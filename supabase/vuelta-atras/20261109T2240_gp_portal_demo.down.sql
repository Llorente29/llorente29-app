-- supabase/vuelta-atras/20261109T2240_gp_portal_demo.down.sql
--
-- GP · La vuelta atrás de la 2240: fuera conta_portal_demo_preparar y lo que
-- sembró en «Gestoría Demo», reconocible por quién lo puso («Preparación de la
-- demo» y los textos de la siembra) y SOLO si sigue como lo dejó: un acceso con
-- el que ya se entró, una petición ya hecha o un mensaje leído se quedan (son
-- uso de la demo). Solo en la cuenta demo (regla 9).
-- sin prueba con datos: la prueba de staging (20261109_gp_portal_demo_prueba.sql) siembra, pasa esta vuelta atrás y comprueba que no queda nada.

delete from public.conta_portal_peticion
 where account_id = 'de000000-0000-4000-8000-0000000000a0' and creada_por_name = 'Gestoría Demo' and estado = 'pendiente'
   and tipo = 'subir' and titulo like 'Facturas de gasto de %' and detalle = 'Las de proveedores y los tiques del mes. Una foto con el móvil vale.';
delete from public.conta_portal_mensaje
 where account_id = 'de000000-0000-4000-8000-0000000000a0' and de = 'gestoria' and autor is null and autor_nombre = 'Gestoría Demo'
   and leido_at is null and texto like 'Hola, Tomás: ya tienes aquí tu espacio.%';
delete from public.conta_portal_acceso
 where account_id = 'de000000-0000-4000-8000-0000000000a0' and invitado_por_name = 'Preparación de la demo' and user_id is null
   and lower(correo) = 'tomas.ruiz@talleresruiz.example';
delete from public.conta_portal_ajustes
 where account_id = 'de000000-0000-4000-8000-0000000000a0' and updated_by_name = 'Preparación de la demo';
drop function if exists public.conta_portal_demo_preparar(uuid);
