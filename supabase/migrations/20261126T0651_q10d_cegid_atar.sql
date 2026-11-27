-- supabase/migrations/20261126T0651_q10d_cegid_atar.sql
--
-- Q10 · respuesta 4 (26/11) · ATAR UNA FICHA A SU CLIENTE DE CEGID. El código del cliente vive en un solo sitio
-- (X14): conta_cobro_cliente.codigo_cliente, el que hace su 430. En QBO es el código de cliente de Cegid. Una ficha con
-- cobros y sin código no se puede mandar a Cegid; «Facturas del mes» le propone uno (por su correo o su nombre) y una
-- persona lo ata con conta_cegid_atar. Aquí:
--   · conta_cegid_atado: quién ató qué ficha a qué código, cuándo y cómo (correo, nombre o a mano), con el código que
--     tenía antes (para deshacer);
--   · _conta_cegid_atar (interna) y conta_cegid_atar (la pantalla, solo quien puede en la gestoría): pone el código,
--     si nadie más de la empresa lo tiene, y lo apunta.
-- El NIF no se toca: la base no admite dos fichas con el mismo NIF en una cuenta (ux_party_nif), y el de Cegid lo
-- tiene ya otra ficha de Sumied, la del 430 (medido el 26/11 en las 10 en que la regla diría «el de Cegid»).
-- SOLO AÑADE (una tabla y dos funciones nuevas). Vuelta atrás: supabase/vuelta-atras/20261126T0651_q10d_cegid_atar.down.sql.

create table if not exists public.conta_cegid_atado (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  party_id uuid not null references public.party(id) on delete cascade,
  codigo int not null check (codigo between 1 and 99999),
  codigo_antes int,
  como text not null check (como in ('correo', 'nombre', 'a_mano')),
  quien text,
  at timestamptz not null default now()
);
comment on table public.conta_cegid_atado is
  'Q10 · Cada ficha atada a su cliente de Cegid (conta_cobro_cliente.codigo_cliente): quién, cuándo, cómo y el código de antes.';
create index if not exists conta_cegid_atado_ficha_idx on public.conta_cegid_atado (company_id, party_id, at desc);
alter table public.conta_cegid_atado enable row level security;
drop policy if exists conta_cegid_atado_leer on public.conta_cegid_atado;
create policy conta_cegid_atado_leer on public.conta_cegid_atado for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_atado from anon;
grant select on public.conta_cegid_atado to authenticated;
grant all on public.conta_cegid_atado to service_role;

create or replace function public._conta_cegid_atar(p_company uuid, p_party uuid, p_codigo int, p_como text, p_quien text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $atar$
declare v_cuenta uuid; v_antes int; v_fila boolean; v_otra text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.party where id = p_party and account_id = v_cuenta) then
    raise exception 'Esa ficha no es de la cuenta de la empresa.' using errcode = 'P0002';
  end if;
  if p_codigo is null or p_codigo < 1 or p_codigo > 99999 then raise exception 'El código de cliente va del 1 al 99999.' using errcode = '22023'; end if;
  if p_como not in ('correo', 'nombre', 'a_mano') then raise exception 'Cómo se ata: correo, nombre o a_mano.' using errcode = '22023'; end if;
  select p.name into v_otra from public.conta_cobro_cliente c join public.party p on p.id = c.party_id
   where c.company_id = p_company and c.codigo_cliente = p_codigo and c.party_id <> p_party;
  if v_otra is not null then
    raise exception 'El código % ya es de «%» en esta empresa: no se ata a dos fichas.', p_codigo, v_otra using errcode = '23505';
  end if;
  select true, c.codigo_cliente into v_fila, v_antes from public.conta_cobro_cliente c where c.company_id = p_company and c.party_id = p_party for update;
  if v_fila then
    update public.conta_cobro_cliente set codigo_cliente = p_codigo, updated_at = now(), updated_by_name = coalesce(p_quien, 'Sumied')
     where company_id = p_company and party_id = p_party;
  else
    insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, updated_at, updated_by_name)
    values (p_company, p_party, v_cuenta, p_codigo, now(), coalesce(p_quien, 'Sumied'));
  end if;
  insert into public.conta_cegid_atado (company_id, account_id, party_id, codigo, codigo_antes, como, quien)
  values (p_company, v_cuenta, p_party, p_codigo, v_antes, p_como, p_quien);
  return jsonb_build_object('codigo', p_codigo, 'antes', v_antes,
    'frase', format('Atada al cliente %s de Cegid%s.', p_codigo, case when v_antes is not null and v_antes <> p_codigo then format(' (tenía el %s)', v_antes) else '' end));
end $atar$;
comment on function public._conta_cegid_atar(uuid, uuid, int, text, text) is
  'Q10 · Interna: pone el código de cliente (el de Cegid en QBO) a una ficha en conta_cobro_cliente, si nadie más de la empresa lo tiene, y lo apunta en conta_cegid_atado.';
revoke all on function public._conta_cegid_atar(uuid, uuid, int, text, text) from public, anon, authenticated;

create or replace function public.conta_cegid_atar(p_company uuid, p_party uuid, p_codigo int, p_como text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $atar$
begin
  perform public._conta_gestoria_puede(p_company);
  return public._conta_cegid_atar(p_company, p_party, p_codigo, p_como, public.conta_nombre_actor());
end $atar$;
comment on function public.conta_cegid_atar(uuid, uuid, int, text) is
  'Q10 · «Atar al N»: la ficha es el cliente N de Cegid. Solo quien puede en la gestoría; lo apunta con quién y cómo.';
revoke all on function public.conta_cegid_atar(uuid, uuid, int, text) from public, anon;
grant execute on function public.conta_cegid_atar(uuid, uuid, int, text) to authenticated;
