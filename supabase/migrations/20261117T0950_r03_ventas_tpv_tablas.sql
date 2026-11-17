-- supabase/migrations/20261117T0950_r03_ventas_tpv_tablas.sql
--
-- R03 · Las ventas de un TPV de fuera (Revo XEF, el primero): dónde se guardan
-- (respuesta R02 · 1, decisiones de Julio del 17/11).
--
-- Solo AÑADE: cinco tablas nuevas y una columna con valor por defecto. No toca
-- `sale` ni nada del camino del pedido: las tablas van con el prefijo conta_tpv_
-- y no con sale_/sales_, que el analizador pone en el camino (CAMINO_TABLAS).
-- Nadie las lee todavía: el día de ventas las leerá con «union all» en el PR 3.
--
--   1. conta_tpv_dia: un día de ventas de un TPV de fuera, de UNA empresa (la
--      empresa va escrita: no se deduce de la cuenta ni del local). Una fila por
--      empresa, fecha y programa. «programa» es texto con CHECK: el siguiente TPV
--      es añadir un valor. «estado»: guardado, o contabilizado (lo pondrá el
--      PR 3 al proponer su asiento; un día contabilizado ya no se sustituye).
--   2. conta_tpv_documento: las facturas del día, con signo (una devolución es
--      un documento en negativo). «canal» es lo que dice la columna «Entrega»,
--      limpio; «--» se guarda como «local» (vendido en el local).
--   3. conta_tpv_impuesto: un renglón por documento y tipo de IVA, con su base y
--      su cuota. Varios tipos caben desde el primer día.
--   4. conta_tpv_cobro: los cobros del día. Uno se identifica por su fila en el
--      fichero (la primera columna de los pagos de Revo repite la orden).
--   5. conta_tpv_forma_cuenta: a qué cuenta va cada forma de pago del TPV, por
--      empresa; «canal» nulo si no depende de él (Efectivo, Tarjeta) o la
--      plataforma (Deliverect se reparte por «Entrega»). Vacía: la rellenará el
--      usuario cuando esté su pantalla.
--   6. company_tax_profile.ventas_por_dia: el interruptor «ventas por día» de la
--      empresa, apagado en todas (default false). Nadie lo lee todavía: la
--      pantalla sigue con company.sector = 'hosteleria'.
--
-- Permisos por fila, los de sales_day_summary: lee quien es de la cuenta
-- (current_user_account_ids, una vez por consulta). Las cuatro tablas del día
-- solo se escriben por conta_tpv_dia_guardar (0951), que es la única puerta:
-- authenticated solo tiene SELECT. La de formas de pago, como sales_day_summary
-- entera: escribe un administrador o un encargado de la cuenta.
--
-- Se puede pasar dos veces (if not exists; las políticas y los disparadores se
-- quitan y se vuelven a poner).
-- Prueba: supabase/staging/sql/20261117_r03_ventas_tpv_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261117T0950_r03_ventas_tpv_tablas.down.sql

-- 1 · El día -------------------------------------------------------------------------
create table if not exists public.conta_tpv_dia (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  dia               date not null,
  programa          text not null constraint conta_tpv_dia_programa_check check (programa in ('revo')),
  estado            text not null default 'guardado' constraint conta_tpv_dia_estado_check check (estado in ('guardado', 'contabilizado')),
  documentos        integer not null constraint conta_tpv_dia_documentos_check check (documentos > 0),
  primer_numero     bigint not null,
  ultimo_numero     bigint not null,
  base              numeric(14,2) not null,
  cuota             numeric(14,2) not null,
  total             numeric(14,2) not null,
  subido_por        uuid,
  subido_por_nombre text,
  subido_en         timestamptz not null default now(),
  constraint conta_tpv_dia_rango_check check (primer_numero <= ultimo_numero),
  constraint conta_tpv_dia_uno unique (company_id, dia, programa)
);
comment on table public.conta_tpv_dia is
  'R03: un día de ventas de un TPV de fuera (Revo…), de una empresa. Lo escribe solo conta_tpv_dia_guardar; subirlo otra vez lo sustituye mientras no esté contabilizado.';
comment on column public.conta_tpv_dia.estado is
  'guardado: se puede sustituir subiéndolo otra vez. contabilizado: tiene su asiento (lo pone el día de ventas, PR 3) y ya no se cambia.';

-- 2 · Las facturas del día ------------------------------------------------------------
create table if not exists public.conta_tpv_documento (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  dia_id         uuid not null references public.conta_tpv_dia(id) on delete cascade,
  numero         bigint not null,
  contador       text not null,
  fecha          timestamptz not null,
  orden          text not null,
  canal          text not null,
  cliente_nif    text,
  cliente_nombre text,
  base           numeric(14,2) not null,
  cuota          numeric(14,2) not null,
  total          numeric(14,2) not null,
  constraint conta_tpv_documento_cuadra check (base + cuota = total),
  constraint conta_tpv_documento_uno unique (dia_id, contador, numero)
);
create index if not exists conta_tpv_documento_dia on public.conta_tpv_documento (dia_id);
comment on table public.conta_tpv_documento is
  'R03: las facturas de un día del TPV, con su número y su contador (la serie del TPV), con signo: una devolución va en negativo. canal = la columna «Entrega» limpia («local» si se vendió en el local).';

-- 3 · El IVA de cada factura ----------------------------------------------------------
create table if not exists public.conta_tpv_impuesto (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  documento_id uuid not null references public.conta_tpv_documento(id) on delete cascade,
  tipo         numeric(5,2) not null constraint conta_tpv_impuesto_tipo_check check (tipo >= 0 and tipo < 100),
  base         numeric(14,2) not null,
  cuota        numeric(14,2) not null,
  constraint conta_tpv_impuesto_uno unique (documento_id, tipo)
);
comment on table public.conta_tpv_impuesto is 'R03: un renglón por factura del TPV y tipo de IVA, con su base y su cuota.';

-- 4 · Los cobros del día --------------------------------------------------------------
create table if not exists public.conta_tpv_cobro (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  dia_id     uuid not null references public.conta_tpv_dia(id) on delete cascade,
  fila       integer not null constraint conta_tpv_cobro_fila_check check (fila > 0),
  orden      text not null,
  forma      text not null,
  importe    numeric(14,2) not null,
  constraint conta_tpv_cobro_uno unique (dia_id, fila)
);
comment on table public.conta_tpv_cobro is
  'R03: los cobros de un día del TPV. Uno se identifica por su fila en el fichero; una orden pagada en dos veces son dos filas.';

-- 5 · A qué cuenta va cada forma de pago -----------------------------------------------
create table if not exists public.conta_tpv_forma_cuenta (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  forma              text not null,
  canal              text,
  company_account_id uuid not null references public.company_account(id) on delete restrict,
  created_at         timestamptz not null default now(),
  created_by_name    text,
  constraint conta_tpv_forma_cuenta_uno unique nulls not distinct (company_id, forma, canal)
);
comment on table public.conta_tpv_forma_cuenta is
  'R03: a qué cuenta va cada forma de pago del TPV, por empresa. canal nulo = la misma para todos los canales; «Deliverect» se reparte por plataforma (canal = la columna «Entrega»).';

-- 6 · El interruptor -------------------------------------------------------------------
alter table public.company_tax_profile add column if not exists ventas_por_dia boolean not null default false;
comment on column public.company_tax_profile.ventas_por_dia is
  'R03: «ventas por día» encendido en esta empresa (hostelería y comercio). Apagado de serie. Nadie lo lee todavía.';

-- 7 · La misma cuenta que su empresa (como sales_day_summary) ---------------------------
drop trigger if exists trg_conta_tpv_dia_misma_cuenta on public.conta_tpv_dia;
create trigger trg_conta_tpv_dia_misma_cuenta before insert or update on public.conta_tpv_dia for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_conta_tpv_documento_misma_cuenta on public.conta_tpv_documento;
create trigger trg_conta_tpv_documento_misma_cuenta before insert or update on public.conta_tpv_documento for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_conta_tpv_impuesto_misma_cuenta on public.conta_tpv_impuesto;
create trigger trg_conta_tpv_impuesto_misma_cuenta before insert or update on public.conta_tpv_impuesto for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_conta_tpv_cobro_misma_cuenta on public.conta_tpv_cobro;
create trigger trg_conta_tpv_cobro_misma_cuenta before insert or update on public.conta_tpv_cobro for each row execute function public.conta_misma_cuenta();
drop trigger if exists trg_conta_tpv_forma_cuenta_misma_cuenta on public.conta_tpv_forma_cuenta;
create trigger trg_conta_tpv_forma_cuenta_misma_cuenta before insert or update on public.conta_tpv_forma_cuenta for each row execute function public.conta_misma_cuenta();

-- 8 · Permisos por fila -----------------------------------------------------------------
alter table public.conta_tpv_dia enable row level security;
alter table public.conta_tpv_documento enable row level security;
alter table public.conta_tpv_impuesto enable row level security;
alter table public.conta_tpv_cobro enable row level security;
alter table public.conta_tpv_forma_cuenta enable row level security;
revoke all on public.conta_tpv_dia, public.conta_tpv_documento, public.conta_tpv_impuesto, public.conta_tpv_cobro, public.conta_tpv_forma_cuenta from public, anon, authenticated;
grant all on public.conta_tpv_dia, public.conta_tpv_documento, public.conta_tpv_impuesto, public.conta_tpv_cobro, public.conta_tpv_forma_cuenta to service_role;
drop policy if exists conta_tpv_dia_select on public.conta_tpv_dia;
create policy conta_tpv_dia_select on public.conta_tpv_dia for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_tpv_documento_select on public.conta_tpv_documento;
create policy conta_tpv_documento_select on public.conta_tpv_documento for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_tpv_impuesto_select on public.conta_tpv_impuesto;
create policy conta_tpv_impuesto_select on public.conta_tpv_impuesto for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_tpv_cobro_select on public.conta_tpv_cobro;
create policy conta_tpv_cobro_select on public.conta_tpv_cobro for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_tpv_forma_cuenta_select on public.conta_tpv_forma_cuenta;
create policy conta_tpv_forma_cuenta_select on public.conta_tpv_forma_cuenta for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));
-- Las cuatro del día: solo leer. Se escriben por conta_tpv_dia_guardar.
grant select on public.conta_tpv_dia, public.conta_tpv_documento, public.conta_tpv_impuesto, public.conta_tpv_cobro to authenticated;
-- La de formas de pago: como sales_day_summary.
grant select, insert, update, delete on public.conta_tpv_forma_cuenta to authenticated;
drop policy if exists conta_tpv_forma_cuenta_insert on public.conta_tpv_forma_cuenta;
create policy conta_tpv_forma_cuenta_insert on public.conta_tpv_forma_cuenta for insert with check (public.current_user_is_admin_or_manager_of(account_id));
drop policy if exists conta_tpv_forma_cuenta_update on public.conta_tpv_forma_cuenta;
create policy conta_tpv_forma_cuenta_update on public.conta_tpv_forma_cuenta for update using (public.current_user_is_admin_or_manager_of(account_id));
drop policy if exists conta_tpv_forma_cuenta_delete on public.conta_tpv_forma_cuenta;
create policy conta_tpv_forma_cuenta_delete on public.conta_tpv_forma_cuenta for delete using (public.current_user_is_admin_or_manager_of(account_id));
