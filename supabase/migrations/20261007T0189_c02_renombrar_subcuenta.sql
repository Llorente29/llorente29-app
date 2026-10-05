-- ============================================================================
-- C02 · Plan contable — 11 · CAMBIAR EL NOMBRE DE UNA SUBCUENTA TUYA
-- ----------------------------------------------------------------------------
-- Respuesta 5: el Mayor de una subcuenta propia lleva «Cambiar nombre». Las de
-- serie llevan el título oficial del BOE y no se cambian: solo las que ha
-- creado la empresa (kind = 'own'), y nunca una cerrada (está en los libros).
-- Queda en el registro del plan («renombrada», con el nombre de antes y el de
-- después).
--
-- Solo crea una función y amplía el CHECK de company_account_log, una tabla
-- nueva del C02 que el pedido no lee. Tanda 1, después de la 0187.
-- ============================================================================

alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado',
                 'enlace_quitado', 'renombrada'));

create function public.company_account_rename(p_id uuid, p_nombre text, p_quien_nombre text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_a public.company_account; v_cuenta uuid; v_nuevo text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
begin
  select * into v_a from public.company_account where id = p_id;
  if not found then raise exception 'Esa cuenta no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(v_a.company_id);
  if v_a.kind <> 'own' then raise exception 'Es de serie: su título es el oficial y no se cambia.' using errcode = '22023'; end if;
  if v_a.status = 'cerrada' then raise exception 'Una cuenta cerrada no cambia de nombre: está en los libros.' using errcode = '22023'; end if;
  if v_nuevo = '' then raise exception 'Ponle un nombre.' using errcode = '22023'; end if;
  if length(v_nuevo) > 120 then raise exception 'El nombre es demasiado largo (120 letras como mucho).' using errcode = '22023'; end if;
  if v_nuevo = v_a.name then return v_nuevo; end if;
  update public.company_account set name = v_nuevo, updated_at = now() where id = p_id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, v_a.company_id, 'renombrada', v_a.code, format('%s · %s se llama ahora %s.', v_a.code, v_a.name, v_nuevo),
          jsonb_build_object('name', v_a.name), jsonb_build_object('name', v_nuevo), 'manual', auth.uid(), p_quien_nombre);
  return v_nuevo;
end $$;
comment on function public.company_account_rename(uuid, text, text) is
  'C02. Cambia el nombre de una subcuenta de la empresa (no las de serie ni las cerradas) y lo deja en el registro del plan.';
revoke all on function public.company_account_rename(uuid, text, text) from public, anon;
grant execute on function public.company_account_rename(uuid, text, text) to authenticated;
