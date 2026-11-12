-- ============================================================================
-- B01·22 · El nivel de cada propuesta del banco (Julio, B01r_22, 12/11 y 13/11).
--
-- Solo AÑADE: no cambia ni un movimiento, ni una propuesta, ni un casado.
--
--   1. bank_settings.seguro_solo (el interruptor de la empresa: casar sola una
--      propuesta «Seguro»). NULL = apagado, y se queda apagado: lo enciende
--      Julio cuando la medida de los «Seguro» nuevos lo diga.
--      bank_settings.seguro_limite: por encima, «Nunca sola». NULL = 1.000 €.
--   2. bank_nivel_veredicto: por cada propuesta con nivel que casa una persona,
--      si la casó TAL CUAL o la cambió. Es la medida que decide encender el
--      interruptor, con movimientos nuevos. Solo crece; se escribe con (3).
--   3. bank_nivel_veredicto_apuntar: lo apunta (la llama Bancos al confirmar).
--   4. bank_historial_validado: lo casado contra una cuenta y VALIDADO, con su
--      fecha de validación y si la persona corrigió lo que se le propuso. Con
--      esto el motor cuenta «3 seguidas sin corrección por medio» (nivel.ts).
-- ============================================================================

alter table public.bank_settings add column if not exists seguro_solo boolean;
comment on column public.bank_settings.seguro_solo is
  'B01·22. El interruptor: si es true, el motor casa solo lo que tiene nivel «Seguro» (coincide al céntimo, o confirmado 3 veces). NULL o false: apagado, nada se casa solo por su nivel.';
alter table public.bank_settings add column if not exists seguro_limite numeric(12, 2);
comment on column public.bank_settings.seguro_limite is
  'B01·22. Por encima de este importe (en euros), una propuesta es «Nunca sola». NULL = 1.000 €.';

create table if not exists public.bank_nivel_veredicto (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  movement_id      uuid references public.bank_movement(id) on delete set null,
  match_id         uuid references public.bank_match(id) on delete set null,
  nivel            text not null check (nivel in ('centimo', 'confirmado', 'camino', 'nunca', 'nose')),
  etiqueta         text not null,
  tal_cual         boolean not null,
  propuesto        jsonb,
  casado           jsonb,
  motor            text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text
);
create index if not exists bank_nivel_veredicto_empresa on public.bank_nivel_veredicto (company_id, created_at desc);
create index if not exists bank_nivel_veredicto_casado on public.bank_nivel_veredicto (match_id);
comment on table public.bank_nivel_veredicto is
  'B01·22. Por cada propuesta con nivel que casa una persona: su nivel y si la casó tal cual (true) o la cambió (false). Solo crece. La medida que decide encender bank_settings.seguro_solo.';
alter table public.bank_nivel_veredicto enable row level security;
drop policy if exists bank_nivel_veredicto_select on public.bank_nivel_veredicto;
create policy bank_nivel_veredicto_select on public.bank_nivel_veredicto for select using ((select public.belongs_to_account(account_id)));

create or replace function public.bank_nivel_veredicto_apuntar(p_movement uuid, p_match uuid, p_nivel text, p_etiqueta text, p_tal_cual boolean,
                                                               p_propuesto jsonb, p_casado jsonb, p_motor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m public.bank_movement; v_id uuid;
begin
  select * into v_m from public.bank_movement where id = p_movement;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_m.company_id);
  insert into public.bank_nivel_veredicto (account_id, company_id, movement_id, match_id, nivel, etiqueta, tal_cual, propuesto, casado, motor, created_by, created_by_name)
  values (v_m.account_id, v_m.company_id, p_movement, p_match, p_nivel, p_etiqueta, p_tal_cual, p_propuesto, p_casado, p_motor, auth.uid(), public.conta_nombre_actor())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.bank_nivel_veredicto_apuntar(uuid, uuid, text, text, boolean, jsonb, jsonb, text) from public, anon;
grant execute on function public.bank_nivel_veredicto_apuntar(uuid, uuid, text, text, boolean, jsonb, jsonb, text) to authenticated, service_role;

create or replace function public.bank_historial_validado(p_company uuid, p_desde date)
returns table (concepto text, contraparte text, cuentas text, validado timestamptz, corregido boolean)
language sql stable security invoker set search_path = public as $$
  -- Lo casado contra una cuenta y validado: el concepto del banco (el mismo que lee el motor), las
  -- cuentas del asiento sin el banco, cuándo se validó y si la persona corrigió lo propuesto:
  -- primero lo que dice su veredicto (B01·22); antes de él, si lo último que propuso el motor
  -- antes de casarlo no iba contra esas mismas cuentas. Sin propuesta (por aclarar), no es corrección.
  select coalesce(nullif(m.bank_concept, ''), m.clean_concept), m.counterparty, c.cuentas, je.validated_at,
         coalesce(
           (select not v.tal_cual from public.bank_nivel_veredicto v where v.match_id = b.id order by v.created_at desc limit 1),
           (select case when p.action = 'por_aclarar' or p.detail->'destino' is null or jsonb_typeof(p.detail->'destino') <> 'object' then false
                        when p.detail->'destino'->>'tipo' not in ('cuenta', 'anticipo') then true
                        else (select string_agg(distinct e->>'cuenta', ',' order by e->>'cuenta') from jsonb_array_elements(p.detail->'destino'->'lineas') e)
                             is distinct from c.cuentas end
              from public.bank_activity_log p
             where p.movement_id = b.movement_id and p.by_who = 'folvy' and p.action in ('propuesto', 'por_aclarar') and p.created_at <= b.created_at
             order by p.created_at desc limit 1),
           false)
    from public.bank_match b
    join public.bank_movement m on m.id = b.movement_id
    join public.journal_entry je on je.id = b.journal_entry_id
    cross join lateral (select string_agg(distinct ca.code, ',' order by ca.code) cuentas
                          from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                         where jl.entry_id = b.journal_entry_id and ca.code not like '57%') c
   where b.company_id = p_company and b.status = 'vivo' and b.kind = 'cuenta'
     and je.validated_at is not null and je.validated_at >= p_desde and c.cuentas is not null
$$;
revoke all on function public.bank_historial_validado(uuid, date) from public, anon;
grant execute on function public.bank_historial_validado(uuid, date) to authenticated, service_role;
