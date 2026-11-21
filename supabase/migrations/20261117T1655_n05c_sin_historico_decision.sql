-- supabase/migrations/20261117T1655_n05c_sin_historico_decision.sql
--
-- N05c · Empezar a trabajar sin el histórico (Julio, 17/11). 1 de 2: LO QUE AÑADE. No cambia
-- ninguna fila ni ninguna función que exista; la 20261117T1656 es la que hace que la decisión
-- valga al validar.
--
-- Hoy, un ejercicio traído a medias (mixed o migrated, con su programa) y sin el histórico
-- traído (history_imported_at nulo) no deja validar NADA de Sumied: conta_motivos_para_validar
-- para con «falta_historico». Protege la numeración (_journal_entry_validar numera max + 1 de su
-- serie: lo traído después chocaría con ux_journal_entry_numero) y el cierre (sin lo de antes,
-- la regularización, el cierre y la apertura saldrían mal).
--
--   1. La decisión, por ejercicio y explícita: quién y cuándo decidió trabajar sin el histórico
--      (fiscal_year.works_without_history_*, que admiten nulos). Las demás empresas, igual que hoy.
--   2. conta_trabajar_sin_historico: la toma (solo un administrador de la empresa).
--   3. conta_trabajar_sin_historico_retirar: la retira, mientras no haya ningún asiento de
--      Sumied validado desde el día de inicio.
--   4. _conta_falta_historico_motivo: el porqué de no validar, ya en palabras de la pantalla.
--      Con la decisión tomada, solo para lo anterior al día de inicio y los asientos de cierre
--      y de apertura (que siguen necesitando lo de antes).

alter table public.fiscal_year
  add column if not exists works_without_history_at timestamptz,
  add column if not exists works_without_history_by uuid,
  add column if not exists works_without_history_by_name text;

comment on column public.fiscal_year.works_without_history_at is
  'N05c: cuándo se decidió trabajar en Sumied sin haber traído todavía lo anterior al día de inicio (un ejercicio traído a medias sin history_imported_at). Nulo: sin decidir; entonces no se valida nada hasta traerlo.';

-- El programa de antes, en palabras: «de ERP10», «de Diez» o «del programa de antes».
create or replace function public._conta_de_programa(p_programa text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_programa, '')) when 'erp10' then 'de ERP10' when 'diez' then 'de Diez' else 'del programa de antes' end
$$;
revoke all on function public._conta_de_programa(text) from public, anon;
grant execute on function public._conta_de_programa(text) to authenticated, service_role;

-- El primer día de Sumied en ese ejercicio: el de la empresa (conta_dia_de_inicio); sin él, el
-- siguiente a lo traído del propio ejercicio.
create or replace function public._conta_inicio_del_ejercicio(p_y public.fiscal_year)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.conta_dia_de_inicio(p_y.company_id),
                  case when p_y.imported_until is not null then p_y.imported_until + 1 else p_y.ends_on + 1 end)
$$;
revoke all on function public._conta_inicio_del_ejercicio(public.fiscal_year) from public, anon, authenticated;
grant execute on function public._conta_inicio_del_ejercicio(public.fiscal_year) to service_role;

-- El porqué de no validar un asiento de un ejercicio traído a medias sin el histórico. Nulo: se puede.
create or replace function public._conta_falta_historico_motivo(p_entry uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_e public.journal_entry; v_y public.fiscal_year; v_inicio date; v_de text; v_dia text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or v_e.source_type = 'migrated' then return null; end if;
  -- La pantalla lo pregunta como usuario: solo de su cuenta.
  if auth.uid() is not null and not public.belongs_to_account(v_e.account_id) then return null; end if;
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_y.id is null or v_y.origin not in ('mixed', 'migrated') or v_y.origin_program is null or v_y.history_imported_at is not null then
    return null;
  end if;
  v_inicio := public._conta_inicio_del_ejercicio(v_y);
  v_de := public._conta_de_programa(v_y.origin_program);
  v_dia := to_char(v_inicio, 'DD/MM/YYYY');
  if v_y.works_without_history_at is null then
    return format('Lo anterior al %s todavía no se ha traído %s. Tráelo, o decide empezar a trabajar ya en Ajustes › Ejercicio.', v_dia, v_de);
  end if;
  if v_e.source_type in ('closing', 'opening') then
    return format('Para cerrar el ejercicio hace falta lo anterior al %s, que todavía no se ha traído %s. Tráelo antes de cerrar.', v_dia, v_de);
  end if;
  if v_e.entry_date < v_inicio then
    return format('Este asiento es del %s y lo anterior al %s todavía no se ha traído %s: no se contabiliza hasta traerlo.',
                  to_char(v_e.entry_date, 'DD/MM/YYYY'), v_dia, v_de);
  end if;
  return null;
end $$;

comment on function public._conta_falta_historico_motivo(uuid) is
  'N05c: el motivo de no validar un asiento de un ejercicio traído a medias sin el histórico. Sin decidir, no se valida nada. Con «empezar a trabajar ya», se valida desde el día de inicio, salvo el cierre y la apertura. Nulo: se puede validar. Lo usa conta_motivos_para_validar.';
revoke all on function public._conta_falta_historico_motivo(uuid) from public, anon;
grant execute on function public._conta_falta_historico_motivo(uuid) to authenticated, service_role;

-- Tomar la decisión ---------------------------------------------------------------------------------
create or replace function public.conta_trabajar_sin_historico(p_company uuid, p_ejercicio text, p_quien_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_y public.fiscal_year; v_inicio date; v_quien text;
begin
  select * into v_y from public.fiscal_year where company_id = p_company and code = p_ejercicio for update;
  if v_y.id is null then raise exception 'Ese ejercicio no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_y.account_id) then
    raise exception 'Esto lo decide un administrador de la empresa.' using errcode = '42501';
  end if;
  if v_y.origin not in ('mixed', 'migrated') or v_y.origin_program is null then
    raise exception 'En el ejercicio % no hay nada que traer de otro programa: ya se puede contabilizar.', v_y.code using errcode = '23514';
  end if;
  if v_y.history_imported_at is not null then
    raise exception 'Lo anterior ya está traído: ya se puede contabilizar.' using errcode = '23514';
  end if;
  v_inicio := public._conta_inicio_del_ejercicio(v_y);
  if v_y.works_without_history_at is not null then
    return jsonb_build_object('desde', v_inicio, 'yaEstaba', true,
      'texto', format('Ya estaba decidido: se trabaja sin lo anterior al %s desde el %s.', to_char(v_inicio, 'DD/MM/YYYY'),
                      to_char(v_y.works_without_history_at at time zone 'Europe/Madrid', 'DD/MM/YYYY')));
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  update public.fiscal_year set works_without_history_at = now(), works_without_history_by = auth.uid(), works_without_history_by_name = v_quien
   where id = v_y.id;
  return jsonb_build_object('desde', v_inicio, 'yaEstaba', false,
    'texto', format('Hecho. Ya puedes contabilizar desde el %s. Lo anterior lo traes cuando lo tengas.', to_char(v_inicio, 'DD/MM/YYYY')));
end $$;

comment on function public.conta_trabajar_sin_historico(uuid, text, text) is
  'N05c: «Empezar a trabajar ya» en un ejercicio traído a medias sin el histórico. Solo un administrador. Desde entonces se valida desde el día de inicio (salvo el cierre y la apertura).';
revoke all on function public.conta_trabajar_sin_historico(uuid, text, text) from public, anon;
grant execute on function public.conta_trabajar_sin_historico(uuid, text, text) to authenticated, service_role;

-- Retirarla ------------------------------------------------------------------------------------------
create or replace function public.conta_trabajar_sin_historico_retirar(p_company uuid, p_ejercicio text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_y public.fiscal_year; v_inicio date; v_n int;
begin
  select * into v_y from public.fiscal_year where company_id = p_company and code = p_ejercicio for update;
  if v_y.id is null then raise exception 'Ese ejercicio no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_y.account_id) then
    raise exception 'Esto lo decide un administrador de la empresa.' using errcode = '42501';
  end if;
  if v_y.works_without_history_at is null then
    return jsonb_build_object('retirada', false, 'texto', 'No había nada que retirar: no se había decidido empezar sin lo anterior.');
  end if;
  v_inicio := public._conta_inicio_del_ejercicio(v_y);
  select count(*) into v_n from public.journal_entry
   where company_id = p_company and fiscal_year_id = v_y.id and source_type <> 'migrated' and status = 'validado' and entry_date >= v_inicio;
  if v_n > 0 then
    raise exception 'No se puede retirar: ya hay % contabilizado% desde el %.', v_n || case when v_n = 1 then ' asiento' else ' asientos' end,
      case when v_n = 1 then '' else 's' end, to_char(v_inicio, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  update public.fiscal_year set works_without_history_at = null, works_without_history_by = null, works_without_history_by_name = null where id = v_y.id;
  return jsonb_build_object('retirada', true,
    'texto', format('Retirado: hasta traer lo anterior al %s, no se puede contabilizar.', to_char(v_inicio, 'DD/MM/YYYY')));
end $$;

comment on function public.conta_trabajar_sin_historico_retirar(uuid, text) is
  'N05c: retira «Empezar a trabajar ya», mientras no haya ningún asiento de Sumied validado desde el día de inicio. Solo un administrador.';
revoke all on function public.conta_trabajar_sin_historico_retirar(uuid, text) from public, anon;
grant execute on function public.conta_trabajar_sin_historico_retirar(uuid, text) to authenticated, service_role;
