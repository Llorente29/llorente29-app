-- Vuelta atrás de 20261010T0120_c04_funciones.sql. PARA si hay asientos
-- validados: sin las funciones que los validan y comprueban su cadena, el libro
-- quedaría sin manera de anularlos ni de comprobarse.
do $$
begin
  if exists (select 1 from public.journal_entry where status in ('validado', 'anulado')) then
    raise exception 'Hay asientos validados: no se quitan las funciones que los validan, anulan y comprueban.';
  end if;
end $$;

drop function if exists public.conta_dias_por_asentar(uuid, date, date);
drop function if exists public.conta_devoluciones_del_dia(uuid, uuid, date);
drop function if exists public.conta_pedidos_del_dia(uuid, uuid, date);
drop function if exists public.conta_json_seguro(text);
drop function if exists public.conta_fijar_corte(uuid, date, text);
drop function if exists public.journal_entry_descartar(uuid, text, text);
drop function if exists public.journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text);
drop trigger if exists trg_treasury_account_local on public.treasury_account;
drop function if exists public.treasury_account_local_de_la_cuenta();
drop function if exists public.journal_cadena_comprobar(uuid);
drop function if exists public.journal_entry_anular(uuid, text, date, text);
drop function if exists public.journal_entry_validar(uuid, text);
drop function if exists public.conta_primer_dia_abierto(uuid, date);
drop function if exists public.journal_huella(text, text);
drop function if exists public.journal_entry_canonico(uuid);

-- conta_reabrir_mes vuelve a ser la del C00 (20261003T0110), literal.
create or replace function public.conta_reabrir_mes(p_company uuid, p_mes date, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_mes date := date_trunc('month', p_mes)::date; v_ultimo date; v_id uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta puede reabrir meses' using errcode = '42501';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Para reabrir un mes hay que decir por qué' using errcode = '23514';
  end if;
  select max(month) into v_ultimo from public.fiscal_period_lock where company_id = p_company and reopened_at is null;
  if v_ultimo is distinct from v_mes then
    raise exception 'Solo se puede reabrir el último mes cerrado: %', coalesce(to_char(v_ultimo, 'MM/YYYY'), 'no hay ninguno')
      using errcode = '23514';
  end if;
  update public.fiscal_period_lock
     set reopened_at = now(), reopened_by = auth.uid(), reopened_by_name = public.conta_nombre_actor(), reopen_reason = trim(p_motivo)
   where company_id = p_company and month = v_mes and reopened_at is null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'mes', v_mes);
end $$;
