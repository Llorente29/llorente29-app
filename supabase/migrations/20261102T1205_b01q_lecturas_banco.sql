-- ============================================================================
-- B01 · Cola 1b · EL REGISTRO DE CADA LECTURA DEL BANCO (solo añade)
-- ----------------------------------------------------------------------------
-- Julio, 02/11: el agregador de BBVA no trajo el 30/10 dos traspasos entre
-- cuentas propias, y el hueco no se rellenó nunca (cada noche se leía desde el
-- día siguiente al último leído). Desde ahora la función de cada noche
-- (conta-banco-agregador) vuelve a leer también los últimos 7 días, sin
-- duplicar, y deja escrito en cada lectura cuántos movimientos pendientes deja
-- fuera (solo entra lo contabilizado) y cuánto ha llegado tarde.
--
--   1. bank_aggregator_lectura, NUEVA: una fila por cuenta y por lectura, con
--      el periodo leído, desde cuándo se releyó, lo leído, lo nuevo, lo
--      repetido, los pendientes que no entran (cuántos e importe), lo que llegó
--      tarde de días ya leídos (cuántos e importe), la continuidad y el saldo
--      del banco. La lee un administrador o un encargado de la cuenta.
--   2. bank_agregador_lectura_apuntar, NUEVA: la escribe; solo la clave de
--      servicio (la función de cada noche).
--
-- bank_agregador_apuntar (la última lectura de cada cuenta) NO cambia: el
-- texto de la cuenta ya lleva los pendientes, que lo escribe la función.
-- Lo que llega tarde entra por bank_importar, como siempre, en un extracto
-- propio (formato «agregador:open-banking-io:tarde», sin saldos).
--
-- Solo añade y se puede pasar dos veces. No toca datos ni nada del camino del
-- pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261102T1205_b01q_lecturas_banco.down.sql
-- Prueba: supabase/staging/sql/20261102_b01q_bancos_prueba.sql
-- ============================================================================

create table if not exists public.bank_aggregator_lectura (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete cascade,
  treasury_account_id  uuid not null references public.treasury_account(id) on delete cascade,
  provider             text not null,
  read_at              timestamptz not null default now(),
  status               text not null,
  message              text,
  period_from          date,
  period_to            date,
  reread_from          date,
  read_count           integer not null default 0,
  new_count            integer not null default 0,
  repeated_count       integer not null default 0,
  pending_count        integer not null default 0,
  pending_amount       numeric(14,2) not null default 0,
  late_count           integer not null default 0,
  late_amount          numeric(14,2) not null default 0,
  continuity           text,
  continuity_gap       numeric(14,2),
  bank_balance         numeric(14,2)
);
comment on table public.bank_aggregator_lectura is 'B01 · Cola 1b (02/11/2026). Cada lectura de cada cuenta por la conexión con el banco: lo leído, lo nuevo, los pendientes que no entran (solo entra lo contabilizado) y lo que llegó tarde de días ya leídos (se releen los últimos 7). La escribe solo la función de cada noche (bank_agregador_lectura_apuntar).';
create index if not exists ix_bank_aggregator_lectura_cuenta on public.bank_aggregator_lectura (treasury_account_id, read_at desc);

alter table public.bank_aggregator_lectura enable row level security;
drop policy if exists bank_aggregator_lectura_read on public.bank_aggregator_lectura;
create policy bank_aggregator_lectura_read on public.bank_aggregator_lectura
  for select using (public.current_user_is_admin_or_manager_of(account_id));
revoke all on public.bank_aggregator_lectura from anon;
revoke insert, update, delete on public.bank_aggregator_lectura from authenticated;
grant select on public.bank_aggregator_lectura to authenticated;
grant all on public.bank_aggregator_lectura to service_role;

create or replace function public.bank_agregador_lectura_apuntar(
  p_treasury uuid, p_proveedor text, p_estado text, p_mensaje text, p_desde date, p_hasta date, p_releido_desde date,
  p_leidos integer, p_nuevos integer, p_repetidos integer, p_pendientes integer, p_pendientes_importe numeric,
  p_tarde integer, p_tarde_importe numeric, p_continuidad text, p_hueco numeric, p_saldo_banco numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo la función de cada noche apunta sus lecturas.' using errcode = '42501'; end if;
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  insert into public.bank_aggregator_lectura (account_id, company_id, treasury_account_id, provider, status, message, period_from, period_to, reread_from,
                                              read_count, new_count, repeated_count, pending_count, pending_amount, late_count, late_amount,
                                              continuity, continuity_gap, bank_balance)
  values (v_t.account_id, v_t.company_id, v_t.id, replace(coalesce(p_proveedor, ''), '-', '_'), coalesce(nullif(trim(p_estado), ''), 'desconocido'),
          nullif(trim(p_mensaje), ''), p_desde, p_hasta, p_releido_desde,
          coalesce(p_leidos, 0), coalesce(p_nuevos, 0), coalesce(p_repetidos, 0), coalesce(p_pendientes, 0), coalesce(p_pendientes_importe, 0),
          coalesce(p_tarde, 0), coalesce(p_tarde_importe, 0), p_continuidad, p_hueco, p_saldo_banco);
end $$;
revoke all on function public.bank_agregador_lectura_apuntar(uuid, text, text, text, date, date, date, integer, integer, integer, integer, numeric, integer, numeric, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.bank_agregador_lectura_apuntar(uuid, text, text, text, date, date, date, integer, integer, integer, integer, numeric, integer, numeric, text, numeric, numeric) to service_role;
