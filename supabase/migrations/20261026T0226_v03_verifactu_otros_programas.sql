-- supabase/migrations/20261026T0226_v03_verifactu_otros_programas.sql
--
-- V03 · Entrega 2 · «¿FACTURAS TAMBIÉN CON OTRO PROGRAMA?» (tablero 25). SOLO
-- AÑADE: una columna que admite nulos en verifactu_empresa y la función que la
-- escribe. No toca datos.
--
-- Desde 2027 cada factura de la empresa sale de un sistema que cumpla el
-- reglamento (RD 1007/2023): la que haga con otro programa (un TPV, una tienda
-- online) también, y una en Excel o Word no. Lo que dice la empresa se guarda
-- para avisarle en la pantalla; null = no lo ha dicho; '{}' = solo Sumied.

alter table public.verifactu_empresa add column if not exists otros_programas text[];
comment on column public.verifactu_empresa.otros_programas is
  'V03 E2 · Con qué otros programas factura la empresa (tablero 25): tpv, tienda, excel, otro. null = no lo ha dicho; vacío = solo con Sumied.';

create or replace function public.verifactu_otros_programas(p_company uuid, p_programas text[], p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co public.company; v_p text[];
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then raise exception 'Solo un administrador o un encargado de la cuenta cambia Verifactu.' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_p from unnest(coalesce(p_programas, '{}')) x;
  if exists (select 1 from unnest(v_p) x where x not in ('tpv', 'tienda', 'excel', 'otro')) then
    raise exception 'Los otros programas son: tpv, tienda, excel u otro.' using errcode = '22023';
  end if;
  insert into public.verifactu_empresa (company_id, account_id, otros_programas, updated_by_name)
  values (v_co.id, v_co.account_id, v_p, coalesce(p_quien_nombre, public.conta_nombre_actor()))
  on conflict (company_id) do update set otros_programas = excluded.otros_programas, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('company_id', v_co.id, 'otros_programas', to_jsonb(v_p));
end $$;
revoke all on function public.verifactu_otros_programas(uuid, text[], text) from public, anon;
grant execute on function public.verifactu_otros_programas(uuid, text[], text) to authenticated;
