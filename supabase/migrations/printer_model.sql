-- ============================================================================
-- FOLVY IMPRIME · PIEZA 2 — Modelo printer / print_job
-- ----------------------------------------------------------------------------
-- Capa AGNÓSTICA + adaptadores de transporte (mismo patrón que TPV/canales).
-- Una impresora declara su `transport`; por cada transporte hay un adaptador que
-- sabe hablar con esa conexión. Folvy encola jobs IGUAL para todas; el adaptador
-- correcto los recoge según el transporte de su impresora.
--
-- Transportes previstos (ampliables sin tocar el modelo):
--   sunmi_cloud     - impresora cloud Sunmi (tira de Folvy por MQTT/HTTPS)
--   escpos_network  - térmica en red/WiFi con IP (bytes ESC/POS a TCP:9100)
--   epson_epos      - Epson ePOS (HTTP directo)
--   bluetooth       - impresora BT emparejada a la tablet
--   browser_pdf     - fallback: diálogo de impresión del navegador (cualquier impresora)
--
-- Lo específico de cada transporte vive en config jsonb (IP+puerto, SN, MAC…),
-- no en columnas: así añadir un transporte nuevo NO cambia la tabla.
-- ============================================================================

-- ── printer: cada impresora física registrada ───────────────────────────────
create table if not exists public.printer (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  name          text not null,                       -- "Cocina pase", "Mostrador"
  transport     text not null
                  check (transport in ('sunmi_cloud','escpos_network','epson_epos','bluetooth','browser_pdf')),
  -- qué documentos saca esta impresora: subconjunto de 'bag'|'kitchen'|'labels'
  doc_types     text[] not null default array['bag','kitchen','labels'],
  -- específico del transporte: { "sn": "...", "ip": "...", "port": 9100, "mac": "...", "paper_mm": 80 }
  config        jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_printer_account_location
  on public.printer(account_id, location_id) where is_active;

comment on table public.printer is
  'Impresora física. transport define el adaptador; config jsonb lleva lo específico del transporte.';

-- ── print_job: la cola de impresión ─────────────────────────────────────────
create table if not exists public.print_job (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  printer_id    uuid references public.printer(id) on delete set null,
  sale_id       uuid references public.sale(id) on delete set null,
  doc_type      text not null check (doc_type in ('bag','kitchen','labels')),
  -- el documento YA renderizado (lista de TicketDoc/TicketBlock). El job es
  -- INMUTABLE: se congela como se imprimió (auditable, reimprimible idéntico).
  -- El adaptador es tonto: solo convierte este payload a su formato.
  payload       jsonb not null,
  status        text not null default 'pending'
                  check (status in ('pending','sent','done','error','cancelled')),
  source        text not null default 'auto'
                  check (source in ('auto','manual','reprint')),
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  done_at       timestamptz
);

-- El adaptador busca trabajo pendiente de SU impresora: índice por printer+status.
create index if not exists idx_print_job_printer_status
  on public.print_job(printer_id, status) where status in ('pending','sent');
create index if not exists idx_print_job_account_created
  on public.print_job(account_id, created_at desc);

comment on table public.print_job is
  'Cola de impresión. payload = documento renderizado (inmutable). El adaptador del transporte lo recoge.';

-- ── trigger updated_at en printer ───────────────────────────────────────────
create or replace function public.tg_printer_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_printer_updated_at on public.printer;
create trigger trg_printer_updated_at
  before update on public.printer
  for each row execute function public.tg_printer_updated_at();
