-- supabase/migrations/20261118T0515_x06_comprobar_salida.sql
--
-- X06 · El paso 3 de la salida a ERP10: «Comprueba que queda igual» (encargo X06,
-- 18/11). SOLO AÑADE: dos tablas y cuatro funciones nuevas. No cambia ninguna
-- función ni tabla de la X02, del X04 ni del X05 (regla 2), ni nada de Diez. Nada en
-- el camino del pedido.
--
--   1. conta_erp10_a_mano: las facturas (o asientos) que alguien dice que metió a
--      mano en ERP10. Dejan de contar como diferencia de Sumied.
--   2. conta_erp10_igualado: cada vez que alguien da un mes por igualado con ERP10:
--      quién, cuándo, con qué fichero y a qué fecha.
--   3. conta_erp10_comprobar(empresa, fecha): lo que necesita la comparación con el
--      sumas y saldos de ERP10. Solo lee:
--        · los saldos de Sumied a esa fecha, cuenta a cuenta, en su ejercicio (lo
--          validado y lo anulado con su contraasiento, como journal_ledger), con el
--          código que tiene cada cuenta en ERP10;
--        · cada asiento desde que sale (y hasta esa fecha), menos lo traído: si
--          salió (en qué tanda), si está metido a mano y lo que pone en cada cuenta;
--        · las tandas y lo último que se dio por igualado.
--   4. conta_erp10_a_mano_poner(empresa, asiento, quien): «Ya la he metido a mano».
--   5. conta_erp10_volver_a_sacar(empresa, asiento, quien): una que salió y no está
--      en ERP10 vuelve a «lo que sale» (su partida pasa a «retirada», el estado que ya
--      tiene la tabla desde la X02), para sacarla sola en un fichero.
--   6. conta_erp10_igualado_poner(...): «Darlo por igualado».
--
-- Vuelta atrás: supabase/vuelta-atras/20261118T0515_x06_comprobar_salida.down.sql

-- 1 · Lo metido a mano ------------------------------------------------------------------------
create table if not exists public.conta_erp10_a_mano (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  entry_id uuid not null references public.journal_entry(id) on delete restrict,
  metida_por uuid,
  metida_por_nombre text,
  metida_en timestamptz not null default now(),
  unique (entry_id)
);
create index if not exists conta_erp10_a_mano_empresa_idx on public.conta_erp10_a_mano (company_id);
comment on table public.conta_erp10_a_mano is
  'X06 · Lo que alguien dice que metió a mano en ERP10 («Ya la he metido a mano»): quién y cuándo. En la comparación con el sumas y saldos deja de contar como diferencia de Sumied. Lo escribe conta_erp10_a_mano_poner.';

-- 2 · Lo dado por igualado --------------------------------------------------------------------
create table if not exists public.conta_erp10_igualado (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  lote_id uuid references public.conta_erp10_salida_lote(id) on delete restrict,
  fichero text not null check (btrim(fichero) <> ''),
  fecha_saldos date not null,
  cuentas integer not null check (cuentas >= 0),
  con_diferencia integer not null check (con_diferencia >= 0),
  igualado_por uuid,
  igualado_por_nombre text,
  igualado_en timestamptz not null default now()
);
create index if not exists conta_erp10_igualado_empresa_idx on public.conta_erp10_igualado (company_id, igualado_en desc);
comment on table public.conta_erp10_igualado is
  'X06 · Cada vez que un mes se da por igualado con ERP10 («Darlo por igualado»): la tanda, el fichero de sumas y saldos con el que se comparó y a qué fecha, cuántas cuentas y cuántas tenían diferencia (todas explicadas), quién y cuándo. Lo escribe conta_erp10_igualado_poner.';

alter table public.conta_erp10_a_mano enable row level security;
alter table public.conta_erp10_igualado enable row level security;
drop policy if exists conta_erp10_a_mano_leer on public.conta_erp10_a_mano;
create policy conta_erp10_a_mano_leer on public.conta_erp10_a_mano
  for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_erp10_igualado_leer on public.conta_erp10_igualado;
create policy conta_erp10_igualado_leer on public.conta_erp10_igualado
  for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_erp10_a_mano, public.conta_erp10_igualado from public, anon, authenticated;
grant select on table public.conta_erp10_a_mano, public.conta_erp10_igualado to authenticated;
grant all on table public.conta_erp10_a_mano, public.conta_erp10_igualado to service_role;

-- 3 · Lo que necesita la comparación -------------------------------------------------------------
create or replace function public.conta_erp10_comprobar(p_company uuid, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_z public.conta_erp10_salida_empresa;
  v_y public.fiscal_year;
  v_r jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha.' using errcode = '22023'; end if;
  select * into v_z from public.conta_erp10_salida_empresa where company_id = v_c.id;
  if v_z.company_id is null or not v_z.encendida then
    raise exception 'La salida a ERP10 no está encendida en esta empresa.' using errcode = '23514';
  end if;
  select * into v_y from public.fiscal_year where company_id = v_c.id and p_fecha between starts_on and ends_on order by starts_on desc limit 1;
  if v_y.id is null then
    raise exception 'No hay ejercicio en Sumied para el %.', to_char(p_fecha, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  with saldos as (
    -- Como journal_ledger: lo validado y lo anulado (que lleva su contraasiento validado).
    select a.id, a.code, a.template_code, a.name, sum(l.debit - l.credit) as saldo
      from public.journal_line l
      join public.journal_entry e on e.id = l.entry_id and e.account_id = l.account_id
      join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id
     where l.account_id = v_c.account_id and l.company_id = v_c.id
       and e.status in ('validado', 'anulado') and e.entry_date between v_y.starts_on and p_fecha
     group by a.id, a.code, a.template_code, a.name
  ),
  mov as (
    -- Cada asiento desde que sale, menos lo traído de otro programa (que ya está en ERP10).
    select e.*
      from public.journal_entry e
     where e.company_id = v_c.id and e.account_id = v_c.account_id
       and e.status in ('validado', 'anulado')
       and e.entry_date >= greatest(v_z.desde, v_y.starts_on) and e.entry_date <= p_fecha
       and e.external_program is null and e.import_run_id is null
       and not exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.import_run_id is not null)
       and not exists (select 1 from public.supplier_invoice si where si.journal_entry_id = e.id and si.account_id = e.account_id and si.source = 'traida')
       and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id and ci.company_id = e.company_id
                         and (ci.origin = 'traida' or ci.import_run_id is not null))
  )
  select jsonb_build_object(
    'fecha', p_fecha, 'ejercicio', jsonb_build_object('desde', v_y.starts_on, 'hasta', v_y.ends_on),
    'desde', v_z.desde, 'codigo', v_z.codigo_erp10, 'largo', v_z.largo_subcuenta,
    'saldos', coalesce((select jsonb_agg(jsonb_build_object(
        'codigo', s.code, 'plantilla', s.template_code, 'nombre', s.name, 'saldo', s.saldo,
        'erp', coalesce((select x.codigo_erp10 from public.conta_erp10_subcuenta_salida x where x.company_id = v_c.id and x.company_account_id = s.id),
                        public.conta_erp10_subcuenta(s.code, s.template_code, v_z.largo_subcuenta)))
        order by s.code) from saldos s), '[]'::jsonb),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', m.id, 'serie', m.series, 'numero', m.number, 'fecha', m.entry_date, 'concepto', m.concept,
        'origen', m.source_type, 'estado', m.status, 'deshace', m.reverses_entry_id,
        'factura', coalesce((select min(v.number) from public.vat_book_entry v where v.entry_id = m.id and v.account_id = m.account_id and v.voided_at is null), m.document_ref),
        'tercero', (select min(v.counterpart_name) from public.vat_book_entry v where v.entry_id = m.id and v.account_id = m.account_id and v.voided_at is null),
        'salida', (select jsonb_build_object('lote', p.lote_id, 'mes', l.mes, 'salioEn', l.creado_en, 'clase', p.clase)
                     from public.conta_erp10_salida_partida p join public.conta_erp10_salida_lote l on l.id = p.lote_id
                    where p.entry_id = m.id and p.company_id = v_c.id and p.estado = 'salida'),
        'aMano', (select jsonb_build_object('quien', x.metida_por_nombre, 'cuando', x.metida_en)
                    from public.conta_erp10_a_mano x where x.entry_id = m.id and x.company_id = v_c.id),
        'lineas', (select jsonb_agg(jsonb_build_object('cuenta', q.code, 'importe', q.importe) order by q.code)
                     from (select a.code, sum(l.debit - l.credit) as importe
                             from public.journal_line l join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id
                            where l.entry_id = m.id and l.account_id = m.account_id
                            group by a.code having sum(l.debit - l.credit) <> 0) q))
        order by m.entry_date, m.series, m.number) from mov m), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'mes', l.mes, 'creadoEn', l.creado_en, 'quien', l.creado_por_nombre) order by l.creado_en)
        from public.conta_erp10_salida_lote l where l.company_id = v_c.id and l.account_id = v_c.account_id), '[]'::jsonb),
    'igualado', (select jsonb_build_object('mes', g.mes, 'fichero', g.fichero, 'fechaSaldos', g.fecha_saldos, 'quien', g.igualado_por_nombre, 'cuando', g.igualado_en)
        from public.conta_erp10_igualado g where g.company_id = v_c.id and g.account_id = v_c.account_id order by g.igualado_en desc limit 1)
  ) into v_r;
  return v_r;
end $$;
comment on function public.conta_erp10_comprobar(uuid, date) is
  'X06 · Lo que necesita la comparación con el sumas y saldos de ERP10: los saldos de Sumied a esa fecha en su ejercicio (con el código de cada cuenta en ERP10), cada asiento desde que sale (menos lo traído) con si salió, si está metido a mano y lo que pone en cada cuenta, las tandas y lo último igualado. Solo lee.';
revoke all on function public.conta_erp10_comprobar(uuid, date) from public, anon;
grant execute on function public.conta_erp10_comprobar(uuid, date) to authenticated, service_role;

-- 4 · «Ya la he metido a mano» ----------------------------------------------------------------------
create or replace function public.conta_erp10_a_mano_poner(p_company uuid, p_entry uuid, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_e public.journal_entry;
  v_x public.conta_erp10_a_mano;
  v_quien text;
  v_que text;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta apunta lo que se ha metido a mano en ERP10.' using errcode = '42501';
  end if;
  select * into v_e from public.journal_entry where id = p_entry and company_id = v_c.id and account_id = v_c.account_id;
  if v_e.id is null or v_e.status not in ('validado', 'anulado') then
    raise exception 'Ese asiento no es de esta empresa o no está validado.' using errcode = '23514';
  end if;
  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  insert into public.conta_erp10_a_mano (account_id, company_id, entry_id, metida_por, metida_por_nombre)
  values (v_c.account_id, v_c.id, v_e.id, auth.uid(), v_quien)
  on conflict (entry_id) do nothing
  returning * into v_x;
  if v_x.id is null then select * into v_x from public.conta_erp10_a_mano where entry_id = v_e.id; end if;
  v_que := coalesce((select 'la ' || min(v.number) from public.vat_book_entry v where v.entry_id = v_e.id and v.voided_at is null),
                    format('el asiento %s/%s', v_e.series, v_e.number));
  return jsonb_build_object('entry', v_e.id, 'quien', v_x.metida_por_nombre, 'cuando', v_x.metida_en,
    'texto', format('Apuntado: %s la metió a mano en ERP10 %s el %s. Ya no cuenta como diferencia.',
                    v_que, coalesce(v_x.metida_por_nombre, 'alguien de la cuenta'),
                    to_char(v_x.metida_en at time zone 'Europe/Madrid', 'DD/MM/YYYY "a las" HH24:MI')));
end $$;
comment on function public.conta_erp10_a_mano_poner(uuid, uuid, text) is
  'X06 · «Ya la he metido a mano»: apunta quién y cuándo metió a mano en ERP10 una factura o un asiento. Deja de contar como diferencia. Solo un administrador. Devuelve la frase de lo apuntado.';
revoke all on function public.conta_erp10_a_mano_poner(uuid, uuid, text) from public, anon;
grant execute on function public.conta_erp10_a_mano_poner(uuid, uuid, text) to authenticated, service_role;

-- 5 · «Volver a sacar solo esa» -------------------------------------------------------------------
create or replace function public.conta_erp10_volver_a_sacar(p_company uuid, p_entry uuid, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_p public.conta_erp10_salida_partida;
  v_e public.journal_entry;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta saca los ficheros para ERP10.' using errcode = '42501';
  end if;
  select * into v_p from public.conta_erp10_salida_partida
   where entry_id = p_entry and company_id = v_c.id and account_id = v_c.account_id and estado = 'salida' for update;
  if v_p.id is null then
    raise exception 'Ese asiento no ha salido a ERP10: no hay nada que volver a sacar.' using errcode = '23514';
  end if;
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.status <> 'validado' then
    raise exception 'Ese asiento está anulado en Sumied: no se vuelve a sacar. Corrígelo a mano en ERP10.' using errcode = '23514';
  end if;
  update public.conta_erp10_salida_partida set estado = 'retirada' where id = v_p.id;
  return jsonb_build_object('entry', v_e.id, 'clase', v_p.clase, 'lote', v_p.lote_id,
    'texto', 'Vuelve a lo que sale: se prepara un fichero solo con ella.');
end $$;
comment on function public.conta_erp10_volver_a_sacar(uuid, uuid, text) is
  'X06 · «Volver a sacar solo esa»: una partida que salió y no está en ERP10 pasa a «retirada» (estado de la X02) y el asiento vuelve a lo que sale, para sacarlo solo en un fichero (que se apunta con conta_erp10_lote_apuntar, como una salida más). Solo un administrador.';
revoke all on function public.conta_erp10_volver_a_sacar(uuid, uuid, text) from public, anon;
grant execute on function public.conta_erp10_volver_a_sacar(uuid, uuid, text) to authenticated, service_role;

-- 6 · «Darlo por igualado» ------------------------------------------------------------------------
create or replace function public.conta_erp10_igualado_poner(
  p_company uuid, p_mes date, p_fichero text, p_fecha date, p_cuentas integer, p_con_diferencia integer, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_ini date := date_trunc('month', p_mes)::date;
  v_lote uuid;
  v_g public.conta_erp10_igualado;
  v_quien text;
  v_meses text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta da un mes por igualado con ERP10.' using errcode = '42501';
  end if;
  if p_mes is null or p_fecha is null or coalesce(btrim(p_fichero), '') = '' or p_cuentas is null or p_cuentas < 0
     or p_con_diferencia is null or p_con_diferencia < 0 then
    raise exception 'Falta con qué fichero, a qué fecha o cuántas cuentas se compararon.' using errcode = '22023';
  end if;
  select l.id into v_lote from public.conta_erp10_salida_lote l
   where l.company_id = v_c.id and l.account_id = v_c.account_id and l.mes <= v_ini order by l.creado_en desc limit 1;
  if v_lote is null then
    raise exception 'Todavía no ha salido nada a ERP10 en esta empresa: no hay nada que dar por igualado.' using errcode = '23514';
  end if;
  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  insert into public.conta_erp10_igualado (account_id, company_id, mes, lote_id, fichero, fecha_saldos, cuentas, con_diferencia, igualado_por, igualado_por_nombre)
  values (v_c.account_id, v_c.id, v_ini, v_lote, btrim(p_fichero), p_fecha, p_cuentas, p_con_diferencia, auth.uid(), v_quien)
  returning * into v_g;
  return jsonb_build_object('id', v_g.id, 'lote', v_lote,
    'texto', format('Igualado: %s de %s queda igual en Sumied y en ERP10 (%s, a %s; %s cuentas). Lo dio por igualado %s el %s.',
                    v_meses[extract(month from v_ini)::int], extract(year from v_ini)::int, v_g.fichero, to_char(p_fecha, 'DD/MM'),
                    p_cuentas, coalesce(v_quien, 'alguien de la cuenta'),
                    to_char(v_g.igualado_en at time zone 'Europe/Madrid', 'DD/MM/YYYY "a las" HH24:MI')));
end $$;
comment on function public.conta_erp10_igualado_poner(uuid, date, text, date, integer, integer, text) is
  'X06 · «Darlo por igualado»: apunta en la última tanda del mes quién, cuándo, con qué fichero de sumas y saldos y a qué fecha se dio por igualado con ERP10, y cuántas cuentas (y cuántas con diferencia, todas explicadas). Lo de no dejar ninguna sin explicar lo comprueba la pantalla, que es la que lee el fichero. Solo un administrador.';
revoke all on function public.conta_erp10_igualado_poner(uuid, date, text, date, integer, integer, text) from public, anon;
grant execute on function public.conta_erp10_igualado_poner(uuid, date, text, date, integer, integer, text) to authenticated, service_role;
