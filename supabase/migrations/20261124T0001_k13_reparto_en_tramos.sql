-- supabase/migrations/20261124T0001_k13_reparto_en_tramos.sql
--
-- K13 · El reparto analítico de cada línea de gasto de la recibida (Julio, 24/11: «Reparto analítico»; maqueta 17b,
-- fila 2 de la contrapartida). El ⊕ de la fila 2 añade otro tramo: otro local, marca o plataforma con su importe. Los
-- tramos de una línea suman el importe de su fila 1; si no suman, la ficha no valida y lo dice (y la propuesta, si
-- llegara a leerlos así, deja la línea entera y la marca en duda).
--
-- SOLO AÑADE: una tabla nueva y una función nueva. No escribe en ninguna fila que exista.
--
--   1. supplier_invoice_expense_tramo: por factura, posición de la línea (la de supplier_invoice_expense_dato) y
--      número de tramo; local, marca, plataforma e importe. Aparte, como los datos de la línea, porque
--      conta_recibida_guardar borra y vuelve a poner las líneas del reparto.
--   2. conta_recibida_reparto_linea(factura, posición, tramos, quién): pone los tramos de UNA línea (los de antes se
--      sustituyen; con menos de dos, la línea queda sin reparto). Las mismas puertas que conta_recibida_otros_datos
--      (de tu cuenta, ni anulada ni descartada, sin contabilizar), su rastro en supplier_invoice_change con los tramos
--      de antes y los de ahora, y el asiento propuesto se quita para proponerlo otra vez con lo nuevo.
--
-- sin hueco: el fichero no retira nada al aplicarse. Solo conta_recibida_reparto_linea, al cambiar el reparto de una
-- línea, quita el asiento propuesto (o borrador) de esa recibida, como conta_recibida_otros_datos: la propuesta lo vuelve
-- a hacer al abrirla, con el reparto nuevo.

create table if not exists public.supplier_invoice_expense_tramo (
  account_id uuid not null references public.accounts(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  position int not null check (position >= 0),
  tramo int not null check (tramo >= 0),
  location_id uuid references public.locations(id) on delete set null,
  brand_id uuid references public.brand(id) on delete set null,
  channel_id uuid references public.sales_channel(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  updated_at timestamptz not null default now(),
  primary key (supplier_invoice_id, position, tramo)
);
comment on table public.supplier_invoice_expense_tramo is
  'K13 · El reparto analítico de una línea de gasto de una recibida: un tramo por local, marca o plataforma con su importe. Los tramos de una línea suman su importe.';
alter table public.supplier_invoice_expense_tramo enable row level security;
revoke all on table public.supplier_invoice_expense_tramo from public, anon, authenticated;
grant select on table public.supplier_invoice_expense_tramo to authenticated;
drop policy if exists supplier_invoice_expense_tramo_leer on public.supplier_invoice_expense_tramo;
create policy supplier_invoice_expense_tramo_leer on public.supplier_invoice_expense_tramo for select to authenticated
  using (public.belongs_to_account(account_id));

create or replace function public.conta_recibida_reparto_linea(p_invoice uuid, p_posicion int, p_tramos jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_t jsonb;
  v_i int := 0;
  v_antes jsonb;
  v_ahora jsonb := '[]'::jsonb;
  v_uuid uuid;
  v_imp numeric;
  v_quitados int := 0;
begin
  if p_posicion is null or p_posicion < 0 then raise exception 'La línea lleva su posición (desde 0).' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_tramos, '[]'::jsonb)) <> 'array' then raise exception 'Los tramos van en una lista.' using errcode = '22023'; end if;
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'
                and e.source_id = v_f.id and e.status = 'validado') then
    raise exception 'Ya está contabilizada: para cambiarla, anula su asiento.' using errcode = '22023';
  end if;

  -- Los tramos que vienen, comprobados; con menos de dos no hay reparto.
  for v_t in select x from jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) x loop
    v_imp := nullif(v_t ->> 'importe', '')::numeric;
    if v_imp is null or v_imp <= 0 then raise exception 'Cada tramo lleva su importe, mayor que cero.' using errcode = '22023'; end if;
    v_uuid := nullif(v_t ->> 'local', '')::uuid;
    if v_uuid is not null and not exists (select 1 from public.locations l where l.id = v_uuid and l.account_id = v_f.account_id) then
      raise exception 'Ese local no es de esta cuenta.' using errcode = '42501';
    end if;
    v_uuid := nullif(v_t ->> 'marca', '')::uuid;
    if v_uuid is not null and not exists (select 1 from public.brand b where b.id = v_uuid and b.account_id = v_f.account_id) then
      raise exception 'Esa marca no es de esta cuenta.' using errcode = '42501';
    end if;
    v_uuid := nullif(v_t ->> 'plataforma', '')::uuid;
    if v_uuid is not null and not exists (select 1 from public.sales_channel c where c.id = v_uuid and c.account_id = v_f.account_id) then
      raise exception 'Esa plataforma no es de esta cuenta.' using errcode = '42501';
    end if;
    v_ahora := v_ahora || jsonb_build_object('tramo', v_i, 'local', nullif(v_t ->> 'local', '')::uuid, 'marca', nullif(v_t ->> 'marca', '')::uuid,
                                             'plataforma', nullif(v_t ->> 'plataforma', '')::uuid, 'importe', round(v_imp, 2));
    v_i := v_i + 1;
  end loop;
  if jsonb_array_length(v_ahora) < 2 then v_ahora := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object('tramo', t.tramo, 'local', t.location_id, 'marca', t.brand_id, 'plataforma', t.channel_id, 'importe', t.amount) order by t.tramo), '[]'::jsonb)
    into v_antes
    from public.supplier_invoice_expense_tramo t where t.supplier_invoice_id = v_f.id and t.position = p_posicion;
  if v_antes = v_ahora then
    return jsonb_build_object('guardado', false, 'texto', 'No había nada que guardar: el reparto estaba como está.', 'asiento_quitado', false);
  end if;

  delete from public.supplier_invoice_expense_tramo where supplier_invoice_id = v_f.id and position = p_posicion;
  insert into public.supplier_invoice_expense_tramo (account_id, supplier_invoice_id, position, tramo, location_id, brand_id, channel_id, amount)
  select v_f.account_id, v_f.id, p_posicion, (x ->> 'tramo')::int, (x ->> 'local')::uuid, (x ->> 'marca')::uuid, (x ->> 'plataforma')::uuid, (x ->> 'importe')::numeric
    from jsonb_array_elements(v_ahora) x;
  delete from public.journal_entry e
   where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');
  get diagnostics v_quitados = row_count;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar',
          jsonb_build_array(jsonb_build_object('campo', 'reparto', 'posicion', p_posicion, 'antes', v_antes, 'ahora', v_ahora)));
  return jsonb_build_object(
    'guardado', true,
    'texto', case when jsonb_array_length(v_ahora) = 0 then format('Línea %s: sin reparto.', p_posicion + 1)
                  else format('Línea %s: repartida en %s tramos (%s €).', p_posicion + 1, jsonb_array_length(v_ahora),
                              replace(to_char((select sum((x ->> 'importe')::numeric) from jsonb_array_elements(v_ahora) x), 'FM999999990.00'), '.', ',')) end
             || case when v_quitados > 0 then ' Su asiento propuesto se ha quitado para proponerlo otra vez con lo nuevo.' else '' end,
    'asiento_quitado', v_quitados > 0);
end $$;
comment on function public.conta_recibida_reparto_linea(uuid, int, jsonb, text) is
  'K13 · Pone el reparto analítico de una línea de gasto de una recibida sin contabilizar (tramos con local, marca, plataforma e importe; con menos de dos, sin reparto). Deja su rastro en supplier_invoice_change y quita el asiento propuesto.';
revoke all on function public.conta_recibida_reparto_linea(uuid, int, jsonb, text) from public, anon;
grant execute on function public.conta_recibida_reparto_linea(uuid, int, jsonb, text) to authenticated;
