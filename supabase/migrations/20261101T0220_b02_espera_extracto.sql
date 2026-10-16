-- ============================================================================
-- B02 · «ESPERA EL EXTRACTO» Y EL PUNTO DE PARTIDA DEL CIERRE (tanda T4).
-- ----------------------------------------------------------------------------
-- 1. bank_movement.status admite «espera_extracto» (el CHECK solo amplía):
--    un traspaso con un solo lado cuya otra cuenta no tiene subido el extracto
--    de esos días. Se ve en «Todos» con «Espera el extracto de ···0133»; no
--    cuenta por aclarar, ni en la barra ni en el menú. Cuando llega el otro
--    lado, el agente lo casa; si el extracto llega y no está, por aclarar con
--    el porqué. Lo decide el motor (conciliacion.ts), no la base.
-- 2. bank_proponer (misma firma) acepta «espera_extracto».
-- 3. _bank_mes_estado (misma firma), lo que lee «Cierre del mes» y comprueba
--    bank_mes_cerrar: (a) desde la fecha de corte, el saldo de contabilidad
--    parte del saldo del EXTRACTO a la víspera, no del contable (regla de
--    Julio, 16/10), y devuelve los dos en «apertura» para decirlo en pantalla;
--    sin ese saldo, el contable de siempre; (b) cuántos esperan el extracto y
--    de qué cuentas («esperan», «esperan_de»). Siguen contando en «sueltos».
-- Lo de antes no cambia: sin fecha de corte, o en un mes anterior a ella,
-- _bank_mes_estado devuelve lo mismo que con la 0150 (más tres claves).
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0220_b02_espera_extracto.down.sql
-- cambia: public.bank_movement · prueba: supabase/staging/sql/20261101_b02_espera_extracto_prueba.sql
-- cambia: public.bank_proponer · prueba: supabase/staging/sql/20261101_b02_espera_extracto_prueba.sql
-- cambia: public._bank_mes_estado · prueba: supabase/staging/sql/20261101_b02_espera_extracto_prueba.sql
-- ============================================================================

alter table public.bank_movement drop constraint bank_movement_status_check,
  add constraint bank_movement_status_check
  check (status in ('pendiente', 'propuesto', 'por_aclarar', 'casado', 'posible_repetido', 'antes_corte_sin_pareja', 'ignorado', 'espera_extracto'));

create or replace function public.bank_proponer(p_movement uuid, p_estado text, p_confianza text, p_porque text, p_propuesta jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if v_m.status in ('casado', 'ignorado') then raise exception 'Ese movimiento ya está casado o ignorado.' using errcode = '23514'; end if;
  if p_estado not in ('pendiente', 'propuesto', 'por_aclarar', 'antes_corte_sin_pareja', 'espera_extracto') then
    raise exception 'Estado de propuesta no válido: %.', p_estado using errcode = '23514';
  end if;
  if p_estado = 'antes_corte_sin_pareja' and not v_m.before_cutover then
    raise exception 'Solo lo anterior a la fecha de corte puede quedar «antes del corte».' using errcode = '23514';
  end if;
  update public.bank_movement set status = p_estado, confidence = case when p_estado = 'pendiente' then null else p_confianza end,
         reason = case when p_estado = 'pendiente' then null else p_porque end,
         proposal = case when p_estado = 'pendiente' then null else p_propuesta end, updated_at = now()
   where id = p_movement;
  if p_estado in ('propuesto', 'por_aclarar') then
    perform public._bank_log(v_m.account_id, v_m.company_id, p_movement, null, null, p_estado, 'folvy', p_porque, coalesce(p_propuesta, '{}'::jsonb));
  end if;
end $$;
grant execute on function public.bank_proponer(uuid, text, text, text, jsonb) to authenticated;

create or replace function public._bank_mes_estado(p_treasury uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.treasury_account; v_desde date := date_trunc('month', p_mes)::date; v_hasta date; v_572 text;
  v_banco numeric; v_libro numeric; v_n int; v_suma numeric; v_extracto date;
  v_corte date; v_vispera date; v_banco_ap numeric; v_libro_ap numeric; v_contable numeric; v_apertura jsonb;
  v_espera int; v_espera_de jsonb;
begin
  v_hasta := (v_desde + interval '1 month - 1 day')::date;
  select * into v_t from public.treasury_account where id = p_treasury;
  v_572 := public._bank_cuenta_572(p_treasury);
  -- El saldo del banco a fin de mes: el del último extracto que llega hasta ese día (con saldos).
  select s.closing_balance, s.period_to into v_banco, v_extracto from public.bank_statement s
   where s.treasury_account_id = p_treasury and s.closing_balance is not null and s.period_to <= v_hasta
   order by s.period_to desc, s.imported_at desc limit 1;
  if v_extracto is not null and v_extracto < v_hasta and exists (select 1 from public.bank_movement m
       where m.treasury_account_id = p_treasury and m.op_date > v_extracto and m.op_date <= v_hasta) then
    v_banco := null;  -- hay movimientos después del último saldo conocido: el saldo de fin de mes no se sabe
  end if;
  select coalesce(sum(jl.debit - jl.credit), 0) into v_libro
    from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id join public.company_account ca on ca.id = jl.company_account_id
   where ca.company_id = v_t.company_id and ca.code = v_572 and je.status in ('validado', 'anulado', 'propuesto')
     and je.entry_date <= v_hasta and je.source_type <> 'closing';
  v_contable := v_libro;
  -- B02 · El punto de partida (regla de Julio, 16/10): desde la fecha de corte,
  -- se parte del saldo del EXTRACTO a la víspera, no del contable, porque hasta
  -- esa fecha la contabilidad está cerrada y casi sin conciliar. Lo mismo que
  -- puntoDePartida (src/modules/conta/lib/conciliarVista.ts). Sin ese saldo,
  -- el contable de siempre, y la pantalla lo dice.
  select b.cutover_date into v_corte from public.bank_settings b where b.company_id = v_t.company_id;
  if v_corte is not null and v_hasta >= v_corte then
    v_vispera := v_corte - 1;
    select s.opening_balance into v_banco_ap from public.bank_statement s
     where s.treasury_account_id = p_treasury and s.period_from = v_corte and s.opening_balance is not null order by s.imported_at desc limit 1;
    if v_banco_ap is null then
      select s.closing_balance into v_banco_ap from public.bank_statement s
       where s.treasury_account_id = p_treasury and s.period_to = v_vispera and s.closing_balance is not null order by s.imported_at desc limit 1;
    end if;
    select coalesce(sum(jl.debit - jl.credit), 0) into v_libro_ap
      from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id join public.company_account ca on ca.id = jl.company_account_id
     where ca.company_id = v_t.company_id and ca.code = v_572 and je.status in ('validado', 'anulado', 'propuesto')
       and je.entry_date <= v_vispera and je.source_type <> 'closing';
    if v_banco_ap is not null then v_libro := v_banco_ap + (v_libro - v_libro_ap); end if;
    v_apertura := jsonb_build_object('fecha', v_vispera, 'saldo_banco', v_banco_ap, 'saldo_libro', v_libro_ap);
  end if;
  select count(*), coalesce(sum(amount), 0) into v_n, v_suma from public.bank_movement
   where treasury_account_id = p_treasury and op_date between v_desde and v_hasta and status not in ('casado', 'ignorado');
  -- B02 · Los traspasos que esperan el extracto de otra cuenta (siguen sin casar: cuentan en sueltos).
  select count(*), coalesce(jsonb_agg(distinct coalesce(proposal->>'esperaExtracto', 'otra cuenta')), '[]'::jsonb)
    into v_espera, v_espera_de from public.bank_movement
   where treasury_account_id = p_treasury and op_date between v_desde and v_hasta and status = 'espera_extracto';
  return jsonb_build_object('mes', v_desde, 'hasta', v_hasta, 'cuenta', v_572, 'saldo_banco', v_banco, 'extracto_hasta', v_extracto,
    'saldo_libro', v_libro, 'diferencia', case when v_banco is null then null else v_banco - v_libro end,
    'sueltos', v_n, 'sueltos_importe', v_suma,
    'saldo_contable', v_contable, 'apertura', v_apertura, 'esperan', v_espera, 'esperan_de', v_espera_de);
end $$;
revoke all on function public._bank_mes_estado(uuid, date) from public, anon, authenticated;
