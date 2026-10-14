-- supabase/vuelta-atras/20261111T0300_c06_traer_listo.down.sql
--
-- Vuelta atrás de 20261111T0300_c06_traer_listo.sql: conta_diez_subcuentas
-- vuelve a su cuerpo de producción del 13/10 (md5 33572edaa7e05e1bab66e024168d0036),
-- y se quitan conta_diez_listo, el disparador y la columna name_pending.
--
-- PARA si hay subcuentas esperando nombre: quitar la columna borraría la marca
-- de «sin nombre en Diez · pónselo» y nadie sabría que hay que ponérselo.

do $$
begin
  if exists (select 1 from public.company_account where name_pending) then
    raise exception 'Hay subcuentas «sin nombre en Diez» esperando nombre: la vuelta atrás borraría la marca. Ponles nombre antes.';
  end if;
end $$;

drop function if exists public.conta_diez_listo(uuid);
drop trigger if exists company_account_nombre_puesto on public.company_account;
drop function if exists public.company_account_nombre_puesto();

CREATE OR REPLACE FUNCTION public.conta_diez_subcuentas(p_company uuid, p_run uuid, p_cuentas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta uuid; v_plan text; v_d int; x jsonb; v_code text; v_hoja text; v_nombre text;
  n_nuevas int := 0; n_estaban int := 0; rechazos jsonb := '[]'::jsonb;
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
    else
      if v_nombre is null then
        rechazos := rechazos || jsonb_build_object('code', v_code, 'motivo', 'Diez no le da nombre'); continue;
      end if;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_id)
      values (v_cuenta, p_company, v_plan, v_code, v_hoja, v_nombre, 'own', 'migrated', 'Diez (traída)', v_nombre, null);
    end if;
    n_nuevas := n_nuevas + 1;
  end loop;
  return jsonb_build_object('nuevas', n_nuevas, 'estaban', n_estaban, 'rechazadas', rechazos);
end $function$;

alter table public.company_account drop column if exists name_pending;
