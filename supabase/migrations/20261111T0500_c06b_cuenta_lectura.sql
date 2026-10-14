-- ============================================================================
-- C06b · AVISO #178: DE QUÉ LECTURA DEL HISTÓRICO VIENE CADA SUBCUENTA
-- ----------------------------------------------------------------------------
-- cambia: public.conta_diez_subcuentas · prueba: supabase/staging/sql/20261111_c06b_cuenta_lectura_prueba.sql
--
-- Respuesta 5 de Julio, punto 2. El agente «Plan contable» da 27 rojos «Plan
-- traído» en Foodint (#178; informe del B01, docs/conta/B01_informe_aviso_178.md
-- en la rama conta/b01-bancos): las 27 subcuentas que dio de alta
-- conta_diez_subcuentas el 12/10 al traer el histórico. Son source 'migrated'
-- con import_id vacío A PROPÓSITO —no vienen de una importación del plan, sino
-- de una lectura del histórico (import_run)—, pero en company_account no queda
-- escrito de cuál, y el agente no tiene dónde mirarlo.
--
-- Lo que hace (añadir, y cambiar en caliente con la misma firma; ninguna fila
-- que exista se toca):
--   1. company_account.import_run_id, que admite nulos, con clave ajena a
--      import_run: la lectura del histórico que dio de alta la subcuenta. Todas
--      las de hoy quedan en null; rellenar las 27 es la 0510, con «autorizo».
--   2. conta_diez_subcuentas, MISMA firma y el cuerpo de producción del 14/10
--      (el de la 0300; pg_get_functiondef md5 9a545a02237517ed39048277b48e5612),
--      con UN cambio: las tres altas escriben import_run_id = p_run. Lo demás,
--      igual.
--
-- No está en el camino del pedido: company_account, y una función que solo
-- llama el importador de Diez con service_role.
--
-- Vuelta atrás: supabase/vuelta-atras/20261111T0500_c06b_cuenta_lectura.down.sql
-- ============================================================================

-- 1 · La procedencia.
alter table public.company_account add column if not exists import_run_id uuid references public.import_run(id);
comment on column public.company_account.import_run_id is
  'C06b · La lectura del histórico (import_run) que dio de alta la subcuenta. Con import_id (la importación del plan), los dos caminos por los que una cuenta es «migrated». Null: ninguno de los dos, o de antes del C06b.';

-- 2 · El escritor la rellena.
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
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name, name_source, import_id, import_run_id)
      select v_cuenta, p_company, v_plan, v_code, a.code, a.name, a.plain_name, 'template', 'serie', 'Diez (traída)', v_nombre, null, p_run
        from public.pgc_account a where a.plan = v_plan and a.code = v_hoja and a.valid_to is null;
    elsif v_nombre is null then
      -- C06: Diez no le da nombre. No se inventa: lleva el de su cuenta del
      -- plan oficial y queda pendiente de que alguien le ponga el suyo.
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_id, name_pending, import_run_id)
      select v_cuenta, p_company, v_plan, v_code, v_hoja, a.name, 'own', 'migrated', 'Diez (traída)', null, null, true, p_run
        from public.pgc_account a where a.plan = v_plan and a.code = v_hoja and a.valid_to is null;
      sin_nombre := sin_nombre || to_jsonb(v_code);
    else
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_id, import_run_id)
      values (v_cuenta, p_company, v_plan, v_code, v_hoja, v_nombre, 'own', 'migrated', 'Diez (traída)', v_nombre, null, p_run);
    end if;
    n_nuevas := n_nuevas + 1;
  end loop;
  return jsonb_build_object('nuevas', n_nuevas, 'estaban', n_estaban, 'rechazadas', rechazos, 'sinNombre', sin_nombre);
end $function$;
