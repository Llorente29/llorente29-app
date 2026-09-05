-- C9 · Lote 2 §1 (04/09/2026). La captura: una foto con hora, atada al pedido.
--
-- NACE CERRADA. En este proyecto toda tabla nueva nace con ALL para anon y
-- authenticated (B51), asi que no basta con crearla: hay que revocar Y
-- COMPROBARLO en la misma migracion (regla 16). El bloque de verificacion del
-- final aborta la migracion entera si algo quedo abierto.
--
-- SIN POLITICA DE ESCRITURA, a proposito: escribe la edge function con
-- service_role. Un dispositivo del pase no escribe en esta tabla directamente.
--
-- SIN PII (§0.3): ni nombre, ni telefono, ni direccion. Solo ids. El nombre de
-- pila del cliente esta impreso EN la etiqueta que sale en la foto, y eso ya es
-- dato personal de sobra; no se duplica tambien en las columnas.
--
-- SIN CLAVES AJENAS, y se dice por que: el DDL del encargo no las lleva. Una FK
-- a `sale` obligaria a decidir que pasa al borrar una venta, y eso toca caminos
-- que este lote no ha mirado. Queda anotado como pregunta abierta, no resuelto
-- por mi cuenta.
--
-- `sha256` NO es adorno: la foto que se adjunta a una reclamacion tiene que ser
-- demostrablemente la que se hizo. Se calcula al subir y el certificado (L3) lo
-- imprime.

create table if not exists public.sale_capture (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  location_id   uuid not null,
  sale_id       uuid not null,
  device_id     uuid,
  kind          text not null default 'pase',
  captured_at   timestamptz not null,
  received_at   timestamptz not null default now(),
  image_path    text not null,
  width         int,
  height        int,
  bytes         int,
  sha256        text,
  purged_at     timestamptz,
  hold_until    timestamptz,
  constraint sale_capture_kind_ck check (kind in ('pase','bolsa','degradado'))
);

comment on table public.sale_capture is
  'C9 L2: la foto del pase atada a un pedido. Escribe SOLO order-evidence-capture con service_role. Sin PII: el nombre del cliente ya va impreso en la etiqueta que sale en la foto, no se duplica aqui.';
comment on column public.sale_capture.captured_at is
  'Hora del DISPOSITIVO. Si difiere de received_at es que la foto se subio en diferido desde la cola local: la captura es contabilidad, no operacion, y el «Listo» nunca espera a la red.';
comment on column public.sale_capture.sha256 is
  'Integridad. La foto que se presenta en una reclamacion tiene que ser demostrablemente la que se hizo.';
comment on column public.sale_capture.hold_until is
  'C9 L2 §5: una foto adjunta a una reclamacion ABIERTA (L4) no se purga hasta que la reclamacion se cierre. La purga respeta esta fecha.';
comment on column public.sale_capture.purged_at is
  'Cuando la purga borro el objeto del bucket. La fila se conserva como recibo de que existio y de que se borro.';

create index if not exists ix_sale_capture_sale on public.sale_capture (sale_id);
create index if not exists ix_sale_capture_cuenta_fecha on public.sale_capture (account_id, captured_at desc);
create index if not exists ix_sale_capture_por_purgar on public.sale_capture (captured_at) where purged_at is null;

alter table public.sale_capture enable row level security;
revoke all on public.sale_capture from anon, authenticated;

drop policy if exists sc_read on public.sale_capture;
create policy sc_read on public.sale_capture
  for select to authenticated
  using (public.belongs_to_account(account_id));

do $verif$
declare v_rol text; v_priv text;
begin
  foreach v_rol in array array['anon','authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(v_rol, 'public.sale_capture', v_priv) then
        raise exception 'C9 L2: % conserva % sobre sale_capture. La tabla NO nace cerrada.', v_rol, v_priv;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role', 'public.sale_capture', 'INSERT') then
    raise exception 'C9 L2: service_role no puede insertar en sale_capture; la edge function no podria escribir.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='sale_capture' and c.relrowsecurity) then
    raise exception 'C9 L2: RLS no esta encendida en sale_capture.';
  end if;
end
$verif$;
