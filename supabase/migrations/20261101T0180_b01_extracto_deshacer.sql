-- ============================================================================
-- B01 · DESHACER UN EXTRACTO ENTERO (Julio, 15/10: el primer Norma 43 de
-- Foodint se sacó desde «extracto» y no trae a quién pagas; hay que cambiarlo
-- por el de «Firmas», que sí lo trae).
-- ----------------------------------------------------------------------------
-- Una función NUEVA, bank_extracto_deshacer(extracto, porqué): quita el
-- extracto y sus movimientos, también los que quedaron como «¿es el mismo?»
-- (posible repetido), para poder volver a subir el fichero bueno.
--
-- Solo si NINGUNO de sus movimientos está casado: ni con un casado vivo, ni
-- como la otra pata de un traspaso casado, ni con un ticket subido. Si alguno
-- lo está, PARA y dice cuántos: primero se deshacen en Movimientos.
-- Pide el porqué, como deshacer un casado.
--
-- Lo que se lleva con él: sus casados YA DESHECHOS (son historia de unos
-- movimientos que dejan de existir; el registro de lo que pasó se queda en
-- «Lo que ha hecho Folvy», sin el enlace) y sus partidas. Lo que NO toca:
-- los asientos (un movimiento sin casar no tiene asiento), los IBAN recordados
-- y los demás extractos de la cuenta.
--
-- Queda en «Lo que ha hecho Folvy» como «deshecho», con el fichero, el periodo,
-- cuántos movimientos se quitaron y por qué.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0180_b01_extracto_deshacer.down.sql
-- ============================================================================

create or replace function public.bank_extracto_deshacer(p_statement uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.bank_statement; v_casados int; v_tickets int; v_movs int; v_repetidos int; v_historia int; v_cuenta text;
begin
  select * into v_s from public.bank_statement where id = p_statement for update;
  if v_s.id is null then raise exception 'Ese extracto no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_s.company_id);   -- administrador o encargado de la cuenta
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Para deshacer un extracto hay que decir por qué.' using errcode = '23514'; end if;

  perform 1 from public.bank_movement where statement_id = v_s.id for update;
  select count(*) into v_casados from public.bank_movement m
   where m.statement_id = v_s.id
     and (m.status = 'casado'
          or exists (select 1 from public.bank_match b where b.movement_id = m.id and b.status = 'vivo')
          or exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                      where i.other_movement_id = m.id and b.status = 'vivo'));
  if v_casados > 0 then
    raise exception 'Este extracto tiene % movimiento(s) casado(s). Deshazlos antes en Movimientos y vuelve a intentarlo.', v_casados using errcode = '23514';
  end if;
  select count(*) into v_tickets from public.bank_movement where statement_id = v_s.id and receipt_path is not null;
  if v_tickets > 0 then
    raise exception 'Este extracto tiene % ticket(s) subido(s): guárdalos antes de deshacerlo.', v_tickets using errcode = '23514';
  end if;

  select count(*), count(*) filter (where status = 'posible_repetido') into v_movs, v_repetidos
    from public.bank_movement where statement_id = v_s.id;
  select count(*) into v_historia from public.bank_match b
   where b.movement_id in (select id from public.bank_movement where statement_id = v_s.id)
      or b.id in (select i.match_id from public.bank_match_item i where i.other_movement_id in (select id from public.bank_movement where statement_id = v_s.id));
  delete from public.bank_match b
   where b.movement_id in (select id from public.bank_movement where statement_id = v_s.id)
      or b.id in (select i.match_id from public.bank_match_item i where i.other_movement_id in (select id from public.bank_movement where statement_id = v_s.id));
  delete from public.bank_movement where statement_id = v_s.id;

  select t.name into v_cuenta from public.treasury_account t where t.id = v_s.treasury_account_id;
  perform public._bank_log(v_s.account_id, v_s.company_id, null, null, v_s.id, 'deshecho', 'persona',
    format('Deshecho el extracto %s de %s (%s – %s): quitados %s movimientos%s. Por qué: %s',
      coalesce(v_s.file_name, 'sin nombre'), coalesce(v_cuenta, 'la cuenta'), to_char(v_s.period_from, 'DD/MM/YYYY'), to_char(v_s.period_to, 'DD/MM/YYYY'),
      v_movs, case when v_repetidos > 0 then format(', %s de ellos como «¿es el mismo?»', v_repetidos) else '' end, trim(p_motivo)),
    jsonb_build_object('extracto', v_s.id, 'fichero', v_s.file_name, 'huella_fichero', v_s.file_sha256, 'desde', v_s.period_from, 'hasta', v_s.period_to,
      'movimientos', v_movs, 'posibles_repetidos', v_repetidos, 'casados_deshechos_quitados', v_historia, 'porque', trim(p_motivo)));
  delete from public.bank_statement where id = v_s.id;

  return jsonb_build_object('movimientos', v_movs, 'posibles_repetidos', v_repetidos, 'casados_deshechos', v_historia,
    'fichero', v_s.file_name, 'desde', v_s.period_from, 'hasta', v_s.period_to, 'cuenta', v_cuenta);
end $$;

revoke all on function public.bank_extracto_deshacer(uuid, text) from public, anon;
grant execute on function public.bank_extracto_deshacer(uuid, text) to authenticated;
comment on function public.bank_extracto_deshacer(uuid, text) is
  'B01 (15/10). Quita un extracto y sus movimientos (también los posibles repetidos) si ninguno está casado ni tiene ticket. Pide el porqué; queda en «Lo que ha hecho Folvy».';
