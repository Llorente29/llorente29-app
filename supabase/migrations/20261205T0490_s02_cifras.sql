-- supabase/migrations/20261205T0490_s02_cifras.sql
-- cambia: public.conta_impuesto_calendario · prueba: supabase/staging/sql/20261205_s02_cifras_prueba.sql
--
-- S02 · PR 3 · LAS CIFRAS: UNA FUENTE POR CONCEPTO (Julio, 22/10).
--
-- La barra, las pestañas, el «Te toca hoy», el «Pendiente de ti», Inicio,
-- Bancos, Contactos e Impuestos contaban lo mismo con varas distintas: la
-- barra de Compras decía 9 y su pantalla 0; Inicio decía «Debes 43.148,20» y
-- Contactos «Nada pendiente»; Inicio −128,36 en el banco y Bancos −4.168,84;
-- Impuestos «Este mes · Todo presentado» bajo «Diciembre» el 22/10. Aquí, una
-- función por concepto, en la base; el front lee la misma fila en todos los
-- sitios (diagnóstico: p1_cifras.md; contrato: pr3_contrato.md).
--
--   1. conta_pendientes(empresa) → jsonb                               [NUEVA]
--      Lo que espera una acción de una persona, contado UNA vez, con la vara
--      de la pantalla a la que lleva:
--        compras_decidir       SIEMPRE null en esta versión: las filas de
--                              «Qué tienes que mirar» las agrupa el cliente con
--                              agruparAMirar (lib/compras.ts), que normaliza
--                              nombres (normaNombre: NFKD, formas jurídicas…)
--                              y eso no se replica en SQL sin inventar otra
--                              vara. Van crudas en compras_filas: lo que
--                              devuelve compras_mirar(cuenta de la empresa),
--                              tal cual (POR CUENTA, como la pantalla de
--                              Compras, que es por cuenta: filtrarlo por
--                              empresa haría que la barra contara otra cosa que
--                              la pantalla, la regla 7 del revés; sin_camino y
--                              fichas no tienen empresa). El número es
--                              agruparAMirar(compras_filas).length.
--        facturas_para_mirar   conta_documentos_recibidos(empresa, los 12
--        facturas_por_aclarar  meses de ventanaParaRevisar) con tipo factura
--                              y estado para_mirar / por_aclarar: la misma
--                              llamada que la pantalla de Facturas recibidas.
--        asientos_por_validar  journal_entry propuesto|borrador de la empresa,
--                              menos lo propuesto que se decide en su sitio
--                              (supplier_invoice → Compras, bank → Bancos:
--                              SE_DECIDE_EN de lib/diario.ts), menos lo que
--                              espera (conta_esperan).
--        bancos_confirmar      bank_movement propuesto;
--        bancos_aclarar        por_aclarar, pendiente o posible_repetido (bandejaDe
--                              de lib/conciliarVista.ts);
--        bancos_validar        casado con su bank_match vivo cuyo asiento está
--                              propuesto (porValidar). Los tres con account_id
--                              Y company_id (regla 9).
--      Un número que no se ha podido contar es null, nunca 0 (M01). Contactos
--      (430 sin revisar y acuerdos sin socio) sigue contado en el cliente: la
--      regla hecha() vive en lib/revision430.ts.
--   2. conta_saldo_bancos(empresa, hasta) → una fila por banco          [NUEVA]
--      treasury_account kind bank y activa, con su 572 (company_account_link
--      bank_account/principal, como bancosDeLaEmpresa):
--        libro_validado   la 572 con lo validado|anulado (journal_ledger), con
--                         conta_saldos_cuentas desde el día 1 del mes de
--                         «hasta», como Inicio (inicial+apertura+periodo+
--                         regularización); null si el banco no tiene 572;
--        libro_propuesto  lo que suman los asientos propuestos en esa 572
--                         hasta «hasta» (lo que Bancos sumaba sin decirlo);
--        extracto_saldo / extracto_hasta  el closing_balance y el period_to
--                         del último extracto con saldo hasta «hasta»;
--        sin_casar / sin_casar_n  los movimientos sin casar (ni ignorados ni
--                         de antes del corte) hasta la fecha del extracto (o
--                         hasta «hasta» si no hay extracto).
--   3. conta_saldos_terceros(empresa, hasta) → una fila por subcuenta   [NUEVA]
--      El saldo DEL LIBRO (la misma vara que Inicio) de cada subcuenta 40,
--      41, 43 y 44 con saldo, partido en deudor y acreedor, con su grupo:
--        cliente        43 y 44;
--        anticipo       407 (es un ACTIVO: fuera de «Debes»);
--        por_localizar  la 40/41 que se llama «… por localizar» (medido el
--                       22/10 en TODA la base: una sola, la 40000099 de
--                       Foodint, «Proveedores · FACTURAS POR LOCALIZAR»);
--        proveedor      el resto de 40 (hoy solo hay 400 en Foodint);
--        acreedor       41 (hoy solo 410).
--      party_id: el contacto de la subcuenta por su enlace, como la ficha de
--      contacto (tercerosService.cuentasDeTercero): customer principal o
--      liquidacion → el party; supplier principal o pago → el party de su
--      party_role supplier. Sin enlace, null.
--   4. conta_impuesto_calendario                     [CAMBIA, misma firma]
--      La ventana es el mes del primer plazo con presentacion >= hoy que NO
--      está «No hace falta» (tax_return not_required). Antes saltaba al 202 3P
--      de diciembre, que no hay que presentar. Y lo que no hace falta y vence
--      entre hoy y la ventana sigue en «filas» (regla 7: no desaparece), con
--      su declaración not_required y su porqué, como ya salen los vencidos
--      del último mes (I01h): el front ya pinta esas filas («No hay que
--      presentarlo: …»); «siguiente» no lleva estado y no se toca. Lo demás,
--      byte a byte el de producción (la 0340; md5 del cuerpo 480da33a…,
--      medido el 22/10).
--
-- Permisos: las tres nuevas son security invoker (como conta_saldos_cuentas y
-- bank_saldos_cuentas): leen con los permisos de quien llama, y además
-- comprueban que la empresa es de una cuenta suya (belongs_to_account, como
-- compras_mirar y conta_documentos_recibidos, a las que conta_pendientes
-- llama y que son definer con esa misma comprobación). Solo con sesión:
-- ni public ni anon.
--
-- Solo lee: ninguna de las cuatro escribe. No toca ninguna fila al aplicarse.
-- Nada del camino del pedido (ni lo lee ni lo llama). No toca coste ni stock.

-- ── 1. Lo que espera una acción de una persona ──────────────────────────────
create or replace function public.conta_pendientes(p_company uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_acc uuid;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_mirar jsonb;
  v_docs jsonb;
  v_para int; v_por int; v_asientos int; v_confirmar int; v_aclarar int; v_validar int;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;

  -- Compras: las filas crudas de «Qué tienes que mirar» (las agrupa el cliente).
  begin
    v_mirar := public.compras_mirar(v_acc);
  exception when others then v_mirar := null;
  end;

  -- Facturas recibidas: la misma llamada que su pantalla, los 12 meses de ventanaParaRevisar.
  begin
    v_docs := public.conta_documentos_recibidos(p_company,
                (date_trunc('month', v_hoy) - interval '11 months')::date,
                (date_trunc('month', v_hoy) + interval '1 month' - interval '1 day')::date);
    select count(*) filter (where f->>'estado' = 'para_mirar'), count(*) filter (where f->>'estado' = 'por_aclarar')
      into v_para, v_por
      from jsonb_array_elements(v_docs->'filas') f
     where f->>'tipo' = 'factura';
  exception when others then v_para := null; v_por := null;
  end;

  -- Asientos: lo de «Para revisar», menos lo que se decide en su sitio y lo que espera.
  begin
    with esperan as materialized (
      select distinct w.entry_id from public.conta_esperan(p_company, date '1900-01-01', date '2999-12-31') w
    )
    select count(*) into v_asientos
      from public.journal_entry e
     where e.account_id = v_acc and e.company_id = p_company
       and e.status in ('propuesto', 'borrador')
       and not (e.status = 'propuesto' and e.source_type in ('supplier_invoice', 'bank'))
       and not exists (select 1 from esperan w where w.entry_id = e.id);
  exception when others then v_asientos := null;
  end;

  -- Bancos: las bandejas de Movimientos.
  begin
    select count(*) filter (where m.status = 'propuesto'),
           count(*) filter (where m.status in ('por_aclarar', 'pendiente', 'posible_repetido'))
      into v_confirmar, v_aclarar
      from public.bank_movement m
     where m.account_id = v_acc and m.company_id = p_company;
    select count(*) into v_validar
      from public.bank_movement m
     where m.account_id = v_acc and m.company_id = p_company and m.status = 'casado'
       and exists (select 1 from public.bank_match b join public.journal_entry e on e.id = b.journal_entry_id
                    where b.movement_id = m.id and b.account_id = v_acc and b.company_id = p_company
                      and b.status = 'vivo' and e.status = 'propuesto');
  exception when others then v_confirmar := null; v_aclarar := null; v_validar := null;
  end;

  return jsonb_build_object(
    'compras_decidir', null,
    'compras_filas', v_mirar,
    'facturas_para_mirar', v_para,
    'facturas_por_aclarar', v_por,
    'asientos_por_validar', v_asientos,
    'bancos_confirmar', v_confirmar,
    'bancos_aclarar', v_aclarar,
    'bancos_validar', v_validar);
end $$;

comment on function public.conta_pendientes(uuid) is
  'S02 · PR 3 (0490). Solo lee. Lo que espera una acción de una persona en una empresa, contado una vez con la vara de su pantalla: compras_filas (compras_mirar crudo; compras_decidir lo agrupa el cliente con agruparAMirar, por eso va null), facturas_para_mirar y facturas_por_aclarar (conta_documentos_recibidos, 12 meses), asientos_por_validar (propuesto|borrador menos lo que se decide en su sitio y lo que espera), bancos_confirmar, bancos_aclarar y bancos_validar. Null = no se ha podido contar.';

-- ── 2. El saldo de cada banco: el libro y el extracto, por separado ─────────
create or replace function public.conta_saldo_bancos(p_company uuid, p_hasta date)
returns table (treasury_account_id uuid, nombre text, cuenta text,
               libro_validado numeric, libro_propuesto numeric,
               extracto_saldo numeric, extracto_hasta date,
               sin_casar numeric, sin_casar_n int)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare v_acc uuid;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if p_hasta is null then
    raise exception 'Falta la fecha.' using errcode = '22023';
  end if;

  return query
  with s as (
    -- La misma vara que Inicio: conta_saldos_cuentas desde el día 1 del mes.
    select x.company_account_id,
           sum(x.inicial_debe - x.inicial_haber + x.apertura_debe - x.apertura_haber
               + x.periodo_debe - x.periodo_haber + x.regularizacion_debe - x.regularizacion_haber) as saldo
      from public.conta_saldos_cuentas(p_company, date_trunc('month', p_hasta)::date, p_hasta) x
     where x.code like '572%'
     group by x.company_account_id
  ), b as (
    select t.id, t.name, ca.id as ca_id, ca.code
      from public.treasury_account t
      left join lateral (select l.company_account_id from public.company_account_link l
                          where l.account_id = v_acc and l.company_id = p_company and l.entity = 'bank_account'
                            and l.role = 'principal' and l.entity_id = t.id::text
                          order by l.created_at limit 1) l on true
      left join public.company_account ca on ca.id = l.company_account_id and ca.account_id = v_acc and ca.company_id = p_company
     where t.account_id = v_acc and t.company_id = p_company and t.kind = 'bank' and t.is_active
  )
  select b.id, b.name, b.code,
         case when b.ca_id is null then null else round(coalesce(s.saldo, 0), 2) end,
         case when b.ca_id is null then null else round(coalesce((
           select sum(jl.debit - jl.credit) from public.journal_line jl join public.journal_entry e on e.id = jl.entry_id
            where jl.account_id = v_acc and jl.company_id = p_company and jl.company_account_id = b.ca_id
              and e.status = 'propuesto' and e.entry_date <= p_hasta and e.source_type <> 'closing'), 0), 2) end,
         st.closing_balance, st.period_to,
         round(coalesce(m.importe, 0), 2), coalesce(m.n, 0)::int
    from b
    left join s on s.company_account_id = b.ca_id
    left join lateral (select bs.closing_balance, bs.period_to from public.bank_statement bs
                        where bs.account_id = v_acc and bs.company_id = p_company and bs.treasury_account_id = b.id
                          and bs.period_to <= p_hasta and bs.closing_balance is not null
                        order by bs.period_to desc, bs.imported_at desc limit 1) st on true
    left join lateral (select sum(bm.amount) as importe, count(*) as n from public.bank_movement bm
                        where bm.account_id = v_acc and bm.company_id = p_company and bm.treasury_account_id = b.id
                          and bm.status not in ('casado', 'ignorado', 'antes_corte_sin_pareja') and not bm.before_cutover
                          and bm.op_date <= coalesce(st.period_to, p_hasta)) m on true
   order by b.code nulls last, b.name;
end $$;

comment on function public.conta_saldo_bancos(uuid, date) is
  'S02 · PR 3 (0490). Solo lee. Una fila por banco activo de la empresa: su 572, lo validado en ella (la vara de Inicio: conta_saldos_cuentas desde el día 1 del mes), lo propuesto aparte, el último extracto con saldo hasta la fecha y lo sin casar hasta la fecha del extracto. Inicio y Bancos leen la misma fila.';

-- ── 3. Lo que se debe y te deben, del libro, por subcuenta ──────────────────
create or replace function public.conta_saldos_terceros(p_company uuid, p_hasta date)
returns table (cuenta text, nombre text, party_id uuid, grupo text, saldo_deudor numeric, saldo_acreedor numeric)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare v_acc uuid;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if p_hasta is null then
    raise exception 'Falta la fecha.' using errcode = '22023';
  end if;

  return query
  with s as (
    -- La misma vara que Inicio: conta_saldos_cuentas desde el día 1 del mes.
    select x.company_account_id,
           round(sum(x.inicial_debe - x.inicial_haber + x.apertura_debe - x.apertura_haber
                     + x.periodo_debe - x.periodo_haber + x.regularizacion_debe - x.regularizacion_haber), 2) as saldo
      from public.conta_saldos_cuentas(p_company, date_trunc('month', p_hasta)::date, p_hasta) x
     where x.code ~ '^4[0134]'
     group by x.company_account_id
  )
  select ca.code, coalesce(ca.plain_name, ca.name),
         coalesce(
           (select p.id from public.company_account_link l join public.party p on p.account_id = v_acc and p.id::text = l.entity_id
             where l.account_id = v_acc and l.company_id = p_company and l.company_account_id = ca.id
               and l.entity = 'customer' and l.role in ('principal', 'liquidacion')
             order by (l.role = 'principal') desc, l.created_at limit 1),
           (select pr.party_id from public.company_account_link l join public.party_role pr
                on pr.account_id = v_acc and pr.role = 'supplier' and pr.supplier_id::text = l.entity_id
             where l.account_id = v_acc and l.company_id = p_company and l.company_account_id = ca.id
               and l.entity = 'supplier' and l.role in ('principal', 'pago')
             order by (l.role = 'principal') desc, l.created_at, pr.created_at limit 1)),
         case when left(ca.code, 2) in ('43', '44') then 'cliente'
              when left(ca.code, 3) = '407' then 'anticipo'
              when coalesce(ca.plain_name, ca.name) ilike '%por localizar%' then 'por_localizar'
              when left(ca.code, 2) = '40' then 'proveedor'
              else 'acreedor' end,
         greatest(s.saldo, 0), greatest(-s.saldo, 0)
    from s
    join public.company_account ca on ca.id = s.company_account_id and ca.account_id = v_acc and ca.company_id = p_company
   where s.saldo <> 0
   order by ca.code;
end $$;

comment on function public.conta_saldos_terceros(uuid, date) is
  'S02 · PR 3 (0490). Solo lee. El saldo del libro (la vara de Inicio) de cada subcuenta 40/41/43/44 con saldo, en deudor y acreedor, con su grupo (cliente 43/44, anticipo 407, por_localizar, proveedor 40, acreedor 41) y su contacto por company_account_link. «Te deben» = deudor de cliente; «Debes» = acreedor de proveedor y acreedor.';

-- Solo con sesión (y el servidor): ni public ni anon.
revoke all on function public.conta_pendientes(uuid) from public, anon;
revoke all on function public.conta_saldo_bancos(uuid, date) from public, anon;
revoke all on function public.conta_saldos_terceros(uuid, date) from public, anon;
grant execute on function public.conta_pendientes(uuid) to authenticated, service_role;
grant execute on function public.conta_saldo_bancos(uuid, date) to authenticated, service_role;
grant execute on function public.conta_saldos_terceros(uuid, date) to authenticated, service_role;

-- ── 4. El calendario de impuestos: la ventana salta lo que no hace falta ────
create or replace function public.conta_impuesto_calendario(p_company uuid, p_hoy date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_y int := extract(year from coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date))::int;
  v_desde date; v_ventana date; v_filas jsonb; v_siguiente jsonb; v_reglas jsonb; v_no jsonb; v_pres jsonb;
begin
  if not exists (select 1 from public.company where id = p_company) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;

  select min(valid_from) into v_desde from public.tax_obligation where company_id = p_company and valid_to is null and active;

  -- La ventana: el mes del próximo plazo de presentación que hay que presentar.
  -- S02 · PR 3 (0490): lo que está «No hace falta» (not_required) no la abre;
  -- antes, el 202 3P de diciembre a cero la llevaba a diciembre el 22/10.
  select date_trunc('month', min(c.presentacion))::date into v_ventana
    from public.conta_impuesto_periodos(p_company, v_y) c
    left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                  and r.period = c.periodo and r.sequence = 1
   where c.presentacion >= v_hoy and coalesce(r.status, 'pending') <> 'not_required';

  with d as (
    select c.*, r.id as rid, r.status, r.result_kind, r.amount, r.previous_period_amount, r.not_required_reason,
           coalesce(r.payment_mode, case when c.pago = 'direct_debit' then 'direct_debit' end) as pago_real,
           coalesce(r.payment_treasury_account_id, c.cuenta) as cuenta_real,
           r.filed_at, r.filed_via, r.due_date
      from public.conta_impuesto_periodos(p_company, v_y) c
      left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'obligacion', d.obligacion, 'modelo', d.modelo, 'nombre', f.name, 'cadencia', d.cadencia,
           'ejercicio', d.ejercicio, 'periodo', d.periodo,
           'presentacion', d.presentacion, 'domiciliacion', d.domiciliacion, 'provisional', d.provisional,
           'atrasado', d.presentacion < v_hoy,
           'domicilia', coalesce(d.pago_real = 'direct_debit', false),
           'cuenta_final', (select right(t.iban, 4) from public.treasury_account t where t.id = d.cuenta_real and t.company_id = p_company),
           'se_calcula', d.modelo = '303',
           'declaracion', case when d.rid is null then null else jsonb_build_object(
             'id', d.rid, 'estado', d.status, 'estado_texto', public.conta_impuesto_estado_texto(d.status),
             'resultado', d.result_kind, 'importe', d.amount, 'anterior', d.previous_period_amount,
             'no_hace_falta', d.not_required_reason,
             'presentada', d.filed_at, 'por', d.filed_via,
             'errores', (select count(*) from public.tax_return_check k where k.tax_return_id = d.rid and k.result = 'error'),
             'avisos', (select count(*) from public.tax_return_check k where k.tax_return_id = d.rid and k.result = 'warning' and k.accepted_at is null),
             'aviso', (select k.title from public.tax_return_check k where k.tax_return_id = d.rid and k.result in ('error', 'warning') and k.accepted_at is null
                        order by (k.result = 'error') desc, k.checked_at limit 1),
             'cuadra', exists (select 1 from public.tax_return_check k where k.tax_return_id = d.rid and k.check_key = 'book_vs_303' and k.result = 'ok')
                   and exists (select 1 from public.tax_return_check k where k.tax_return_id = d.rid and k.check_key = 'ledger_477_472' and (k.result = 'ok' or k.accepted_at is not null))) end
         ) order by d.presentacion, d.modelo, d.ejercicio, d.periodo), '[]')
    into v_filas
    from d join public.tax_form f on f.code = d.modelo
   where (v_ventana is not null and date_trunc('month', d.presentacion)::date = v_ventana)
      -- Lo de antes que no se ha presentado: desde que lleva aquí sus impuestos, o si tiene declaración.
      or (d.presentacion < v_hoy
          and coalesce(d.status, 'pending') in ('pending', 'draft', 'reviewed')
          and (d.rid is not null or (v_desde is not null and d.presentacion >= v_desde)))
      -- I01h · Lo que no hacía falta presentar y venció hace poco (el último mes): se
      -- enseña con su porqué, para que no desaparezca sin decir nada (Julio, 21/10).
      or (d.presentacion < v_hoy and d.status = 'not_required' and d.presentacion >= v_hoy - 31)
      -- S02 · PR 3 (0490) · Lo que no hace falta presentar y vence ANTES de la
      -- ventana (que ya no se abre por ello): sale igual, con su porqué, para
      -- que no desaparezca (regla 7). El 202 3P de diciembre, el 22/10.
      or (d.presentacion >= v_hoy and d.status = 'not_required' and (v_ventana is null or d.presentacion < v_ventana));

  -- Lo siguiente: los plazos de después de la ventana, hasta un año.
  select coalesce(jsonb_agg(jsonb_build_object('modelo', c.modelo, 'nombre', f.name, 'cadencia', c.cadencia, 'ejercicio', c.ejercicio,
                                               'periodo', c.periodo, 'presentacion', c.presentacion, 'domiciliacion', c.domiciliacion)
                            order by c.presentacion, c.modelo), '[]')
    into v_siguiente
    from public.conta_impuesto_periodos(p_company, v_y) c join public.tax_form f on f.code = c.modelo
   where v_ventana is not null and c.presentacion >= (v_ventana + interval '1 month')::date
     and c.presentacion < (v_ventana + interval '1 year')::date;

  -- Los presentados del año: los periodos con plazo en el año que ya han vencido
  -- (desde que lleva aquí sus impuestos, o con declaración), y cuántos están presentados.
  with v as (
    select c.*, r.id as rid, r.status, r.filed_at, r.due_date
      from public.conta_impuesto_periodos(p_company, v_y) c
      left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
     where extract(year from c.presentacion) = v_y
       and (c.presentacion < v_hoy or r.filed_at is not null)
       and coalesce(r.status, 'pending') <> 'not_required'
       and (r.id is not null or (v_desde is not null and c.presentacion >= v_desde))
  )
  select jsonb_build_object('ano', v_y, 'desde', v_desde,
           'vencidos', count(*),
           'presentados', count(*) filter (where status in ('filed', 'booked', 'paid', 'offset', 'refunded')),
           'en_plazo', count(*) filter (where filed_at is not null and (filed_at at time zone 'Europe/Madrid')::date <= presentacion),
           'contabilizados', count(*) filter (where status in ('booked', 'paid', 'offset', 'refunded')))
    into v_pres from v;

  -- Por qué le sale cada modelo, y los que no.
  select coalesce(jsonb_agg(jsonb_build_object('modelo', o2.form_code, 'nombre', f.name, 'por_que', o2.why, 'origen', o2.origin,
                                               'cadencia', o2.cadence, 'quien', o2.decided_by_name, 'cuando', o2.decided_at)
                            order by o2.form_code) filter (where o2.active), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('modelo', o2.form_code, 'nombre', f.name, 'por_que', o2.why, 'origen', o2.origin)
                            order by o2.form_code) filter (where not o2.active), '[]')
    into v_reglas, v_no
    from public.tax_obligation o2 join public.tax_form f on f.code = o2.form_code
   where o2.company_id = p_company and o2.valid_to is null;
  -- 0250: y las reglas que dicen que no y nunca se escribieron (calcular no
  -- escribe una regla inactiva sin fila previa): «No te sale el 349: …».
  v_no := v_no || coalesce((select jsonb_agg(jsonb_build_object('modelo', r.form_code, 'nombre', f.name, 'por_que', r.why, 'origen', 'rule')
                                              order by r.form_code)
                              from public.conta_impuesto_reglas(p_company) r join public.tax_form f on f.code = r.form_code
                             where not r.active
                               and not exists (select 1 from public.tax_obligation o3 where o3.company_id = p_company
                                                                                       and o3.valid_to is null and o3.form_code = r.form_code)), '[]');

  return jsonb_build_object(
    'hoy', v_hoy, 'ventana', v_ventana, 'desde', v_desde,
    -- Para los avisos de Inicio: el certificado con que presenta la empresa (su caducidad)…
    'certificado', (select jsonb_build_object('titular', t.subject_name, 'caduca', t.valid_to)
                      from public.company_tax_presenter pr join public.tax_certificate t on t.id = pr.certificate_id
                     where pr.company_id = p_company and pr.mode = 'company' and t.status <> 'removed'),
    -- …y lo presentado a pagar cuyo cargo no ha llegado al banco dos días después del plazo (respuesta 5 de Julio).
    'pagos_sin_llegar', (select coalesce(jsonb_agg(jsonb_build_object('declaracion', r.id, 'modelo', r.form_code, 'ejercicio', r.fiscal_year,
                                                                      'periodo', r.period, 'importe', r.amount, 'plazo', r.due_date,
                                                                      'domicilia', r.payment_mode = 'direct_debit') order by r.due_date), '[]')
                           from public.tax_return r
                          where r.company_id = p_company and r.status in ('filed', 'booked') and r.result_kind = 'to_pay'
                            and r.bank_match_id is null and r.due_date < v_hoy - 2 and r.due_date > v_hoy - 400),
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'filas', v_filas, 'siguiente', v_siguiente, 'presentados', v_pres,
    'modelos', v_reglas, 'no_presenta', v_no,
    -- Para «+ Añadir otro impuesto»: los modelos que conoce Sumied y no están en la lista.
    'se_pueden_anadir', (select coalesce(jsonb_agg(jsonb_build_object('modelo', f.code, 'nombre', f.name) order by f.code), '[]')
                           from public.tax_form f
                          where f.code in (select distinct form_code from public.tax_form_deadline)
                            and not exists (select 1 from public.tax_obligation o3 where o3.company_id = p_company and o3.valid_to is null
                                                                                    and o3.active and o3.form_code = f.code)));
end $$;
