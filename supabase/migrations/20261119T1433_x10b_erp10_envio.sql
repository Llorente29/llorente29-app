-- X10b · ERP10 por la API, fase 2 · Lo que Sumied escribe en ERP10, asiento a asiento (19/11).
--
-- Solo añade: una tabla nueva y una función nueva. No cambia ninguna que exista.
--
-- Lo que entra en ERP10 no se puede borrar por la API (no hay ningún DELETE de facturas ni
-- de apuntes en el Swagger). Por eso nada sale dos veces, aunque se pulse dos veces o el
-- envío se corte a la mitad:
--   · conta_erp10_envio guarda, por asiento, la INTENCIÓN antes de escribir («enviando»),
--     lo que ERP10 le ha dado después («en_erp10»: su ejercicio, serie y documento) o por
--     qué no ha podido («no_pudo»). Un asiento, una fila (índice único).
--   · conta_erp10_envio_tomar coge el asiento para escribirlo, en una sola sentencia: si
--     es nuevo, lo crea en «enviando»; si no pudo, o se quedó en «enviando» más de 3
--     minutos (el envío se cortó), lo vuelve a coger; si está en ERP10 o en marcha (otra
--     pestaña, otro clic), no. Quien lo coge busca antes en ERP10 la factura por su número
--     y su proveedor: si ya está (el corte fue después de escribir), la enlaza y no
--     escribe otra.
--   · Lo que ha entrado se apunta en la salida de siempre (conta_erp10_lote_apuntar, con
--     la sesión de quien pulsa), y el número de ERP10 va en conta_erp10_salida_partida
--     (erp10_serie y erp10_documento, que ya existen): así se casan uno a uno.
-- Solo lo escribe la función del servidor (conta-erp10-escribir, con la clave de
-- servicio); la cuenta lo lee.

create table if not exists public.conta_erp10_envio (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  entry_id uuid not null references public.journal_entry(id) on delete restrict,
  clase text not null check (clase in ('recibida', 'emitida', 'asiento')),
  estado text not null check (estado in ('enviando', 'en_erp10', 'no_pudo')),
  erp10_ejercicio text,
  erp10_serie text,
  erp10_documento integer check (erp10_documento is null or erp10_documento > 0),
  -- Ya estaba en ERP10 (alguien la metió, o el envío se cortó después de escribir): enlazada, no escrita otra vez.
  enlazada boolean not null default false,
  pdf text check (pdf is null or pdf in ('subido', 'fallo')),
  motivo text,
  intentos integer not null default 1 check (intentos > 0),
  lote_id uuid references public.conta_erp10_salida_lote(id) on delete restrict,
  quien_nombre text,
  creado_en timestamptz not null default now(),
  cambiado_en timestamptz not null default now(),
  check ((estado = 'en_erp10') = (erp10_documento is not null))
);

create unique index if not exists conta_erp10_envio_asiento_uq on public.conta_erp10_envio (entry_id);
create index if not exists conta_erp10_envio_empresa_idx on public.conta_erp10_envio (company_id, creado_en desc);

alter table public.conta_erp10_envio enable row level security;
drop policy if exists conta_erp10_envio_leer on public.conta_erp10_envio;
create policy conta_erp10_envio_leer on public.conta_erp10_envio for select to authenticated
  using (account_id = any (public.current_user_account_ids()));
revoke all on public.conta_erp10_envio from anon;
revoke insert, update, delete on public.conta_erp10_envio from authenticated;
grant select on public.conta_erp10_envio to authenticated;
grant all on public.conta_erp10_envio to service_role;

comment on table public.conta_erp10_envio is 'X10b · Lo que Sumied escribe en ERP10 por la API, asiento a asiento: la intención antes de escribir y lo que ERP10 le da. Lo escribe solo conta-erp10-escribir.';

create or replace function public.conta_erp10_envio_tomar(p_company uuid, p_entry uuid, p_clase text, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  v_e public.conta_erp10_envio;
  v_nuevo boolean := false;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.journal_entry e where e.id = p_entry and e.company_id = v_c.id and e.account_id = v_c.account_id) then
    raise exception 'Ese asiento no es de esta empresa.' using errcode = '23514';
  end if;
  if p_clase not in ('recibida', 'emitida', 'asiento') then raise exception 'Clase no válida: %', p_clase using errcode = '22023'; end if;

  insert into public.conta_erp10_envio (account_id, company_id, entry_id, clase, estado, quien_nombre)
  values (v_c.account_id, v_c.id, p_entry, p_clase, 'enviando', nullif(btrim(coalesce(p_quien_nombre, '')), ''))
  on conflict (entry_id) do nothing
  returning * into v_e;
  if v_e.id is not null then
    return jsonb_build_object('tomado', true, 'envio', to_jsonb(v_e));
  end if;

  -- Ya tenía fila: se vuelve a coger solo si no pudo, o si se quedó a medias hace más de 3 minutos.
  update public.conta_erp10_envio
     set estado = 'enviando', intentos = intentos + 1, motivo = null, cambiado_en = now(),
         quien_nombre = coalesce(nullif(btrim(coalesce(p_quien_nombre, '')), ''), quien_nombre)
   where entry_id = p_entry
     and (estado = 'no_pudo' or (estado = 'enviando' and cambiado_en < now() - interval '3 minutes'))
  returning * into v_e;
  if v_e.id is not null then
    return jsonb_build_object('tomado', true, 'envio', to_jsonb(v_e));
  end if;

  select * into v_e from public.conta_erp10_envio where entry_id = p_entry;
  return jsonb_build_object('tomado', false, 'envio', to_jsonb(v_e));
end $$;

revoke all on function public.conta_erp10_envio_tomar(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_erp10_envio_tomar(uuid, uuid, text, text) to service_role;
