-- supabase/migrations/20261121T0930_x20_subcuenta_con_codigo.sql
--
-- X20 · Crear una subcuenta como en ERP10 (encargo del 21/11): el código y el nombre. SOLO AÑADE una
-- función: company_account_add_codigo. company_account_add (la de «la siguiente libre bajo esta cuenta»)
-- no se toca.
--
--   company_account_add_codigo(empresa, código, nombre, quién)
--     · el código, con los dígitos del plan de la empresa (el navegador ya ha pasado «430.30» a 43000030 y
--       «430» a la siguiente libre; aquí se vuelve a comprobar todo);
--     · la cuenta de la que cuelga la busca la base: la cuenta del plan, de las que admiten apuntes, más
--       larga cuyo número empieza el código (43000030 → 4300). Si no hay ninguna, para y dice el número que
--       falta; no inventa nada;
--     · si el código ya existe en la empresa, para y lo dice;
--     · lo demás, como company_account_add: propia («own»), a mano, y su línea en el historial del plan.
--
-- Nada en el camino del pedido. El real lo lanza Julio.

create or replace function public.company_account_add_codigo(p_company uuid, p_codigo text, p_nombre text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_plan text; v_d int; v_code text := btrim(coalesce(p_codigo, '')); v_hoja public.pgc_account; v_id uuid; v_llega int; v_falta text;
begin
  if coalesce(btrim(p_nombre), '') = '' then raise exception 'Ponle un nombre.' using errcode = '22023'; end if;
  select a.plan, length(a.code) into v_plan, v_d from public.company_account a where a.company_id = p_company limit 1;
  if v_plan is null then raise exception 'El plan contable de esta empresa no está activado.' using errcode = '22023'; end if;
  if v_code !~ '^[0-9]+$' or length(v_code) <> v_d then
    raise exception 'El código son % cifras («%» no).', v_d, v_code using errcode = '22023';
  end if;
  if exists (select 1 from public.company_account where company_id = p_company and code = v_code) then
    raise exception 'Ya existe la %: ábrela.', v_code using errcode = '23505';
  end if;
  select * into v_hoja from public.pgc_account p
   where p.plan = v_plan and p.is_leaf and p.valid_to is null and length(p.code) < length(v_code) and left(v_code, length(p.code)) = p.code
   order by length(p.code) desc limit 1;
  if v_hoja.code is null then
    select coalesce(max(length(p.code)), 0) into v_llega from public.pgc_account p
     where p.plan = v_plan and p.valid_to is null and left(v_code, length(p.code)) = p.code;
    v_falta := left(v_code, least(length(v_code) - 1, greatest(3, v_llega + 1)));
    raise exception 'La % no está en tu plan: no hay de qué cuenta colgarla.', v_falta using errcode = '22023';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by, created_by_name)
  values (v_cuenta, p_company, v_plan, v_code, v_hoja.code, btrim(p_nombre), null, 'own', 'manual', auth.uid(), p_quien_nombre)
  returning id into v_id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'subcuenta_creada', v_code, format('Subcuenta %s · %s, bajo la %s.', v_code, btrim(p_nombre), v_hoja.code),
          jsonb_build_object('code', v_code, 'name', btrim(p_nombre)), 'manual', auth.uid(), p_quien_nombre);
  return jsonb_build_object('id', v_id, 'code', v_code, 'hoja', v_hoja.code, 'hoja_nombre', v_hoja.name);
end $$;
comment on function public.company_account_add_codigo(uuid, text, text, text) is
  'X20 · Añade una subcuenta con el código que se escribe (como en ERP10): la cuenta de la que cuelga la busca la base (la de apuntes más larga que lo empieza). Para si el código no tiene los dígitos del plan, si ya existe o si no hay de qué cuenta colgarla. Como company_account_add: propia, a mano y con su línea en el historial.';
revoke all on function public.company_account_add_codigo(uuid, text, text, text) from public, anon;
grant execute on function public.company_account_add_codigo(uuid, text, text, text) to authenticated;
