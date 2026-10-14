-- supabase/migrations/20261111T0700_c06b_diez_pdf_pendiente.sql
--
-- cambia: public.external_send · prueba: supabase/staging/sql/20261111_c06b_diez_pdf_pendiente_prueba.sql
--
-- C06b · Respuesta 7 de Julio, tarea 1 (decisión del 14/10): a Diez sin
-- esperar a Cegid. Cegid no ha activado el almacén de documentos de apiCON
-- (R14: «The specified container does not exist»), y con el freno de R15 («sin
-- documento adjunto no está en Diez») no salía nada.
--
--   · En Folvy el PDF sigue siendo obligatorio: sin documento guardado en
--     Folvy no se envía (el freno 2 de _shared/diezEnviar.ts no cambia).
--   · A Diez va la factura SIN adjunto y queda «PDF pendiente en Diez»
--     (external_send.document_status = 'pendiente_diez').
--   · Lo adjunta una persona en Diez y lo marca en Folvy («Ya está adjunto»:
--     conta_diez_adjunto_a_mano), o, cuando Cegid lo active, Folvy solo
--     (document_attached_via = 'diez'). Queda dicho quién y cómo.
--   · Escribir en una base REAL de Diez (C0008) sigue cerrado salvo lo que
--     Julio autorice, por escrito y en la base: conta_diez_autorizo. Primero
--     un asiento (alcance 'asiento'); después, la empresa entera ('empresa').
--     Solo se escribe con service_role, en una tanda de producción que lleva
--     su «autorizo».
--
-- Solo amplía: el CHECK de document_status admite un valor más (se quita y se
-- vuelve a poner con el mismo nombre, en la misma transacción), columnas que
-- admiten nulos, una tabla y una función nuevas. external_send no está en el
-- camino del pedido.

-- 1. «PDF pendiente en Diez» -----------------------------------------------------
alter table public.external_send drop constraint if exists external_send_document_status_check;
alter table public.external_send add constraint external_send_document_status_check
  check (document_status in ('pendiente', 'adjunto', 'fallo', 'pendiente_diez'));
comment on column public.external_send.document_status is
  'El documento en Diez: pendiente (aún no se ha subido), adjunto (Diez lo tiene), fallo (con document_error) o pendiente_diez (C06b R7: la factura está en Diez SIN su PDF, que hay que adjuntar allí; sale en Libros › Pendientes de adjuntar en Diez).';

-- 2. Quién lo adjuntó y cómo ------------------------------------------------------
alter table public.external_send add column if not exists document_attached_via text
  check (document_attached_via in ('diez', 'a_mano'));
alter table public.external_send add column if not exists document_attached_by uuid;
alter table public.external_send add column if not exists document_attached_by_name text;
comment on column public.external_send.document_attached_via is
  'C06b R7 · Cómo llegó el PDF a Diez: diez (lo subió Folvy por apiCON y lo leyó de vuelta) o a_mano (una persona lo adjuntó en Diez y lo marcó en Folvy).';

-- 3. Lo que Julio autoriza escribir en Diez real -----------------------------------
create table if not exists public.conta_diez_autorizo (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  alcance text not null check (alcance in ('asiento', 'empresa')),
  entry_id uuid references public.journal_entry(id) on delete cascade,
  nombre_bd text not null check (upper(nombre_bd) <> 'C0001'),
  autorizado_por text not null check (length(trim(autorizado_por)) > 0),
  motivo text not null check (length(trim(motivo)) > 0),
  created_at timestamptz not null default now(),
  check ((alcance = 'asiento') = (entry_id is not null))
);
create unique index if not exists conta_diez_autorizo_asiento_uq on public.conta_diez_autorizo (entry_id) where entry_id is not null;
create unique index if not exists conta_diez_autorizo_empresa_uq on public.conta_diez_autorizo (company_id, nombre_bd) where alcance = 'empresa';
comment on table public.conta_diez_autorizo is
  'C06b R7 · Lo que Julio autoriza escribir en una base REAL de Diez: un asiento o la empresa entera, en una base. Sin fila, conta-diez-enviar no escribe fuera de C0009. Solo service_role (tanda de producción con autorizo).';
alter table public.conta_diez_autorizo enable row level security;
revoke all on table public.conta_diez_autorizo from public, anon, authenticated;

-- 4. «Ya está adjunto» -------------------------------------------------------------
create or replace function public.conta_diez_adjunto_a_mano(p_entry uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.external_send;
begin
  select * into v_s from public.external_send
   where entry_id = p_entry and status in ('enviado', 'enlazado') for update;
  if v_s.id is null or not public.belongs_to_account(v_s.account_id) then
    raise exception 'Ese asiento no está en Diez.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_s.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta marca un documento como adjunto en Diez.' using errcode = '42501';
  end if;
  if v_s.document_status = 'adjunto' then
    return jsonb_build_object('serie', v_s.ext_series, 'numero', v_s.ext_number, 'ya_estaba', true,
      'via', v_s.document_attached_via, 'quien', v_s.document_attached_by_name, 'cuando', v_s.document_attached_at);
  end if;
  if v_s.document_status is distinct from 'pendiente_diez' then
    raise exception 'El documento de este asiento no está pendiente de adjuntar en Diez (está %).', coalesce(v_s.document_status, 'sin estado') using errcode = '23514';
  end if;
  update public.external_send
     set document_status = 'adjunto', document_error = null, document_attached_at = now(),
         document_attached_via = 'a_mano', document_attached_by = auth.uid(),
         document_attached_by_name = nullif(trim(coalesce(p_quien_nombre, '')), ''), updated_at = now()
   where id = v_s.id;
  return jsonb_build_object('serie', v_s.ext_series, 'numero', v_s.ext_number, 'ya_estaba', false, 'via', 'a_mano');
end $$;
comment on function public.conta_diez_adjunto_a_mano(uuid, text) is
  'C06b R7 · «Ya está adjunto»: una persona ha adjuntado en Diez el PDF de una factura que Folvy envió sin él. Solo administrador o encargado; solo desde pendiente_diez; queda quién y cuándo.';
revoke all on function public.conta_diez_adjunto_a_mano(uuid, text) from public, anon;
grant execute on function public.conta_diez_adjunto_a_mano(uuid, text) to authenticated;

-- conta_lectura (los agentes) lee las autorizaciones, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_diez_autorizo to conta_lectura;
  end if;
end $$;
