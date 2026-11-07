-- supabase/vuelta-atras/20261107T0915_g01b_mapa_confirmado.down.sql
--
-- G01b · La vuelta atrás de la 0915: fuera la función que confirma el mapa;
-- el mapa vuelve a estar sin confirmar (así la lectura deja de guardar la
-- situación); las fichas «sin clasificar» se quedan sin situación, y el CHECK
-- vuelve a ser el de antes.
-- sin prueba con datos: la prueba de staging (20261107_g01b_mapa_confirmado_prueba.sql) la pasa en ROLLBACK y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

drop function if exists public.conta_bitrix_confirmar_mapa(uuid, jsonb);
update public.conta_crm_bitrix set mapa = mapa - 'confirmado', updated_at = now() where mapa ? 'confirmado';
update public.conta_gestoria_cliente set situacion = null where situacion = 'sin_clasificar';
alter table public.conta_gestoria_cliente drop constraint if exists conta_gestoria_cliente_situacion_check;
alter table public.conta_gestoria_cliente add constraint conta_gestoria_cliente_situacion_check
  check (situacion is null or situacion in ('activo', 'baja', 'moroso', 'solo_renta'));
