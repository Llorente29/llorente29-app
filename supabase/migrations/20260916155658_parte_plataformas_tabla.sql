-- ============================================================================
-- §3.3 — LA TABLA DEL CRUCE CON LAS PLATAFORMAS.
--
-- APLICADA el 16/09 a las 15:56:58 UTC = 17:56 de Madrid. RLS encendida y
--     comprobada.
--
-- Una fila por (cuenta, día, plataforma, pedido). Guarda las dos caras: lo que
-- dice la plataforma y lo que dice Folvy. El parte la lee; no llama fuera.
--
-- CEDIDAS POR LAST, PROPIAS POR HUBRISE, Y NINGUNA RELACIÓN ENTRE LAS DOS
-- (§3.3). Por eso son dos funciones de llenado separadas, sin una sola línea
-- compartida, y la columna `plataforma` no se cruza nunca consigo misma.
--
-- LA CLAVE DE CADA UNA, medida el 16/09 y escrita aquí para que nadie la
-- deduzca de memoria (el 15/09, en Foodint: 96 pedidos):
--   · cedidas  → `platform_order_code`. 96 valores distintos de 96.
--   · propias  → `external_ref` (el order_id del aviso de HubRise). 24 de 24.
--   · NUNCA `pos_short_code`: 88 distintos de 96, repite ocho veces en un solo
--     día (G192, G221, G361, G422, G504, G549, G645, G834), y comprobado que
--     no son el mismo pedido. Va guardado solo para que una persona lo
--     reconozca en pantalla, jamás para casar.
--
-- `origen` dice de dónde salió la fila:
--   · 'aviso'   — de lo que ya está en la base (lastapp_webhook_log /
--                 external_webhook_log). Es lo que hay hoy.
--   · 'listado' — del listado del día pedido a la plataforma. Todavía no:
--                 Last necesita la pasada que lo pida, y HubRise necesita
--                 `orders.read`, que Julio ya ha dicho que sí.
-- Mientras una cuenta no tenga filas 'listado' de un día, el parte sigue
-- diciendo en el pie que solo compara con los avisos recibidos. Un cruce a
-- medias que no se declara es peor que no tenerlo.
-- ============================================================================

create table if not exists public.parte_plataformas (
  account_id          uuid not null references public.accounts(id) on delete cascade,
  dia                 date not null,
  plataforma          text not null check (plataforma in ('last','hubrise')),
  pedido_ref          text not null,
  location_id         uuid references public.locations(id),
  sale_id             uuid references public.sale(id) on delete set null,
  pedido_corto        text,
  en_plataforma       boolean not null default false,
  en_folvy            boolean not null default false,
  anulado_plataforma  boolean not null default false,
  anulado_folvy       boolean not null default false,
  importe_plataforma  numeric,
  importe_folvy       numeric,
  origen              text not null default 'aviso' check (origen in ('aviso','listado')),
  visto_en            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (account_id, dia, plataforma, pedido_ref)
);

comment on table public.parte_plataformas is
'El cruce diario de un día con cada plataforma: lo que dice la plataforma contra lo que dice Folvy. Cedidas por Last, propias por HubRise, sin relación entre las dos. Se casa por platform_order_code (Last) y external_ref (HubRise); nunca por el código corto. Encargo del 16/09 §3.3.';

comment on column public.parte_plataformas.pedido_corto is
'El G/U/J que ve una persona. NO sirve para casar: repite ocho veces en un solo día (medido el 15/09).';

comment on column public.parte_plataformas.origen is
'aviso = salió de los avisos que ya están en la base. listado = salió del listado del día pedido a la plataforma, que es lo único que ve un pedido cuyo aviso nunca llegó.';

create index if not exists idx_parte_plataformas_dia
  on public.parte_plataformas (account_id, dia, plataforma);

alter table public.parte_plataformas enable row level security;

drop policy if exists parte_plataformas_lectura on public.parte_plataformas;
create policy parte_plataformas_lectura on public.parte_plataformas
  for select to authenticated
  using (public.belongs_to_account(account_id));

revoke all on public.parte_plataformas from public, anon;
grant select on public.parte_plataformas to authenticated;
grant select, insert, update, delete on public.parte_plataformas to service_role;
