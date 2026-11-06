-- supabase/migrations/20261106T1750_dl1_uber_validar.sql
--
-- DL1 · Valida por tanda los 12 asientos de Uber que el libro diario no enseña
-- (Julio, DL1·11, 06/11). La 1702 (real del 06/11) los dejó propuestos y Julio
-- validó los tres de octubre y noviembre (4/3351, 4/3352 y 4/3353). Quedan:
--   · los 7 de la 1702 con fecha hasta el 30/09: la apertura (01/01) y las
--     promociones de enero a junio. El libro diario no enseña nada hasta el
--     imported_until del ejercicio (30/09), así que no se pueden pulsar;
--   · las 5 liquidaciones de Uber de octubre (147,86), propuestas por Sumied al
--     leer la liquidación, que el libro diario tampoco encuentra.
--
-- Se validan con la misma función que la aplicación (journal_entry_validar ->
-- _journal_entry_validar), con todas sus comprobaciones: conta_motivos_para_
-- validar, que incluye el candado del #484. Nada de cambiar el estado a mano.
-- Como si lo hubiera pulsado Julio: con su usuario (673fca49…) y su nombre.
-- Anclados por su id; al empezar se comprueba que los 12 siguen propuestos y
-- con su importe. Si alguno no, o si alguno tiene un motivo para no validarse,
-- para y no deja nada (todo va en la transacción del run).
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado no vuelve a propuesto (se
-- anula con un contraasiento). Lo dice el manifiesto, con lo esperado.

create or replace function public._dl1_validar(p_company uuid, p_actor uuid, p_nombre text, p_asientos jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; a jsonb; v_e public.journal_entry; v_importe numeric; v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true); v_n int := 0; r record;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1 validar: esa empresa no está.'; end if;
  if jsonb_array_length(p_asientos) = 0 then raise exception 'DL1 validar: no hay asientos que validar.'; end if;
  for a in select * from jsonb_array_elements(p_asientos) loop
    select * into v_e from public.journal_entry where id = (a->>'id')::uuid and account_id = v_acc and company_id = p_company;
    if v_e.id is null then raise exception 'DL1 validar: el asiento % no está en la empresa.', a->>'id'; end if;
    if v_e.status <> 'propuesto' then raise exception 'DL1 validar: el asiento % ya no está propuesto (está %): no se valida nada.', a->>'id', v_e.status; end if;
    select coalesce(sum(debit), 0) into v_importe from public.journal_line where entry_id = v_e.id and account_id = v_acc;
    if v_importe <> (a->>'importe')::numeric then
      raise exception 'DL1 validar: el asiento % suma % y se esperaba %: no se valida nada.', a->>'id', v_importe, a->>'importe';
    end if;
  end loop;

  -- Como si lo pulsara la persona: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  for r in select e.id from public.journal_entry e
            where e.id in (select (x->>'id')::uuid from jsonb_array_elements(p_asientos) x)
            order by e.entry_date, e.created_at, e.id loop
    perform public.journal_entry_validar(r.id, p_nombre);
    v_n := v_n + 1;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_n;
end $$;
revoke all on function public._dl1_validar(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._dl1_validar(uuid, uuid, text, jsonb) is
  'DL1. Valida, como una persona de la cuenta y con journal_entry_validar, una lista de asientos propuestos anclados por id e importe; para si alguno ya no está propuesto, no suma lo esperado o no se puede validar. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 validar: sin la cuenta de Foodint, no hay nada que validar.';
    return;
  end if;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(
    -- La 1702: la apertura y las promociones de enero a junio.
    jsonb_build_object('id', 'bd337a82-cf40-4f71-945f-3eb41a9f103d', 'importe', 2369.31),
    jsonb_build_object('id', 'daac2c29-69ce-4239-a10a-4a9d440c29fc', 'importe', 14122.20),
    jsonb_build_object('id', '4249fd58-75f1-4c47-bbfd-92a85202472b', 'importe', 8257.71),
    jsonb_build_object('id', 'a2797334-df9d-49d6-9d30-decd9aa91ece', 'importe', 3472.95),
    jsonb_build_object('id', 'c914d25e-dc13-4519-8622-a776cfc271a1', 'importe', 1082.31),
    jsonb_build_object('id', 'ee851e48-2300-452f-b3dc-e54faf2cc163', 'importe', 6303.70),
    jsonb_build_object('id', '07beeca2-9f2d-4500-bf0a-ca8fcc49ad9d', 'importe', 3216.97),
    -- Las 5 liquidaciones de Uber de octubre (147,86).
    jsonb_build_object('id', '18a30474-37bf-4720-a8cd-6f0c8c50a8c1', 'importe', 14.11),
    jsonb_build_object('id', '3cea8cc9-91ee-49b4-8f8b-b72b811ef138', 'importe', 24.25),
    jsonb_build_object('id', 'e9b99d2e-0f2a-4ea6-8a4e-c6d809fc40d3', 'importe', 27.32),
    jsonb_build_object('id', '3641b09f-a2f2-4b2b-bb1d-8a3c005b6d24', 'importe', 36.62),
    jsonb_build_object('id', 'dfbbb625-c576-4f0b-84c9-7e9c5e15e097', 'importe', 45.56)));
  raise notice 'DL1 validar: % asientos validados.', v_n;
end $$;
