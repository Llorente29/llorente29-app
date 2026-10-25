-- supabase/migrations/20261025T0918_pc01_cobros_y_pagos_de_antes.sql
--
-- PC01 · Entrega 1 · Lo de antes, con el motor nuevo (Julio, 25/10). TOCA
-- DATOS QUE EXISTEN: pide «autorizo». Va después de la 0916 y la 0917.
--
--   1. Cuándo paga cada plataforma de Foodint (dato de Julio, 25/10; los días
--      son aproximados): Uber, semanal, el lunes siguiente (1 día después de
--      cerrar la semana); Just Eat, quincenal, unos 4 días después de cerrar la
--      quincena (la del 1 al 15, hacia el 19; la del 16 a fin de mes, hacia el
--      4); Glovo, quincenal con una quincena más de retraso, unos 20 días
--      después (la del 1 al 15, hacia el 4 del mes siguiente; la del 16 a fin
--      de mes, hacia el 20). Margen, el de por defecto: 5 días.
--   2. La marca de las 9 tiendas de Uber de Foodint (vacía en las 9; Julio, sí,
--      con la lista en el PR). Cada tienda, la marca propia con su mismo nombre.
--      Al ponerla, sus liquidaciones cobradas se vuelven a mirar solas.
--   3. El vencimiento de las facturas emitidas de plataforma (las 1.281 de
--      Foodint vencían el mismo día que se emitían): el día de pago que les toca
--      más el margen. Las traídas de Diez, por la plataforma de su 430.
--   4. Las traídas de Diez (las 1.196 del histórico, grupo «traida»), cobradas:
--      un cobro sin asiento («traido_diez»; el cobro ya está en los libros
--      traídos), por su total. La devolución de −3,90 €, con un cobro negativo.
--   5. Los pagos de las recibidas que ya hay, a su tabla (supplier_invoice_payment):
--      · los casados en Bancos vivos (las 4 pagadas de Foodint), con su asiento;
--      · los pagados del saldo prepago de Catcher con el pago de su lote (83 de
--        Foodint, con su asiento validado y todavía «aprobada»): su pago, y
--        pagadas.
--   6. Las liquidaciones cobradas: sus facturas, cobradas por sus pedidos, o «a
--      revisar» con su porqué. Lo que no tiene liquidación cobrada se queda por
--      cobrar: no se inventa ningún cobro.
--
-- COPIA PREVIA, para que la vuelta atrás deje los datos EXACTAMENTE como estaban
-- (lo aprendido en el #323): _copia_pc01_party_role, _copia_pc01_tienda,
-- _copia_pc01_vence, _copia_pc01_recibida, _copia_pc01_liquidacion; y lo que crea,
-- fila a fila, en _pc01_creados. Si ya existen, para: la tanda no se pasa dos veces.
-- sin hueco: no retira ni rehace asientos, cierres ni facturas; no escribe en sale.
-- Vuelta atrás: supabase/vuelta-atras/20261025T0918_pc01_cobros_y_pagos_de_antes.down.sql

do $$ begin
  if to_regproc('public._conta_liquidacion_cobros') is null or not exists (select 1 from pg_trigger where tgname = 'pc01_liquidacion_cobrada') then
    raise exception 'PC01 0918: faltan la 0916 y la 0917 (el motor y sus disparadores). No toco nada.';
  end if;
  if to_regclass('public._pc01_creados') is not null then
    raise exception 'PC01 0918: ya está su copia previa (_pc01_creados): esta tanda ya se pasó. No toco nada.';
  end if;
end $$;

create table public._copia_pc01_party_role (id uuid primary key, settlement_every text, payout_days_after integer, payout_margin_days integer);
create table public._copia_pc01_tienda (id uuid primary key, brand_id uuid, updated_at timestamptz, updated_by uuid, updated_by_name text);
create table public._copia_pc01_vence (invoice_id uuid primary key, due_date date, updated_at timestamptz);
create table public._copia_pc01_recibida (invoice_id uuid primary key, status text, paid_at date, paid_method text, paid_by uuid, paid_by_name text, updated_at timestamptz);
create table public._copia_pc01_liquidacion (id uuid primary key, invoice_match_status text, invoice_match_note text);
create table public._pc01_creados (tabla text not null, id uuid not null, primary key (tabla, id));
alter table public._copia_pc01_party_role enable row level security;
alter table public._copia_pc01_tienda enable row level security;
alter table public._copia_pc01_vence enable row level security;
alter table public._copia_pc01_recibida enable row level security;
alter table public._copia_pc01_liquidacion enable row level security;
alter table public._pc01_creados enable row level security;
revoke all on table public._copia_pc01_party_role, public._copia_pc01_tienda, public._copia_pc01_vence, public._copia_pc01_recibida,
  public._copia_pc01_liquidacion, public._pc01_creados from anon, authenticated;

do $$
declare
  c_foodint constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  -- 1 · Las tres plataformas de Foodint: su papel en Contactos, su canal y su plazo.
  v_plazo jsonb := '[
    {"rol": "8304df62-ccfc-49f5-b29d-149f2cc17489", "canal": "uber",    "cada": "weekly",      "dias": 1},
    {"rol": "ad7c6f0e-218f-41aa-870a-419f53e2353d", "canal": "justeat", "cada": "fortnightly", "dias": 4},
    {"rol": "f28f3170-47cd-4d2a-af80-0339dfc0ac62", "canal": "glovo",   "cada": "fortnightly", "dias": 20}]';
  -- 2 · Las 9 tiendas de Uber y su marca (la propia con su mismo nombre).
  v_tiendas jsonb := '[
    {"tienda": "5a537eda-a0c8-4768-a99e-e2486d6dc1c0", "marca": "95635ce3-055f-4333-b3ec-1b4e9b2a0170", "nombre": "Bendito Burrito"},
    {"tienda": "a865e585-33f1-43aa-8677-3599e886e5d5", "marca": "cc89c6eb-afb8-4308-884e-9aac83986b22", "nombre": "Meraki Pita"},
    {"tienda": "b37feb93-a403-46dc-a00b-1b3d1e7b3f16", "marca": "cc89c6eb-afb8-4308-884e-9aac83986b22", "nombre": "Meraki Pita"},
    {"tienda": "00895f50-c86a-470d-93ff-9791ca2825f6", "marca": "0229a52b-bfc6-4c6b-b29b-22b7288138e5", "nombre": "Mila''s Sandwiches"},
    {"tienda": "42acec0b-7282-44a7-93e2-4d78dc75c6f5", "marca": "501ffd59-19e1-4d75-81dd-70c5a1a2b1de", "nombre": "Milanesa House"},
    {"tienda": "29c5cb12-58d9-41e4-94cf-9216d5f324c4", "marca": "501ffd59-19e1-4d75-81dd-70c5a1a2b1de", "nombre": "Milanesa House"},
    {"tienda": "ccfb8be5-4302-4915-bf6c-0b0a179b78d5", "marca": "2b160122-c763-4ca5-8fd5-b74d06c910c5", "nombre": "Scandal Burgers"},
    {"tienda": "f8ac54e5-bafd-4202-aec5-11f5ace39152", "marca": "43d305cd-6b48-4a8d-b292-7d3aa09e9657", "nombre": "Smash Brothers Burgers"},
    {"tienda": "f1414b0b-03da-4909-8825-ab1233334125", "marca": "5a230c99-1de4-47ca-82fb-65d4af589176", "nombre": "The Urban Kebab"}]';
  x jsonb; n int; v_t numeric; r record; v_hay_foodint boolean;
  n_plazo int := 0; n_tiendas int := 0; n_vence int := 0; n_traidas int := 0; t_traidas numeric := 0; n_banco int := 0; n_lote int := 0; t_lote numeric := 0;
  n_liq int := 0; n_cobradas int := 0; n_revisar int := 0;
begin
  v_hay_foodint := exists (select 1 from public.accounts where id = c_foodint);

  -- 1 · Plazos (solo Foodint: es su dato).
  if v_hay_foodint then
    for x in select * from jsonb_array_elements(v_plazo) loop
      select pr.* into r from public.party_role pr join public.sales_channel ch on ch.id = pr.channel_id
       where pr.id = (x->>'rol')::uuid and pr.account_id = c_foodint and pr.role = 'platform' and ch.slug = x->>'canal';
      if r.id is null then raise exception 'PC01 0918 · 1: no encuentro la plataforma «%» de Foodint (papel %).', x->>'canal', x->>'rol'; end if;
      insert into public._copia_pc01_party_role values (r.id, r.settlement_every, r.payout_days_after, r.payout_margin_days);
      update public.party_role set settlement_every = x->>'cada', payout_days_after = (x->>'dias')::int where id = r.id;
      n_plazo := n_plazo + 1;
    end loop;

    -- 2 · La marca de las 9 tiendas: vacía, de Foodint, y la marca propia con ese nombre al principio de la tienda.
    for x in select * from jsonb_array_elements(v_tiendas) loop
      select ps.id, ps.brand_id, ps.updated_at, ps.updated_by, ps.updated_by_name, ps.external_text into r
        from public.platform_store ps where ps.id = (x->>'tienda')::uuid and ps.account_id = c_foodint;
      if r.id is null then raise exception 'PC01 0918 · 2: la tienda % no es de Foodint.', x->>'tienda'; end if;
      if r.brand_id is not null then raise exception 'PC01 0918 · 2: la tienda «%» ya tiene marca: no la cambio.', r.external_text; end if;
      if r.external_text not like (x->>'nombre') || ' (%' then raise exception 'PC01 0918 · 2: la tienda «%» no es de «%».', r.external_text, x->>'nombre'; end if;
      if not exists (select 1 from public.brand b where b.id = (x->>'marca')::uuid and b.account_id = c_foodint and b.name = x->>'nombre' and b.ownership_type = 'own') then
        raise exception 'PC01 0918 · 2: la marca % no es «%» propia de Foodint.', x->>'marca', x->>'nombre';
      end if;
      insert into public._copia_pc01_tienda values (r.id, r.brand_id, r.updated_at, r.updated_by, r.updated_by_name);
      n_tiendas := n_tiendas + 1;
    end loop;
    -- La copia de las liquidaciones, antes de que las tiendas las vuelvan a mirar.
    insert into public._copia_pc01_liquidacion select id, invoice_match_status, invoice_match_note from public.channel_settlement where collected_on is not null or store_id in (select id from public._copia_pc01_tienda);
    for x in select * from jsonb_array_elements(v_tiendas) loop
      update public.platform_store set brand_id = (x->>'marca')::uuid, updated_at = now(), updated_by_name = 'Sumied · PC01 (marca de la tienda)' where id = (x->>'tienda')::uuid;
    end loop;
  end if;
  insert into public._copia_pc01_liquidacion select id, invoice_match_status, invoice_match_note from public.channel_settlement
   where collected_on is not null on conflict (id) do nothing;

  -- 3 · Vencimientos de las emitidas de plataforma.
  insert into public._copia_pc01_vence
  select ci.id, ci.due_date, ci.updated_at from public.customer_invoice ci
   where ci.status = 'emitida' and public.conta_vence_de_factura(ci.id) is not null and ci.due_date is distinct from public.conta_vence_de_factura(ci.id);
  update public.customer_invoice ci set due_date = public.conta_vence_de_factura(ci.id) where ci.id in (select invoice_id from public._copia_pc01_vence);
  get diagnostics n_vence = row_count;

  -- 4 · Las traídas de Diez, cobradas (sin asiento: el cobro ya está en los libros traídos).
  if to_regclass('public._v01_historico_facturas') is not null then
    insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by_name)
    select ci.account_id, ci.company_id, ci.id, ci.issue_date, ci.total, 'traido_diez',
           'Traída de Diez: el cobro ya está en los libros traídos (sin asiento aquí).', 'Sumied · PC01'
      from public.customer_invoice ci join public._v01_historico_facturas h on h.invoice_id = ci.id and h.grupo = 'traida'
     where ci.status = 'emitida' and ci.total <> 0
       and not exists (select 1 from public.customer_invoice_payment p where p.invoice_id = ci.id);
    get diagnostics n_traidas = row_count;
    select coalesce(sum(amount), 0) into t_traidas from public.customer_invoice_payment where method = 'traido_diez' and created_at = now();
  end if;

  -- 5a · Los pagos casados en Bancos (vivos), con el asiento del banco.
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, bank_match_id, created_by, created_by_name)
  select i.account_id, b.company_id, i.supplier_invoice_id, m.op_date, sum(abs(i.amount)),
         case when m.common_code = '03' or m.bank_concept ~* 'RECIBO|ADEUDO|DOMICILIA' then 'direct_debit' else 'transfer' end,
         'Casado en Bancos con el movimiento del ' || to_char(m.op_date, 'DD/MM/YYYY'), b.journal_entry_id, b.id, b.created_by, b.created_by_name
    from public.bank_match_item i
    join public.bank_match b on b.id = i.match_id and b.status = 'vivo'
    join public.bank_movement m on m.id = b.movement_id
   where i.supplier_invoice_id is not null
   group by i.account_id, b.company_id, i.supplier_invoice_id, m.op_date, m.common_code, m.bank_concept, b.journal_entry_id, b.id, b.created_by, b.created_by_name
  on conflict (bank_match_id, invoice_id) where bank_match_id is not null do nothing;
  get diagnostics n_banco = row_count;

  -- 5b · Los pagados del saldo prepago con el pago de su lote: su pago, y pagadas.
  for r in select si.*, e.entry_date as fecha_pago, e.company_id as empresa_pago from public.supplier_invoice si
             join public.journal_entry e on e.id = si.payment_entry_id and e.source_type = 'supplier_payment' and e.status in ('propuesto', 'borrador', 'validado')
            where si.status in ('aprobada', 'pagada') and coalesce(si.grand_total, 0) <> 0
              and not exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = si.id and p.entry_id = si.payment_entry_id) loop
    insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, created_by_name)
    values (r.account_id, coalesce(r.company_id, r.empresa_pago), r.id, r.fecha_pago, r.grand_total, 'prepaid',
            'Pagada del saldo prepago de Catcher con el pago de su lote', r.payment_entry_id, 'Sumied · PC01');
    if r.status = 'aprobada' then
      insert into public._copia_pc01_recibida values (r.id, r.status, r.paid_at, r.paid_method, r.paid_by, r.paid_by_name, r.updated_at);
      update public.supplier_invoice set status = 'pagada', paid_at = r.fecha_pago, paid_method = 'prepaid', paid_by = null,
             paid_by_name = 'Sumied · PC01 (pago del lote)', updated_at = now() where id = r.id;
      insert into public.supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
      values (r.account_id, r.id, 'paid', r.fecha_pago, 'prepaid', null, 'Sumied · PC01 (pago del lote)');
    end if;
    n_lote := n_lote + 1; t_lote := t_lote + r.grand_total;
  end loop;

  -- 6 · Las liquidaciones cobradas (todas: se puede repetir y deja lo mismo).
  for r in select id from public.channel_settlement where collected_on is not null order by period_from, id loop
    x := public._conta_liquidacion_cobros(r.id);
    n_liq := n_liq + 1;
    if x->>'estado' = 'cobradas' then n_cobradas := n_cobradas + 1; elsif x->>'estado' = 'a_revisar' then n_revisar := n_revisar + 1; end if;
  end loop;

  -- Lo que esta tanda ha creado, fila a fila (todo lo creado en ESTA transacción lleva su now()).
  insert into public._pc01_creados select 'customer_invoice_payment', id from public.customer_invoice_payment where created_at = now();
  insert into public._pc01_creados select 'supplier_invoice_payment', id from public.supplier_invoice_payment where created_at = now();
  insert into public._pc01_creados select 'supplier_invoice_payment_log', id from public.supplier_invoice_payment_log where created_at = now();
  insert into public._pc01_creados select 'customer_invoice_event', id from public.customer_invoice_event where at = now();

  -- La comprobación: ninguna traída queda con algo por cobrar.
  if to_regclass('public._v01_historico_facturas') is not null then
    select count(*) into n from public.conta_factura_cobro f join public._v01_historico_facturas h on h.invoice_id = f.invoice_id and h.grupo = 'traida'
     where f.estado not in ('cobrada', 'anulada');
    if n > 0 then raise exception 'PC01 0918: % traídas de Diez siguen con algo por cobrar. No aplico nada.', n; end if;
  end if;
  -- Y ninguna recibida pagada del lote o del banco queda sin cubrir.
  select count(*) into n from public.supplier_invoice si where si.status = 'pagada'
     and coalesce((select sum(p.amount) from public.supplier_invoice_payment p where p.invoice_id = si.id and p.entry_id is not null), 0) < coalesce(si.grand_total, 0) - 0.005;
  if n > 0 then raise exception 'PC01 0918: % recibidas pagadas no tienen pagos con asiento que las cubran. No aplico nada.', n; end if;

  raise notice 'PC01 0918: % plazos de plataforma; marca a % tiendas; % vencimientos; % traídas cobradas (%); % pagos del banco; % pagados del lote (%); % liquidaciones cobradas: % con sus facturas cobradas, % a revisar.',
    n_plazo, n_tiendas, n_vence, n_traidas, public.conta_euros_exactos(t_traidas), n_banco, n_lote, public.conta_euros_exactos(t_lote), n_liq, n_cobradas, n_revisar;
end $$;
