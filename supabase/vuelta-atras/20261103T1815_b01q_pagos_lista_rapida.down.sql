-- ============================================================================
-- Vuelta atrás de 20261103T1815_b01q_pagos_lista_rapida.sql: las dos funciones
-- como estaban en producción el 03/11, restauradas del respaldo que guardó la
-- 1815 (_restaurar_funcion comprueba la huella: 72fee864… y 0f60410c…), con
-- sus permisos de antes, en el mismo orden, y sus comentarios de antes.
-- ============================================================================

select public._restaurar_funcion('public.conta_pagos_lista(uuid,date)', '20261103T1815_b01q_pagos_lista_rapida');
select public._restaurar_funcion('public.conta_pagos_por_revisar(uuid)', '20261103T1815_b01q_pagos_lista_rapida');

-- Los permisos de conta_pagos_lista, en el orden de antes ({=X,postgres=X,anon=X,authenticated=X,service_role=X}):
-- quitarlos todos y darlos uno a uno (un grant se apunta al final de la lista).
revoke all on function public.conta_pagos_lista(uuid, date) from public, postgres, anon, authenticated, service_role;
grant execute on function public.conta_pagos_lista(uuid, date) to public;
grant execute on function public.conta_pagos_lista(uuid, date) to postgres;
grant execute on function public.conta_pagos_lista(uuid, date) to anon;
grant execute on function public.conta_pagos_lista(uuid, date) to authenticated;
grant execute on function public.conta_pagos_lista(uuid, date) to service_role;
-- Los de conta_pagos_por_revisar no los cambió la 1815 ({postgres=X,authenticated=X,service_role=X}).

comment on function public.conta_pagos_lista(uuid, date) is 'PC01 · E2 · Compras › Pagos: las recibidas por pagar y pagadas de la empresa, con su estado, su remesa y lo pagado en el mes.';
comment on function public.conta_pagos_por_revisar(uuid) is 'B01 · Cola 1e (02/11). Las facturas recibidas en revisión y sin pagar, con las columnas de conta_pagos_lista y por_revisar = true: Pagos las enseña con su vencimiento, sin poder marcarlas.';
