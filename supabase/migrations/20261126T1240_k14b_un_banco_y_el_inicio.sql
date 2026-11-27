-- supabase/migrations/20261126T1240_k14b_un_banco_y_el_inicio.sql
--
-- K14b · Un IBAN, un banco; y lo de antes del día de inicio, recalculado cuando cambia (26/11). Lo pagó QBO Integrity
-- el 26/11: al subir su extracto de DiezBank (que no trae IBAN), Sumied ofreció «Nuevo banco» y se dio de alta un
-- segundo banco con el IBAN del «CaixaBank» que ya había; y como cuando entraron no había día de inicio, sus 708
-- movimientos de junio a octubre quedaron con before_cutover = false, y el agente validó 37 asientos de antes.
--
-- cambia: public.bank_cuenta_alta(uuid,text,text,text,text,uuid,boolean) · prueba: supabase/staging/sql/20261126_k14b_un_banco_y_el_inicio_prueba.sql
-- cambia: public.bank_settings · prueba: supabase/staging/sql/20261126_k14b_un_banco_y_el_inicio_prueba.sql
-- cambia: public.fiscal_year · prueba: supabase/staging/sql/20261126_k14b_un_banco_y_el_inicio_prueba.sql
--
--   1. bank_cuenta_alta (misma firma, con su respaldo): un banco con un IBAN que ya tiene otro banco activo de la empresa
--      no se da de alta; lo dice, con el nombre del que ya lo tiene. La usa también bank_cuenta_nueva (S01d), que crea
--      la subcuenta antes: el error la deshace entera.
--   2. _bank_antes_del_inicio_recalcular(empresa), nueva: before_cutover de cada movimiento de la empresa según su día
--      de inicio (_conta_corte). Lo que cambia y no está casado vuelve a «pendiente», sin su propuesta, para que el
--      agente lo vuelva a mirar como lo que es ahora. Lo casado no se toca (se dice cuántos).
--   3. Dos disparadores nuevos que la llaman cuando cambia el día de inicio: bank_settings.cutover_date y los ejercicios
--      (fiscal_year: imported_until, origin, ends_on, starts_on), de donde sale _conta_corte.
--   4. _bank_juntar(queda, se_va), nueva: junta dos bancos de la misma empresa en uno. Todo lo que apunta al que se va
--      (movimientos, extractos y cualquier otra tabla con clave ajena a treasury_account, leídas de pg_constraint) pasa
--      al que queda; sus enlaces al plan se quitan y el banco se borra. No borra ningún movimiento.
--
-- Nada en el camino del pedido. Vuelta atrás: supabase/vuelta-atras/20261126T1240_k14b_un_banco_y_el_inicio.down.sql

select public._respaldar_funcion('public.bank_cuenta_alta(uuid,text,text,text,text,uuid,boolean)', '20261126T1240_k14b_un_banco_y_el_inicio');

create or replace function public.bank_cuenta_alta(p_company uuid, p_kind text, p_nombre text, p_iban text, p_cuenta_contable text,
                                                   p_local uuid, p_comun boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._bank_cuenta_de_empresa(p_company); v_id uuid; v_ca uuid; v_ya text;
begin
  if p_kind not in ('bank', 'card') then raise exception 'Una cuenta del banco es «bank» o «card».' using errcode = '23514'; end if;
  if p_kind = 'bank' and coalesce(trim(p_iban), '') = '' then
    raise exception 'Una cuenta del banco necesita su IBAN: escríbelo o súbela desde su primer extracto, que lo trae.' using errcode = '23514';
  end if;
  -- P1: la pregunta se contesta al dar de alta: un local o «común», nunca supuesto.
  if (p_local is null) = (coalesce(p_comun, false) = false) then
    raise exception '¿De qué local es esta cuenta? Elige un local o «común».' using errcode = '23514';
  end if;
  if p_local is not null and not exists (select 1 from public.locations where id = p_local and account_id = v_cuenta) then
    raise exception 'Ese local no es de la cuenta.' using errcode = '23514';
  end if;
  -- K14b (26/11): un IBAN, un banco. Si la empresa ya tiene un banco con ese IBAN, no se crea otro: el extracto va a
  -- ése (el 26/11, QBO Integrity se quedó con dos bancos del mismo IBAN al subir su extracto de DiezBank).
  select t.name into v_ya from public.treasury_account t
   where t.company_id = p_company and t.is_active and t.iban is not null
     and t.iban = nullif(upper(replace(coalesce(p_iban, ''), ' ', '')), '');
  if v_ya is not null then
    raise exception 'Ese IBAN ya es del banco «%»: el extracto va a ese, no se crea otro.', v_ya using errcode = '23505';
  end if;
  if p_cuenta_contable is not null then
    select id into v_ca from public.company_account where company_id = p_company and code = p_cuenta_contable;
    if v_ca is null or p_cuenta_contable not like '57%' then
      raise exception 'La cuenta % no está en el plan o no es de tesorería (57).', p_cuenta_contable using errcode = '23514';
    end if;
    if exists (select 1 from public.company_account_link where company_account_id = v_ca and entity = 'bank_account') then
      raise exception 'La cuenta % ya es de otro banco de Folvy.', p_cuenta_contable using errcode = '23514';
    end if;
  end if;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active, created_by, location_id)
  values (v_cuenta, p_company, p_kind, trim(p_nombre), nullif(upper(replace(coalesce(p_iban, ''), ' ', '')), ''), '572', false, true, auth.uid(), p_local)
  returning id into v_id;
  if v_ca is not null then
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, p_company, v_ca, 'bank_account', v_id::text, 'principal', 'manual', auth.uid());
  end if;
  return v_id;
end $$;
comment on function public.bank_cuenta_alta(uuid, text, text, text, text, uuid, boolean) is
  'B01 · Da de alta un banco o una tarjeta con su IBAN. K14b: nunca un segundo banco con el IBAN de otro activo de la empresa.';

-- ── 2 · Lo de antes del día de inicio ───────────────────────────────────────
create or replace function public._bank_antes_del_inicio_recalcular(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dia date := public._conta_corte(p_company); v_antes int; v_ahora int; v_vuelven int; v_casados int;
begin
  -- Lo casado o ignorado, y lo que espera a que se diga si es repetido, cambia solo de lado; lo demás vuelve a pendiente.
  with c as (
    update public.bank_movement m set before_cutover = (v_dia is not null and m.op_date < v_dia),
           status = case when m.status in ('casado', 'ignorado', 'posible_repetido') then m.status else 'pendiente' end,
           confidence = case when m.status in ('casado', 'ignorado', 'posible_repetido') then m.confidence end,
           reason = case when m.status in ('casado', 'ignorado', 'posible_repetido') then m.reason end,
           proposal = case when m.status in ('casado', 'ignorado', 'posible_repetido') then m.proposal end,
           updated_at = now()
     where m.company_id = p_company and m.before_cutover is distinct from (v_dia is not null and m.op_date < v_dia)
     returning m.before_cutover as antes, m.status)
  select count(*) filter (where antes), count(*) filter (where not antes), count(*) filter (where status = 'pendiente'),
         count(*) filter (where status in ('casado', 'ignorado'))
    into v_antes, v_ahora, v_vuelven, v_casados from c;
  return jsonb_build_object('dia_de_inicio', v_dia, 'pasan_a_antes', v_antes, 'pasan_a_despues', v_ahora,
                            'vuelven_a_mirarse', v_vuelven, 'casados_sin_tocar', v_casados);
end $$;
comment on function public._bank_antes_del_inicio_recalcular(uuid) is
  'K14b · Pone before_cutover de los movimientos de la empresa según su día de inicio (_conta_corte). Lo que cambia y no está casado vuelve a «pendiente» sin su propuesta. Lo llaman los disparadores del día de inicio.';
revoke all on function public._bank_antes_del_inicio_recalcular(uuid) from public, anon, authenticated;

create or replace function public._tg_bank_inicio_cambia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._bank_antes_del_inicio_recalcular(coalesce(new.company_id, old.company_id));
  return null;
end $$;
revoke all on function public._tg_bank_inicio_cambia() from public, anon, authenticated;

drop trigger if exists trg_bank_settings_inicio_cambia on public.bank_settings;
create trigger trg_bank_settings_inicio_cambia after insert or update of cutover_date or delete on public.bank_settings
  for each row execute function public._tg_bank_inicio_cambia();
drop trigger if exists trg_fiscal_year_inicio_cambia on public.fiscal_year;
create trigger trg_fiscal_year_inicio_cambia after insert or update of imported_until, origin, starts_on, ends_on or delete on public.fiscal_year
  for each row execute function public._tg_bank_inicio_cambia();

-- ── 4 · Juntar dos bancos en uno ─────────────────────────────────────────────
create or replace function public._bank_juntar(p_queda uuid, p_se_va uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q public.treasury_account; v_v public.treasury_account; r record; v_n bigint; v_movidos jsonb := '{}'::jsonb;
begin
  select * into v_q from public.treasury_account where id = p_queda for update;
  select * into v_v from public.treasury_account where id = p_se_va for update;
  if v_q.id is null or v_v.id is null then raise exception 'Uno de los dos bancos no existe.' using errcode = 'P0002'; end if;
  if v_q.id = v_v.id then raise exception 'Es el mismo banco.' using errcode = '22023'; end if;
  if v_q.company_id <> v_v.company_id then raise exception 'Los dos bancos no son de la misma empresa.' using errcode = '22023'; end if;
  for r in
    select c.conrelid::regclass as tabla, a.attname as columna
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.treasury_account'::regclass and cardinality(c.conkey) = 1
     order by 1, 2
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tabla, r.columna, r.columna) using p_queda, p_se_va;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_movidos := v_movidos || jsonb_build_object(r.tabla::text || '.' || r.columna, v_n); end if;
  end loop;
  delete from public.company_account_link where entity = 'bank_account' and entity_id = p_se_va::text;
  delete from public.treasury_account where id = p_se_va;
  return jsonb_build_object('queda', p_queda, 'se_va', p_se_va, 'movido', v_movidos);
end $$;
comment on function public._bank_juntar(uuid, uuid) is
  'K14b · Junta dos bancos de la misma empresa: todo lo que apunta al que se va pasa al que queda (cada clave ajena a treasury_account), se quitan sus enlaces al plan y se borra. Ningún movimiento se borra.';
revoke all on function public._bank_juntar(uuid, uuid) from public, anon, authenticated;
