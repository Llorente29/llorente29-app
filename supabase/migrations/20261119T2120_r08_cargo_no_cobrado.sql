-- supabase/migrations/20261119T2120_r08_cargo_no_cobrado.sql
--
-- R08 · 3 · El recibo que el banco no cobró, por la cadena de extractos.
--
-- Lo que pasó el 19/11: un Vodafone de 31,50 se coló como cobrado y Julio tuvo que bajar el
-- extracto para saberlo. El banco cerraba en 0,00 y Sumied decía −31,50.
--   1. _bank_cargos_anulados (el texto de la 0055 del B01s, md5 5f152fba…) mide el hueco de
--      cada extracto por la CADENA: su cierre contra el cierre del extracto anterior de la
--      misma cuenta (fecha final y, a igual fecha, el que llegó antes) más lo nuevo que trae.
--      No usa la apertura que guarda la lectura, que el lector se inventa (cierre − lo nuevo).
--      Lo demás, igual: un hueco positivo sin su contrario en la misma cuenta, y una sola
--      forma de sumarlo con 1 a 4 cargos del mismo día. Misma firma (regla 2); la de antes,
--      al respaldo.
--   2. bank_apartar_no_cobrados(empresa) (NUEVA): aparta, con bank_ignorar y el motivo
--      «Anulado por el banco: no había saldo», cada cargo que señala el detector y que no
--      está conciliado. Lo conciliado no lo toca: se queda en el aviso para quien sabe.
--      Devuelve lo apartado, para decirlo en pantalla.
-- No está en el camino del pedido.
-- cambia: public._bank_cargos_anulados · prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261119T2120_r08_cargo_no_cobrado.down.sql

set local lock_timeout = '5s';

do $$ begin
  if md5(pg_get_functiondef('public._bank_cargos_anulados(uuid)'::regprocedure)) <> '5f152fbae949adbb4f09190aae710171' then
    raise exception 'R08 · 2120: _bank_cargos_anulados no es el medido (5f152fba): no se toca nada.';
  end if;
end $$;

select public._respaldar_funcion('public._bank_cargos_anulados(uuid)', '20261119T2120_r08_cargo_no_cobrado');

create or replace function public._bank_cargos_anulados(p_company uuid)
returns table (statement_id uuid, treasury_account_id uuid, dia date, saldo_banco numeric, hueco numeric, ids uuid[])
language sql stable security definer set search_path = public as $$
  with recursive cad as (
    select st.id, st.treasury_account_id, st.closing_balance,
           lag(st.closing_balance) over (partition by st.treasury_account_id order by st.period_to, st.imported_at, st.id) as anterior,
           (select coalesce(sum(m.amount), 0) from public.bank_movement m where m.statement_id = st.id) as nuevo
      from public.bank_statement st
     where st.company_id = p_company and st.closing_balance is not null
  ), g as (
    select cad.id, cad.treasury_account_id, cad.closing_balance, round((cad.closing_balance - (cad.anterior + cad.nuevo)) * 100)::bigint as gap_c
      from cad where cad.anterior is not null
  ), s as (
    select g.* from g
     where g.gap_c > 0
       and not exists (select 1 from g o where o.treasury_account_id = g.treasury_account_id and o.id <> g.id and o.gap_c = -g.gap_c)
  ), c as (
    select s.id as sid, m.id, m.op_date, round(-m.amount * 100)::bigint as cent,
           row_number() over (partition by s.id, m.op_date order by m.id) as n
      from s join public.bank_movement m on m.statement_id = s.id and m.treasury_account_id = s.treasury_account_id
     where m.amount < 0 and m.status <> 'ignorado' and m.not_cancelled_at is null
  ), r (sid, op_date, ids, total, ult) as (
    select c.sid, c.op_date, array[c.id], c.cent, c.n from c join s on s.id = c.sid where c.n <= 15 and c.cent <= s.gap_c
    union all
    select r.sid, r.op_date, r.ids || c.id, r.total + c.cent, c.n
      from r join c on c.sid = r.sid and c.op_date = r.op_date and c.n > r.ult and c.n <= 15 join s on s.id = r.sid
     where cardinality(r.ids) < 4 and r.total + c.cent <= s.gap_c
  ), hit as (
    select r.sid, r.op_date, r.ids from r join s on s.id = r.sid where r.total = s.gap_c
  ), unica as (
    select h.sid from hit h group by h.sid having count(*) = 1
  )
  select s.id, s.treasury_account_id, h.op_date, s.closing_balance, s.gap_c / 100.0, h.ids
    from s join unica u on u.sid = s.id join hit h on h.sid = s.id
$$;
revoke all on function public._bank_cargos_anulados(uuid) from public, anon, authenticated, service_role;

create or replace function public.bank_apartar_no_cobrados(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_motivo constant text := 'Anulado por el banco: no había saldo';
  a record; m record; v_out jsonb := '[]'::jsonb;
begin
  perform public._bank_cuenta_de_empresa(p_company);
  for a in select * from public._bank_cargos_anulados(p_company) loop
    for m in select bm.* from public.bank_movement bm where bm.id = any(a.ids) and bm.status in ('pendiente', 'propuesto', 'por_aclarar') order by bm.amount, bm.id loop
      perform public.bank_ignorar(m.id, v_motivo);
      v_out := v_out || jsonb_build_object('id', m.id, 'fecha', m.op_date, 'importe', m.amount,
                                           'concepto', coalesce(nullif(m.clean_concept, ''), m.bank_concept), 'banco', a.treasury_account_id);
    end loop;
  end loop;
  return v_out;
end $$;
comment on function public.bank_apartar_no_cobrados(uuid) is
  'R08 · Aparta («Anulado por el banco: no había saldo») cada cargo sin conciliar que el detector de cargos anulados señala por la cadena de extractos. Lo conciliado se queda en el aviso. Devuelve lo apartado.';
revoke all on function public.bank_apartar_no_cobrados(uuid) from public, anon;
grant execute on function public.bank_apartar_no_cobrados(uuid) to authenticated;
