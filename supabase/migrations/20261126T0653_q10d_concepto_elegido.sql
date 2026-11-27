-- supabase/migrations/20261126T0653_q10d_concepto_elegido.sql
--
-- Q10 · respuesta 4 (26/11) · EL CONCEPTO DE CEGID DE LO QUE NO LO TIENE EN LA TABLA APROBADA.
--   · conta_gc_cobro.descripcion: el texto del cobro en GoCardless (description). Un cobro suelto, sin suscripción, solo
--     dice qué se cobra ahí; va de texto a la incidencia. Lo rellena conta-gocardless-leer desde esta tanda.
--   · conta_cegid_concepto_elegido: el concepto de Cegid que eligió una persona para un cobro suelto (por su id de
--     cobro) o para una suscripción cuyo nombre no está en la tabla aprobada (por su id de suscripción). Manda sobre la
--     tabla; Sumied lo propone por palabras del texto y una persona lo confirma.
--   · conta_cegid_elegir_concepto: «Confirmar» desde «Facturas del mes» (solo quien puede en la gestoría).
-- SOLO AÑADE (una columna que admite nulos, una tabla y una función). Vuelta atrás:
-- supabase/vuelta-atras/20261126T0653_q10d_concepto_elegido.down.sql.

alter table public.conta_gc_cobro add column if not exists descripcion text;
comment on column public.conta_gc_cobro.descripcion is 'Q10 · El texto del cobro en GoCardless (description); el de un cobro suelto va de texto a su incidencia de Cegid.';

create table if not exists public.conta_cegid_concepto_elegido (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  que text not null check (que in ('cobro', 'suscripcion')),
  gc_id text not null,
  concepto text not null check (concepto ~ '^[0-9A-Z]{1,5}$'),
  quien text,
  at timestamptz not null default now(),
  unique (company_id, que, gc_id)
);
comment on table public.conta_cegid_concepto_elegido is
  'Q10 · El concepto de Cegid elegido por una persona para un cobro suelto o una suscripción fuera de la tabla aprobada. Manda sobre la tabla.';
alter table public.conta_cegid_concepto_elegido enable row level security;
drop policy if exists conta_cegid_concepto_elegido_leer on public.conta_cegid_concepto_elegido;
create policy conta_cegid_concepto_elegido_leer on public.conta_cegid_concepto_elegido for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_concepto_elegido from anon;
grant select on public.conta_cegid_concepto_elegido to authenticated;
grant all on public.conta_cegid_concepto_elegido to service_role;

create or replace function public.conta_cegid_elegir_concepto(p_company uuid, p_que text, p_gc_id text, p_concepto text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $elegir$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_c text := upper(trim(coalesce(p_concepto, '')));
begin
  if p_que not in ('cobro', 'suscripcion') then raise exception 'Qué se elige: cobro o suscripcion.' using errcode = '22023'; end if;
  if v_c !~ '^[0-9A-Z]{1,5}$' then raise exception 'El concepto de Cegid tiene hasta 5 letras o cifras.' using errcode = '22023'; end if;
  if p_que = 'cobro' and not exists (select 1 from public.conta_gc_cobro where company_id = p_company and gc_id = p_gc_id) then
    raise exception 'Ese cobro no está en lo leído de GoCardless.' using errcode = 'P0002';
  end if;
  if p_que = 'suscripcion' and not exists (select 1 from public.conta_gc_suscripcion where company_id = p_company and gc_id = p_gc_id) then
    raise exception 'Esa suscripción no está en lo leído de GoCardless.' using errcode = 'P0002';
  end if;
  insert into public.conta_cegid_concepto_elegido (company_id, account_id, que, gc_id, concepto, quien)
  values (p_company, v_cuenta, p_que, p_gc_id, v_c, public.conta_nombre_actor())
  on conflict (company_id, que, gc_id) do update set concepto = excluded.concepto, quien = excluded.quien, at = now();
  return jsonb_build_object('concepto', v_c, 'frase', format('Confirmado: va al concepto %s de Cegid.', v_c));
end $elegir$;
comment on function public.conta_cegid_elegir_concepto(uuid, text, text, text) is
  'Q10 · «Confirmar»: el concepto de Cegid de un cobro suelto o de una suscripción fuera de la tabla aprobada. Solo quien puede en la gestoría.';
revoke all on function public.conta_cegid_elegir_concepto(uuid, text, text, text) from public, anon;
grant execute on function public.conta_cegid_elegir_concepto(uuid, text, text, text) to authenticated;
