-- supabase/vuelta-atras/20261110T1520_gb_sin_titulo.down.sql
-- GB · la vuelta atrás de la 1520: conta_portal_quien_lleva como estaba (la de la
-- 1403), restaurada de su respaldo (_restaurar_funcion comprueba la huella), y su
-- comentario de antes. Solo lee: no hay nada más que devolver.

select public._restaurar_funcion('public.conta_portal_quien_lleva(uuid)', '20261110T1520_gb_sin_titulo');

comment on function public.conta_portal_quien_lleva(uuid) is
  'GB (nº 24, el 7 de Code 3) · Quién lleva al cliente, para el portal («Te lleva: Nombre · correo»): el responsable de su ficha del CRM (Bitrix24, ASSIGNED_BY_ID con user.get), que guarda la lectura del CRM en conta_gestoria_cliente.ficha. {nombre, correo} o null. Para la persona del portal de ese cliente (_conta_portal_yo), con cualquier permiso.';
