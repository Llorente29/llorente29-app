-- supabase/migrations/20261107T0055_b01s_cargo_anulado.sql
--
-- B01·20 · El cargo que el banco anula (maqueta aprobada por Julio, 07/11).
--
-- Lo que pasó el 30/10: el BBVA apuntó tres cargos sin saldo y los anuló horas
-- después. La lectura los cogió antes, la anulación nunca llegó, y Sumied y el
-- banco dejaron de cuadrar en justo lo que sumaban (B01·19). Esto lo detecta
-- solo y lo enseña en Bancos, en la cuenta, para que lo quite quien sabe.
--
-- Cuándo hay aviso (bank_cargos_anulados), y solo entonces, sin adivinar:
--   · un extracto con saldo y un HUECO POSITIVO con el anterior (el banco dice
--     más dinero del que Sumied espera: continuity = 'hueco', gap > 0);
--   · ningún otro extracto de la misma cuenta tiene el hueco CONTRARIO (si lo
--     tiene, era un retraso del banco: lo descontó un día y nos dio el
--     movimiento al siguiente, como el −200,00 de ···0133 del 03-04/11);
--   · entre los cargos de ese extracto (sin apartar y sin «No, es bueno»), del
--     mismo día, hay UNA sola forma (de 1 a 4 cargos, de los 15 primeros del
--     día) de sumar exactamente el hueco. Ninguna o más de una: no hay aviso.
--   Así el saldo del banco ese día no bajó por esos cargos: con ellos, Sumied
--   queda por debajo justo en lo que suman.
--
-- Qué se añade (todo nuevo; nada de lo que existe cambia):
--   · bank_movement.not_cancelled_at / not_cancelled_by: «No, es bueno».
--   · _bank_cargos_anulados (sin comprobar quién, solo para las de abajo).
--   · bank_cargos_anulados(empresa): los avisos, para la pantalla.
--   · bank_anulado_quitar(empresa, extracto): deshace el casado si lo hay y
--     aparta cada cargo con bank_ignorar («Anulado por el banco: no había
--     saldo»), el mismo camino que «Apartar». Devuelve lo que se dice.
--   · bank_anulado_es_bueno(empresa, extracto): el aviso no vuelve.
--   · bank_desapartar(movimiento): deshace un «Apartar» (no existía): vuelve a
--     pendiente, con su línea en el historial, para que el motor lo mire.
--
-- Vuelta atrás: supabase/vuelta-atras/20261107T0055_b01s_cargo_anulado.down.sql

alter table public.bank_movement add column if not exists not_cancelled_at timestamptz;
alter table public.bank_movement add column if not exists not_cancelled_by uuid;
comment on column public.bank_movement.not_cancelled_at is
  'B01·20 · «No, es bueno»: quien lo dijo cuándo; el aviso de cargo anulado por el banco no vuelve para este cargo.';

create or replace function public._bank_cargos_anulados(p_company uuid)
returns table (statement_id uuid, treasury_account_id uuid, dia date, saldo_banco numeric, hueco numeric, ids uuid[])
language sql stable security definer set search_path = public as $$
  with recursive s as (
    select st.id, st.treasury_account_id, st.closing_balance, round(st.continuity_gap * 100)::bigint as gap_c
      from public.bank_statement st
     where st.company_id = p_company and st.continuity = 'hueco' and st.continuity_gap > 0 and st.closing_balance is not null
       and not exists (select 1 from public.bank_statement o
                        where o.treasury_account_id = st.treasury_account_id and o.id <> st.id
                          and o.continuity = 'hueco' and o.continuity_gap = -st.continuity_gap)
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

create or replace function public.bank_cargos_anulados(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._bank_cuenta_de_empresa(p_company);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'extracto', a.statement_id, 'banco', a.treasury_account_id, 'dia', a.dia,
             'saldo_banco', a.saldo_banco, 'hueco', a.hueco,
             'cargos', (select jsonb_agg(jsonb_build_object(
                          'id', m.id, 'fecha', m.op_date, 'importe', m.amount,
                          'concepto', coalesce(nullif(m.clean_concept, ''), m.bank_concept),
                          'casado', (select e.concept from public.bank_match b left join public.journal_entry e on e.id = b.journal_entry_id
                                      where b.movement_id = m.id and b.status = 'vivo' limit 1),
                          'esta_casado', m.status = 'casado') order by m.amount, m.id)
                          from public.bank_movement m where m.id = any(a.ids)))
           order by a.dia, a.statement_id)
      from public._bank_cargos_anulados(p_company) a), '[]'::jsonb);
end $$;
revoke all on function public.bank_cargos_anulados(uuid) from public, anon;
grant execute on function public.bank_cargos_anulados(uuid) to authenticated;

create or replace function public.bank_anulado_quitar(p_company uuid, p_extracto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_motivo constant text := 'Anulado por el banco: no había saldo';
  a record; v_id uuid; v_match uuid; v_n int := 0; v_d int := 0;
begin
  perform public._bank_cuenta_de_empresa(p_company);
  select * into a from public._bank_cargos_anulados(p_company) x where x.statement_id = p_extracto;
  if a.statement_id is null then
    raise exception 'Ese aviso ya no está: el banco y Sumied ya cuadran o algo ha cambiado. Vuelve a cargar.' using errcode = 'P0002';
  end if;
  foreach v_id in array a.ids loop
    select b.id into v_match from public.bank_match b where b.movement_id = v_id and b.status = 'vivo' limit 1;
    if v_match is not null then perform public.bank_deshacer(v_match, v_motivo); v_d := v_d + 1; end if;
    perform public.bank_ignorar(v_id, v_motivo);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('n', v_n, 'suma', a.hueco, 'dia', a.dia, 'saldo_banco', a.saldo_banco, 'deshechos', v_d);
end $$;
revoke all on function public.bank_anulado_quitar(uuid, uuid) from public, anon;
grant execute on function public.bank_anulado_quitar(uuid, uuid) to authenticated;

create or replace function public.bank_anulado_es_bueno(p_company uuid, p_extracto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  perform public._bank_cuenta_de_empresa(p_company);
  select * into a from public._bank_cargos_anulados(p_company) x where x.statement_id = p_extracto;
  if a.statement_id is null then
    raise exception 'Ese aviso ya no está: vuelve a cargar.' using errcode = 'P0002';
  end if;
  update public.bank_movement set not_cancelled_at = now(), not_cancelled_by = auth.uid(), updated_at = now() where id = any(a.ids);
  return jsonb_build_object('n', cardinality(a.ids), 'suma', a.hueco, 'dia', a.dia);
end $$;
revoke all on function public.bank_anulado_es_bueno(uuid, uuid) from public, anon;
grant execute on function public.bank_anulado_es_bueno(uuid, uuid) to authenticated;

create or replace function public.bank_desapartar(p_movement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  if v_m.status <> 'ignorado' then raise exception 'Ese movimiento no está apartado.' using errcode = '23514'; end if;
  update public.bank_movement set status = 'pendiente', ignored_reason = null, reason = null, confidence = null, proposal = null, updated_at = now()
   where id = p_movement;
  perform public._bank_log(v_m.account_id, v_m.company_id, p_movement, null, null, 'deshecho', 'persona',
    'Deshecho el «Apartado»: ' || v_m.ignored_reason, '{}'::jsonb);
end $$;
revoke all on function public.bank_desapartar(uuid) from public, anon;
grant execute on function public.bank_desapartar(uuid) to authenticated;
