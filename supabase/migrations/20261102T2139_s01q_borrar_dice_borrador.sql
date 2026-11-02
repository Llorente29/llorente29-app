-- supabase/migrations/20261102T2139_s01q_borrar_dice_borrador.sql
--
-- S01q·8 · Una regla para cualquier cliente (Julio, 02/11): si la función de
-- borrado encuentra un asiento en una declaración, dice cuál es (modelo, periodo
-- y año) y si está en borrador o ya presentada. En borrador: «sácalo del borrador
-- y recalcúlalo después». Presentada: no se borra. No borra ni toca ninguna
-- declaración: que el borrado saque la línea y recalcule el borrador solo, en la
-- propia función, va en la tanda siguiente.
--
-- cambia: public._conta_asientos_borrar · prueba: supabase/staging/sql/20261102_s01q_no_duplicar_prueba.sql

select public._respaldar_funcion('public._conta_asientos_borrar(uuid,uuid[],text,text)', '20261102T2139_s01q_borrar_dice_borrador');
do $$
declare
  v_def text := pg_get_functiondef('public._conta_asientos_borrar(uuid,uuid[],text,text)'::regprocedure); v_n int;
  v_antes constant text := $t$    select format('El asiento %s/%s está en una declaración: no se borra.', e.series, e.number)
      from public.journal_entry e where e.id = any(p_entries)
       and exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = e.id)$t$;
  v_despues constant text := $t$    -- S01q·8 · En qué declaración está, y si es un borrador o ya está presentada.
    select format(case when d.status in ('pending', 'draft', 'reviewed') and d.filed_at is null
                       then 'El asiento %s/%s está en el borrador del %s del %s de %s: no se borra mientras esté ahí. Sácalo del borrador y recalcúlalo después.'
                       else 'El asiento %s/%s está en el %s del %s de %s, ya presentado: no se borra.' end,
                  e.series, e.number, d.form_code, d.period, d.fiscal_year)
      from public.journal_entry e
      join lateral (select distinct tr.status, tr.filed_at, tr.form_code, tr.period, tr.fiscal_year
                      from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id
                      join public.tax_return tr on tr.id = t.tax_return_id
                     where l.entry_id = e.id) d on true
     where e.id = any(p_entries)$t$;
begin
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01q·8: _conta_asientos_borrar no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  execute replace(v_def, v_antes, v_despues);
end $$;
