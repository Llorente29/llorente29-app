-- supabase/migrations/20261122T1315_x27_fichas_terceros.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261122_x27_fichas_terceros_prueba.sql
-- cambia: public.supplier_invoice_expense · prueba: supabase/staging/sql/20261122_x27_fichas_terceros_prueba.sql
--
-- X27 · La ficha de proveedor y la de cliente, como ERP10 (maqueta nucleo_20, aprobada el 22/11). Lo que la maqueta
-- pide y no tenía dónde guardarse, solo lo que la factura va a usar (Julio, 22/11: «una casilla de la ficha que no
-- propone nada es una casilla muerta»).
--
--   1. supplier, «Datos por defecto en facturas» y «Datos de pago», columnas que admiten nulos y nacen vacías:
--      · vat_deductible_pct («% I.V.A. deducible»): de 0 a 100; vacío = lo de siempre (100).
--      · default_brand_id («Marca») y default_channel_id («Plataforma»).
--      · exclude_from_347 («No incluir en 347»): vacío = no.
--      · pay_on_post («Pago directo al contabilizar la factura»): la pantalla de la recibida propone el pago con la
--        subcuenta de pago en la fecha de la factura (sin esperar al vencimiento). Solo lo lee la pantalla.
--   2. customer_fiscal, datos de la ficha del cliente: phone, email, notes, trade_name (nombre comercial) y
--      usual_tax_rate_ids (tipos de IVA). Se ven y se guardan en su ficha.
--   3. La factura nace con lo de su proveedor (cambia: public.supplier_invoice). Disparador antes de insertar o de
--      cambiar el proveedor: si la recibida no tiene el asiento validado, lo que tiene VACÍO (el % deducible, el 347 y
--      la marca) toma lo de la ficha del proveedor; al cambiarle el proveedor, sus líneas sin datos, su plataforma.
--      Lo que ya tiene no se toca. Con las columnas nuevas vacías (todas,
--      al aplicar) no cambia nada: ninguna factura de hoy ni de mañana es distinta hasta que alguien escriba en una
--      ficha (regla 31). Es el patrón del S01o·2 (s01o2_iva_no_deducible): al insertar o al cambiar de proveedor.
--   4. La plataforma, en la línea (cambia: public.supplier_invoice_expense). Disparador después de insertar una
--      línea de gasto: si su proveedor tiene plataforma y la línea aún no tiene sus datos (supplier_invoice_expense_dato,
--      K11a), se los pone con esa plataforma. Una línea a la que alguien quitó la plataforma conserva su fila (on
--      conflict do nothing): no vuelve.
-- Lo que no se copia de ERP10 (Julio, 22/11): «Proveedor genérico», «Criterio de caja» y «REAGP»; el tipo de operación
-- no se guarda en la ficha (lo calcula conta_proveedor_iva_clase y se cambia en la factura, K10b).
-- Nada en el camino del pedido: ningún pedido escribe recibidas. Los dos disparadores solo escriben en la fila que se
-- inserta o se cambia, y solo en lo vacío.
-- Vuelta atrás: supabase/vuelta-atras/20261122T1315_x27_fichas_terceros.down.sql

-- 1 · La ficha del proveedor ----------------------------------------------------------------------------------------
alter table public.supplier add column if not exists vat_deductible_pct numeric(5,2)
  constraint supplier_vat_deductible_pct_check check (vat_deductible_pct between 0 and 100);
alter table public.supplier add column if not exists default_brand_id uuid references public.brand(id) on delete set null;
alter table public.supplier add column if not exists default_channel_id uuid references public.sales_channel(id) on delete set null;
alter table public.supplier add column if not exists exclude_from_347 boolean;
alter table public.supplier add column if not exists pay_on_post boolean;
comment on column public.supplier.vat_deductible_pct is 'X27 · «% I.V.A. deducible» de su ficha: la recibida nace con él (disparador x27_recibida_nace). Vacío = 100.';
comment on column public.supplier.default_brand_id is 'X27 · «Marca» de su ficha: la recibida nace con ella (su brand_id, que va a los apuntes del asiento).';
comment on column public.supplier.default_channel_id is 'X27 · «Plataforma» de su ficha: cada línea de gasto nace con ella (supplier_invoice_expense_dato.channel_id).';
comment on column public.supplier.exclude_from_347 is 'X27 · «No incluir en 347» de su ficha: la recibida nace con él (exclude_from_347). Vacío = no.';
comment on column public.supplier.pay_on_post is 'X27 · «Pago directo al contabilizar la factura»: la ficha de la recibida propone el pago con la subcuenta de pago en la fecha de la factura. Vacío = no (la del vencimiento).';

-- 2 · La ficha del cliente ------------------------------------------------------------------------------------------
alter table public.customer_fiscal add column if not exists phone text;
alter table public.customer_fiscal add column if not exists email text;
alter table public.customer_fiscal add column if not exists notes text;
alter table public.customer_fiscal add column if not exists trade_name text;
alter table public.customer_fiscal add column if not exists usual_tax_rate_ids uuid[];
comment on column public.customer_fiscal.phone is 'X27 · Teléfono de la ficha del cliente.';
comment on column public.customer_fiscal.email is 'X27 · Correo electrónico de la ficha del cliente.';
comment on column public.customer_fiscal.notes is 'X27 · Observaciones de la ficha del cliente.';
comment on column public.customer_fiscal.trade_name is 'X27 · Nombre comercial del cliente.';
comment on column public.customer_fiscal.usual_tax_rate_ids is 'X27 · Tipos de IVA habituales del cliente (ids de tax_rate), como supplier.usual_tax_rate_ids.';

-- 3 · La recibida nace con lo de su proveedor -----------------------------------------------------------------------
create or replace function public.tg_x27_recibida_nace()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_s public.supplier;
begin
  if new.supplier_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return new; end if;
  -- Nunca con su asiento validado.
  if new.journal_entry_id is not null
     and exists (select 1 from public.journal_entry e where e.id = new.journal_entry_id and e.status = 'validado') then
    return new;
  end if;
  select * into v_s from public.supplier where id = new.supplier_id and account_id = new.account_id;
  if v_s.id is null then return new; end if;
  if new.vat_deductible_pct is null then new.vat_deductible_pct := v_s.vat_deductible_pct; end if;
  if new.exclude_from_347 is null and v_s.exclude_from_347 then new.exclude_from_347 := true; end if;
  if new.brand_id is null then new.brand_id := v_s.default_brand_id; end if;
  -- Al cambiarle el proveedor (R14 lo pone después de leer el documento), sus líneas que aún no tienen datos toman
  -- su plataforma, como las que nacen después (x27_linea_plataforma).
  if tg_op = 'UPDATE' and v_s.default_channel_id is not null then
    insert into public.supplier_invoice_expense_dato (account_id, supplier_invoice_id, position, channel_id)
    select x.account_id, x.supplier_invoice_id, x.position, v_s.default_channel_id
      from public.supplier_invoice_expense x where x.supplier_invoice_id = new.id
    on conflict (supplier_invoice_id, position) do nothing;
  end if;
  return new;
end $$;
comment on function public.tg_x27_recibida_nace() is
  'X27 · La recibida nace con lo de la ficha de su proveedor: al insertarla o al cambiarle el proveedor, sin su asiento validado, lo VACÍO (% deducible, 347 y marca) toma lo de la ficha. Lo que ya tiene no se toca.';
revoke all on function public.tg_x27_recibida_nace() from public, anon, authenticated;
drop trigger if exists x27_recibida_nace on public.supplier_invoice;
create trigger x27_recibida_nace before insert or update of supplier_id on public.supplier_invoice
  for each row execute function public.tg_x27_recibida_nace();

-- 4 · La plataforma, en la línea ------------------------------------------------------------------------------------
create or replace function public.tg_x27_linea_plataforma()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_canal uuid;
begin
  select s.default_channel_id into v_canal
    from public.supplier_invoice i join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
   where i.id = new.supplier_invoice_id
     and not exists (select 1 from public.journal_entry e where e.id = i.journal_entry_id and e.status = 'validado');
  if v_canal is null then return null; end if;
  insert into public.supplier_invoice_expense_dato (account_id, supplier_invoice_id, position, channel_id)
  values (new.account_id, new.supplier_invoice_id, new.position, v_canal)
  on conflict (supplier_invoice_id, position) do nothing;
  return null;
end $$;
comment on function public.tg_x27_linea_plataforma() is
  'X27 · Cada línea de gasto nace con la plataforma de la ficha de su proveedor (supplier_invoice_expense_dato), si aún no tiene sus datos. Una línea que ya los tiene (o a la que se quitó la plataforma) no se toca.';
revoke all on function public.tg_x27_linea_plataforma() from public, anon, authenticated;
drop trigger if exists x27_linea_plataforma on public.supplier_invoice_expense;
create trigger x27_linea_plataforma after insert on public.supplier_invoice_expense
  for each row execute function public.tg_x27_linea_plataforma();
