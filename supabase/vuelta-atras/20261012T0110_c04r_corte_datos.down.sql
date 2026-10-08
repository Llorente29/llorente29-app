-- ============================================================================
-- Vuelta atrás de C04 R4 · corte de Foodint con Diez.
-- ----------------------------------------------------------------------------
-- Deja el ejercicio 2026 como estaba (folvy, sin corte), quita los cierres de
-- mes «traídos» y los descartes «anteriores al corte» que puso el fichero.
--
-- Lo que NO hace, y va dicho: no vuelve a crear las propuestas descartadas.
-- Eran propuestas (nadie las había tocado) y salen solas otra vez con
-- «Proponer lo pendiente» en cuanto no hay corte ni descarte que las frene.
--
-- PARA si ya hay asientos traídos (el corte ya no se cambia: se deshace lo
-- traído primero) o si alguien ha descartado otra cosa con ese mismo motivo
-- a mano (solo se quitan las filas que puso este fichero, por su autor).
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_quien   constant text := 'Folvy · corte con Diez (C04 R4)';
  v_n int;
begin
  if exists (select 1 from public.journal_entry where company_id = v_empresa and source_type = 'migrated') then
    raise exception 'vuelta atrás del corte: ya hay asientos traídos; primero se deshace lo traído.';
  end if;

  delete from public.journal_dismissal
   where company_id = v_empresa and account_id = v_cuenta
     and reason = 'anteriores al corte' and created_by_name = v_quien;
  get diagnostics v_n = row_count;
  raise notice 'vuelta atrás del corte: % descartes quitados.', v_n;

  delete from public.fiscal_period_lock
   where company_id = v_empresa and account_id = v_cuenta and kind = 'migrated' and locked_by_name = v_quien;
  get diagnostics v_n = row_count;
  raise notice 'vuelta atrás del corte: % cierres de mes traídos quitados.', v_n;

  update public.fiscal_year
     set origin = 'folvy', origin_program = null, imported_until = null
   where company_id = v_empresa and account_id = v_cuenta and code = '2026'
     and origin = 'mixed' and origin_program = 'diez' and imported_until = '2026-09-30';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'vuelta atrás del corte: el 2026 no estaba como lo dejó el fichero (mixed/diez/30-09): no se toca.';
  end if;
end $$;
