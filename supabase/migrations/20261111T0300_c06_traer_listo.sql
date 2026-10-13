-- ============================================================================
-- C06 · TRAER DE DIEZ: los pasos de antes y la subcuenta sin nombre
-- ----------------------------------------------------------------------------
-- cambia: public.conta_diez_subcuentas · prueba: supabase/staging/sql/20261111_c06_traer_listo_prueba.sql
--
-- Respuesta 3 de Julio (13/10), punto 1.2. Una empresa nueva necesita, antes de
-- traer de Diez, su plan y su cuenta de banco. Eso va en el alta y en este
-- orden: 1) datos de la empresa, 2) plan, 3) banco, 4) traer de Diez. Si falta
-- un paso, la pantalla dice cuál, con un botón para hacerlo. Y nunca se
-- inventan nombres de subcuenta: la que llega de Diez sin nombre queda
-- «sin nombre en Diez · pónselo» en la lista de lo pendiente.
--
-- Lo que hace:
--   1. company_account.name_pending (no nula, por defecto false): la subcuenta
--      espera a que alguien le ponga nombre. En todas las de hoy, false: nada
--      cambia para ellas. Un disparador la vuelve false en cuanto el nombre
--      cambia (company_account_rename, o cualquier otro camino).
--   2. conta_diez_subcuentas, MISMA firma y el cuerpo de producción del 13/10
--      (pg_get_functiondef, md5 33572edaa7e05e1bab66e024168d0036), con UN
--      cambio: la subcuenta propia que Diez trae sin nombre ya no se rechaza
--      (antes ponía la tanda en rojo); entra con el nombre de su cuenta del
--      plan oficial —el de la norma, no uno inventado— y name_pending = true.
--      Devuelve además «sinNombre» con sus códigos. Lo demás, igual: lo que ya
--      estaba, la de serie de su hoja, los dígitos y la hoja. Foodint: su
--      histórico ya está traído y ninguna de sus subcuentas llegó sin nombre
--      (si no, la tanda habría salido en rojo); no le cambia nada.
--   3. conta_diez_listo(empresa): los cuatro pasos y el primero que falta.
--      Lo leen la pantalla (el cliente, de su empresa) y el workflow del
--      histórico (que no trae nada si falta uno).
--
-- Vuelta atrás: supabase/vuelta-atras/20261111T0300_c06_traer_listo.down.sql
-- ============================================================================

-- 1 · La marca de «sin nombre».
alter table public.company_account add column if not exists name_pending boolean not null default false;
comment on column public.company_account.name_pending is
  'C06 · La subcuenta llegó de Diez sin nombre: lleva el de su cuenta del plan y espera a que alguien le ponga el suyo («sin nombre en Diez · pónselo»).';

create or replace function public.company_account_nombre_puesto()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.name is distinct from old.name then new.name_pending := false; end if;
  return new;
end;
$$;

drop trigger if exists company_account_nombre_puesto on public.company_account;
create trigger company_account_nombre_puesto before update of name on public.company_account
  for each row execute function public.company_account_nombre_puesto();

-- 2 · Las subcuentas de Diez: la que llega sin nombre entra, marcada.
CREATE OR REPLACE FUNCTION public.conta_diez_subcuentas(p_company uuid, p_run uuid, p_cuentas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta uuid; v_plan text; v_d int; x jsonb; v_code text; v_hoja text; v_nombre text;
  n_nuevas int := 0; n_estaban int := 0; rechazos jsonb := '[]'::jsonb; sin_nombre jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.import_run r where r.id = p_run and r.company_id = p_company and r.status = 'en_curso') then
    raise exception 'Esa lectura no es de esta empresa o ya terminó.' using errcode = '23514';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits into v_plan, v_d
    from public.company_tax_profile p where p.company_id = p_company;
  if v_plan is null then raise exception 'La empresa no tiene plan contable elegido.' using errcode = '23514'; end if;
  if jsonb_typeof(p_cuentas) <> 'array' then raise exception 'Falta la lista de subcuentas.' using errcode = '22023'; end if;

  for x in select * from jsonb_array_elements(p_cuentas) loop
    v_code := trim(x ->> 'code'); v_nombre := nullif(trim(x ->> 'nombre'), '');
    if exists (select 1 from public.company_account where company_id = p_company and code = v_code) then
      n_estaban := n_estaban + 1; continue;
    end if;
    if v_code !~ ('^[0-9]{' || v_d || '}$') then
      rechazos := rechazos || jsonb_build_object('code', v_code, 'motivo', format('no tiene %s dígitos', v_d)); continue;
    end if;
    -- La hoja: la cuenta sin hijas del plan más larga que empieza el código.
    select a.code into v_hoja from public.pgc_account a
     where a.plan = v_plan and a.is_leaf and a.valid_to is null and v_code like a.code || '%'
     order by length(a.code) desc limit 1;
    if v_hoja is null then
      rechazos := rechazos || jsonb_build_object('code', v_code, 'motivo', 'no cuelga de ninguna cuenta del plan'); continue;
    end if;
    if v_code = rpad(v_hoja, v_d, '0') then
      -- Es la de serie de su hoja y no está activada: se activa como de serie.
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name, name_source, import_id)
      select v_cuenta, p_company, v_plan, v_code, a.code, a.name, a.plain_name, 'template', 'serie', 'Diez (traída)', v_nombre, null
        from public.pgc_account a where a.plan = v_plan and a.code = v_hoja and a.valid_to is null;
    elsif v_nombre is null then
      -- C06: Diez no le da nombre. No se inventa: lleva el de su cuenta del
      -- plan oficial y queda pendiente de que alguien le ponga el suyo.
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_id, name_pending)
      select v_cuenta, p_company, v_plan, v_code, v_hoja, a.name, 'own', 'migrated', 'Diez (traída)', null, null, true
        from public.pgc_account a where a.plan = v_plan and a.code = v_hoja and a.valid_to is null;
      sin_nombre := sin_nombre || to_jsonb(v_code);
    else
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_id)
      values (v_cuenta, p_company, v_plan, v_code, v_hoja, v_nombre, 'own', 'migrated', 'Diez (traída)', v_nombre, null);
    end if;
    n_nuevas := n_nuevas + 1;
  end loop;
  return jsonb_build_object('nuevas', n_nuevas, 'estaban', n_estaban, 'rechazadas', rechazos, 'sinNombre', sin_nombre);
end $function$;

-- 3 · Los cuatro pasos y el primero que falta.
create or replace function public.conta_diez_listo(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
  v_datos boolean; v_plan boolean; v_banco boolean; v_base text; v_traido boolean; v_fallo text;
  v_sin_nombre int;
begin
  select account_id, setup_completed_at is not null into v_cuenta, v_datos from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  -- El cliente, solo de su cuenta; Folvy (service_role, sin usuario), de todas.
  if auth.uid() is not null and not (v_cuenta = any (public.current_user_account_ids())) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  v_plan := exists (select 1 from public.company_tax_profile p where p.company_id = p_company)
        and exists (select 1 from public.company_account a where a.company_id = p_company);
  v_banco := exists (select 1 from public.company_account a where a.company_id = p_company and a.code like '572%' and a.status = 'activa');
  select b.nombre_bd into v_base from public.conta_diez_base b where b.company_id = p_company;
  v_traido := exists (select 1 from public.import_run r where r.company_id = p_company and r.program = 'diez' and r.kind = 'historico' and r.status = 'hecho');
  select r.error into v_fallo from public.import_run r
   where r.company_id = p_company and r.program = 'diez' and r.kind = 'historico' and r.status = 'fallido'
     and not v_traido order by r.finished_at desc nulls last limit 1;
  select count(*) into v_sin_nombre from public.company_account a where a.company_id = p_company and a.name_pending;
  return jsonb_build_object(
    'pasos', jsonb_build_array(
      jsonb_build_object('paso', 'datos', 'hecho', v_datos),
      jsonb_build_object('paso', 'plan', 'hecho', v_plan),
      jsonb_build_object('paso', 'banco', 'hecho', v_banco),
      jsonb_build_object('paso', 'diez', 'hecho', v_traido, 'base', v_base, 'fallo', v_fallo)),
    'falta', case when not v_datos then 'datos' when not v_plan then 'plan' when not v_banco then 'banco'
                  when not v_traido then 'diez' end,
    'sinNombre', v_sin_nombre);
end;
$$;

revoke all on function public.conta_diez_listo(uuid) from public, anon;
grant execute on function public.conta_diez_listo(uuid) to authenticated, service_role;
