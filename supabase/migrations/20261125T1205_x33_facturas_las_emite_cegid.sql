-- supabase/migrations/20261125T1205_x33_facturas_las_emite_cegid.sql
--
-- X33 · «Las facturas las emite Cegid: no se suben las de Sumied» (Julio, 25/11). Un ajuste de cada empresa, con su
-- fecha de cambio y quién lo cambió. Mientras está encendido, ninguna factura de Sumied de esa empresa sale a ERP10:
-- ni las emitidas ni las recibidas (las facturas las lleva Cegid y saldrían dos veces). Los asientos que no son de una
-- factura siguen saliendo como siempre.
--
-- Solo añade: una tabla nueva, la función que dice si un asiento es de una factura frenada, la que lo enciende o lo
-- apaga (un administrador de la cuenta, como la salida a ERP10) y la que cuenta lo frenado de un mes (regla 7: la
-- pantalla dice cuántas no salen, no las esconde). Lo usan, en la 1206, las tres funciones de la salida.
--
-- Encendido de partida en las dos empresas de QBO de la cuenta de la gestoría, por decisión de Julio (25/11): se
-- apunta con su fecha y con «Julio (decisión del X33)» como quién. Si la empresa no está (staging, la base local), no
-- se apunta nada.

create table if not exists public.conta_erp10_facturas_fuera (
  company_id uuid primary key references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  encendido boolean not null default false,
  cambiado_en timestamptz not null default now(),
  cambiado_por uuid,
  cambiado_por_nombre text
);
comment on table public.conta_erp10_facturas_fuera is
  'X33 · «Las facturas las emite Cegid: no se suben las de Sumied», por empresa. Encendido: ninguna factura (emitida o recibida) de Sumied sale a ERP10; los demás asientos, sí.';

alter table public.conta_erp10_facturas_fuera enable row level security;
drop policy if exists conta_erp10_facturas_fuera_leer on public.conta_erp10_facturas_fuera;
create policy conta_erp10_facturas_fuera_leer on public.conta_erp10_facturas_fuera
  for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_erp10_facturas_fuera from anon;
grant select on public.conta_erp10_facturas_fuera to authenticated;
grant all on public.conta_erp10_facturas_fuera to service_role;

-- Si un asiento es de una factura (emitida o recibida) de una empresa con el ajuste encendido.
create or replace function public._conta_erp10_factura_frenada(p_company uuid, p_entry uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conta_erp10_facturas_fuera f where f.company_id = p_company and f.encendido)
     and (exists (select 1 from public.supplier_invoice si where si.journal_entry_id = p_entry and si.company_id = p_company)
       or exists (select 1 from public.customer_invoice ci where ci.entry_id = p_entry and ci.company_id = p_company))
$$;
comment on function public._conta_erp10_factura_frenada(uuid, uuid) is
  'X33 · true si el asiento es de una factura (emitida o recibida) y la empresa tiene encendido «Las facturas las emite Cegid».';
revoke all on function public._conta_erp10_factura_frenada(uuid, uuid) from public, anon;
grant execute on function public._conta_erp10_factura_frenada(uuid, uuid) to authenticated, service_role;

-- Encenderlo o apagarlo: un administrador de la cuenta. Apunta cuándo y quién.
create or replace function public.conta_erp10_facturas_fuera_poner(p_company uuid, p_encendido boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  v_f public.conta_erp10_facturas_fuera;
  v_quien text;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta cambia lo que sale a ERP10.' using errcode = '42501';
  end if;
  if p_encendido is null then raise exception 'Falta si se enciende o se apaga.' using errcode = '22023'; end if;
  select * into v_f from public.conta_erp10_facturas_fuera where company_id = v_c.id for update;
  if v_f.company_id is null or v_f.encendido is distinct from p_encendido then
    v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
    insert into public.conta_erp10_facturas_fuera (company_id, account_id, encendido, cambiado_en, cambiado_por, cambiado_por_nombre)
    values (v_c.id, v_c.account_id, p_encendido, now(), auth.uid(), v_quien)
    on conflict (company_id) do update set encendido = excluded.encendido, cambiado_en = excluded.cambiado_en,
      cambiado_por = excluded.cambiado_por, cambiado_por_nombre = excluded.cambiado_por_nombre
    returning * into v_f;
  end if;
  return jsonb_build_object('encendido', v_f.encendido, 'cambiado_en', v_f.cambiado_en, 'cambiado_por_nombre', v_f.cambiado_por_nombre,
    'texto', case when v_f.encendido
      then 'Encendido: las facturas de Sumied de esta empresa no salen a ERP10 (las emite Cegid). Los demás asientos, sí.'
      else 'Apagado: las facturas de esta empresa salen a ERP10 como los demás asientos.' end);
end $$;
comment on function public.conta_erp10_facturas_fuera_poner(uuid, boolean, text) is
  'X33 · Enciende o apaga «Las facturas las emite Cegid: no se suben las de Sumied» (un administrador de la cuenta), con cuándo y quién.';
revoke all on function public.conta_erp10_facturas_fuera_poner(uuid, boolean, text) from public, anon;
grant execute on function public.conta_erp10_facturas_fuera_poner(uuid, boolean, text) to authenticated, service_role;

-- Lo frenado de un mes: cuántas facturas validadas de la empresa no salen por el ajuste (regla 7: se cuentan, no se esconden).
create or replace function public.conta_erp10_facturas_fuera_del_mes(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_c public.company;
  v_f public.conta_erp10_facturas_fuera;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_emitidas int := 0;
  v_recibidas int := 0;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or (auth.uid() is not null and not public.belongs_to_account(v_c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  select * into v_f from public.conta_erp10_facturas_fuera where company_id = v_c.id;
  if coalesce(v_f.encendido, false) then
    select count(*) filter (where exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id and ci.company_id = e.company_id)),
           count(*) filter (where exists (select 1 from public.supplier_invoice si where si.journal_entry_id = e.id and si.company_id = e.company_id))
      into v_emitidas, v_recibidas
      from public.journal_entry e
     where e.company_id = v_c.id and e.account_id = v_c.account_id and e.status = 'validado'
       and e.entry_date >= date_trunc('month', p_mes)::date and e.entry_date < v_fin;
  end if;
  return jsonb_build_object('encendido', coalesce(v_f.encendido, false), 'cambiado_en', v_f.cambiado_en,
    'cambiado_por_nombre', v_f.cambiado_por_nombre, 'emitidas', v_emitidas, 'recibidas', v_recibidas);
end $$;
comment on function public.conta_erp10_facturas_fuera_del_mes(uuid, date) is
  'X33 · El ajuste «Las facturas las emite Cegid» de la empresa y cuántas facturas validadas del mes no salen por él.';
revoke all on function public.conta_erp10_facturas_fuera_del_mes(uuid, date) from public, anon;
grant execute on function public.conta_erp10_facturas_fuera_del_mes(uuid, date) to authenticated, service_role;

-- Encendido de partida en las dos empresas de QBO (decisión de Julio, 25/11). Solo si están (en staging no están).
insert into public.conta_erp10_facturas_fuera (company_id, account_id, encendido, cambiado_en, cambiado_por, cambiado_por_nombre)
select c.id, c.account_id, true, now(), null, 'Julio (decisión del X33)'
  from public.company c
 where c.id in ('58e574ec-012a-4483-9f5b-3501cc023ba4', 'dc43e21d-2992-4eb3-a378-c867f86d6644')
on conflict (company_id) do nothing;
