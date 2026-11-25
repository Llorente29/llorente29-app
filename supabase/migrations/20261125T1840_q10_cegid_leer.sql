-- supabase/migrations/20261125T1840_q10_cegid_leer.sql
--
-- Q10 · respuesta 1 · puntos 1 y 2 · LA FACTURACIÓN DE CEGID (DiezREC), SOLO LEYENDO. Las facturas de noviembre y
-- diciembre de QBO las emite Cegid (con Verifactu); Sumied las prepara y las cuadra. Aquí, lo que hace falta para
-- leer: la conexión y lo leído. SOLO AÑADE: un conector y tres tablas; no toca ninguna fila que exista.
--
--   · El conector «diezrec» (como el de ERP10, la 1250 del X10): las cuatro claves (clientId, clientSecret, usuario y
--     contraseña) van cifradas en el Vault por connector-credentials, nunca en el repositorio, el registro ni el chat;
--     debajo, cada sociedad con su código de empresa en DiezREC («empresa» del login).
--   · Lo leído de Cegid, por empresa, con cuándo se leyó (lo escribe solo conta-cegid-leer, con la clave de servicio;
--     la pantalla lo lee con RLS de su cuenta):
--       conta_cegid_cliente   los clientes con su código y sus conceptos fijos (GetCustomer: detalleConceptos);
--       conta_cegid_concepto  los conceptos de facturación (GetConcept: IVA, retención, IVA incluido);
--       conta_cegid_factura   las facturas emitidas, con sus líneas (details) tal cual.
--     La «foto» de lo que había en Cegid: cada lectura la renueva entera por empresa y tipo.
-- Nada en el camino del pedido. Vuelta atrás: supabase/vuelta-atras/20261125T1840_q10_cegid_leer.down.sql.

insert into public.connector (code, name, category, connection_type, managed_by, direction, description, config_schema, features, is_available, status, sort_order)
values ('diezrec', 'Facturación de Cegid (DiezREC)', 'other', 'credentials', 'client', 'inbound',
        'Lee la facturación de Cegid (clientes con sus conceptos fijos, conceptos, series y facturas emitidas) para cuadrarla con lo cobrado por GoCardless. Las claves, una vez; debajo, cada sociedad con su código de empresa en Cegid.',
        jsonb_build_object('fields', jsonb_build_array(
          jsonb_build_object('key', 'client_id', 'label', 'clientId (de Diez Software)', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'client_secret', 'label', 'clientSecret (de Diez Software)', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'username', 'label', 'Usuario de Cegid', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'password', 'label', 'Contraseña de Cegid', 'type', 'secret', 'required', true))),
        jsonb_build_array('por_empresa'), true, 'active', 92)
on conflict (code) do nothing;

create table if not exists public.conta_cegid_cliente (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  codigo int not null,
  nombre_comercial text,
  nombre_fiscal text,
  nif text,
  email text,
  -- Los conceptos fijos de su ficha (detalleConceptos de GetCustomer): [{codigoConcepto, importe, cantidad, totalLinea, descripcion}].
  -- null: aún no se ha leído su detalle.
  conceptos jsonb,
  leido_at timestamptz not null default now(),
  primary key (company_id, codigo)
);
comment on table public.conta_cegid_cliente is
  'Q10 · Los clientes de la facturación de Cegid (DiezREC) de cada empresa, con sus conceptos fijos. Solo lo escribe conta-cegid-leer.';

create table if not exists public.conta_cegid_concepto (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  codigo text not null,
  descripcion text,
  importe numeric,
  area int,
  extraordinario boolean,
  por_iva numeric,
  con_retencion boolean,
  iva_incluido boolean,
  leido_at timestamptz not null default now(),
  primary key (company_id, codigo)
);
comment on table public.conta_cegid_concepto is
  'Q10 · Los conceptos de facturación de Cegid (DiezREC) de cada empresa. Solo lo escribe conta-cegid-leer.';

create table if not exists public.conta_cegid_factura (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ejercicio int not null,
  serie text not null,
  codigo int not null,
  cliente int,
  nombre_fiscal text,
  nif text,
  -- La fecha como la da DiezREC (un número entero; su forma se mide con una factura conocida antes de usarla).
  fecha_cegid bigint,
  base numeric,
  iva numeric,
  retencion numeric,
  porcentaje_retencion numeric,
  total numeric,
  -- Las líneas tal cual (details): [{linea, codigoConcepto, tituloConcepto, texto, importe, iva, porcentajeIva, cantidad, llevaRetencion, total…}].
  lineas jsonb not null default '[]'::jsonb,
  leido_at timestamptz not null default now(),
  primary key (company_id, ejercicio, serie, codigo)
);
comment on table public.conta_cegid_factura is
  'Q10 · Las facturas emitidas en la facturación de Cegid (DiezREC) de cada empresa, con sus líneas. Solo lo escribe conta-cegid-leer.';
create index if not exists conta_cegid_factura_cliente_idx on public.conta_cegid_factura (company_id, cliente);

alter table public.conta_cegid_cliente enable row level security;
drop policy if exists conta_cegid_cliente_leer on public.conta_cegid_cliente;
create policy conta_cegid_cliente_leer on public.conta_cegid_cliente for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_cliente from anon;
grant select on public.conta_cegid_cliente to authenticated;
grant all on public.conta_cegid_cliente to service_role;

alter table public.conta_cegid_concepto enable row level security;
drop policy if exists conta_cegid_concepto_leer on public.conta_cegid_concepto;
create policy conta_cegid_concepto_leer on public.conta_cegid_concepto for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_concepto from anon;
grant select on public.conta_cegid_concepto to authenticated;
grant all on public.conta_cegid_concepto to service_role;

alter table public.conta_cegid_factura enable row level security;
drop policy if exists conta_cegid_factura_leer on public.conta_cegid_factura;
create policy conta_cegid_factura_leer on public.conta_cegid_factura for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_factura from anon;
grant select on public.conta_cegid_factura to authenticated;
grant all on public.conta_cegid_factura to service_role;
