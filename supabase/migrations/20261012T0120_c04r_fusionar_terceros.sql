-- ============================================================================
-- C04 R4 · FUSIONAR DOS TERCEROS (Clientes y proveedores › «Fusionar con…»)
-- ----------------------------------------------------------------------------
-- Lo que quedó apuntado en el C01b: el mismo cliente o proveedor dos veces
-- (la ficha que trajo Diez, activa, y el proveedor viejo de Cocina, archivado).
-- «Fusionar con…» deja UNA ficha viva y conserva lo de las dos:
--
--   · Se mueve a la que queda todo lo que apunta a la que se va y se puede
--     mover sin chocar: sus papeles (si la que queda no lo tiene ya), sus
--     cuentas de cliente (si no tiene ya una con el mismo papel), sus datos
--     fiscales de cliente (si no tiene), sus liquidaciones, acuerdos de cesión,
--     aportaciones y las propuestas y borradores del libro. Y su NIF, si la que
--     queda no tiene.
--   · Lo que choca NO se pisa: se queda en la que se va, que pasa a archivada
--     con la nota «Fusionado con …». El caso de siempre es la ficha de
--     proveedor de Cocina: un tercero tiene una sola (party_role único por
--     papel) y los albaranes y facturas de Cocina cuelgan de ella; moverlos
--     sería tocar Cocina, y no se toca. Sus documentos siguen donde estaban.
--   · No se fusiona si la que se va tiene asientos VALIDADOS: lo validado no
--     cambia de tercero (se anula y se rehace); se dice y para.
--
-- Rastro y deshacer: party_merge guarda qué se movió, fila a fila, quién y
-- cuándo. party_merge_undo lo devuelve todo a su sitio mientras nada de lo
-- movido se haya validado después.
--
-- No toca el camino del pedido: party, party_role, customer_fiscal,
-- company_account_link, channel_settlement, licensed_settlement,
-- brand_licensing_agreement, brand_partner_contribution y journal_entry/line
-- (solo propuestas y borradores). Solo AÑADE: una tabla y dos funciones.
-- Vuelta atrás: supabase/vuelta-atras/20261012T0120_c04r_fusionar_terceros.down.sql
-- ============================================================================

create table if not exists public.party_merge (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  kept_party_id   uuid not null references public.party(id) on delete cascade,
  gone_party_id   uuid not null references public.party(id) on delete cascade,
  moved           jsonb not null,
  kept_on_gone    jsonb not null default '[]'::jsonb,
  summary         text not null,
  done_at         timestamptz not null default now(),
  done_by         uuid,
  done_by_name    text,
  undone_at       timestamptz,
  undone_by       uuid,
  undone_by_name  text,
  check (kept_party_id <> gone_party_id)
);
comment on table public.party_merge is
  'C04 R4. Cada fusión de dos terceros: qué se movió de la que se va a la que queda (moved, por tabla y fila), lo que se quedó en la que se va por chocar (kept_on_gone), quién y cuándo. La deshace party_merge_undo.';
create index if not exists party_merge_cuenta on public.party_merge (account_id, done_at desc);
create index if not exists party_merge_queda on public.party_merge (kept_party_id);
create index if not exists party_merge_se_va on public.party_merge (gone_party_id);

alter table public.party_merge enable row level security;
drop policy if exists party_merge_select on public.party_merge;
create policy party_merge_select on public.party_merge for select using (belongs_to_account(account_id));
-- Se escribe solo desde las dos funciones (security definer): ni insert ni update directos.

create or replace function public.party_merge_do(p_queda uuid, p_se_va uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_a party; v_b party;
  v_mov jsonb := '{}'::jsonb; v_quedan jsonb := '[]'::jsonb; v_ids uuid[];
  v_validados int; v_n int := 0; v_resumen text; v_nif_movido boolean := false; v_merge uuid; v_prov uuid[]; r record;
begin
  if p_queda = p_se_va then raise exception 'Es la misma ficha.' using errcode = '22023'; end if;
  v_cuenta := public.party_cuenta(p_queda);  -- existe y quien llama es administrador o encargado de su cuenta
  select * into v_a from party where id = p_queda for update;
  select * into v_b from party where id = p_se_va for update;
  if v_b.id is null or v_b.account_id <> v_cuenta then raise exception 'Las dos fichas tienen que ser de la misma cuenta.' using errcode = '42501'; end if;
  if exists (select 1 from party_merge m where m.undone_at is null and m.gone_party_id = p_queda) then
    raise exception '% ya se fusionó en otra ficha: fusiona con esa.', v_a.name using errcode = '22023';
  end if;

  select (select count(*) from journal_entry where party_id = p_se_va and status in ('validado', 'anulado'))
       + (select count(*) from journal_line l join journal_entry e on e.id = l.entry_id where l.party_id = p_se_va and e.status in ('validado', 'anulado'))
    into v_validados;
  if v_validados > 0 then
    raise exception '% sale en % asiento(s) o apunte(s) validados: lo validado no cambia de tercero. Anúlalos y rehazlos con %, y vuelve a fusionar.', v_b.name, v_validados, v_a.name
      using errcode = '23514';
  end if;

  -- 1 · Papeles: los que la que queda no tiene se mueven; los que ya tiene se quedan (la ficha de proveedor de Cocina, sobre todo).
  select coalesce(array_agg(x.id), '{}') into v_ids from party_role x
   where x.party_id = p_se_va and not exists (select 1 from party_role y where y.party_id = p_queda and y.role = x.role);
  for r in select role from party_role where party_id = p_se_va and not (id = any(v_ids)) loop
    v_quedan := v_quedan || jsonb_build_object('que', 'papel', 'papel', r.role);
  end loop;
  update party_role set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('party_role', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 2 · Sus cuentas de cliente, papel a papel, si la que queda no tiene ya una con ese papel.
  select coalesce(array_agg(l.id), '{}') into v_ids from company_account_link l
   where l.account_id = v_cuenta and l.entity = 'customer' and l.entity_id = p_se_va::text
     and not exists (select 1 from company_account_link x where x.company_id = l.company_id and x.entity = 'customer' and x.entity_id = p_queda::text and x.role = l.role);
  for r in select l.role, a.code from company_account_link l join company_account a on a.id = l.company_account_id
            where l.account_id = v_cuenta and l.entity = 'customer' and l.entity_id = p_se_va::text and not (l.id = any(v_ids)) loop
    v_quedan := v_quedan || jsonb_build_object('que', 'cuenta', 'papel', r.role, 'codigo', r.code);
  end loop;
  update company_account_link set entity_id = p_queda::text where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('company_account_link', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 3 · Datos fiscales de cliente, si la que queda no tiene.
  if exists (select 1 from customer_fiscal where party_id = p_se_va) then
    if not exists (select 1 from customer_fiscal where party_id = p_queda) then
      update customer_fiscal set party_id = p_queda where party_id = p_se_va;
      v_mov := v_mov || jsonb_build_object('customer_fiscal', true); v_n := v_n + 1;
    else
      v_quedan := v_quedan || jsonb_build_object('que', 'datos_fiscales');
    end if;
  end if;

  -- 4 · Lo que solo apunta al tercero: se mueve entero, apuntando qué filas.
  select coalesce(array_agg(id), '{}') into v_ids from channel_settlement where party_id = p_se_va and account_id = v_cuenta;
  update channel_settlement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('channel_settlement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from licensed_settlement where party_id = p_se_va and account_id = v_cuenta;
  update licensed_settlement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('licensed_settlement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from brand_licensing_agreement where party_id = p_se_va and account_id = v_cuenta;
  update brand_licensing_agreement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('brand_licensing_agreement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from brand_partner_contribution where party_id = p_se_va and account_id = v_cuenta;
  update brand_partner_contribution set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('brand_partner_contribution', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- Propuestas y borradores del libro (lo validado ya se ha descartado arriba).
  select coalesce(array_agg(id), '{}') into v_ids from journal_entry where party_id = p_se_va and account_id = v_cuenta;
  update journal_entry set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('journal_entry', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);
  select coalesce(array_agg(id), '{}') into v_ids from journal_line where party_id = p_se_va and account_id = v_cuenta;
  update journal_line set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('journal_line', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 5 · El NIF, si la que queda no tiene (el índice único por cuenta obliga a soltarlo antes).
  if v_a.tax_id is null and v_b.tax_id is not null then
    update party set tax_id = null where id = p_se_va;
    update party set tax_id = v_b.tax_id where id = p_queda;
    v_nif_movido := true;
  end if;

  -- 6 · La que se va, archivada con su nota (y su ficha de proveedor de Cocina, si la tiene y estaba viva).
  select coalesce(array_agg(s.id), '{}') into v_prov from party_role r join supplier s on s.id = r.supplier_id
   where r.party_id = p_se_va and s.archived_at is null;
  update supplier set archived_at = now() where id = any(v_prov);
  update party set archived_at = coalesce(archived_at, now()), archived_note = format('Fusionado con %s', v_a.name) where id = p_se_va;

  v_resumen := format('%s fusionado en %s: %s %s movido%s%s%s.', v_b.name, v_a.name, v_n, case when v_n = 1 then 'dato' else 'datos' end,
    case when v_n = 1 then '' else 's' end,
    case when v_nif_movido then format(', con su NIF %s', v_b.tax_id) else '' end,
    case when jsonb_array_length(v_quedan) > 0 then format('; se queda en %s (archivada) lo que %s ya tenía: %s', v_b.name, v_a.name,
      (select string_agg(case x->>'que' when 'papel' then 'su papel de ' || case x->>'papel' when 'supplier' then 'proveedor' when 'customer' then 'cliente' when 'platform' then 'plataforma' when 'brand_partner' then 'socio de marca' else x->>'papel' end when 'cuenta' then 'la cuenta ' || (x->>'codigo') else 'sus datos fiscales' end, ', ')
         from jsonb_array_elements(v_quedan) x)) else '' end);

  insert into party_merge (account_id, kept_party_id, gone_party_id, moved, kept_on_gone, summary, done_by, done_by_name)
  values (v_cuenta, p_queda, p_se_va,
          v_mov || jsonb_build_object('nif', v_nif_movido, 'antes', jsonb_build_object('archived_at', v_b.archived_at, 'archived_note', v_b.archived_note, 'tax_id', v_b.tax_id),
                                      'proveedores_archivados', to_jsonb(v_prov)),
          v_quedan, v_resumen, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  returning id into v_merge;
  return jsonb_build_object('fusion', v_merge, 'resumen', v_resumen, 'movidos', v_n, 'se_quedan', v_quedan);
end $$;
revoke all on function public.party_merge_do(uuid, uuid, text) from public, anon;
grant execute on function public.party_merge_do(uuid, uuid, text) to authenticated;

create or replace function public.party_merge_undo(p_merge uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m party_merge; v_cuenta uuid; v_b uuid; v_a uuid; v_ids uuid[];
begin
  select * into v_m from party_merge where id = p_merge for update;
  if v_m.id is null then raise exception 'Esa fusión no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.party_cuenta(v_m.kept_party_id);
  if v_m.undone_at is not null then raise exception 'Esa fusión ya está deshecha.' using errcode = '22023'; end if;
  v_a := v_m.kept_party_id; v_b := v_m.gone_party_id;
  v_ids := array(select jsonb_array_elements_text(v_m.moved->'journal_entry')::uuid);
  if exists (select 1 from journal_entry where id = any(v_ids) and status in ('validado', 'anulado')) then
    raise exception 'Desde la fusión se ha validado un asiento que era de la otra ficha: lo validado no cambia de tercero. Anúlalo antes de deshacer.' using errcode = '23514';
  end if;

  update journal_line set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'journal_line')::uuid)) and party_id = v_a;
  update journal_entry set party_id = v_b where id = any(v_ids) and party_id = v_a;
  update brand_partner_contribution set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'brand_partner_contribution')::uuid)) and party_id = v_a;
  update brand_licensing_agreement set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'brand_licensing_agreement')::uuid)) and party_id = v_a;
  update licensed_settlement set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'licensed_settlement')::uuid)) and party_id = v_a;
  update channel_settlement set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'channel_settlement')::uuid)) and party_id = v_a;
  if (v_m.moved->>'customer_fiscal')::boolean then update customer_fiscal set party_id = v_b where party_id = v_a; end if;
  update company_account_link set entity_id = v_b::text where id = any(array(select jsonb_array_elements_text(v_m.moved->'company_account_link')::uuid)) and entity_id = v_a::text;
  update party_role set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'party_role')::uuid)) and party_id = v_a;
  if (v_m.moved->>'nif')::boolean then
    update party set tax_id = null where id = v_a and tax_id = v_m.moved->'antes'->>'tax_id';
    update party set tax_id = v_m.moved->'antes'->>'tax_id' where id = v_b;
  end if;
  -- Primero el proveedor (su disparador copia archived_at al tercero si solo tiene ese papel) y después el tercero, tal como estaba.
  update supplier set archived_at = null where id = any(array(select jsonb_array_elements_text(v_m.moved->'proveedores_archivados')::uuid));
  update party set archived_at = (v_m.moved->'antes'->>'archived_at')::timestamptz, archived_note = v_m.moved->'antes'->>'archived_note' where id = v_b;
  update party_merge set undone_at = now(), undone_by = auth.uid(), undone_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()) where id = p_merge;
  return jsonb_build_object('fusion', p_merge, 'deshecha', true);
end $$;
revoke all on function public.party_merge_undo(uuid, text) from public, anon;
grant execute on function public.party_merge_undo(uuid, text) to authenticated;
