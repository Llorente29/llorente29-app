-- supabase/migrations/20261028T0753_s01_propuestas_solas_base.sql
--
-- S01 · PR 3 · Entrega 5 del PC01 · PROPUESTAS SIN BOTÓN · la base común.
-- Decidido por Julio (28/10): cada regla pasa a SQL, comparada con la del
-- navegador sobre los datos reales (regla 31); cuando coinciden, el navegador
-- llama a la de SQL y su copia se borra. Origen por origen.
--
-- Este fichero SOLO AÑADE lo que comparten los cinco orígenes:
--   1. conta_propuesta_pendiente: «Lo que no he podido proponer, y por qué»,
--      una fila por origen (la nómina de septiembre, el recibido sin factura de
--      un proveedor y mes…), con su qué y su porqué en palabras de oficina y
--      dónde se arregla. Se borra sola cuando el origen se propone. Lo enseña
--      cada apartado en su sitio (no Asientos).
--   2. conta_dia_abierto: un día en un ejercicio abierto, fuera de lo traído y
--      con su mes sin cerrar; lo mismo que diaAbierto del navegador
--      (lib/libro.ts), con las piezas que ya tiene la base
--      (conta_primer_dia_abierto).
--   3. _conta_proponer: una propuesta ya hecha ({entrada, lineas}, la forma de
--      aJson del navegador) al libro, por _journal_entry_proponer (una sola
--      puerta), y borra su «no he podido».
--   4. _conta_no_propuesta: apunta (o actualiza) un «no he podido».
--
-- Nada de esto toca filas que existan ni el camino del pedido. Se puede pasar
-- dos veces.

create table if not exists public.conta_propuesta_pendiente (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  origen      text not null check (origen in ('payroll', 'purchase_accrual', 'sales_adjustment', 'licensed_settlement', 'channel_settlement')),
  origen_id   text not null,
  que         text not null,
  porque      text not null,
  donde       text,
  at          timestamptz not null default now(),
  constraint conta_propuesta_pendiente_uno unique (company_id, origen, origen_id)
);
comment on table public.conta_propuesta_pendiente is
  'S01 · PR 3 (entrega 5): lo que no se ha podido proponer solo, y por qué, en palabras de oficina; donde = el apartado en el que se arregla. Se borra cuando el origen se propone.';
alter table public.conta_propuesta_pendiente enable row level security;
drop policy if exists conta_propuesta_pendiente_leer on public.conta_propuesta_pendiente;
create policy conta_propuesta_pendiente_leer on public.conta_propuesta_pendiente for select to authenticated
  using (public.belongs_to_account(account_id));
revoke insert, update, delete on public.conta_propuesta_pendiente from anon, authenticated;
grant select on public.conta_propuesta_pendiente to authenticated;

create or replace function public.conta_dia_abierto(p_company uuid, p_dia date)
returns boolean language sql stable set search_path = public as $$
  select p_dia is not null and public.conta_primer_dia_abierto(p_company, p_dia) = p_dia
$$;
comment on function public.conta_dia_abierto(uuid, date) is
  'S01 · PR 3: el día está en un ejercicio abierto, fuera de lo traído y con su mes sin cerrar (diaAbierto del navegador).';

create or replace function public._conta_no_propuesta(p_company uuid, p_origen text, p_origen_id text, p_que text, p_porque text, p_donde text)
returns void language sql security definer set search_path = public as $$
  insert into public.conta_propuesta_pendiente (account_id, company_id, origen, origen_id, que, porque, donde)
  select c.account_id, c.id, p_origen, p_origen_id, p_que, p_porque, p_donde from public.company c where c.id = p_company
  on conflict (company_id, origen, origen_id) do update set que = excluded.que, porque = excluded.porque, donde = excluded.donde, at = now()
$$;
revoke all on function public._conta_no_propuesta(uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public._conta_proponer(p_company uuid, p_propuesta jsonb, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  v_res := public._journal_entry_proponer(p_company, p_propuesta->'entrada', p_propuesta->'lineas', null, coalesce(p_quien, 'Sumied'), null);
  delete from public.conta_propuesta_pendiente
   where company_id = p_company and origen = p_propuesta->'entrada'->>'source_type' and origen_id = p_propuesta->'entrada'->>'source_id';
  return v_res;
end $$;
revoke all on function public._conta_proponer(uuid, jsonb, text) from public, anon, authenticated;
comment on function public._conta_proponer(uuid, jsonb, text) is
  'S01 · PR 3: una propuesta ya hecha ({entrada, lineas}, la forma de aJson) al libro por _journal_entry_proponer, y fuera su «no he podido».';
