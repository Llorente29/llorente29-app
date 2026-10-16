-- Vuelta atrás de B02 · T4 (0220): bank_proponer y _bank_mes_estado vuelven a
-- su cuerpo de la 0110 y la 0150 byte a byte, y el CHECK de bank_movement.status
-- a sus siete estados. Lo que esperaba el extracto pasa a «por aclarar» con su
-- porqué (lo tiene: el motor lo escribe siempre), y queda en el registro.
select public._bank_log(m.account_id, m.company_id, m.id, null, null, 'por_aclarar', 'folvy',
       'Vuelta atrás B02 · 0220: esperaba el extracto de su otra cuenta; queda por aclarar.', coalesce(m.proposal, '{}'::jsonb))
  from public.bank_movement m where m.status = 'espera_extracto';
update public.bank_movement set status = 'por_aclarar', updated_at = now() where status = 'espera_extracto';

alter table public.bank_movement drop constraint bank_movement_status_check,
  add constraint bank_movement_status_check
  check (status in ('pendiente', 'propuesto', 'por_aclarar', 'casado', 'posible_repetido', 'antes_corte_sin_pareja', 'ignorado'));

create or replace function public.bank_proponer(p_movement uuid, p_estado text, p_confianza text, p_porque text, p_propuesta jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if v_m.status in ('casado', 'ignorado') then raise exception 'Ese movimiento ya está casado o ignorado.' using errcode = '23514'; end if;
  if p_estado not in ('pendiente', 'propuesto', 'por_aclarar', 'antes_corte_sin_pareja') then
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
  select count(*), coalesce(sum(amount), 0) into v_n, v_suma from public.bank_movement
   where treasury_account_id = p_treasury and op_date between v_desde and v_hasta and status not in ('casado', 'ignorado');
  return jsonb_build_object('mes', v_desde, 'hasta', v_hasta, 'cuenta', v_572, 'saldo_banco', v_banco, 'extracto_hasta', v_extracto,
    'saldo_libro', v_libro, 'diferencia', case when v_banco is null then null else v_banco - v_libro end,
    'sueltos', v_n, 'sueltos_importe', v_suma);
end $$;
revoke all on function public._bank_mes_estado(uuid, date) from public, anon, authenticated;
