-- supabase/migrations/20261127T0730_q10i_banco_a_cegid.sql
--
-- Q10 · respuesta 7 (27/11) · LO COBRADO POR EL BANCO Y CON TARJETA, A CEGID (las reglas de Julio en
-- supabase/functions/_shared/cegidBanco.ts).
--   · conta_cegid_incidencia.movement_id, origen_clave y parte: de qué cobro sale cada incidencia que no es de
--     GoCardless. origen_clave es la del cobro («mov:<movimiento>» del banco o «tpv:<cuándo>|<importe>» de un pago con
--     tarjeta); parte, «recibo» (paga un recibo de GoCardless devuelto: su gc_cobro_id es el del recibo, así que ni el
--     banco ni GoCardless lo mandan dos veces), «recargo» (el 0018) o «decision» (lo que decidió Julio). Null en las de
--     GoCardless.
--   · conta_banco_decision: lo que decide Julio de cada cobro que no paga ningún recibo: «paga_factura» (paga una
--     factura que ya existe), «facturar» (con su concepto y su cliente de Cegid) o «no_es_cobro». Con quién y cuándo, y
--     la decisión de antes si la cambia. Una por cobro.
--   · conta_banco_decidir: los tres botones de «Facturas del mes» (solo quien puede en la gestoría). Un cobro ya mandado
--     a Cegid no se vuelve a decidir.
-- SOLO AÑADE (tres columnas que admiten nulos, una tabla y una función). Vuelta atrás:
-- supabase/vuelta-atras/20261127T0730_q10i_banco_a_cegid.down.sql.

alter table public.conta_cegid_incidencia add column if not exists movement_id uuid references public.bank_movement(id) on delete set null;
alter table public.conta_cegid_incidencia add column if not exists origen_clave text;
alter table public.conta_cegid_incidencia add column if not exists parte text check (parte in ('recibo', 'recargo', 'decision'));
comment on column public.conta_cegid_incidencia.origen_clave is
  'Q10 · El cobro del banco («mov:<movimiento>») o con tarjeta («tpv:<cuándo>|<importe>») del que sale la incidencia; null en las de GoCardless.';

create table if not exists public.conta_banco_decision (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  clave text not null check (clave ~ '^(mov:[0-9a-f-]{36}|tpv:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\|\d+\.\d{2})$'),
  decision text not null check (decision in ('paga_factura', 'facturar', 'no_es_cobro')),
  concepto text check (concepto ~ '^[0-9A-Z]{1,5}$'),
  cliente int check (cliente > 0),
  texto text check (length(texto) <= 250),
  -- La factura de Cegid que paga («1/2745»), si se sabe.
  factura text check (factura ~ '^[0-9A-Z]{1,5}/\d{1,9}$'),
  quien text,
  at timestamptz not null default now(),
  antes jsonb,
  primary key (company_id, clave),
  check (decision <> 'facturar' or (concepto is not null and cliente is not null))
);
comment on table public.conta_banco_decision is
  'Q10 · Lo que decide Julio de un cobro del banco o con tarjeta que no paga ningún recibo: paga una factura que ya existe, se factura (concepto y cliente de Cegid) o no es un cobro.';
alter table public.conta_banco_decision enable row level security;
drop policy if exists conta_banco_decision_leer on public.conta_banco_decision;
create policy conta_banco_decision_leer on public.conta_banco_decision for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_banco_decision from anon;
grant select on public.conta_banco_decision to authenticated;
grant all on public.conta_banco_decision to service_role;

create or replace function public.conta_banco_decidir(p_company uuid, p_clave text, p_decision text, p_concepto text, p_cliente int, p_texto text, p_factura text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $decidir$
declare
  v_cuenta uuid := public._conta_gestoria_puede(p_company);
  v_c text := nullif(upper(trim(coalesce(p_concepto, ''))), '');
  v_t text := nullif(trim(coalesce(p_texto, '')), '');
  v_f text := nullif(upper(trim(coalesce(p_factura, ''))), '');
  v_antes jsonb;
  v_frase text;
begin
  if p_decision not in ('paga_factura', 'facturar', 'no_es_cobro') then raise exception 'Qué se decide: paga_factura, facturar o no_es_cobro.' using errcode = '22023'; end if;
  if p_clave ~ '^mov:' then
    if not exists (select 1 from public.conta_banco_cobro where company_id = p_company and movement_id::text = substr(p_clave, 5)) then
      raise exception 'Ese movimiento no es un cobro del banco de esta empresa.' using errcode = 'P0002';
    end if;
  elsif p_clave ~ '^tpv:' then
    if to_regclass('public.conta_banco_cobro_tarjeta') is null or not exists (
      select 1 from public.conta_banco_cobro_tarjeta where company_id = p_company
         and pagado_en = split_part(substr(p_clave, 5), '|', 1)::timestamptz and importe = split_part(p_clave, '|', 2)::numeric) then
      raise exception 'Ese pago con tarjeta no es de esta empresa.' using errcode = 'P0002';
    end if;
  else
    raise exception 'La clave de un cobro empieza por mov: o tpv:.' using errcode = '22023';
  end if;
  if p_decision = 'facturar' then
    if v_c is null or v_c !~ '^[0-9A-Z]{1,5}$' then raise exception 'Para facturar hace falta el concepto de Cegid (hasta 5 letras o cifras).' using errcode = '22023'; end if;
    if coalesce(p_cliente, 0) <= 0 then raise exception 'Para facturar hace falta el cliente de Cegid.' using errcode = '22023'; end if;
  end if;
  if v_f is not null and (p_decision <> 'paga_factura' or v_f !~ '^[0-9A-Z]{1,5}/\d{1,9}$') then
    raise exception 'La factura que paga va como serie/número («1/2745»), y solo con «paga una factura que ya existe».' using errcode = '22023';
  end if;
  if exists (select 1 from public.conta_cegid_incidencia where company_id = p_company and origen_clave = p_clave and estado in ('mandando', 'mandada', 'facturada')) then
    raise exception 'Este cobro ya está mandado a Cegid: no se vuelve a decidir.' using errcode = '55000';
  end if;
  select to_jsonb(d) - 'company_id' - 'account_id' - 'clave' into v_antes from public.conta_banco_decision d where company_id = p_company and clave = p_clave;
  insert into public.conta_banco_decision (company_id, account_id, clave, decision, concepto, cliente, texto, factura, quien, antes)
  values (p_company, v_cuenta, p_clave, p_decision, case when p_decision = 'facturar' then v_c end, case when p_decision = 'facturar' then p_cliente end,
          case when p_decision = 'facturar' then v_t end, v_f, public.conta_nombre_actor(), v_antes)
  on conflict (company_id, clave) do update set decision = excluded.decision, concepto = excluded.concepto, cliente = excluded.cliente,
    texto = excluded.texto, factura = excluded.factura, quien = excluded.quien, at = now(), antes = excluded.antes;
  v_frase := case p_decision
    when 'paga_factura' then case when v_f is null then 'Apuntado: paga una factura que ya existe. No se manda a Cegid.'
      else format('Apuntado: paga la factura %s, que ya existe. No se manda a Cegid.', v_f) end
    when 'no_es_cobro' then 'Apuntado: no es un cobro. No se manda a Cegid.'
    else format('Apuntado: se factura al cliente %s de Cegid con el concepto %s.', p_cliente, v_c) end;
  return jsonb_build_object('decision', p_decision, 'frase', v_frase);
end $decidir$;
comment on function public.conta_banco_decidir(uuid, text, text, text, int, text, text) is
  'Q10 · Los tres botones de un cobro del banco o con tarjeta: paga una factura que ya existe, facturar con un concepto o no es un cobro. Solo quien puede en la gestoría.';
revoke all on function public.conta_banco_decidir(uuid, text, text, text, int, text, text) from public, anon;
grant execute on function public.conta_banco_decidir(uuid, text, text, text, int, text, text) to authenticated;
