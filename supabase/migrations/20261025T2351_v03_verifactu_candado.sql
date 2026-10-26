-- supabase/migrations/20261025T2351_v03_verifactu_candado.sql
--
-- V03 · Verifactu · E1 · EL CANDADO (respuesta 3 de Julio, 26/10): ninguna
-- empresa pasa a «pruebas» ni a «real» hasta que esté apuntada una prueba de
-- conexión correcta con la AEAT. Así la tanda se puede aplicar sin haber hablado
-- todavía con Hacienda: todo nace apagado y no se puede encender sin probarlo.
--
-- AÑADE una tabla y dos funciones, y vuelve a escribir verifactu_modo (de la
-- 2140, con la misma firma: en producción no existe antes de esta tanda) con
-- la comprobación delante. No toca datos.
--
--   · verifactu_conexion: cada prueba de conexión (entorno, NIF del
--     certificado, si salió bien, el código de Hacienda y quién la hizo). Solo la
--     escribe el servicio (verifactu_conexion_apuntar): la función de envío en
--     staging, con el certificado de pruebas (accion «probar_conexion»), y la de
--     real, «Comprobar con Hacienda» (E3), con el certificado autorizado.
--   · verifactu_conexion_probada(entorno, nif): pruebas, alguna correcta en
--     pruebas; real, alguna correcta en real con ese NIF.

create table if not exists public.verifactu_conexion (
  id          uuid primary key default gen_random_uuid(),
  entorno     text not null check (entorno in ('pruebas', 'real')),
  nif         text not null check (nif ~ '^[0-9A-Z]{9}$'),
  ok          boolean not null,
  codigo      integer,
  mensaje     text,
  origen      text not null,
  probada_at  timestamptz not null default now()
);
comment on table public.verifactu_conexion is
  'V03. Las pruebas de conexión con la AEAT (una consulta con certificado): entorno, NIF del certificado, si salió bien y qué dijo Hacienda. Sin una correcta, verifactu_modo no deja pasar a pruebas ni a real (el candado). Solo la escribe el servicio.';
create index if not exists verifactu_conexion_entorno on public.verifactu_conexion (entorno, nif, probada_at desc);
alter table public.verifactu_conexion enable row level security;
revoke all on public.verifactu_conexion from anon, authenticated;

create or replace function public.verifactu_conexion_apuntar(p_entorno text, p_nif text, p_ok boolean, p_codigo integer, p_mensaje text, p_origen text)
returns uuid language sql security definer set search_path = public as $$
  insert into public.verifactu_conexion (entorno, nif, ok, codigo, mensaje, origen)
  values (p_entorno, regexp_replace(upper(btrim(p_nif)), '^ES', ''), p_ok, p_codigo, left(p_mensaje, 1000), p_origen)
  returning id
$$;
revoke all on function public.verifactu_conexion_apuntar(text, text, boolean, integer, text, text) from public, anon, authenticated;
comment on function public.verifactu_conexion_apuntar(text, text, boolean, integer, text, text) is
  'V03. Solo el servicio: apunta una prueba de conexión con la AEAT (la abre o la mantiene cerrada para verifactu_modo).';

create or replace function public.verifactu_conexion_probada(p_entorno text, p_nif text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.verifactu_conexion c
                  where c.ok and c.entorno = p_entorno
                    and (p_entorno = 'pruebas' or c.nif = regexp_replace(upper(btrim(coalesce(p_nif, ''))), '^ES', '')))
$$;
revoke all on function public.verifactu_conexion_probada(text, text) from public, anon;
grant execute on function public.verifactu_conexion_probada(text, text) to authenticated;
comment on function public.verifactu_conexion_probada(text, text) is
  'V03. ¿Hay una prueba de conexión correcta con la AEAT? En pruebas, cualquiera del entorno de pruebas; en real, una de real con ese NIF. La usa verifactu_modo (el candado) y la pantalla, para decir por qué no deja.';

create or replace function public.verifactu_modo(p_company uuid, p_modo text, p_serie text default null, p_confirmacion text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_co public.company; v_e public.verifactu_empresa; v_serie text := upper(btrim(coalesce(p_serie, ''))); v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then raise exception 'Solo un administrador o un encargado de la cuenta cambia Verifactu.' using errcode = '42501'; end if;
  if p_modo not in ('apagado', 'pruebas', 'real') then raise exception 'Verifactu va apagado, en pruebas o en real.' using errcode = '22023'; end if;
  insert into public.verifactu_empresa (company_id, account_id) values (v_co.id, v_co.account_id) on conflict (company_id) do nothing;
  select * into v_e from public.verifactu_empresa where company_id = p_company for update;
  if v_e.modo = p_modo then return jsonb_build_object('modo', v_e.modo, 'cambiado', false); end if;
  -- EL CANDADO (respuesta 3 de Julio): a pruebas o a real, solo con una prueba
  -- de conexión correcta con la AEAT apuntada. En pruebas, la del entorno de
  -- pruebas; en real, la de real con el NIF de esta empresa.
  if p_modo in ('pruebas', 'real') and not public.verifactu_conexion_probada(p_modo, v_co.tax_id) then
    raise exception '%', case p_modo
      when 'pruebas' then 'Todavía no se ha probado la conexión con el entorno de pruebas de Hacienda: hasta que salga bien, Verifactu no se puede poner en pruebas.'
      else 'Todavía no se ha probado la conexión con Hacienda con el certificado de esta empresa: hasta que salga bien, Verifactu no se puede pasar a real.' end
      using errcode = '23514';
  end if;
  if v_e.modo = 'real' and v_hoy <= v_e.real_obliga_hasta then
    raise exception 'Estás en real desde el %: la ley obliga a seguir así hasta el % (Orden HAC/1177/2024, art. 17.2).',
      to_char(v_e.real_desde at time zone 'Europe/Madrid', 'DD/MM/YYYY'), to_char(v_e.real_obliga_hasta, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if p_modo = 'real' then
    if p_confirmacion is distinct from 'EMPEZAR' then raise exception 'Para pasar a real, escribe EMPEZAR: desde ese momento no se puede volver a pruebas este año.' using errcode = '23514'; end if;
    if not public._verifactu_nif_es_valido(v_co.tax_id) then raise exception 'El NIF de tu empresa no es válido: corrígelo antes de pasar a real.' using errcode = '23514'; end if;
    if v_serie !~ '^[A-Z0-9][A-Z0-9-]{0,9}$' then raise exception 'La serie nueva va en mayúsculas y cifras (por ejemplo F%).', extract(year from v_hoy)::int using errcode = '23514'; end if;
    if exists (select 1 from public.customer_invoice where company_id = p_company and series_code = v_serie and status <> 'borrador') then
      raise exception 'La serie % ya tiene facturas: la de real empieza nueva.', v_serie using errcode = '23514';
    end if;
    if not exists (select 1 from public.invoice_series where company_id = p_company and code = v_serie) then
      insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active)
      values (v_co.account_id, v_co.id, v_serie, 'Facturas (Verifactu)', 'invoice', 4, true, 1, false, true);
    end if;
    update public.verifactu_empresa set modo = 'real', real_desde = now(), real_serie = v_serie,
           real_obliga_hasta = make_date(extract(year from v_hoy)::int, 12, 31), updated_at = now(), updated_by_name = v_quien
     where company_id = p_company;
  else
    update public.verifactu_empresa set modo = p_modo, real_desde = null, real_serie = null, real_obliga_hasta = null,
           pruebas_desde = case when p_modo = 'pruebas' then now() else pruebas_desde end, updated_at = now(), updated_by_name = v_quien
     where company_id = p_company;
  end if;
  select * into v_e from public.verifactu_empresa where company_id = p_company;
  return jsonb_build_object('modo', v_e.modo, 'cambiado', true, 'real_desde', v_e.real_desde, 'real_serie', v_e.real_serie, 'real_obliga_hasta', v_e.real_obliga_hasta);
end $$;
revoke all on function public.verifactu_modo(uuid, text, text, text, text) from public, anon;
grant execute on function public.verifactu_modo(uuid, text, text, text, text) to authenticated;
comment on function public.verifactu_modo(uuid, text, text, text, text) is
  'V03. El interruptor de Verifactu de una empresa: apagado, pruebas o real. A pruebas o a real, solo con una prueba de conexión correcta con la AEAT apuntada (el candado, verifactu_conexion_probada). A real, escribiendo EMPEZAR y con una serie nueva; obliga hasta el 31/12.';
