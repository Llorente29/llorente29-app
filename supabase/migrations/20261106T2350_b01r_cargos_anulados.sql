-- supabase/migrations/20261106T2350_b01r_cargos_anulados.sql
--
-- B01·19 · Los tres cargos de la Seguridad Social del 30/10 que el BBVA anuló
-- (Julio, 06/11). El banco los apuntó sin saldo y, como a las 10:00 seguía sin
-- haberlo, los anuló como si no hubieran existido. La lectura de las 02:02 del
-- 31/10 los cogió antes y la anulación nunca llegó: open-banking.io los sigue
-- devolviendo (el 06/11 a las 03:02, las sumas releídas son las de Sumied CON
-- los tres). Medido el 06/11: quitándolos, el saldo de Sumied de ···6536 y de
-- ···4525 es el del banco al céntimo cada día con saldo (30/10, 02/11 y
-- 04/11); con ellos, faltan 3.308,46 € y 798,36 €.
--
--   ···6536  −3.308,46  TGSS, régimen general (los seguros sociales)
--   ···4525    −483,36  TGSS, autónomos
--   ···4525    −315,00  TGSS, autónomos
--
-- Dejan de contar por el mismo camino que la aplicación: bank_ignorar, con su
-- motivo («Anulado por el banco: no había saldo») y su línea en el historial,
-- como si lo pulsara la persona (su usuario y su cuenta activa, solo en esta
-- transacción). No se borran y no se casan con nada. Anclados por su id: al
-- empezar se comprueba que los tres siguen en la empresa, con su importe y su
-- fecha, y por aclarar. Si alguno no, para y no deja nada.
--
-- Vuelta atrás: supabase/vuelta-atras/20261106T2350_b01r_cargos_anulados.down.sql
-- (los devuelve a «por aclarar» si siguen ignorados con este motivo).

create or replace function public._b01r_ignorar_anulados(p_company uuid, p_actor uuid, p_motivo text, p_movs jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; x jsonb; v_m public.bank_movement; v_n int := 0;
  v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true);
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'B01r anulados: esa empresa no está.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'B01r anulados: falta el motivo.'; end if;
  if jsonb_array_length(coalesce(p_movs, '[]'::jsonb)) = 0 then raise exception 'B01r anulados: no hay movimientos.'; end if;
  for x in select * from jsonb_array_elements(p_movs) loop
    select * into v_m from public.bank_movement where id = (x->>'id')::uuid for update;
    if v_m.id is null or v_m.company_id is distinct from p_company or v_m.account_id is distinct from v_acc then
      raise exception 'B01r anulados: el movimiento % no está en la empresa: no se toca nada.', x->>'id';
    end if;
    if v_m.amount <> (x->>'importe')::numeric or v_m.op_date <> (x->>'fecha')::date then
      raise exception 'B01r anulados: el movimiento % es de % el % y se esperaba % el %: no se toca nada.',
        x->>'id', v_m.amount, v_m.op_date, x->>'importe', x->>'fecha';
    end if;
    if v_m.status <> 'por_aclarar' then
      raise exception 'B01r anulados: el movimiento % ya no está por aclarar (está %): no se toca nada.', x->>'id', v_m.status;
    end if;
  end loop;

  -- Como si lo pulsara la persona: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  for x in select * from jsonb_array_elements(p_movs) loop
    perform public.bank_ignorar((x->>'id')::uuid, p_motivo);
    v_n := v_n + 1;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_n;
end $$;
revoke all on function public._b01r_ignorar_anulados(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._b01r_ignorar_anulados(uuid, uuid, text, jsonb) is
  'B01r. Deja de lado, con bank_ignorar y como una persona de la cuenta, una lista de movimientos por aclarar anclados por id, importe y fecha; para si alguno no está en la empresa, no cuadra o ya no está por aclarar. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_actor constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'B01r anulados: sin la cuenta de Foodint, no hay nada que dejar de lado.';
    return;
  end if;
  v_n := public._b01r_ignorar_anulados(v_e, v_actor, 'Anulado por el banco: no había saldo', jsonb_build_array(
    jsonb_build_object('id', '9d7826af-32b0-4f45-9368-45f98a030d47', 'importe', -3308.46, 'fecha', '2026-10-30'),
    jsonb_build_object('id', '1f73bfb3-8bb6-41e5-8110-8bbc31d0b0a4', 'importe', -483.36, 'fecha', '2026-10-30'),
    jsonb_build_object('id', 'b4a02704-b5bb-46cd-882e-c2e3f02b2918', 'importe', -315.00, 'fecha', '2026-10-30')));
  if v_n <> 3 then raise exception 'B01r anulados: se esperaban 3 y han salido %.', v_n; end if;
end $$;
