-- supabase/migrations/20261117T1656_n05c_sin_historico_validar.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261117_n05c_sin_historico_prueba.sql
--
-- N05c · Empezar a trabajar sin el histórico. 2 de 2: LO QUE CAMBIA (va después de la
-- 20261117T1655, que añade la decisión y _conta_falta_historico_motivo).
--
-- conta_motivos_para_validar: la parada «falta_historico» pregunta su porqué a
-- _conta_falta_historico_motivo. Sin la decisión, para igual que hoy, con el motivo nuevo que dice
-- qué hacer; con la decisión tomada, solo para lo anterior al día de inicio y el cierre y la
-- apertura. Es el ÚNICO sitio de la base que para por esto (medido en pg_proc, 17/11; en el front,
-- ninguno: lee este motivo).
--
-- Misma firma, el cuerpo vigente con un solo trozo cambiado (reemplazo exacto: si el trozo no está
-- una sola vez, no se toca nada). Respaldo antes, para la vuelta atrás. No toca ningún dato. Nada en
-- el camino del pedido.

select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261117T1656_n05c_sin_historico_validar');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo text := $viejo$    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      orden := 5; codigo := 'falta_historico';
      motivo := format('Primero hay que traer el histórico de %s de %s.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code); return next;
    end if;$viejo$;
  v_nuevo text := $nuevo$    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      -- N05c · Sin decidir, nada; con «empezar a trabajar ya», desde el día de inicio (salvo cierre y apertura).
      motivo := public._conta_falta_historico_motivo(v_e.id);
      if motivo is not null then
        orden := 5; codigo := 'falta_historico'; return next;
      end if;
    end if;$nuevo$;
begin
  if strpos(v_def, 'N05c · Sin decidir, nada') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'N05c: conta_motivos_para_validar no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;
