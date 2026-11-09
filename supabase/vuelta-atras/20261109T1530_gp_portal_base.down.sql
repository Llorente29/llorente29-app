-- supabase/vuelta-atras/20261109T1530_gp_portal_base.down.sql
--
-- GP · La vuelta atrás de la 1530: fuera las funciones, las políticas del
-- almacén, las tablas conta_portal_* y las cinco columnas de conta_solicitud.
-- El almacén conta-portal se queda (con lo que tenga dentro no se puede borrar
-- desde SQL; vacío no molesta) y se dice en el parte.
-- sin prueba con datos: la prueba de staging (20261109_gp_portal_base_prueba.sql) la pasa en ROLLBACK y comprueba que no queda nada.

drop policy if exists conta_portal_leer on storage.objects;
drop policy if exists conta_portal_subir on storage.objects;

drop function if exists public.conta_portal_ruta_puede(text, boolean);
drop function if exists public.conta_portal_firma_pdf(uuid, text, text);
drop function if exists public.conta_portal_incidencia_parada(uuid, boolean, text);
drop function if exists public.conta_portal_firma_pedir(uuid, uuid, text, text);
drop function if exists public.conta_portal_acceso_usuario(uuid, uuid);
drop function if exists public.conta_portal_ajustes_guardar(uuid, text[]);
drop function if exists public.conta_portal_incidencia_resolver(uuid, text);
drop function if exists public.conta_portal_peticion_anular(uuid);
drop function if exists public.conta_portal_peticion_crear(uuid, text, text, text, date, text);
drop function if exists public.conta_portal_pendiente(uuid);
drop function if exists public.conta_portal_ficha(uuid);
drop function if exists public.conta_portal_firma_comprobar(uuid, text, text, text);
drop function if exists public.conta_portal_acceso_quitar(uuid);
drop function if exists public.conta_portal_invitar(uuid, text, text, text);
drop function if exists public.conta_portal_peticion_contestar(uuid, text);
drop function if exists public.conta_portal_incidencia_crear(uuid, text, text, uuid);
drop function if exists public.conta_portal_solicitud_pedir(uuid, text, text, text, date, text, numeric, text);
drop function if exists public.conta_portal_mensajes_leidos(uuid);
drop function if exists public.conta_portal_mensaje_enviar(uuid, text, jsonb);
drop function if exists public.conta_portal_archivo(uuid, text, uuid, int);
drop function if exists public.conta_portal_cuenta(uuid);
drop function if exists public.conta_portal_mensajes(uuid);
drop function if exists public.conta_portal_trabajadores(uuid);
drop function if exists public.conta_portal_documentos(uuid);
drop function if exists public.conta_portal_pagos(uuid);
drop function if exists public.conta_portal_facturas(uuid);
drop function if exists public.conta_portal_inicio(uuid);
drop function if exists public.conta_portal_entrada();
drop function if exists public._conta_portal_cuenta_propia(uuid, uuid);
drop function if exists public._conta_portal_proximo(uuid, uuid);
drop function if exists public._conta_portal_devueltos(uuid, uuid);
drop function if exists public._conta_portal_devuelto_pagado(uuid);
drop function if exists public._conta_portal_estado_recibo(text);
drop function if exists public._conta_portal_marca(uuid, uuid);
drop function if exists public._conta_portal_empresa(uuid, uuid);
drop function if exists public._conta_portal_yo(uuid, boolean);

alter table public.conta_solicitud drop constraint if exists conta_solicitud_portal_acceso;
alter table public.conta_solicitud drop constraint if exists conta_solicitud_empleado_documento;
alter table public.conta_solicitud drop constraint if exists conta_solicitud_horas_semana;
alter table public.conta_solicitud drop column if exists portal_acceso_id;
alter table public.conta_solicitud drop column if exists horas_semana;
alter table public.conta_solicitud drop column if exists tipo_contrato;
alter table public.conta_solicitud drop column if exists fecha_efecto;
alter table public.conta_solicitud drop column if exists empleado_documento;

drop table if exists public.conta_portal_aviso;
drop table if exists public.conta_portal_operacion;
drop table if exists public.conta_portal_subida;
drop table if exists public.conta_portal_incidencia;
drop table if exists public.conta_portal_firma;
drop table if exists public.conta_portal_peticion;
drop table if exists public.conta_portal_mensaje;
drop table if exists public.conta_portal_ajustes;
drop table if exists public.conta_portal_acceso;

drop function if exists public.conta_portal_ve(uuid, boolean);
