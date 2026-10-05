-- ============================================================================
-- C02 · Plan contable — 7 · LAS CUENTAS DE UN PROVEEDOR (encargo §5b, tarea 6)
-- ----------------------------------------------------------------------------
-- La pestaña «Contabilidad» de la ficha enseña y deja cambiar sus cuentas. Lo
-- que ya existía (0120) cubre «Su cuenta» (enlace supplier/principal), y lo
-- que va por tipo de gasto, IVA y retención sale de los enlaces de esas tablas.
-- Faltan tres cosas que son DEL PROVEEDOR, no de la tabla general:
--
--   supplier/gasto     «Sus facturas se apuntan en» cuando no es la cuenta de su
--                      tipo de gasto (un grupo 6 concreto para él).
--   supplier/pago      «Le pagas desde»: un banco (572) o, cuando llegue el C03,
--                      «se compensa con lo que te debe» (su 430). El modelo lo
--                      admite ya; la pantalla solo enseña bancos hasta el C03.
--   supplier/suplidos  Dónde van sus suplidos (los gastos que adelanta en tu
--                      nombre, p. ej. una gestoría): un grupo 6, de serie la 629.
--
-- Y quitar un enlace propio (volver a «lo de su tipo de gasto») queda en el
-- registro: company_account_link_unset.
--
-- La regla «un tercero, una subcuenta, salvo la común» (0120) es del papel
-- PRINCIPAL: que un proveedor se pague desde la 57200001 no hace a esa cuenta
-- «suya», sigue siendo la del banco. El disparador se reescribe con su misma
-- firma (create or replace sin parámetros nuevos, regla 2) para que solo mire
-- el principal y para comprobar de qué grupo es la cuenta de cada papel nuevo.
-- Además, un enlace de proveedor tiene que ser de un proveedor DE ESA CUENTA
-- (regla 9): antes entity_id era texto libre.
--
-- Tablas nuevas: ninguna. Fuera del camino del pedido: company_account_link y
-- company_account_log solo las leen y escriben pantallas de contabilidad.
-- ============================================================================

-- ── Papeles ─────────────────────────────────────────────────────────────────
alter table public.company_account_link drop constraint if exists company_account_link_role_check;
alter table public.company_account_link add constraint company_account_link_role_check
  check (role in ('principal', 'soportado', 'repercutido', 'gasto', 'pago', 'suplidos'));
-- Los papeles nuevos son solo de proveedor (y de cliente cuando llegue).
alter table public.company_account_link add constraint company_account_link_papel_de_tercero
  check (role not in ('gasto', 'pago', 'suplidos') or entity in ('supplier', 'customer'));

alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado',
                 'enlace_quitado'));

-- ── El disparador, con su misma firma ───────────────────────────────────────
create or replace function public.company_account_misma_cuenta() returns trigger
language plpgsql set search_path = public as $$
declare v_plantilla text;
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'company_account_link' then
    if not exists (select 1 from public.company_account a where a.id = new.company_account_id and a.company_id = new.company_id) then
      raise exception 'Esa cuenta no es de esta empresa.' using errcode = '23514';
    end if;
    -- Un proveedor de OTRA cuenta no se enlaza aquí (regla 9).
    if new.entity = 'supplier' and not exists (select 1 from public.supplier s where s.id::text = new.entity_id and s.account_id = new.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '23514';
    end if;
    -- Un tercero, una subcuenta; salvo la común (encargo §3). Solo el papel principal.
    if new.role = 'principal' and new.entity in ('supplier', 'customer', 'bank_account')
       and not (select is_common from public.company_account where id = new.company_account_id)
       and exists (select 1 from public.company_account_link l
                    where l.company_account_id = new.company_account_id and l.id <> new.id and l.role = 'principal'
                      and l.entity in ('supplier', 'customer', 'bank_account')
                      and (l.entity, l.entity_id) is distinct from (new.entity, new.entity_id)) then
      raise exception 'Esa subcuenta ya es de otro tercero, y no es la cuenta común.' using errcode = '23505';
    end if;
    -- Cada papel nuevo, a su grupo: gastos y suplidos al 6; el pago a un banco o caja (57) o a lo que te debe (43).
    select template_code into v_plantilla from public.company_account where id = new.company_account_id;
    if new.role in ('gasto', 'suplidos') and v_plantilla not like '6%' then
      raise exception 'Sus facturas y sus suplidos van a una cuenta de gastos (grupo 6); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    if new.role = 'pago' and v_plantilla not like '57%' and v_plantilla not like '43%' then
      raise exception 'Se le paga desde un banco o caja (57) o compensando con lo que te debe (43); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.
    if (select status from public.company_account where id = new.company_account_id) <> 'activa' then
      raise exception 'Esa cuenta está oculta o cerrada: no se le puede enlazar nada.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ── Quitar un enlace propio ─────────────────────────────────────────────────
-- Solo los papeles propios de un tercero: el principal de un proveedor no se
-- quita (sin él no tiene cuenta), se cambia.
create function public.company_account_link_unset(
  p_company uuid, p_entity text, p_entity_id text, p_role text, p_quien_nombre text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.conta_ia_cuenta(p_company); v_antes text;
begin
  if p_role not in ('gasto', 'pago', 'suplidos') then
    raise exception 'Ese enlace no se quita: se cambia por otro.' using errcode = '22023';
  end if;
  delete from public.company_account_link l using public.company_account a
   where a.id = l.company_account_id and l.company_id = p_company and l.entity = p_entity and l.entity_id = p_entity_id and l.role = p_role
  returning a.code into v_antes;
  if v_antes is null then return; end if;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'enlace_quitado', v_antes,
          format('%s deja de ir a %s (%s).', p_entity, v_antes, p_role),
          jsonb_build_object('code', v_antes), jsonb_build_object('entity', p_entity, 'entity_id', p_entity_id, 'role', p_role),
          'manual', auth.uid(), p_quien_nombre);
end $$;
revoke all on function public.company_account_link_unset(uuid, text, text, text, text) from public, anon;
grant execute on function public.company_account_link_unset(uuid, text, text, text, text) to authenticated;
comment on function public.company_account_link_unset(uuid, text, text, text, text) is
  'C02. Quita un enlace propio de un tercero (gasto, pago, suplidos) y lo deja en el registro. El principal no se quita: se cambia.';
