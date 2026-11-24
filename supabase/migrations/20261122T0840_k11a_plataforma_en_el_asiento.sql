-- supabase/migrations/20261122T0840_k11a_plataforma_en_el_asiento.sql
--
-- K11a · La plataforma de cada línea llega a la línea del asiento, como el local y la marca (Julio, 22/11: «que
-- lleguen a la línea del asiento como llega el local: la plataforma también en journal_line»). La propuesta
-- (journal_entry_proponer → _journal_entry_proponer) lee un campo más de cada línea, «canal_id», y lo escribe en
-- journal_line.channel_id (de la 0839). Una línea sin «canal_id» queda como hasta hoy: sin plataforma.
--
-- cambia: public._journal_entry_proponer · prueba: supabase/staging/sql/20261122_k11a_base_ficha_recibida_prueba.sql
--   La MISMA firma y el cuerpo vigente (el del S01d, 20261030T0900) con dos trozos cambiados: la lista de columnas
--   del insert de journal_line y sus valores. Respaldo antes, para la vuelta atrás. Ninguna línea de hoy lleva
--   «canal_id»: lo que se propone hoy queda igual (regla 31).
--
-- Va aparte de la 0839 porque CAMBIA: desde la rama solo pasa en ROLLBACK.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0840_k11a_plataforma_en_el_asiento.down.sql

select public._respaldar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261122T0840_k11a_plataforma_en_el_asiento');

do $do$
declare
  v_def text := pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure);
  v_viejo1 text := $v$withholding_rate_id, withholding_base, withholding_model, withholding_period)$v$;
  v_nuevo1 text := $n$withholding_rate_id, withholding_base, withholding_model, withholding_period, channel_id)   -- K11a: la plataforma$n$;
  v_viejo2 text := $v$v_l->'retencion'->>'modelo', nullif(v_l->'retencion'->>'periodo', ''));$v$;
  v_nuevo2 text := $n$v_l->'retencion'->>'modelo', nullif(v_l->'retencion'->>'periodo', ''), nullif(v_l->>'canal_id', '')::uuid);$n$;
begin
  if strpos(v_def, 'K11a: la plataforma') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo1, ''))) / length(v_viejo1) <> 1
     or (length(v_def) - length(replace(v_def, v_viejo2, ''))) / length(v_viejo2) <> 1 then
    raise exception 'K11a: _journal_entry_proponer no es la medida (el insert de journal_line no está una sola vez): no se toca.';
  end if;
  execute replace(replace(v_def, v_viejo1, v_nuevo1), v_viejo2, v_nuevo2);
end $do$;
