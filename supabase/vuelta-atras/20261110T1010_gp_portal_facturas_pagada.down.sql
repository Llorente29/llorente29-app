-- supabase/vuelta-atras/20261110T1010_gp_portal_facturas_pagada.down.sql
--
-- GP · la vuelta atrás de la 1010: conta_portal_facturas y conta_portal_inicio,
-- restauradas de su respaldo (Inicio vuelve a como lo dejó la 0945).
-- sin prueba con datos: la prueba de staging (20261110_gp_portal_facturas_pagada_prueba.sql) la pasa en ROLLBACK y comprueba que las dos vuelven a no dar «pagada».

select public._restaurar_funcion('public.conta_portal_inicio(uuid)', '20261110T1010_gp_portal_facturas_pagada');
select public._restaurar_funcion('public.conta_portal_facturas(uuid)', '20261110T1010_gp_portal_facturas_pagada');
