-- supabase/vuelta-atras/20261111T0500_c06b_cuenta_lectura.down.sql
--
-- Vuelta atrás de 20261111T0500_c06b_cuenta_lectura.sql: conta_diez_subcuentas
-- vuelve al cuerpo de la 0300 (md5 9a545a02237517ed39048277b48e5612) y se
-- quita la columna import_run_id.
--
-- PARA si alguna subcuenta tiene ya su lectura escrita: quitar la columna
-- borraría la procedencia y el #178 volvería a salir. Antes, la vuelta atrás
-- de la 0510.

do $$
begin
  if exists (select 1 from public.company_account where import_run_id is not null) then
    raise exception 'Hay subcuentas con su lectura del histórico escrita: la vuelta atrás la borraría. Deshaz antes la 0510.';
  end if;
end $$;

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

alter table public.company_account drop column if exists import_run_id;
