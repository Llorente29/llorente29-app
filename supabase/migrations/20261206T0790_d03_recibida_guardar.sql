-- supabase/migrations/20261206T0790_d03_recibida_guardar.sql
--
-- D03 · «GUARDAR CAMBIOS» DE LA FICHA DE LA RECIBIDA (Julio, 23/10, puntos 1 y 2).
--
-- La ficha de la recibida ya deja editar todo antes de validar, pero la base
-- solo sabía guardar el proveedor y el vencimiento: lo demás lo decía «Guardar
-- cambios» como «no se ha podido guardar». Con esto se guarda todo, sin
-- escribir directo en tablas desde el front, en un solo viaje y con historial:
--
--   1. supplier_invoice, columnas nuevas (todas admiten nulos):
--        payment_method       la forma de pago PREVISTA (paid_method sigue
--                             siendo la de cuando se pagó), mismos valores.
--        no_document_at, no_document_reason, no_document_by_name
--                             «Sin PDF», con su motivo y quién.
--        entry_overrides      el asiento tocado a mano: [{posicion, cuenta,
--                             debe, haber, concepto, local}] o nulo.
--        withholding_base     la base de la retención (el tipo y el importe ya
--                             estaban: withholding_rate_id y withholding_amount).
--   2. supplier_invoice_expense (nueva): el gasto repartido por cuenta y local.
--   3. supplier_invoice_change (nueva): lo que cambió una persona, campo a
--      campo, con antes y ahora.
--      Las dos se LEEN con la sesión (como supplier_invoice_tax: si la factura
--      es de tu cuenta) y se escriben SOLO por las funciones de abajo.
--   4. conta_recibida_guardar(p_invoice, p_cambios, p_quien_nombre): guarda lo
--      que venga en p_cambios (todas las claves opcionales), rehace el IVA por
--      tipos y los totales, la retención, el reparto del gasto y el asiento a
--      mano; el vencimiento con set_supplier_invoice_due_date (su escritura y
--      su registro de siempre). Si la factura tenía un asiento PROPUESTO y lo
--      cambiado le afecta, lo quita (sin descartar: no deja journal_dismissal)
--      para que se vuelva a proponer con lo nuevo, y lo dice. Para si la
--      factura no es de tu cuenta, si está anulada o descartada, o si su
--      asiento ya está validado.
--   5. conta_recibida_papel_poner: el PDF (o la foto) que se sube en la ficha.
--      Limpia «Sin PDF» y reinicia su fila del D02 (conta_recibida_pdf), para
--      que la pasada del minuto haga el PDF de la foto nueva y no enlace el de
--      la vieja.
--   6. conta_recibida_sin_papel: «Sin PDF» con su motivo, o quitarlo.
--
-- Solo AÑADE: columnas que admiten nulos, dos tablas y tres funciones nuevas.
-- No toca ninguna fila al aplicarse ni ninguna función que exista. No toca el
-- camino del pedido (ningún pedido escribe recibidas ni asientos), ni coste
-- ni stock: las líneas de la factura (supplier_invoice_line) no se tocan, y
-- apply_invoice_costs no mira nada de esto.
-- sin hueco: no retira nada al aplicarse; el «delete from journal_entry» va
-- dentro de conta_recibida_guardar y solo quita el asiento PROPUESTO de una
-- recibida que alguien acaba de cambiar, para que la pantalla lo proponga otra
-- vez con lo nuevo en ese mismo «Guardar cambios» (y si no, el siguiente
-- «Proponer» del libro). Ningún resumen del día ni asiento validado.
-- Vuelta atrás: supabase/vuelta-atras/20261206T0790_d03_recibida_guardar.down.sql
-- Prueba: supabase/staging/sql/20261206_d03_recibida_guardar_prueba.sql

-- 1 · Columnas ------------------------------------------------------------------------
alter table public.supplier_invoice add column if not exists payment_method text
  constraint supplier_invoice_payment_method_check
  check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash'));
alter table public.supplier_invoice add column if not exists no_document_at timestamptz;
alter table public.supplier_invoice add column if not exists no_document_reason text;
alter table public.supplier_invoice add column if not exists no_document_by_name text;
alter table public.supplier_invoice add column if not exists entry_overrides jsonb;
alter table public.supplier_invoice add column if not exists withholding_base numeric(14,2);
comment on column public.supplier_invoice.payment_method is
  'D03 · La forma de pago PREVISTA (transfer, direct_debit, card, cash). paid_method es la de cuando se pagó.';
comment on column public.supplier_invoice.no_document_at is 'D03 · «Sin PDF»: cuándo se dijo que esta factura no tiene documento (con no_document_reason).';
comment on column public.supplier_invoice.no_document_reason is 'D03 · «Sin PDF»: por qué no tiene documento.';
comment on column public.supplier_invoice.no_document_by_name is 'D03 · «Sin PDF»: quién lo dijo.';
comment on column public.supplier_invoice.entry_overrides is
  'D03 · El asiento tocado a mano en la ficha: [{posicion, cuenta, debe, haber, concepto, local}], que cuadra; nulo = el propuesto.';
comment on column public.supplier_invoice.withholding_base is 'D03 · La base de la retención (con withholding_rate_id y withholding_amount).';

-- 2 · El gasto repartido ----------------------------------------------------------------
create table if not exists public.supplier_invoice_expense (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  position integer not null,
  account_code text not null,
  location_id uuid references public.locations(id),
  is_common boolean not null default false,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists supplier_invoice_expense_factura on public.supplier_invoice_expense (supplier_invoice_id, position);
comment on table public.supplier_invoice_expense is
  'D03 · El gasto de una recibida repartido por cuenta (del plan de su empresa) y local, o común. Si tiene filas, manda sobre la cuenta propuesta. Lo escribe conta_recibida_guardar.';
alter table public.supplier_invoice_expense enable row level security;
revoke all on table public.supplier_invoice_expense from public, anon, authenticated;
grant select on table public.supplier_invoice_expense to authenticated;
drop policy if exists supplier_invoice_expense_leer on public.supplier_invoice_expense;
create policy supplier_invoice_expense_leer on public.supplier_invoice_expense for select to authenticated
  using (public.belongs_to_account(account_id));

-- 3 · El historial de lo que cambió una persona ---------------------------------------
create table if not exists public.supplier_invoice_change (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  at timestamptz not null default now(),
  by_name text,
  what text not null check (what in ('guardar', 'papel', 'sin_papel')),
  cambios jsonb not null default '[]'::jsonb
);
create index if not exists supplier_invoice_change_factura on public.supplier_invoice_change (supplier_invoice_id, at);
comment on table public.supplier_invoice_change is
  'D03 · Lo que cambió una persona en la ficha de una recibida: guardar, poner su documento o «Sin PDF», con [{campo, antes, ahora}]. Lo escriben las funciones conta_recibida_*.';
alter table public.supplier_invoice_change enable row level security;
revoke all on table public.supplier_invoice_change from public, anon, authenticated;
grant select on table public.supplier_invoice_change to authenticated;
drop policy if exists supplier_invoice_change_leer on public.supplier_invoice_change;
create policy supplier_invoice_change_leer on public.supplier_invoice_change for select to authenticated
  using (public.belongs_to_account(account_id));

-- 4 · Guardar ---------------------------------------------------------------------------
create or replace function public.conta_recibida_guardar(p_invoice uuid, p_cambios jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_n public.supplier_invoice;
  v_c jsonb := coalesce(p_cambios, '{}'::jsonb);
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_claves constant text[] := array['proveedor', 'numero', 'fecha', 'local', 'vence', 'forma_pago', 'iva', 'retencion', 'gasto', 'asiento_a_mano'];
  v_raras text[];
  v_cambios jsonb := '[]'::jsonb;
  v_textos text[] := '{}';
  v_guardado text[] := '{}';
  v_al_asiento boolean := false;
  v_quitados int := 0;
  v_vence_antes date; v_vence date;
  v_iva_antes jsonb; v_iva jsonb;
  v_gasto_antes jsonb; v_gasto jsonb;
  v_ret_antes jsonb; v_ret jsonb;
  v_tasa uuid; v_tasas uuid[]; v_tipo numeric; v_importe numeric;
  v_x jsonb; v_uuid uuid; v_txt text; v_fecha date; v_mal int;
  v_debe numeric; v_haber numeric;
  v_formas constant jsonb := '{"transfer": "Transferencia", "direct_debit": "Domiciliación", "card": "Tarjeta", "cash": "Efectivo"}'::jsonb;
begin
  if jsonb_typeof(v_c) <> 'object' then
    raise exception 'Los cambios no se entienden: tiene que ser un objeto con lo que cambia.' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_raras from jsonb_object_keys(v_c) k where not (k = any (v_claves));
  if v_raras is not null then
    raise exception 'No sé guardar: %. Lo que sé guardar: %.', array_to_string(v_raras, ', '), array_to_string(v_claves, ', ') using errcode = '22023';
  end if;

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
  v_n := v_f;

  -- Proveedor
  if v_c ? 'proveedor' then
    v_uuid := nullif(v_c ->> 'proveedor', '')::uuid;
    if v_uuid is null then raise exception 'Una factura tiene proveedor.' using errcode = '22023'; end if;
    if not exists (select 1 from public.supplier s where s.id = v_uuid and s.account_id = v_f.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
    end if;
    if v_uuid is distinct from v_f.supplier_id then
      v_n.supplier_id := v_uuid; v_al_asiento := true; v_guardado := array_append(v_guardado, 'proveedor');
      v_cambios := v_cambios || jsonb_build_object('campo', 'proveedor', 'antes', v_f.supplier_id, 'ahora', v_uuid);
      v_textos := array_append(v_textos, format('Proveedor %s → %s',
        coalesce((select s.name from public.supplier s where s.id = v_f.supplier_id), '—'), (select s.name from public.supplier s where s.id = v_uuid)));
    end if;
  end if;

  -- Número
  if v_c ? 'numero' then
    v_txt := nullif(trim(v_c ->> 'numero'), '');
    if v_txt is distinct from v_f.invoice_number then
      v_n.invoice_number := v_txt; v_al_asiento := true; v_guardado := array_append(v_guardado, 'numero');
      v_cambios := v_cambios || jsonb_build_object('campo', 'numero', 'antes', v_f.invoice_number, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Número %s → %s', coalesce(v_f.invoice_number, '—'), coalesce(v_txt, '—')));
    end if;
  end if;

  -- Fecha
  if v_c ? 'fecha' then
    v_fecha := nullif(v_c ->> 'fecha', '')::date;
    if v_fecha is null then raise exception 'Una factura tiene fecha.' using errcode = '22023'; end if;
    if v_fecha is distinct from v_f.invoice_date then
      v_n.invoice_date := v_fecha; v_al_asiento := true; v_guardado := array_append(v_guardado, 'fecha');
      v_cambios := v_cambios || jsonb_build_object('campo', 'fecha', 'antes', v_f.invoice_date, 'ahora', v_fecha);
      v_textos := array_append(v_textos, format('Fecha %s → %s', coalesce(to_char(v_f.invoice_date, 'DD/MM/YYYY'), '—'), to_char(v_fecha, 'DD/MM/YYYY')));
    end if;
  end if;

  -- Local
  if v_c ? 'local' then
    v_uuid := nullif(v_c ->> 'local', '')::uuid;
    if v_uuid is not null and not exists (select 1 from public.locations l where l.id = v_uuid and l.account_id = v_f.account_id) then
      raise exception 'Ese local no es de esta cuenta.' using errcode = '42501';
    end if;
    if v_uuid is distinct from v_f.location_id then
      v_n.location_id := v_uuid; v_al_asiento := true; v_guardado := array_append(v_guardado, 'local');
      v_cambios := v_cambios || jsonb_build_object('campo', 'local', 'antes', v_f.location_id, 'ahora', v_uuid);
      v_textos := array_append(v_textos, format('Local %s → %s',
        coalesce((select l.name from public.locations l where l.id = v_f.location_id), 'común'), coalesce((select l.name from public.locations l where l.id = v_uuid), 'común')));
    end if;
  end if;

  -- Forma de pago (prevista)
  if v_c ? 'forma_pago' then
    v_txt := nullif(v_c ->> 'forma_pago', '');
    if v_txt is not null and not (v_formas ? v_txt) then
      raise exception 'No conozco la forma de pago «%»: transfer, direct_debit, card o cash.', v_txt using errcode = '22023';
    end if;
    if v_txt is distinct from v_f.payment_method then
      v_n.payment_method := v_txt; v_guardado := array_append(v_guardado, 'forma_pago');
      v_cambios := v_cambios || jsonb_build_object('campo', 'forma_pago', 'antes', v_f.payment_method, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Forma de pago %s → %s', coalesce(v_formas ->> v_f.payment_method, 'sin decir'), coalesce(v_formas ->> v_txt, 'sin decir')));
    end if;
  end if;

  -- IVA por tipos: se rehace entero y, con él, los totales.
  if v_c ? 'iva' then
    if jsonb_typeof(v_c -> 'iva') <> 'array' then raise exception 'El IVA va por tipos: una lista.' using errcode = '22023'; end if;
    select count(*) into v_mal from jsonb_array_elements(v_c -> 'iva') t
     where jsonb_typeof(t -> 'tipo') <> 'number' or jsonb_typeof(t -> 'base') <> 'number' or jsonb_typeof(t -> 'cuota') <> 'number';
    if v_mal > 0 then raise exception 'Cada línea de IVA lleva su tipo, su base y su cuota (% sin ellos).', v_mal using errcode = '22023'; end if;
    select count(*) - count(distinct (t ->> 'tipo')::numeric) into v_mal from jsonb_array_elements(v_c -> 'iva') t;
    if v_mal > 0 then raise exception 'Un mismo tipo de IVA va en una sola línea.' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_c -> 'iva') t
                where nullif(t ->> 'tipo_id', '') is not null
                  and not exists (select 1 from public.tax_rate r where r.id = (t ->> 'tipo_id')::uuid and (r.is_system or r.account_id = v_f.account_id))) then
      raise exception 'Ese tipo de IVA no es de esta cuenta.' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('tipo', x.vat_pct, 'base', x.base, 'cuota', x.vat_amount, 'recargo_tipo', x.surcharge_pct,
                                                 'recargo', nullif(x.surcharge_amount, 0), 'tipo_id', x.tax_rate_id) order by x.vat_pct), '[]'::jsonb)
      into v_iva_antes from public.supplier_invoice_tax x where x.supplier_invoice_id = v_f.id;
    select coalesce(jsonb_agg(jsonb_build_object('tipo', (t ->> 'tipo')::numeric, 'base', round((t ->> 'base')::numeric, 2), 'cuota', round((t ->> 'cuota')::numeric, 2),
                                                 'recargo_tipo', nullif(t ->> 'recargo_tipo', '')::numeric, 'recargo', nullif(round(coalesce(nullif(t ->> 'recargo', '')::numeric, 0), 2), 0),
                                                 'tipo_id', nullif(t ->> 'tipo_id', '')::uuid) order by (t ->> 'tipo')::numeric), '[]'::jsonb)
      into v_iva from jsonb_array_elements(v_c -> 'iva') t;
    if v_iva is distinct from v_iva_antes
       or (select sum((t ->> 'base')::numeric) from jsonb_array_elements(v_iva) t) is distinct from v_f.tax_base_total then
      delete from public.supplier_invoice_tax x where x.supplier_invoice_id = v_f.id;
      insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount, surcharge_pct, surcharge_amount)
      select v_f.account_id, v_f.id, nullif(t ->> 'tipo_id', '')::uuid, (t ->> 'tipo')::numeric, (t ->> 'base')::numeric, (t ->> 'cuota')::numeric,
             nullif(t ->> 'recargo_tipo', '')::numeric, coalesce(nullif(t ->> 'recargo', '')::numeric, 0)
        from jsonb_array_elements(v_iva) t;
      select sum((t ->> 'base')::numeric), sum((t ->> 'cuota')::numeric), sum(nullif(t ->> 'recargo', '')::numeric)
        into v_n.tax_base_total, v_n.tax_total, v_n.surcharge_total from jsonb_array_elements(v_iva) t;
      v_n.tax_base_total := coalesce(v_n.tax_base_total, 0); v_n.tax_total := coalesce(v_n.tax_total, 0);
      v_al_asiento := true; v_guardado := array_append(v_guardado, 'iva');
      v_cambios := v_cambios || jsonb_build_object('campo', 'iva', 'antes', v_iva_antes, 'ahora', v_iva);
      v_textos := array_append(v_textos, format('IVA %s de base y %s de cuota → %s y %s',
        public.compras_euros(v_f.tax_base_total), public.compras_euros(v_f.tax_total), public.compras_euros(v_n.tax_base_total), public.compras_euros(v_n.tax_total)));
    end if;
  end if;

  -- Retención: su tipo (withholding_rate), su base y su importe; o ninguna.
  if v_c ? 'retencion' then
    v_x := v_c -> 'retencion';
    v_ret_antes := case when v_f.withholding_rate_id is null and v_f.withholding_amount is null then null
                        else jsonb_build_object('tipo_id', v_f.withholding_rate_id, 'base', v_f.withholding_base, 'importe', v_f.withholding_amount) end;
    v_importe := case when jsonb_typeof(v_x) = 'object' then round(nullif(v_x ->> 'importe', '')::numeric, 2) end;
    if v_importe is null or v_importe = 0 then
      v_tasa := null; v_ret := null;
    else
      if v_importe < 0 then raise exception 'La retención se escribe en positivo: se resta del total.' using errcode = '22023'; end if;
      v_tasa := nullif(v_x ->> 'tipo_id', '')::uuid;
      v_tipo := nullif(v_x ->> 'tipo', '')::numeric;
      if v_tasa is not null then
        if not exists (select 1 from public.withholding_rate w where w.id = v_tasa and (w.is_system or w.account_id = v_f.account_id)) then
          raise exception 'Esa retención no es de esta cuenta.' using errcode = '42501';
        end if;
      else
        if v_tipo is null then raise exception 'Dime el tipo de la retención (el %%).' using errcode = '22023'; end if;
        select array_agg(w.id order by w.sort_order, w.code) into v_tasas from public.withholding_rate w
         where w.rate = v_tipo and (w.is_system or w.account_id = v_f.account_id)
           and (w.valid_from is null or w.valid_from <= coalesce(v_n.invoice_date, current_date))
           and (w.valid_to is null or w.valid_to >= coalesce(v_n.invoice_date, current_date));
        if v_tasas is null then raise exception 'No hay ninguna retención del % %%.', v_tipo using errcode = '22023'; end if;
        if cardinality(v_tasas) = 1 then
          v_tasa := v_tasas[1];
        else
          -- Varias del mismo tanto (19 %: alquiler o capital): la que usó este proveedor la última vez.
          select i.withholding_rate_id into v_tasa from public.supplier_invoice i
           where i.account_id = v_f.account_id and i.supplier_id = v_n.supplier_id and i.withholding_rate_id = any (v_tasas)
           order by i.invoice_date desc nulls last, i.created_at desc limit 1;
          if v_tasa is null then
            raise exception 'Hay % retenciones del % %% (%): dime cuál con tipo_id.', cardinality(v_tasas), v_tipo,
              (select string_agg(w.name, ', ' order by w.sort_order, w.code) from public.withholding_rate w where w.id = any (v_tasas)) using errcode = '22023';
          end if;
        end if;
      end if;
      v_ret := jsonb_build_object('tipo_id', v_tasa, 'base', round(nullif(v_x ->> 'base', '')::numeric, 2), 'importe', v_importe);
    end if;
    if v_ret is distinct from v_ret_antes then
      v_n.withholding_rate_id := v_tasa; v_n.withholding_amount := case when v_ret is null then null else v_importe end;
      v_n.withholding_base := case when v_ret is null then null else (v_ret ->> 'base')::numeric end;
      v_al_asiento := true; v_guardado := array_append(v_guardado, 'retencion');
      v_cambios := v_cambios || jsonb_build_object('campo', 'retencion', 'antes', v_ret_antes, 'ahora', v_ret);
      v_textos := array_append(v_textos, format('Retención %s → %s', case when v_f.withholding_amount is null then 'ninguna' else public.compras_euros(v_f.withholding_amount) end,
        case when v_ret is null then 'ninguna' else public.compras_euros(v_importe) end));
    end if;
  end if;

  -- Con el IVA o la retención cambiados, el total: base + cuota + recargo − retención.
  if ('iva' = any (v_guardado) or 'retencion' = any (v_guardado)) and v_n.tax_base_total is not null and v_n.tax_total is not null then
    v_n.grand_total := v_n.tax_base_total + v_n.tax_total + coalesce(v_n.surcharge_total, 0) - coalesce(v_n.withholding_amount, 0);
  end if;

  -- El gasto repartido: cuentas del plan de su empresa, local de la cuenta o común.
  if v_c ? 'gasto' then
    if jsonb_typeof(v_c -> 'gasto') <> 'array' then raise exception 'El gasto va en una lista: cuenta, local y importe.' using errcode = '22023'; end if;
    if jsonb_array_length(v_c -> 'gasto') > 0 and v_n.company_id is null then
      raise exception 'La factura no tiene empresa: no se puede repartir su gasto en un plan.' using errcode = '22023';
    end if;
    select count(*) into v_mal from jsonb_array_elements(v_c -> 'gasto') g
     where nullif(g ->> 'cuenta', '') is null or jsonb_typeof(g -> 'importe') <> 'number';
    if v_mal > 0 then raise exception 'Cada línea del gasto lleva su cuenta y su importe (% sin ellos).', v_mal using errcode = '22023'; end if;
    select string_agg(distinct g ->> 'cuenta', ', ') into v_txt from jsonb_array_elements(v_c -> 'gasto') g
     where not exists (select 1 from public.company_account a where a.company_id = v_n.company_id and a.code = g ->> 'cuenta' and a.status <> 'cerrada');
    if v_txt is not null then raise exception 'Estas cuentas no están (o están cerradas) en el plan de la empresa: %.', v_txt using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_c -> 'gasto') g
                where nullif(g ->> 'local', '') is not null
                  and not exists (select 1 from public.locations l where l.id = (g ->> 'local')::uuid and l.account_id = v_f.account_id)) then
      raise exception 'Un local del gasto no es de esta cuenta.' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('cuenta', x.account_code, 'local', x.location_id, 'comun', x.is_common, 'importe', x.amount) order by x.position), '[]'::jsonb)
      into v_gasto_antes from public.supplier_invoice_expense x where x.supplier_invoice_id = v_f.id;
    select coalesce(jsonb_agg(jsonb_build_object('cuenta', g ->> 'cuenta', 'local', nullif(g ->> 'local', '')::uuid,
                                                 'comun', coalesce((g ->> 'comun')::boolean, nullif(g ->> 'local', '') is null),
                                                 'importe', round((g ->> 'importe')::numeric, 2)) order by o), '[]'::jsonb)
      into v_gasto from jsonb_array_elements(v_c -> 'gasto') with ordinality as e(g, o);
    if v_gasto is distinct from v_gasto_antes then
      delete from public.supplier_invoice_expense x where x.supplier_invoice_id = v_f.id;
      insert into public.supplier_invoice_expense (account_id, supplier_invoice_id, position, account_code, location_id, is_common, amount)
      select v_f.account_id, v_f.id, (o - 1)::int, g ->> 'cuenta', nullif(g ->> 'local', '')::uuid, (g ->> 'comun')::boolean, (g ->> 'importe')::numeric
        from jsonb_array_elements(v_gasto) with ordinality as e(g, o);
      v_al_asiento := true; v_guardado := array_append(v_guardado, 'gasto');
      v_cambios := v_cambios || jsonb_build_object('campo', 'gasto', 'antes', v_gasto_antes, 'ahora', v_gasto);
      v_textos := array_append(v_textos, case when jsonb_array_length(v_gasto) = 0 then 'Gasto: sin reparto, el de la cuenta propuesta'
                                   else format('Gasto: %s', (select string_agg(format('%s %s', g ->> 'cuenta', public.compras_euros((g ->> 'importe')::numeric)), ' + ' order by o)
                                                            from jsonb_array_elements(v_gasto) with ordinality as e(g, o))) end);
    end if;
  end if;

  -- El asiento a mano: tiene que cuadrar, con cuentas del plan de su empresa.
  if v_c ? 'asiento_a_mano' then
    v_x := v_c -> 'asiento_a_mano';
    if jsonb_typeof(v_x) = 'null' then v_x := null; end if;
    if v_x is not null then
      if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) < 2 then
        raise exception 'El asiento a mano lleva al menos dos líneas.' using errcode = '22023';
      end if;
      if v_n.company_id is null then raise exception 'La factura no tiene empresa: no hay plan contra el que hacer el asiento.' using errcode = '22023'; end if;
      select string_agg(distinct coalesce(nullif(l ->> 'cuenta', ''), '(sin cuenta)'), ', ') into v_txt from jsonb_array_elements(v_x) l
       where not exists (select 1 from public.company_account a where a.company_id = v_n.company_id and a.code = l ->> 'cuenta' and a.status <> 'cerrada');
      if v_txt is not null then raise exception 'El asiento a mano usa cuentas que no están en el plan de la empresa: %.', v_txt using errcode = '22023'; end if;
      select round(sum(coalesce(nullif(l ->> 'debe', '')::numeric, 0)), 2), round(sum(coalesce(nullif(l ->> 'haber', '')::numeric, 0)), 2),
             count(*) filter (where coalesce(nullif(l ->> 'debe', '')::numeric, 0) < 0 or coalesce(nullif(l ->> 'haber', '')::numeric, 0) < 0)
        into v_debe, v_haber, v_mal from jsonb_array_elements(v_x) l;
      if v_mal > 0 then raise exception 'En el asiento, el debe y el haber van en positivo.' using errcode = '22023'; end if;
      if v_debe <> v_haber or v_debe = 0 then
        raise exception 'El asiento no cuadra: debe %, haber %.', public.compras_euros(v_debe), public.compras_euros(v_haber) using errcode = '22023';
      end if;
    end if;
    if v_x is distinct from v_f.entry_overrides then
      v_n.entry_overrides := v_x; v_al_asiento := true; v_guardado := array_append(v_guardado, 'asiento_a_mano');
      v_cambios := v_cambios || jsonb_build_object('campo', 'asiento_a_mano', 'antes', v_f.entry_overrides, 'ahora', v_x);
      v_textos := array_append(v_textos, case when v_x is null then 'Asiento: el propuesto' else 'Asiento: a mano' end);
    end if;
  end if;

  -- Vence: con set_supplier_invoice_due_date (su escritura y su registro de siempre).
  if v_c ? 'vence' then
    v_vence := nullif(v_c ->> 'vence', '')::date;
    v_vence_antes := v_f.due_date;
  end if;

  if cardinality(v_guardado) > 0 then
    update public.supplier_invoice
       set supplier_id = v_n.supplier_id, invoice_number = v_n.invoice_number, invoice_date = v_n.invoice_date, location_id = v_n.location_id,
           payment_method = v_n.payment_method, tax_base_total = v_n.tax_base_total, tax_total = v_n.tax_total, surcharge_total = v_n.surcharge_total,
           grand_total = v_n.grand_total, withholding_rate_id = v_n.withholding_rate_id, withholding_amount = v_n.withholding_amount,
           withholding_base = v_n.withholding_base, entry_overrides = v_n.entry_overrides, updated_at = now()
     where id = v_f.id;
  end if;
  if v_c ? 'vence' and v_vence is distinct from v_vence_antes then
    perform public.set_supplier_invoice_due_date(v_f.id, v_vence);
    v_guardado := array_append(v_guardado, 'vence');
    v_cambios := v_cambios || jsonb_build_object('campo', 'vence', 'antes', v_vence_antes, 'ahora', v_vence);
    v_textos := array_append(v_textos, format('Vence %s → %s', coalesce(to_char(v_vence_antes, 'DD/MM/YYYY'), 'sin vencimiento'), coalesce(to_char(v_vence, 'DD/MM/YYYY'), 'sin vencimiento')));
  end if;

  if cardinality(v_guardado) = 0 then
    return jsonb_build_object('guardado', '[]'::jsonb, 'texto', 'No había nada que guardar: todo estaba como está.', 'asiento_quitado', false);
  end if;

  -- Su asiento propuesto, si lo cambiado le afecta: fuera, para volver a proponerlo con lo nuevo.
  if v_al_asiento then
    delete from public.journal_entry e
     where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');
    get diagnostics v_quitados = row_count;
  end if;

  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar', v_cambios);

  return jsonb_build_object(
    'guardado', to_jsonb(v_guardado),
    'texto', 'Guardado: ' || array_to_string(v_textos, ', ') || '.'
             || case when v_quitados > 0 then ' Su asiento propuesto se ha quitado para proponerlo otra vez con lo nuevo.' else '' end,
    'asiento_quitado', v_quitados > 0);
end $$;
comment on function public.conta_recibida_guardar(uuid, jsonb, text) is
  'D03 · «Guardar cambios» de la ficha de una recibida: proveedor, numero, fecha, local, vence, forma_pago, iva, retencion, gasto y asiento_a_mano (todas opcionales). Con historial; quita su asiento propuesto si le afecta. No con su asiento validado.';
revoke all on function public.conta_recibida_guardar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_recibida_guardar(uuid, jsonb, text) to authenticated;

-- 5 · Poner su documento --------------------------------------------------------------
create or replace function public.conta_recibida_papel_poner(p_invoice uuid, p_ruta text, p_nombre text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_f public.supplier_invoice;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_ruta text := nullif(trim(p_ruta), '');
  v_nombre text := coalesce(nullif(trim(p_nombre), ''), regexp_replace(coalesce(nullif(trim(p_ruta), ''), ''), '^.*/', ''));
  v_d02 int := 0;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'
                and e.source_id = v_f.id and e.status = 'validado') then
    raise exception 'Ya está contabilizada: su documento va con el asiento. Para cambiarlo, anula su asiento.' using errcode = '22023';
  end if;
  if v_ruta is null or left(v_ruta, 37) <> v_f.account_id::text || '/' or v_ruta like '%..%' then
    raise exception 'El documento tiene que estar subido en la carpeta de esta cuenta.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipt-uploads' and o.name = v_ruta) then
    raise exception 'El documento no está subido (%): no se pone nada.', v_nombre using errcode = 'P0002';
  end if;
  if v_ruta = v_f.raw_document_url and v_f.no_document_at is null then
    return jsonb_build_object('documento', v_ruta, 'ya_estaba', true, 'pdf_reiniciado', false, 'texto', 'Ese documento ya era el suyo.');
  end if;

  update public.supplier_invoice
     set raw_document_url = v_ruta, no_document_at = null, no_document_reason = null, no_document_by_name = null, updated_at = now()
   where id = v_f.id;
  -- El D02: lo hecho (o fallado) con el documento de antes ya no vale; la pasada del minuto vuelve a mirar.
  delete from public.conta_recibida_pdf r where r.invoice_id = v_f.id;
  get diagnostics v_d02 = row_count;

  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'papel',
          jsonb_build_array(jsonb_build_object('campo', 'documento', 'antes', v_f.raw_document_url, 'ahora', v_ruta, 'nombre', v_nombre))
          || case when v_f.no_document_at is not null
                  then jsonb_build_array(jsonb_build_object('campo', 'sin_pdf', 'antes', v_f.no_document_reason, 'ahora', null)) else '[]'::jsonb end);

  return jsonb_build_object('documento', v_ruta, 'ya_estaba', false, 'pdf_reiniciado', v_d02 > 0,
    'texto', format('Documento puesto: «%s».', v_nombre)
             || case when v_ruta ~* '\.(jpe?g|png)$' then ' Es una foto: Folvy hace su PDF en un minuto.' else '' end
             || case when v_f.no_document_at is not null then ' Ya no está marcada «Sin PDF».' else '' end);
end $$;
comment on function public.conta_recibida_papel_poner(uuid, text, text, text) is
  'D03 · Pone el documento de una recibida (subido en receipt-uploads, en la carpeta de su cuenta), quita «Sin PDF» y reinicia su fila del D02. Con historial. No con su asiento validado.';
revoke all on function public.conta_recibida_papel_poner(uuid, text, text, text) from public, anon;
grant execute on function public.conta_recibida_papel_poner(uuid, text, text, text) to authenticated;

-- 6 · «Sin PDF» -------------------------------------------------------------------------
create or replace function public.conta_recibida_sin_papel(p_invoice uuid, p_sin boolean, p_motivo text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_motivo text := nullif(trim(p_motivo), '');
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  if p_sin is null then raise exception 'Dime si es sin PDF o no.' using errcode = '22023'; end if;
  if p_sin then
    if v_motivo is null then raise exception 'Para decir que no tiene PDF, di por qué.' using errcode = '22023'; end if;
    if v_f.raw_document_url is not null then
      raise exception 'Ya tiene su documento: no se puede marcar «Sin PDF».' using errcode = '22023';
    end if;
    if v_f.no_document_at is not null and v_f.no_document_reason = v_motivo then
      return jsonb_build_object('sin_pdf', true, 'ya_estaba', true, 'texto', 'Ya estaba marcada «Sin PDF» con ese motivo.');
    end if;
    update public.supplier_invoice
       set no_document_at = now(), no_document_reason = v_motivo, no_document_by_name = v_quien, updated_at = now()
     where id = v_f.id;
  else
    if v_f.no_document_at is null then
      return jsonb_build_object('sin_pdf', false, 'ya_estaba', true, 'texto', 'No estaba marcada «Sin PDF».');
    end if;
    update public.supplier_invoice
       set no_document_at = null, no_document_reason = null, no_document_by_name = null, updated_at = now()
     where id = v_f.id;
  end if;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'sin_papel',
          jsonb_build_array(jsonb_build_object('campo', 'sin_pdf', 'antes', v_f.no_document_reason, 'ahora', case when p_sin then v_motivo end)));
  return jsonb_build_object('sin_pdf', p_sin, 'ya_estaba', false,
    'texto', case when p_sin then format('Marcada «Sin PDF»: %s.', v_motivo) else 'Ya no está marcada «Sin PDF».' end);
end $$;
comment on function public.conta_recibida_sin_papel(uuid, boolean, text, text) is
  'D03 · «Sin PDF» de una recibida, con su motivo (p_sin = true), o quitarlo (false). Con historial.';
revoke all on function public.conta_recibida_sin_papel(uuid, boolean, text, text) from public, anon;
grant execute on function public.conta_recibida_sin_papel(uuid, boolean, text, text) to authenticated;

-- conta_lectura (los agentes) lee las dos tablas, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.supplier_invoice_expense to conta_lectura;
    grant select on table public.supplier_invoice_change to conta_lectura;
  end if;
end $$;
