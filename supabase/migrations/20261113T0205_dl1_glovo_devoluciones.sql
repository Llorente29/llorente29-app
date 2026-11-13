-- supabase/migrations/20261113T0205_dl1_glovo_devoluciones.sql
--
-- DL1 · Las devoluciones falsas de Glovo de octubre (Julio, DL1·22, 13/11). Al
-- validar los 12 días de Glovo de Carabanchel, Sumied propuso 21 «Devolución …
-- no cobrado» (541,35): conta_sin_confirmar_no_cobrados busca, de cada pedido
-- cerrado sin confirmar, su línea en la liquidación (channel_settlement_order),
-- y estas liquidaciones entraron como resumen (Excel), sin líneas. Glovo sí los
-- cobró: cada liquidación cuenta los mismos pedidos que Folvy o más.
--   I170326000537098 (otra marca de Carabanchel, 01–15/10): 2 y 2, 69,40 y 69,40 (el 766).
--   I170326000544676 (Camichi, 01–15/10): 23 y 23 (17 de los 21).
--   I170326000578241 (Camichi, 16–31/10): 9 y 7 (282, 637 y 793).
--
-- Como Julio y por el camino de la aplicación:
--   · la 1/2010 (pedido 234, 20,40), validada por error: se anula con
--     journal_entry_anular y la fecha del asiento (06/10, octubre abierto), y se
--     apunta «se cobró por otro lado» para ese pedido, como la pantalla «Lo que
--     deja el cierre» (journal_dismissal de sales_adjustment), para que no se
--     vuelva a proponer;
--   · las otras 20, propuestas: se descartan con journal_entry_descartar, que
--     apunta lo mismo y quita la propuesta.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento, y un descarte es lo que dice la persona.

create or replace function public._dl1_anular(p_company uuid, p_actor uuid, p_nombre text, p_entry uuid, p_motivo text, p_fecha date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true); v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1 anular: esa empresa no está.'; end if;
  if not exists (select 1 from public.journal_entry where id = p_entry and company_id = p_company and account_id = v_acc) then
    raise exception 'DL1 anular: el asiento % no es de la empresa.', p_entry;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  v_r := public.journal_entry_anular(p_entry, p_motivo, p_fecha, p_nombre);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  if (v_r->>'fecha')::date is distinct from p_fecha then
    raise exception 'DL1 anular: el contraasiento sale con fecha % y se pedía %.', v_r->>'fecha', p_fecha;
  end if;
  return v_r;
end $$;
revoke all on function public._dl1_anular(uuid, uuid, text, uuid, text, date) from public, anon, authenticated, service_role;
comment on function public._dl1_anular(uuid, uuid, text, uuid, text, date) is
  'DL1. Anula un asiento validado con journal_entry_anular, como una persona de la cuenta, con la fecha que se pide (para si sale otra). Solo una tanda.';

create or replace function public._dl1_descartar(p_company uuid, p_actor uuid, p_nombre text, p_entry uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true); v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1 descartar: esa empresa no está.'; end if;
  if not exists (select 1 from public.journal_entry where id = p_entry and company_id = p_company and account_id = v_acc) then
    raise exception 'DL1 descartar: el asiento % no es de la empresa.', p_entry;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  v_r := public.journal_entry_descartar(p_entry, p_motivo, p_nombre);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_r;
end $$;
revoke all on function public._dl1_descartar(uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;
comment on function public._dl1_descartar(uuid, uuid, text, uuid, text) is
  'DL1. Descarta una propuesta con journal_entry_descartar, como una persona de la cuenta. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_motivo constant text := 'Cerrado sin confirmar al cierre del día: se cobró por otro lado (no hace falta la devolución).';
  v_por constant text := ' DL1 (Julio, 13/11): Glovo lo pagó; su liquidación entró como resumen, sin líneas, y cuenta los mismos pedidos que Folvy o más.';
  r record; v_n int := 0;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 devoluciones: sin la cuenta de Foodint, no hay nada que hacer.';
    return;
  end if;

  -- La 1/2010, validada por error: anulada con la fecha del asiento, y su pedido «se cobró».
  if not exists (select 1 from public.journal_entry where id = 'be914472-6625-4dde-92a7-df68152f106d' and company_id = v_e and status = 'validado'
                  and source_type = 'sales_adjustment' and source_id = '56072c28-32ae-4065-a7bb-4282067a13a0' and entry_date = date '2026-10-06') then
    raise exception 'DL1 devoluciones: la 1/2010 no está como se midió (validada, del pedido 234, del 06/10): no se toca nada.';
  end if;
  perform public._dl1_anular(v_e, v_julio, 'Julio', 'be914472-6625-4dde-92a7-df68152f106d',
    'devolución propuesta por error: Glovo cobró el pedido 234 (liquidación I170326000544676, 23 pedidos como en Folvy)', date '2026-10-06');
  insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
  values (v_acc, v_e, 'sales_adjustment', '56072c28-32ae-4065-a7bb-4282067a13a0', v_motivo || v_por, v_julio, 'Julio')
  on conflict (company_id, source_type, source_key) do update set reason = excluded.reason;

  -- Las otras 20, propuestas: descartadas («se cobró por otro lado»).
  for r in select * from (values
      ('8c95fea9-6694-4b11-bb1f-6c1c3da154f7'::uuid, '662ec0d9-e44e-4845-baa4-f04d8fe2b52e'::uuid, 20.40),
      ('832abe48-1834-44f3-9d9a-d3a912533de6', '384de9da-674b-4bb5-835c-5c12bdc36ead', 24.30),
      ('a7b66620-ab75-4370-b230-dea270c7a1ab', '3c36e6af-c350-487f-9bf9-64b13d05ae9e', 11.90),
      ('0a243ad5-612f-4409-b469-b18d7b14de39', '0d7a5869-c837-4d8e-811e-eafa16db3099', 23.80),
      ('96a0fc22-e662-4939-a067-ae527cd54e5f', 'a86c4856-cace-4244-b883-d9a9fdf3c7c1', 24.80),
      ('46482153-6dda-44c1-94b6-7be455536480', '2b3efa39-9bc3-4b27-9f55-e339fdb37d07', 19.87),
      ('263c77d7-83ea-40d2-9046-2a22284d6283', '6fca1bf8-5953-4082-88ea-73ef04237dc2', 36.14),
      ('0ec59187-e106-4025-92b4-cdd738318840', 'b8fdca8e-2282-40ab-9e48-81492ebdb899', 24.30),
      ('6a8d2c95-c556-41bd-835f-67a786f487a2', 'b5a1c95a-30e7-42be-a181-197a875b4438', 28.70),
      ('16f63df0-7ead-4ac6-813c-aa526dd415f6', 'e0cbda61-17aa-454c-b0c7-3702f0e20a4a', 32.20),
      ('169e9f21-ce04-430f-8897-ff2ea040ff2c', 'c5190a76-45b9-493d-9b28-83479704d825', 20.40),
      ('739c9e52-9c33-448e-b19f-49f83a14dfdc', '477fd6ce-c49b-4915-bfcf-f14ffe8bd63f', 21.47),
      ('e8a502c0-46aa-4c60-a330-888f243a88c8', 'ac3d179d-795c-481c-be35-16f15ade8260', 20.40),
      ('691ba0be-37ec-40e5-81d7-8b9b2b32c4eb', '0d7e0ab2-8597-49da-89d1-8e19fd3c0dd2', 24.30),
      ('1bfe7759-a5f5-4ed5-ae07-666fa05e3da9', '55cc530e-f651-4130-99c2-dc3314a1b7e8', 20.40),
      ('ceed18e7-4e18-449e-a121-8e433bf72248', 'e43a74a2-2b42-40e6-947e-89a8b219617e', 33.20),
      ('91fa4616-5e15-4454-b2dc-615801f93b18', '32b35dca-bc27-4588-bcaa-9c31e7a6ce30', 33.70),
      ('28c71a92-b129-469b-b620-cf633d8ff987', 'a9ccb705-b4da-4868-a2eb-2d20e4f046c9', 19.87),
      ('2fc12b6f-6945-4c77-8fc3-b07d7a456c05', '8d0f3abb-729a-48bd-983f-e640b60ea6fe', 36.70),
      ('aef68ca5-d1e5-4d49-855a-1718c101cf35', '07b0190e-7672-428f-9115-415f3e636944', 44.10)
    ) x(id, sale_id, importe) loop
    if not exists (select 1 from public.journal_entry e where e.id = r.id and e.company_id = v_e and e.status = 'propuesto'
                    and e.source_type = 'sales_adjustment' and e.source_id = r.sale_id
                    and (select sum(debit) from public.journal_line where entry_id = e.id) = r.importe) then
      raise exception 'DL1 devoluciones: la propuesta % no está como se midió: no se descarta nada.', r.id;
    end if;
    perform public._dl1_descartar(v_e, v_julio, 'Julio', r.id, v_motivo || v_por);
    v_n := v_n + 1;
  end loop;
  if exists (select 1 from public.journal_entry where company_id = v_e and status = 'propuesto' and source_type = 'sales_adjustment'
              and entry_date between date '2026-10-01' and date '2026-10-31') then
    raise exception 'DL1 devoluciones: después de descartar quedan devoluciones de octubre propuestas.';
  end if;
  raise notice 'DL1 devoluciones: la 1/2010 anulada y % propuestas descartadas («se cobró por otro lado»).', v_n;
end $$;
