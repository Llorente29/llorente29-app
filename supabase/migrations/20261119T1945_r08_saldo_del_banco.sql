-- supabase/migrations/20261119T1945_r08_saldo_del_banco.sql
--
-- R08 · 1 · El saldo del banco, el bueno, y el de Sumied con lo que está en el diario. SOLO AÑADE.
--
-- Lo que vivió Julio el 19/11: Revolut trajo cinco extractos ese día con la misma fecha
-- final, y la pantalla cogía uno del medio («No cuadra · Banco 5.353,99» cuando cuadraba
-- a 549,22). Y «Cuadra» contaba también lo propuesto, que no está en el diario.
--   · bank_saldo_extracto(banco, hasta): el cierre del ÚLTIMO extracto de la cadena hasta
--     esa fecha (fecha final y, a igual fecha, el que llegó el último), con su fecha y
--     su hora de llegada.
--   · bank_saldo_diario(empresa, hasta, cuenta): el saldo de la cuenta con lo que está en
--     el diario (validado; lo anulado, con su contraasiento, suma cero).
-- Funciones nuevas: no cambian ninguna que exista. Se pueden pasar dos veces.
-- Prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261119T1945_r08_saldo_del_banco.down.sql

create or replace function public.bank_saldo_extracto(p_treasury uuid, p_hasta date)
returns table (saldo numeric, hasta date, llego timestamptz, extracto uuid)
language sql stable security invoker set search_path = public as $$
  select s.closing_balance, s.period_to, s.imported_at, s.id
    from public.bank_statement s
   where s.treasury_account_id = p_treasury and s.closing_balance is not null and s.period_to <= p_hasta
   order by s.period_to desc, s.imported_at desc, s.id desc
   limit 1
$$;
comment on function public.bank_saldo_extracto(uuid, date) is
  'R08 · El saldo del banco a una fecha: el cierre del último extracto de la cadena (fecha final y, a igual fecha, el último que llegó). Lee con los permisos de quien llama.';
revoke all on function public.bank_saldo_extracto(uuid, date) from public, anon;
grant execute on function public.bank_saldo_extracto(uuid, date) to authenticated;

create or replace function public.bank_saldo_diario(p_company uuid, p_hasta date, p_cuenta text)
returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
    from public.company_account ca
    join public.journal_line jl on jl.company_account_id = ca.id
    join public.journal_entry je on je.id = jl.entry_id
   where ca.company_id = p_company and ca.code = p_cuenta
     and je.status in ('validado', 'anulado') and je.entry_date <= p_hasta and je.source_type <> 'closing'
$$;
comment on function public.bank_saldo_diario(uuid, date, text) is
  'R08 · El saldo de una cuenta a una fecha con lo que está en el diario (validado; un anulado y su contraasiento suman cero). Lo propuesto no cuenta. Lee con los permisos de quien llama.';
revoke all on function public.bank_saldo_diario(uuid, date, text) from public, anon;
grant execute on function public.bank_saldo_diario(uuid, date, text) to authenticated;
