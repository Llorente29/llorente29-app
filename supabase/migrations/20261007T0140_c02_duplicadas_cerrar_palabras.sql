-- ============================================================================
-- C02 · Plan contable — 5 · DUPLICADAS, CERRAR Y PALABRAS CLAVE (encargo §3)
-- ----------------------------------------------------------------------------
-- Misma regla que src/modules/conta/lib/planEmpresa.ts (fusionar, puedeCerrar,
-- limpiarPalabras), probada allí y en supabase/staging/sql/20261007_c02_prueba_plan.sql.
--
--   company_account_merge(sobra, queda)  Antes del primer asiento: borra la que
--                                        sobra y pasa sus enlaces a la que queda.
--                                        Después: lo hace el C04 (es quien tiene
--                                        el historial y el «Deshacer» de 24 h);
--                                        hoy contesta que llega con el C04.
--   company_account_close(cuenta)        Cerrar es para cuentas con historial:
--                                        sin asientos, contesta «ocúltala».
--   company_account_set_keywords(…)      Palabras clave de una cuenta (Puzzle).
--
-- Solo añade funciones y amplía los valores del registro. Fuera del camino del pedido.
-- ============================================================================

alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave'));

create function public.company_account_merge(p_sobra uuid, p_queda uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.company_account; q public.company_account; v_cuenta uuid; n int; v_terceros int;
begin
  select * into s from public.company_account where id = p_sobra;
  select * into q from public.company_account where id = p_queda;
  if s.id is null or q.id is null or s.company_id <> q.company_id then raise exception 'Esas dos cuentas no son de la misma empresa.' using errcode = '22023'; end if;
  v_cuenta := public.conta_ia_cuenta(s.company_id);
  if s.id = q.id then raise exception 'Es la misma cuenta.' using errcode = '22023'; end if;
  if s.template_code <> q.template_code then raise exception '% y % no cuelgan de la misma cuenta del plan: no son duplicadas.', s.code, q.code using errcode = '22023'; end if;
  if s.kind = 'template' then raise exception '% es de serie: no se puede quitar. Fusiona al revés.', s.code using errcode = '22023'; end if;
  if q.status <> 'activa' then raise exception '% está %: elige una activa para quedarte.', q.code, q.status using errcode = '22023'; end if;
  select count(distinct (entity, entity_id)) into v_terceros from public.company_account_link
   where company_account_id in (s.id, q.id) and entity in ('supplier', 'customer', 'bank_account');
  if v_terceros > 1 and not q.is_common then raise exception 'Las dos son subcuentas de terceros distintos: no son duplicadas.' using errcode = '22023'; end if;
  if public.company_account_length_locked(s.company_id) then
    raise exception 'Ya hay asientos: fusionar con su historial llega con el libro diario (C04).' using errcode = '0A000';
  end if;
  update public.company_account_link set company_account_id = q.id where company_account_id = s.id;
  get diagnostics n = row_count;
  delete from public.company_account where id = s.id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, s.company_id, 'borrada_duplicada', q.code, format('%s · %s era duplicada de %s: borrada, y sus %s enlaces pasan a %s.', s.code, s.name, q.code, n, q.code),
          jsonb_build_object('code', s.code, 'name', s.name), jsonb_build_object('code', q.code, 'enlaces', n), 'manual', auth.uid(), p_quien_nombre);
  return jsonb_build_object('modo', 'borrar', 'enlaces', n);
end $$;

create function public.company_account_close(p_id uuid, p_quien_nombre text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.company_account; v_cuenta uuid;
begin
  select * into a from public.company_account where id = p_id;
  if not found then raise exception 'Esa cuenta no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(a.company_id);
  if not public.company_account_length_locked(a.company_id) then
    raise exception 'Aún no hay asientos: no hay nada que cerrar. Si no la usas, ocúltala.' using errcode = '22023';
  end if;
  update public.company_account set status = 'cerrada', updated_at = now() where id = p_id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, source, done_by, done_by_name)
  values (v_cuenta, a.company_id, 'cerrada', a.code, format('Cerrada %s · %s: sigue en los libros y no admite apuntes nuevos.', a.code, a.name), 'manual', auth.uid(), p_quien_nombre);
end $$;

create function public.company_account_set_keywords(p_id uuid, p_palabras text[], p_quien_nombre text default null)
returns text[] language plpgsql security definer set search_path = public as $$
declare a public.company_account; v_cuenta uuid; v text[];
begin
  select * into a from public.company_account where id = p_id;
  if not found then raise exception 'Esa cuenta no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(a.company_id);
  -- Misma limpieza que limpiarPalabras(): sin espacios de más, minúsculas, sin repetir, hasta 20.
  select coalesce(array_agg(w order by o), '{}') into v from (
    select w, min(o) o from (
      select lower(regexp_replace(trim(x), '\s+', ' ', 'g')) w, o from unnest(p_palabras) with ordinality t(x, o)
    ) y where w <> '' and length(w) <= 40 group by w order by min(o) limit 20) z;
  update public.company_account set keywords = v, updated_at = now() where id = p_id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, a.company_id, 'palabras_clave', a.code, format('Palabras clave de %s: %s.', a.code, coalesce(nullif(array_to_string(v, ', '), ''), 'ninguna')),
          to_jsonb(a.keywords), to_jsonb(v), 'manual', auth.uid(), p_quien_nombre);
  return v;
end $$;

do $$
declare f text;
begin
  foreach f in array array['company_account_merge(uuid, uuid, text)', 'company_account_close(uuid, text)', 'company_account_set_keywords(uuid, text[], text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
