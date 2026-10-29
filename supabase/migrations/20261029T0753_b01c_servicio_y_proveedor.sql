-- ============================================================================
-- B01c · 2 · LO QUE CAMBIA EN CALIENTE para que los movimientos entren solos
-- ----------------------------------------------------------------------------
-- Va después de la 0752 (que solo añade). Dos cambios, los dos declarados:
--
--   1. _bank_cuenta_de_empresa (MISMA FIRMA): además de un administrador o
--      encargado de la cuenta, deja pasar a la clave de servicio
--      (auth.role() = 'service_role', como las de la C07). Sin esto la función
--      de cada noche (conta-banco-agregador) no puede llamar a bank_importar:
--      no lleva persona detrás. Para una persona, lo mismo que antes.
--   2. bank_aggregator_link: su CHECK del proveedor admite además
--      open_banking_io. Solo amplía: lo que cabía, sigue cabiendo.
--
-- No toca datos ni nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261029T0753_b01c_servicio_y_proveedor.down.sql
-- cambia: public._bank_cuenta_de_empresa · prueba: supabase/staging/sql/20261029_b01c_banco_agregador_prueba.sql
-- cambia: public.bank_aggregator_link · prueba: supabase/staging/sql/20261029_b01c_banco_agregador_prueba.sql
-- ============================================================================

-- La de antes, guardada (la vuelta atrás la restaura de aquí, con su huella).
select public._respaldar_funcion('public._bank_cuenta_de_empresa(uuid)', '20261029T0753_b01c_servicio_y_proveedor');

-- ── 1 · La clave de servicio también trabaja los bancos ────────────────────
create or replace function public._bank_cuenta_de_empresa(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.company where id = p_company;
  if v is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  -- B01c: la función de cada noche (conta-banco-agregador) llama con la clave de servicio, sin persona.
  if not (public.current_user_is_admin_or_manager_of(v) or auth.role() = 'service_role') then
    raise exception 'Solo un administrador o un encargado de la cuenta trabaja los bancos.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public._bank_cuenta_de_empresa(uuid) from public, anon, authenticated;

-- ── 2 · El proveedor open_banking_io ───────────────────────────────────────
alter table public.bank_aggregator_link drop constraint if exists bank_aggregator_link_provider_check;
alter table public.bank_aggregator_link add constraint bank_aggregator_link_provider_check check (provider in ('simulado', 'enable_banking', 'open_banking_io'));
