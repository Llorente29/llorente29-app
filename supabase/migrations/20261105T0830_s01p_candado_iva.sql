-- supabase/migrations/20261105T0830_s01p_candado_iva.sql
--
-- S01p·13 · El candado, solo para lo que lleva IVA (Julio, 05/11):
--   00:07 «La prohibición la he puesto para evitar modificar IVAs ya
--   presentados; si no los modifican, se pueden poner asientos en meses
--   cerrados». 07:51 «Lo apuntado, en la fecha de pago, no ahora».
-- D tiene que apuntar pagos de julio a septiembre hechos desde la caja, sin
-- IVA, con su fecha real. Como Odoo 18 (bloqueo de ventas, compras, impuestos y
-- libro, por separado), y además lo apuntado tarde queda marcado y va a Diez.
--
-- 1. En un periodo cerrado —mes del corte con Diez («migrated») o cerrado por un
--    impuesto («tax_filed»), lo de antes de imported_until, o un trimestre con
--    el 303 presentado— se crea y se valida un asiento si NO lleva IVA. Lleva IVA
--    (_conta_asiento_lleva_iva) si viene de una factura (recibida, emitida o las
--    ventas del día), o si una línea va a la 472/477 o tiene tipo, base o libro
--    de IVA. Lo que lleva IVA sigue parado, como hoy.
-- 2. Las retenciones, igual: con el 111 o el 115 de su periodo presentado, no
--    entra una línea de la 4751 ni una con retención (tipo, base o modelo).
-- 3. Lo que no se toca nunca: lo traído de Diez (además de no cambiarse ni
--    borrarse, ahora tampoco se anula), lo que lleva IVA, y un ejercicio cerrado
--    (el motivo 4 de validar, que no cambia).
-- 4. Lo apuntado en un periodo cerrado queda en conta_mes_cambio (qué asiento,
--    quién, cuándo y por qué estaba cerrado: «migrated», «tax_filed», «traido» o
--    «iva_presentado»; los de una persona, «manual», como hasta ahora). Y va en
--    el siguiente traspaso a Diez: conta_traspaso_lista recoge también lo
--    validado con fecha de un mes anterior que tenga esa marca y no esté en Diez.
-- 5. El mensaje dice por qué, en palabras de usuario: «No se puede: el IVA del
--    3T de 2026 ya está presentado y este asiento lleva IVA (línea 2, 47200000).»
-- 6. imported_until ya no basta para parar en validar (el motivo «traido» y el
--    «mes_cerrado» pasan a uno solo, «periodo_cerrado»), y el disparador del
--    corte deja pasar lo que apunta una persona (manual, pagos, nómina). Lo
--    automático de antes del corte (banco, ventas, liquidaciones, facturas)
--    sigue parado: lo lleva Diez y se duplicaría. El resto de lectores de
--    imported_until y de conta_mes_cerrado no cambia (el parte lo detalla).
--
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
-- cambia: public._tg_s01p_trimestre_presentado · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
-- cambia: public.tg_journal_entry_no_antes_del_corte · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
-- cambia: public._tg_s01p_mes_cambio · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
-- cambia: public.conta_traspaso_lista · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
-- cambia: public.conta_mes_cambio · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
--   (lock_id admite nulos y una columna nueva, motivo, que admite nulos)
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
--   (un disparador nuevo: lo traído de Diez no se anula)
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
--   (un disparador nuevo: la retención con el 111/115 presentado)
--
-- Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261105T0830_s01p_candado_iva');
select public._respaldar_funcion('public._tg_s01p_trimestre_presentado()', '20261105T0830_s01p_candado_iva');
select public._respaldar_funcion('public.tg_journal_entry_no_antes_del_corte()', '20261105T0830_s01p_candado_iva');
select public._respaldar_funcion('public._tg_s01p_mes_cambio()', '20261105T0830_s01p_candado_iva');
select public._respaldar_funcion('public.conta_traspaso_lista(uuid,date)', '20261105T0830_s01p_candado_iva');

-- ── 1 · Qué lleva IVA y qué lleva retención ────────────────────────────────
-- Los orígenes que siempre llevan IVA: las facturas (recibidas y emitidas) y
-- las ventas (facturas simplificadas). Se sabe ya al crear el asiento.
create or replace function public._conta_origen_con_iva(p_tipo text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_tipo in ('supplier_invoice', 'customer_invoice', 'sales_day', 'sales_adjustment'), false)
$$;
revoke all on function public._conta_origen_con_iva(text) from public, anon;
grant execute on function public._conta_origen_con_iva(text) to authenticated, service_role;

-- Por qué lleva IVA, en palabras de usuario, o null si no lleva. Los de
-- siempre (_conta_iva_exento: traídos, apertura, cierre y la liquidación del
-- 303) no cuentan.
create or replace function public._conta_asiento_lleva_iva(p_entry uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_e record; v_l record;
begin
  select e.company_id, e.source_type, e.source_id into v_e from public.journal_entry e where e.id = p_entry;
  if not found or public._conta_iva_exento(v_e.source_type, v_e.source_id, v_e.company_id) then return null; end if;
  if v_e.source_type = 'supplier_invoice' then return 'viene de una factura recibida'; end if;
  if v_e.source_type = 'customer_invoice' then return 'viene de una factura emitida'; end if;
  if v_e.source_type in ('sales_day', 'sales_adjustment') then return 'son ventas, con su IVA repercutido'; end if;
  select l.position, a.code into v_l
    from public.journal_line l left join public.company_account a on a.id = l.company_account_id
   where l.entry_id = p_entry
     and (l.vat_book is not null or l.tax_rate_id is not null or l.tax_base is not null
          or a.code like '472%' or a.code like '477%')
   order by l.position, l.id limit 1;
  if v_l.position is null and v_l.code is null then return null; end if;
  return format('línea %s, %s', coalesce(v_l.position::text, '?'), coalesce(v_l.code, 'sin cuenta'));
end $$;
revoke all on function public._conta_asiento_lleva_iva(uuid) from public, anon;
grant execute on function public._conta_asiento_lleva_iva(uuid) to authenticated, service_role;

create or replace function public._conta_linea_retencion(p_account uuid, p_rate uuid, p_base numeric, p_model text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_rate is not null or p_base is not null or p_model is not null
      or exists (select 1 from public.company_account a where a.id = p_account and a.code like '4751%')
$$;
revoke all on function public._conta_linea_retencion(uuid, uuid, numeric, text) from public, anon, authenticated;

create or replace function public._conta_asiento_lleva_retencion(p_entry uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_e record; v_l record;
begin
  select e.company_id, e.source_type, e.source_id into v_e from public.journal_entry e where e.id = p_entry;
  if not found or public._conta_iva_exento(v_e.source_type, v_e.source_id, v_e.company_id) then return null; end if;
  select l.position, a.code into v_l
    from public.journal_line l left join public.company_account a on a.id = l.company_account_id
   where l.entry_id = p_entry
     and public._conta_linea_retencion(l.company_account_id, l.withholding_rate_id, l.withholding_base, l.withholding_model)
   order by l.position, l.id limit 1;
  if v_l.position is null and v_l.code is null then return null; end if;
  return format('línea %s, %s', coalesce(v_l.position::text, '?'), coalesce(v_l.code, 'sin cuenta'));
end $$;
revoke all on function public._conta_asiento_lleva_retencion(uuid) from public, anon;
grant execute on function public._conta_asiento_lleva_retencion(uuid) to authenticated, service_role;

-- El 111 o el 115 presentado del periodo de esa fecha (como conta_iva_presentado).
create or replace function public._conta_retenciones_presentado(p_company uuid, p_fecha date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'modelo', r.form_code, 'ejercicio', r.fiscal_year, 'periodo', r.period,
                            'desde', f.desde, 'hasta', f.hasta)
    from public.tax_return r
   cross join lateral public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) f
   where p_fecha is not null and r.company_id = p_company and r.form_code in ('111', '115')
     and r.fiscal_year = extract(year from p_fecha)::int
     and r.period ~ '^([1-4]T|0[1-9]|1[0-2])$'
     and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
     and p_fecha between f.desde and f.hasta
   order by r.form_code, r.sequence desc, r.filed_at desc nulls last
   limit 1
$$;
revoke all on function public._conta_retenciones_presentado(uuid, date) from public, anon, authenticated;
grant execute on function public._conta_retenciones_presentado(uuid, date) to service_role;

-- ── 2 · Lo que admite un periodo cerrado, con su porqué ─────────────────────
-- null: el periodo admite el asiento (o no está cerrado). Si no, el mensaje.
create or replace function public._conta_periodo_admite(p_entry uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_e public.journal_entry; v_y public.fiscal_year; v_traido boolean; v_mes boolean; v_iva jsonb; v_ret jsonb; v_t text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or v_e.source_type in ('migrated', 'opening', 'closing') then return null; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_e.account_id) then return null; end if;
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  v_traido := v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until;
  v_mes := public.conta_mes_cerrado(v_e.company_id, v_e.entry_date);
  v_iva := public.conta_iva_presentado(v_e.company_id, v_e.entry_date);
  if v_traido or v_mes or v_iva is not null then
    v_t := public._conta_asiento_lleva_iva(v_e.id);
    if v_t is not null then
      if v_iva is not null then
        return format('No se puede: el IVA %s ya está presentado y este asiento lleva IVA (%s).',
                      public.conta_iva_periodo_frase('de', v_iva->>'periodo', (v_iva->>'ejercicio')::int), v_t);
      end if;
      return format('No se puede: el mes de %s está cerrado%s y este asiento lleva IVA (%s).',
                    to_char(v_e.entry_date, 'MM/YYYY'),
                    case when v_traido then format(' (hasta el %s lo lleva %s)', to_char(v_y.imported_until, 'DD/MM/YYYY'),
                                                   case when lower(v_y.origin_program) = 'diez' then 'Diez' else coalesce(v_y.origin_program, 'la contabilidad de antes') end)
                         else '' end, v_t);
    end if;
  end if;
  v_ret := public._conta_retenciones_presentado(v_e.company_id, v_e.entry_date);
  if v_ret is not null then
    v_t := public._conta_asiento_lleva_retencion(v_e.id);
    if v_t is not null then
      return format('No se puede: el %s %s ya está presentado y este asiento lleva retención (%s).',
                    v_ret->>'modelo', public.conta_iva_periodo_frase('de', v_ret->>'periodo', (v_ret->>'ejercicio')::int), v_t);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._conta_periodo_admite(uuid) from public, anon;
grant execute on function public._conta_periodo_admite(uuid) to authenticated, service_role;

-- Validar: los motivos 6 («traido») y 7 («mes_cerrado») pasan a uno solo,
-- «periodo_cerrado», que solo para lo que lleva IVA o retención. Reemplazo
-- exacto del trozo, medido en producción (huella de la función entera
-- 3f7ee5dbee6904c7c5cf892696f71c3f, igual en staging y en la base local).
do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo text := $viejo$    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      orden := 6; codigo := 'traido';
      motivo := format('Hasta el %s el ejercicio %s es traído de %s: la fecha abierta más cercana es el %s.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY')); return next;
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      orden := 7; codigo := 'mes_cerrado';
      motivo := format('El mes de %s está cerrado: la fecha abierta más cercana es el %s.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna')); return next;
    end if;
$viejo$;
  v_nuevo text := $nuevo$    -- S01p·13: un periodo cerrado (el corte con Diez, un mes cerrado por un
    -- impuesto, un trimestre con el 303 presentado) admite lo que no lleva IVA
    -- ni retención presentada. El porqué, en _conta_periodo_admite.
    motivo := public._conta_periodo_admite(v_e.id);
    if motivo is not null then
      orden := 6; codigo := 'periodo_cerrado'; return next;
    end if;
$nuevo$;
begin
  if strpos(v_def, 'public._conta_periodo_admite(v_e.id)') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·13: conta_motivos_para_validar no es la medida (el trozo de los motivos 6 y 7 no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- ── 3 · Crear: el trimestre presentado y el corte, solo para lo que lleva IVA ──
create or replace function public._tg_s01p_trimestre_presentado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_p jsonb;
begin
  if tg_op = 'UPDATE' and new.entry_date is not distinct from old.entry_date then return new; end if;
  if public._conta_iva_exento(new.source_type, new.source_id, new.company_id) then return new; end if;
  v_p := public.conta_iva_presentado(new.company_id, new.entry_date);
  if v_p is null then return new; end if;
  -- S01p·13: lo que no lleva IVA entra (queda marcado en conta_mes_cambio).
  if not public._conta_origen_con_iva(new.source_type)
     and not (tg_op = 'UPDATE' and public._conta_asiento_lleva_iva(new.id) is not null) then
    return new;
  end if;
  raise exception '%', public.conta_iva_presentado_mensaje(new.company_id, v_p,
                         case when new.source_type = 'supplier_invoice' then 'factura' else 'corregir' end)
    using errcode = '23514', hint = 'iva_presentado';
end $$;
revoke all on function public._tg_s01p_trimestre_presentado() from public, anon, authenticated;

create or replace function public.tg_journal_entry_no_antes_del_corte()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_corte date;
begin
  if new.source_type in ('migrated', 'opening', 'closing') then return new; end if;
  if tg_op = 'UPDATE' and new.entry_date is not distinct from old.entry_date then return new; end if;
  v_corte := public._conta_corte(new.company_id);
  if v_corte is null or new.entry_date >= v_corte then return new; end if;
  -- S01p·13: lo que apunta una persona (un asiento a mano, un pago, una nómina)
  -- entra con su fecha real si no lleva IVA; queda marcado y va a Diez en el
  -- siguiente traspaso. Lo automático (banco, ventas, liquidaciones, facturas)
  -- sigue parado: ese periodo ya lo tiene Diez y se duplicaría.
  if new.source_type in ('manual', 'supplier_payment', 'customer_payment', 'payroll')
     and not (tg_op = 'UPDATE' and public._conta_asiento_lleva_iva(new.id) is not null) then
    return new;
  end if;
  raise exception using errcode = '23514', message = format('No se apunta: el día %s es de antes del corte (%s). Ese periodo lo lleva %s.',
    to_char(new.entry_date, 'DD/MM/YYYY'), to_char(v_corte, 'DD/MM/YYYY'),
    case when exists (select 1 from public.fiscal_year y where y.company_id = new.company_id and y.origin_program = 'diez') then 'Diez' else 'la contabilidad de antes' end);
end $$;

-- La retención con el 111 o el 115 de su periodo presentado no entra.
create or replace function public._conta_retencion_candado_apunte()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e record; v_p jsonb; v_cod text;
begin
  if not public._conta_linea_retencion(new.company_account_id, new.withholding_rate_id, new.withholding_base, new.withholding_model)
     and not (tg_op = 'UPDATE' and public._conta_linea_retencion(old.company_account_id, old.withholding_rate_id, old.withholding_base, old.withholding_model)) then
    return new;
  end if;
  select e.company_id, e.entry_date, e.source_type, e.source_id into v_e from public.journal_entry e where e.id = new.entry_id;
  if not found or public._conta_iva_exento(v_e.source_type, v_e.source_id, v_e.company_id) then return new; end if;
  v_p := public._conta_retenciones_presentado(v_e.company_id, v_e.entry_date);
  if v_p is null then return new; end if;
  select a.code into v_cod from public.company_account a where a.id = new.company_account_id;
  raise exception '%', format('No se puede: el %s %s ya está presentado y este apunte lleva retención (línea %s, %s).',
                              v_p->>'modelo', public.conta_iva_periodo_frase('de', v_p->>'periodo', (v_p->>'ejercicio')::int),
                              coalesce(new.position::text, '?'), coalesce(v_cod, 'sin cuenta'))
    using errcode = '23514', hint = 'retenciones_presentadas';
end $$;
revoke all on function public._conta_retencion_candado_apunte() from public, anon, authenticated;
drop trigger if exists trg_journal_line_0_retencion_presentada on public.journal_line;
create trigger trg_journal_line_0_retencion_presentada
  before insert or update on public.journal_line
  for each row execute function public._conta_retencion_candado_apunte();

-- Lo traído de Diez no se anula en Sumied (ya no se cambia ni se borra).
create or replace function public._tg_s01p_traido_no_se_anula()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo anular: cambiar o borrar uno validado ya lo para journal_entry_inalterable, y la
  -- importación de Diez tiene que poder dejarlos validados.
  if old.source_type = 'migrated' and old.status = 'validado' and new.status = 'anulado' then
    raise exception 'Este asiento es traído de %: no se anula ni se cambia en Sumied. Se corrige allí.',
                    case when lower(coalesce(old.external_program, 'diez')) = 'diez' then 'Diez' else old.external_program end
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public._tg_s01p_traido_no_se_anula() from public, anon, authenticated;
drop trigger if exists trg_journal_entry_0_traido_no_se_anula on public.journal_entry;
create trigger trg_journal_entry_0_traido_no_se_anula
  before update of status on public.journal_entry
  for each row execute function public._tg_s01p_traido_no_se_anula();

-- ── 4 · Lo apuntado en un periodo cerrado queda marcado ─────────────────────
alter table public.conta_mes_cambio alter column lock_id drop not null;
alter table public.conta_mes_cambio add column if not exists motivo text;
comment on column public.conta_mes_cambio.motivo is
  'S01p·13 · Por qué estaba cerrado: el tipo de candado del mes (manual, migrated, tax_filed), o sin candado: traido (antes de imported_until) o iva_presentado (trimestre con el 303 presentado).';

create or replace function public._tg_s01p_mes_cambio()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_l public.fiscal_period_lock; v_imp numeric; v_que text; v_mes date; v_dia date; v_motivo text; v_y public.fiscal_year;
begin
  for v_que, v_mes, v_dia in
    select x.que, date_trunc('month', x.dia)::date, x.dia from (values
      -- Validado o anulado en un mes cerrado.
      (case when tg_op = 'INSERT' and new.status = 'validado' then 'validado'
            when tg_op = 'UPDATE' and new.status = 'validado' and old.status is distinct from 'validado' then 'validado'
            when tg_op = 'UPDATE' and new.status = 'anulado' and old.status = 'validado' then 'anulado' end,
       new.entry_date),
      -- Un validado que cambia de fecha: entra en un mes cerrado o sale de él.
      (case when tg_op = 'UPDATE' and new.status = 'validado' and old.status = 'validado'
                 and date_trunc('month', new.entry_date) <> date_trunc('month', old.entry_date) then 'entra' end,
       new.entry_date),
      (case when tg_op = 'UPDATE' and new.status = 'validado' and old.status = 'validado'
                 and date_trunc('month', new.entry_date) <> date_trunc('month', old.entry_date) then 'sale' end,
       old.entry_date)) x(que, dia)
     where x.que is not null
  loop
    v_l := null; v_motivo := null;
    select * into v_l from public.fiscal_period_lock
     where company_id = new.company_id and month = v_mes and reopened_at is null
     order by (kind = 'manual') desc, locked_at desc nulls last limit 1;
    if v_l.id is not null and v_l.kind = 'manual' then
      v_motivo := 'manual';
    elsif new.source_type in ('migrated', 'opening', 'closing') then
      continue;   -- S01p·13: lo traído y los de apertura y cierre no son «apuntado tarde».
    elsif v_l.id is not null then
      v_motivo := v_l.kind;
    else
      select * into v_y from public.fiscal_year where company_id = new.company_id and v_dia between starts_on and ends_on;
      if v_y.imported_until is not null and v_dia <= v_y.imported_until then v_motivo := 'traido';
      elsif public.conta_iva_presentado(new.company_id, v_dia) is not null then v_motivo := 'iva_presentado';
      end if;
    end if;
    continue when v_motivo is null;
    select coalesce(sum(l.debit), 0) into v_imp from public.journal_line l where l.entry_id = new.id;
    insert into public.conta_mes_cambio (account_id, company_id, lock_id, month, entry_id, que, importe, concepto, hecho_por, hecho_por_nombre, motivo)
    values (new.account_id, new.company_id, v_l.id, v_mes, new.id, v_que, v_imp, left(new.concept, 200), auth.uid(),
            coalesce(new.validated_by_name, public.conta_nombre_actor()), v_motivo);
  end loop;
  return null;
end $$;
revoke all on function public._tg_s01p_mes_cambio() from public, anon, authenticated;

-- ── 5 · Y va a Diez en el siguiente traspaso ────────────────────────────────
-- Lo del mes, como hasta ahora, y además lo validado con fecha de un mes
-- anterior que quedó marcado en conta_mes_cambio (validado o entra) y aún no
-- está en Diez. Va en el traspaso del mes de antes de marcarse o en uno
-- posterior (no en uno más viejo, que ya no corre).
create or replace function public.conta_traspaso_lista(p_company uuid, p_mes date)
returns table(entry_id uuid, orden integer, tipo text)
language sql stable security definer set search_path = public as $$
  select e.id, (row_number() over (order by e.entry_date, (e.reverses_entry_id is not null), e.number nulls last, e.id))::int,
         case when e.source_type = 'reversal' then 'anulacion'
              when e.source_type = 'sales_day' then 'ventas'
              when e.source_type = 'supplier_invoice' then 'recibidas'
              when e.source_type = 'bank' then 'banco'
              when e.source_type in ('channel_settlement', 'licensed_settlement') then 'liquidaciones'
              else 'manuales' end
    from public.journal_entry e
   where e.company_id = p_company
     and ((e.entry_date >= date_trunc('month', p_mes)::date
           and e.entry_date < (date_trunc('month', p_mes) + interval '1 month')::date)
          -- S01p·13: lo apuntado tarde en un mes ya cerrado.
          or (e.entry_date < date_trunc('month', p_mes)::date
              and exists (select 1 from public.conta_mes_cambio c
                           where c.company_id = e.company_id and c.entry_id = e.id and c.que in ('validado', 'entra')
                             and c.hecho_at < (date_trunc('month', p_mes) + interval '2 months'))))
     and public._conta_traspaso_va(e.id)
   order by 2
$$;
revoke execute on function public.conta_traspaso_lista(uuid, date) from public, anon, authenticated;
grant execute on function public.conta_traspaso_lista(uuid, date) to service_role;
