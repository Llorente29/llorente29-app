-- supabase/migrations/20261104T1720_s01p_bloques.sql
--
-- S01p · 3 · Los bloques de «Cerrar el mes», en la base (Julio, respuesta
-- S01p·1, paso 3). Una función stable por bloque: devuelve su estado, su frase,
-- sus cifras y sus ejemplos (5 de cada cosa que falta). Son las mismas que
-- usará la pantalla: conta_cierre_mes las junta.
--
-- Estado de un bloque (regla 7: nada se pone en verde por esconder filas):
--   verde      todo está; lo que no va a llegar, con su porqué.
--   ambar      falta algo que no impide saber que el mes está contabilizado
--              (p. ej. asientos propuestos por validar).
--   rojo       falta algo del mes.
--   sin_medir  Sumied no lo sabe todavía, y lo dice (nunca verde).
--   no_aplica  el bloque no es de esta empresa o de este mes. Sale igual, con
--              su porqué (regla 7: la pantalla decide cómo, no si existe).
--
-- Reutiliza lo que ya hay, sin repetir reglas: el cierre del día
-- (sales_day_summary, conta_cierre_espera, conta_sin_confirmar_no_cobrados y la
-- regla de marca propia de conta_pedidos_del_dia), lo que falta
-- (conta_esperadas_del_mes), el motor de liquidaciones (conta_liquidaciones_mes),
-- el cierre de banco (bank_meses_estado), el enlace factura↔asiento (S01p·1) y los
-- días de la empresa (S01p·2). Decisiones de Julio del 04/11: el cobro de una
-- liquidación solo se pide si su abono cae antes del día de cierre (lo hace ya
-- el motor: «aún no toca»); amortizaciones «sin medir: falta el registro de
-- bienes» (S01r); se justifican solas las comisiones del banco y los traspasos;
-- las recargas de Catcher, con sus facturas contra la 407 en el mes.
--
-- Solo añade funciones. No toca filas. Nada en el camino del pedido.

-- ── Ayudantes ───────────────────────────────────────────────────────────────
create or replace function public._s01p_bloque(p_codigo text, p_nombre text, p_estado text, p_frase text,
                                               p_cifras jsonb default '{}'::jsonb, p_ejemplos jsonb default '[]'::jsonb, p_ir text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('codigo', p_codigo, 'nombre', p_nombre, 'estado', p_estado, 'frase', p_frase,
                            'cifras', coalesce(p_cifras, '{}'::jsonb), 'ejemplos', coalesce(p_ejemplos, '[]'::jsonb), 'ir', p_ir)
$$;

-- La empresa es de quien pregunta (o lo pide el servicio). Devuelve su cuenta.
create or replace function public._s01p_cuenta_de(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  return v_acc;
end $$;

create or replace function public._s01p_euros(p numeric)
returns text language sql immutable as $$
  select replace(replace(replace(to_char(coalesce(p, 0), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ' €'
$$;

-- ── 1 · Ventas ──────────────────────────────────────────────────────────────
-- Cada día, local y plataforma con ventas cerradas de marcas propias tiene su
-- cierre validado, o está en espera con su motivo; y ningún pedido cerrado sin
-- confirmar espera decisión.
create or replace function public.conta_cierre_bloque_ventas(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_total int; v_ok int; v_prop int; v_sin int; v_esp int; v_sinconf int; v_ej jsonb; v_estado text; v_frase text;
begin
  with v as (
    select s.location_id, s.channel_id, (s.sold_at at time zone 'Europe/Madrid')::date dia
      from public.sale s
      join public.location_company lc on lc.location_id = s.location_id and lc.company_id = p_company and lc.account_id = v_acc
      left join public.brand b on b.id = s.brand_id
     where s.account_id = v_acc and s.is_active and s.status = 'closed' and coalesce(b.ownership_type, 'own') = 'own'
       and s.sold_at >= (v_ini::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((v_fin + 1)::timestamp at time zone 'Europe/Madrid')
     group by 1, 2, 3),
  r as (
    select v.*,
           (select bool_or(e.status = 'validado') from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
             where d.company_id = p_company and d.location_id = v.location_id and d.sales_day = v.dia and d.channel_id is not distinct from v.channel_id) val,
           (select bool_or(e.status in ('propuesto', 'borrador')) from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
             where d.company_id = p_company and d.location_id = v.location_id and d.sales_day = v.dia and d.channel_id is not distinct from v.channel_id) prop,
           exists (select 1 from public.conta_cierre_espera w where w.company_id = p_company and w.location_id = v.location_id and w.sales_day = v.dia
                    and coalesce(btrim(w.motivo), '') <> '') espera
      from v)
  select count(*), count(*) filter (where val), count(*) filter (where not coalesce(val, false) and prop),
         count(*) filter (where not coalesce(val, false) and not coalesce(prop, false) and not espera), count(*) filter (where espera and not coalesce(val, false)),
         (select jsonb_agg(x) from (select jsonb_build_object('dia', r2.dia, 'local', l.name, 'canal', ch.name,
                     'que', case when r2.prop then 'cierre propuesto, por validar' else 'sin cierre del día' end) x
                from r r2 left join public.locations l on l.id = r2.location_id left join public.sales_channel ch on ch.id = r2.channel_id
               where not coalesce(r2.val, false) and not r2.espera order by r2.dia, l.name, ch.name limit 5) z)
    into v_total, v_ok, v_prop, v_sin, v_esp, v_ej
    from r;

  select count(*) into v_sinconf from public.conta_sin_confirmar_no_cobrados(p_company) w where w.dia between v_ini and v_fin;

  if coalesce(v_total, 0) = 0 then
    return public._s01p_bloque('ventas', 'Ventas', 'no_aplica', 'No hay ventas de tus marcas en el mes.');
  end if;
  v_estado := case when v_sin > 0 or v_sinconf > 0 then 'rojo' when v_prop > 0 then 'ambar' else 'verde' end;
  v_frase := case when v_estado = 'verde'
    then format('Los %s días por local y plataforma, validados%s.', v_total, case when v_esp > 0 then format(' (%s en espera con su motivo)', v_esp) else '' end)
    else concat_ws(' · ',
      case when v_prop > 0 then format('%s días con su cierre por validar', v_prop) end,
      case when v_sin > 0 then format('%s días sin cierre', v_sin) end,
      case when v_sinconf > 0 then format('%s pedidos cerrados sin confirmar', v_sinconf) end) end;
  return public._s01p_bloque('ventas', 'Ventas', v_estado, v_frase,
    jsonb_build_object('dias', v_total, 'validados', v_ok, 'por_validar', v_prop, 'sin_cierre', v_sin, 'en_espera', v_esp, 'sin_confirmar', v_sinconf),
    coalesce(v_ej, '[]'::jsonb), 'ventas/cierres');
end $$;

-- ── 2 · Compras ─────────────────────────────────────────────────────────────
-- Nada del mes en «Por revisar»; lo que se esperaba en el mes ha llegado (menos
-- los alquileres, que van en «Lo que se repite»); y ningún «recibido sin
-- factura» propuesto cuyo albarán ya tenga factura del mes.
create or replace function public.conta_cierre_bloque_compras(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_rev int; v_rev_ej jsonb; v_esp int; v_esp_ej jsonb; v_rsf int; v_rsf_ej jsonb; v_estado text;
begin
  select count(*), (select jsonb_agg(x) from (select jsonb_build_object('factura', f.code, 'fecha', f.invoice_date, 'total', f.grand_total) x
                      from public.supplier_invoice f where f.account_id = v_acc and (f.company_id = p_company or f.company_id is null)
                       and f.status = 'en_revision' and f.discarded_at is null and f.invoice_date between v_ini and v_fin
                     order by f.grand_total desc nulls last, f.code limit 5) z)
    into v_rev, v_rev_ej from public.supplier_invoice f
   where f.account_id = v_acc and (f.company_id = p_company or f.company_id is null)
     and f.status = 'en_revision' and f.discarded_at is null and f.invoice_date between v_ini and v_fin;
  select count(*), jsonb_agg(jsonb_build_object('proveedor', n.supplier_name, 'ultima', n.ultima) order by n.supplier_name) filter (where true)
    into v_esp, v_esp_ej
    from public.conta_esperadas_del_mes(p_company, v_ini) n join public.supplier_expected_invoice x on x.id = n.expected_id
   where x.kind <> 'alquiler';
  select count(*), jsonb_agg(jsonb_build_object('albaran', r->>'code', 'base', a.base))
    into v_rsf, v_rsf_ej
    from public.purchase_accrual a cross join lateral jsonb_array_elements(a.receipts) r
    join public.goods_receipt_path p on p.goods_receipt_id = (r->>'id')::uuid and p.account_id = v_acc
    join public.supplier_invoice si on si.id = p.supplier_invoice_id and si.status <> 'anulada' and si.invoice_date <= v_fin
   where a.company_id = p_company and a.account_id = v_acc and a.month = v_ini
     and exists (select 1 from public.journal_entry e where e.source_id = a.id and e.source_type in ('purchase_accrual', 'purchase_accrual_reversal')
                  and e.status in ('propuesto', 'borrador'));

  v_estado := case when v_rev > 0 or v_esp > 0 or v_rsf > 0 then 'rojo' else 'verde' end;
  return public._s01p_bloque('compras', 'Compras', v_estado,
    case when v_estado = 'verde' then 'Nada por revisar, y ha llegado todo lo que se esperaba en el mes.'
         else concat_ws(' · ',
           case when v_rev > 0 then format('%s facturas por revisar', v_rev) end,
           case when v_esp > 0 then format('%s facturas que se esperaban y no han llegado', v_esp) end,
           case when v_rsf > 0 then format('%s «recibido sin factura» propuestos cuyo albarán ya tiene factura', v_rsf) end) end,
    jsonb_build_object('por_revisar', v_rev, 'no_llegadas', v_esp, 'recibido_ya_facturado', v_rsf),
    coalesce(v_rev_ej, '[]'::jsonb) || coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_esp_ej) e limit 5) z), '[]'::jsonb)
      || coalesce(v_rsf_ej, '[]'::jsonb),
    'compras/recibidas');
end $$;

-- ── 3 · Plataformas ─────────────────────────────────────────────────────────
-- El motor del mes (S01q): cada periodo con su liquidación y su factura de
-- comisión; el cobro, solo si su abono cae antes del día de cierre («aún no
-- toca» no falta: se mira el mes siguiente).
create or replace function public.conta_cierre_bloque_plataformas(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._s01p_cuenta_de(p_company); j jsonb; r jsonb; v_estado text; v_ej jsonb;
begin
  j := public.conta_liquidaciones_mes(p_company, date_trunc('month', p_mes)::date);
  r := j->'resumen';
  if coalesce((r->>'total')::int, 0) = 0 then
    return public._s01p_bloque('plataformas', 'Plataformas', 'no_aplica', 'No hay liquidaciones de plataformas en el mes.');
  end if;
  select jsonb_agg(x) into v_ej from (
    select jsonb_build_object('canal', f->>'canal', 'marca', f->>'marca', 'local', f->>'local', 'periodo', (f->>'desde') || '→' || (f->>'hasta'),
                              'que', case f->>'accion' when 'pidela' then 'falta la liquidación' when 'subela' then 'falta la factura de comisión'
                                                       else 'no cuadra' end) x
      from jsonb_array_elements(j->'filas') f where f->>'estado' in ('te_necesita', 'no_cuadra')
     order by f->>'desde', f->>'canal', f->>'marca' limit 5) z;
  v_estado := case when (r->>'te_necesita')::int + (r->>'no_cuadra')::int > 0 then 'rojo' else 'verde' end;
  return public._s01p_bloque('plataformas', 'Plataformas', v_estado,
    case when v_estado = 'verde' then format('Los %s periodos con su liquidación y su factura de comisión%s.', r->>'total',
                                             case when (r->>'aun_no_toca')::int > 0 then format(' (%s cobros se miran el mes siguiente)', r->>'aun_no_toca') else '' end)
         else concat_ws(' · ',
           case when (r->>'te_necesita')::int > 0 then format('%s periodos te necesitan', r->>'te_necesita') end,
           case when (r->>'no_cuadra')::int > 0 then format('%s no cuadran', r->>'no_cuadra') end) end,
    r, coalesce(v_ej, '[]'::jsonb), 'ventas/liquidaciones');
end $$;

-- ── 4 · Bancos ──────────────────────────────────────────────────────────────
-- Cada cuenta: el extracto hasta fin de mes, su saldo igual al de Sumied y nada
-- sin casar. Sin saldo del banco: sin medir (nunca verde).
create or replace function public.conta_cierre_bloque_bancos(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_n int; v_mal int; v_sin int; v_ok int; v_ej jsonb; v_estado text; v_sueltos int;
begin
  with b as (
    select t.name, (m.estado->>'cuenta') cuenta, (m.estado->>'saldo_banco')::numeric banco, (m.estado->>'saldo_libro')::numeric libro,
           (m.estado->>'diferencia')::numeric dif, coalesce((m.estado->>'sueltos')::int, 0) sueltos,
           (m.estado->>'extracto_hasta')::date hasta, m.cierre_id
      from public.bank_meses_estado(p_company, date_trunc('month', p_mes)::date) m
      join public.treasury_account t on t.id = m.treasury_account_id),
  c as (select b.*, case when b.cierre_id is not null then 'ok'
                         when b.banco is null and b.sueltos = 0 and coalesce(b.libro, 0) = 0 then 'sin_medir'
                         when b.banco is null then 'sin_medir'
                         when b.dif <> 0 or b.sueltos > 0 or b.hasta is null or b.hasta < v_fin then 'mal' else 'ok' end e from b)
  select count(*), count(*) filter (where e = 'mal'), count(*) filter (where e = 'sin_medir'), count(*) filter (where e = 'ok'), sum(sueltos),
         (select jsonb_agg(x) from (select jsonb_build_object('cuenta', c2.name, 'diferencia', c2.dif, 'sueltos', c2.sueltos, 'extracto_hasta', c2.hasta,
                     'que', case when c2.e = 'sin_medir' then 'sin saldo del banco' when c2.dif <> 0 then 'no cuadra con su 572'
                                 when c2.hasta is null or c2.hasta < v_fin then 'falta el extracto hasta fin de mes' else 'movimientos sin casar' end) x
                from c c2 where c2.e <> 'ok' order by c2.e, abs(coalesce(c2.dif, 0)) desc limit 5) z)
    into v_n, v_mal, v_sin, v_ok, v_sueltos, v_ej from c;
  if coalesce(v_n, 0) = 0 then return public._s01p_bloque('bancos', 'Bancos', 'no_aplica', 'La empresa no tiene cuentas de banco.'); end if;
  v_estado := case when v_mal > 0 then 'rojo' when v_sin > 0 then 'sin_medir' else 'verde' end;
  return public._s01p_bloque('bancos', 'Bancos', v_estado,
    case when v_estado = 'verde' then format('Las %s cuentas cuadran con su extracto hasta el %s.', v_n, to_char(v_fin, 'DD/MM'))
         else concat_ws(' · ',
           case when v_mal > 0 then format('%s de %s cuentas sin cuadrar o sin extracto hasta fin de mes', v_mal, v_n) end,
           case when v_sueltos > 0 then format('%s movimientos sin casar', v_sueltos) end,
           case when v_sin > 0 then format('%s sin saldo del banco: sin medir', v_sin) end) end,
    jsonb_build_object('cuentas', v_n, 'cuadran', v_ok, 'mal', v_mal, 'sin_medir', v_sin, 'sueltos', v_sueltos),
    coalesce(v_ej, '[]'::jsonb), 'bancos');
end $$;

-- ── 5 · Justificantes ───────────────────────────────────────────────────────
-- Todo movimiento casado del mes tiene su justificante: su factura, su
-- liquidación o un documento en su asiento; se justifican solos los traspasos
-- entre cuentas propias y las comisiones del banco (626, el extracto es el
-- documento); las recargas de Catcher (407), con sus facturas en el mes. Y toda
-- recibida con asiento del mes, su PDF (o «Sin PDF» con su porqué).
create or replace function public.conta_cierre_bloque_justificantes(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_n int; v_ok int; v_sin int; v_sin_imp numeric; v_ej jsonb; v_pdf int; v_pdf_ej jsonb; v_recarga numeric; v_facturado numeric; v_estado text;
begin
  with m as (
    select b.id, b.op_date, b.amount, k.kind, k.journal_entry_id
      from public.bank_movement b
      join public.bank_match k on k.movement_id = b.id and k.undone_at is null and k.account_id = v_acc
     where b.company_id = p_company and b.account_id = v_acc and b.status = 'casado' and b.op_date between v_ini and v_fin),
  c as (
    select m.*,
           (m.kind in ('liquidacion', 'factura_recibida', 'traspaso', 'remesa', 'factura_emitida', 'modelo', 'nomina', 'contrato')
            or exists (select 1 from public.journal_entry_document d where d.entry_id = m.journal_entry_id)
            or exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                        where l.entry_id = m.journal_entry_id and a.code !~ '^572' and (a.code ~ '^626' or a.code ~ '^407'))) ok,
           (select string_agg(distinct left(a.code, 3), '+') from public.journal_line l join public.company_account a on a.id = l.company_account_id
             where l.entry_id = m.journal_entry_id and a.code !~ '^572') contra
      from m)
  select count(*), count(*) filter (where ok), count(*) filter (where not ok), coalesce(sum(abs(amount)) filter (where not ok), 0),
         (select jsonb_agg(x) from (select jsonb_build_object('dia', c2.op_date, 'importe', c2.amount, 'contra', c2.contra) x
                from c c2 where not c2.ok order by abs(c2.amount) desc limit 5) z)
    into v_n, v_ok, v_sin, v_sin_imp, v_ej from c;

  -- Catcher: lo recargado (debe de la 407) frente a lo facturado (haber de la 407) en el mes; la diferencia, saldo a favor.
  select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0) into v_recarga, v_facturado
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin and a.code ~ '^407';

  select count(*), (select jsonb_agg(x) from (select jsonb_build_object('factura', f.code, 'fecha', f.invoice_date, 'total', f.grand_total) x
                     from public.supplier_invoice f join public.journal_entry e on e.id = f.journal_entry_id
                    where f.account_id = v_acc and e.company_id = p_company and e.entry_date between v_ini and v_fin and e.status <> 'anulado'
                      and f.raw_document_url is null and f.no_document_at is null order by f.grand_total desc nulls last limit 5) z)
    into v_pdf, v_pdf_ej from public.supplier_invoice f join public.journal_entry e on e.id = f.journal_entry_id
   where f.account_id = v_acc and e.company_id = p_company and e.entry_date between v_ini and v_fin and e.status <> 'anulado'
     and f.raw_document_url is null and f.no_document_at is null;

  if coalesce(v_n, 0) = 0 and coalesce(v_pdf, 0) = 0 then
    return public._s01p_bloque('justificantes', 'Justificantes', 'no_aplica', 'No hay movimientos del banco casados en el mes.');
  end if;
  v_estado := case when v_sin > 0 or v_pdf > 0 then 'rojo' else 'verde' end;
  return public._s01p_bloque('justificantes', 'Justificantes', v_estado,
    case when v_estado = 'verde' then format('Los %s movimientos casados tienen su justificante.', v_n)
         else concat_ws(' · ',
           case when v_sin > 0 then format('%s movimientos sin su documento (%s)', v_sin, public._s01p_euros(v_sin_imp)) end,
           case when v_pdf > 0 then format('%s facturas recibidas sin PDF', v_pdf) end) end,
    jsonb_build_object('casados', v_n, 'justificados', v_ok, 'sin_documento', v_sin, 'sin_documento_importe', v_sin_imp,
                       'recibidas_sin_pdf', v_pdf, 'catcher_recargado', v_recarga, 'catcher_facturado', v_facturado,
                       'catcher_saldo_a_favor', v_recarga - v_facturado),
    coalesce(v_ej, '[]'::jsonb) || coalesce(v_pdf_ej, '[]'::jsonb), 'bancos');
end $$;

-- ── 6 · Laboral ─────────────────────────────────────────────────────────────
-- Dos cosas: el devengo del mes (640 con fecha del mes) y el pago (lo que sale
-- del banco en el mes contra la 465, la nómina del mes anterior, en los días de
-- pago de la empresa). Si Laboral no tiene el mes: sin medir, nunca verde.
create or replace function public.conta_cierre_bloque_laboral(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_640 numeric; v_642 numeric; v_465_pago numeric; v_laboral int; v_dias smallint[]; v_estado text; v_frase text;
begin
  select coalesce(sum(l.debit - l.credit) filter (where a.code ~ '^640'), 0), coalesce(sum(l.debit - l.credit) filter (where a.code ~ '^642'), 0)
    into v_640, v_642
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin
     and e.source_type not in ('closing', 'regularization');
  select coalesce(sum(l.debit), 0) into v_465_pago
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin
     and a.code ~ '^465' and e.source_type = 'bank';
  select count(*) into v_laboral from public.payroll_cost c
   where c.account_id = v_acc and c.period_year = extract(year from v_ini) and c.period_month = extract(month from v_ini);
  select payroll_pay_days into v_dias from public.company where id = p_company;

  if v_640 = 0 and v_laboral = 0 and v_465_pago = 0 then
    -- Ni nómina en el libro, ni en Laboral, ni pagos: puede que no tenga personal; no se da por verde.
    if not exists (select 1 from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
                    where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and a.code ~ '^640' and e.entry_date >= v_ini - 365) then
      return public._s01p_bloque('laboral', 'Laboral', 'no_aplica', 'Sin nóminas en el último año.');
    end if;
  end if;
  v_estado := case when v_640 = 0 then 'rojo' when v_laboral = 0 then 'sin_medir' else 'verde' end;
  v_frase := concat_ws(' · ',
    case when v_640 = 0 then format('Falta la nómina de %s: ningún 640 con fecha del mes', to_char(v_ini, 'MM/YYYY'))
         else format('Nómina del mes en el libro: 640 %s y 642 %s', public._s01p_euros(v_640), public._s01p_euros(v_642)) end,
    case when v_laboral = 0 then 'Laboral no tiene este mes: sin medir' end,
    case when v_465_pago > 0 then format('Pago de la nómina anterior: %s', public._s01p_euros(v_465_pago)) else 'Ningún pago de nóminas por el banco en el mes' end,
    case when v_dias is null then 'Sin días de pago de la nómina en la empresa' end);
  return public._s01p_bloque('laboral', 'Laboral', v_estado, v_frase,
    jsonb_build_object('devengo_640', v_640, 'devengo_642', v_642, 'pago_465', v_465_pago, 'laboral_personas', v_laboral, 'dias_de_pago', to_jsonb(v_dias)),
    '[]'::jsonb, 'laboral');
end $$;

-- ── 7 · Lo que se repite cada mes ───────────────────────────────────────────
-- Amortizaciones: sin medir (falta el registro de bienes, S01r). Cuotas de
-- préstamos y aplazamientos del mes, casadas con su fila. Alquileres esperados
-- del mes, llegados. Lo recibido sin factura del mes, validado.
create or replace function public.conta_cierre_bloque_repite(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_cuotas int; v_cuotas_mal int; v_cuotas_ej jsonb; v_alq int; v_alq_ej jsonb; v_rsf int; v_estado text;
begin
  select count(*), count(*) filter (where not exists (select 1 from public.bank_match m where m.contract_id = c.id and m.undone_at is null
                                                       and m.contract_due_date = (f->>'fecha')::date)),
         jsonb_agg(jsonb_build_object('contrato', c.name, 'fecha', f->>'fecha', 'cuota', (f->>'cuota')::numeric, 'que', 'cuota sin casar con su fila del cuadro'))
           filter (where not exists (select 1 from public.bank_match m where m.contract_id = c.id and m.undone_at is null and m.contract_due_date = (f->>'fecha')::date))
    into v_cuotas, v_cuotas_mal, v_cuotas_ej
    from public.recurring_contract c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.schedule) = 'array' then c.schedule else '[]'::jsonb end) f
   where c.company_id = p_company and c.account_id = v_acc and c.is_active and (f->>'fecha')::date between v_ini and v_fin;
  select count(*), jsonb_agg(jsonb_build_object('alquiler', n.supplier_name, 'ultima', n.ultima, 'que', 'falta la factura del mes'))
    into v_alq, v_alq_ej
    from public.conta_esperadas_del_mes(p_company, v_ini) n join public.supplier_expected_invoice x on x.id = n.expected_id
   where x.kind = 'alquiler';
  select count(*) into v_rsf from public.journal_entry e join public.purchase_accrual a on a.id = e.source_id
   where a.company_id = p_company and a.account_id = v_acc and a.month = v_ini and e.source_type = 'purchase_accrual' and e.status in ('propuesto', 'borrador');

  v_estado := case when v_cuotas_mal > 0 or v_alq > 0 then 'rojo' else 'sin_medir' end;  -- sin el registro de bienes, nunca verde
  return public._s01p_bloque('repite', 'Lo que se repite', v_estado,
    concat_ws(' · ',
      'Amortizaciones: sin medir, falta el registro de bienes',
      case when v_cuotas_mal > 0 then format('%s de %s cuotas sin casar con su fila', v_cuotas_mal, v_cuotas)
           when v_cuotas > 0 then format('las %s cuotas del mes, casadas', v_cuotas) end,
      case when v_alq > 0 then format('%s facturas de alquiler sin llegar', v_alq) end,
      case when v_rsf > 0 then format('%s «recibido sin factura» por validar', v_rsf) end),
    jsonb_build_object('amortizaciones', 'sin_medir', 'cuotas', v_cuotas, 'cuotas_sin_casar', v_cuotas_mal, 'alquileres_sin_llegar', v_alq, 'recibido_sin_factura_por_validar', v_rsf),
    coalesce(v_cuotas_ej, '[]'::jsonb) || coalesce(v_alq_ej, '[]'::jsonb), 'compras/esperando');
end $$;

-- ── 8 · Asientos ────────────────────────────────────────────────────────────
-- Ningún asiento del mes propuesto ni en borrador, y el libro cuadra.
create or replace function public.conta_cierre_bloque_asientos(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_prop int; v_por_tipo jsonb; v_debe numeric; v_haber numeric; v_desc int; v_ej jsonb; v_estado text;
begin
  select count(*), (select jsonb_object_agg(t, n) from (select e2.source_type t, count(*) n from public.journal_entry e2
                      where e2.company_id = p_company and e2.account_id = v_acc and e2.status in ('propuesto', 'borrador')
                        and e2.entry_date between v_ini and v_fin group by 1) z)
    into v_prop, v_por_tipo from public.journal_entry e
   where e.company_id = p_company and e.account_id = v_acc and e.status in ('propuesto', 'borrador') and e.entry_date between v_ini and v_fin;
  select jsonb_agg(x) into v_ej from (select jsonb_build_object('fecha', e.entry_date, 'concepto', left(e.concept, 70), 'origen', e.source_type) x
      from public.journal_entry e where e.company_id = p_company and e.account_id = v_acc and e.status in ('propuesto', 'borrador')
       and e.entry_date between v_ini and v_fin order by e.entry_date, e.created_at limit 5) z;
  select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0) into v_debe, v_haber
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin;
  select count(*) into v_desc from (select e.id from public.journal_entry e join public.journal_line l on l.entry_id = e.id
     where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_ini and v_fin
     group by e.id having sum(l.debit) <> sum(l.credit)) z;

  v_estado := case when v_desc > 0 or v_debe <> v_haber then 'rojo' when v_prop > 0 then 'ambar' else 'verde' end;
  return public._s01p_bloque('asientos', 'Asientos', v_estado,
    concat_ws(' · ',
      case when v_prop > 0 then format('%s asientos por validar', v_prop) else 'Ninguno por validar' end,
      case when v_desc > 0 or v_debe <> v_haber then format('el libro no cuadra (%s asientos descuadrados)', v_desc)
           else format('El balance cuadra: %s en el debe y en el haber', public._s01p_euros(v_debe)) end),
    jsonb_build_object('por_validar', v_prop, 'por_tipo', coalesce(v_por_tipo, '{}'::jsonb), 'debe', v_debe, 'haber', v_haber, 'descuadrados', v_desc),
    coalesce(v_ej, '[]'::jsonb), 'libros/diario');
end $$;

-- ── 9 · IVA (solo en el último mes del trimestre) ───────────────────────────
-- Las 472 y 477 del trimestre cuadran con el libro registro, y el 303 del
-- trimestre está al menos en borrador.
create or replace function public.conta_cierre_bloque_iva(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_tri_ini date := date_trunc('quarter', p_mes)::date; v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_477 numeric; v_472 numeric; v_lib_rep numeric; v_lib_sop numeric; v_303 text; v_estado text;
begin
  if extract(month from v_ini)::int % 3 <> 0 then
    return public._s01p_bloque('iva', 'IVA', 'no_aplica', 'No es el último mes del trimestre.');
  end if;
  select coalesce(sum(l.credit - l.debit) filter (where a.code ~ '^477'), 0), coalesce(sum(l.debit - l.credit) filter (where a.code ~ '^472'), 0)
    into v_477, v_472
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = p_company and e.account_id = v_acc and e.status = 'validado' and e.entry_date between v_tri_ini and v_fin
     and e.source_type <> 'vat_settlement';
  select coalesce(sum(v.tax_amount) filter (where v.book = 'issued'), 0), coalesce(sum(v.tax_amount) filter (where v.book = 'received'), 0)
    into v_lib_rep, v_lib_sop
    from public.vat_book_entry v where v.company_id = p_company and v.account_id = v_acc and v.voided_at is null
     and v.issue_date between v_tri_ini and v_fin;
  select r.status into v_303 from public.tax_return r where r.company_id = p_company and r.form_code = '303'
     and r.fiscal_year = extract(year from v_ini)::int and r.period = (extract(quarter from v_ini)::int || 'T') order by r.sequence desc limit 1;
  v_estado := case when round(v_477 - v_lib_rep, 2) <> 0 or round(v_472 - v_lib_sop, 2) <> 0 or v_303 is null or v_303 = 'pending' then 'rojo' else 'verde' end;
  return public._s01p_bloque('iva', 'IVA', v_estado,
    concat_ws(' · ',
      case when round(v_477 - v_lib_rep, 2) <> 0 then format('La 477 (%s) no cuadra con el libro de expedidas (%s)', public._s01p_euros(v_477), public._s01p_euros(v_lib_rep)) end,
      case when round(v_472 - v_lib_sop, 2) <> 0 then format('La 472 (%s) no cuadra con el libro de recibidas (%s)', public._s01p_euros(v_472), public._s01p_euros(v_lib_sop)) end,
      case when v_303 is null or v_303 = 'pending' then 'El 303 del trimestre no está en borrador' else format('El 303 del trimestre: %s', v_303) end),
    jsonb_build_object('c477', v_477, 'c472', v_472, 'libro_repercutido', v_lib_rep, 'libro_soportado', v_lib_sop, 'estado_303', v_303),
    '[]'::jsonb, 'impuestos');
end $$;

-- ── El mes entero ───────────────────────────────────────────────────────────
create or replace function public.conta_cierre_mes(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid := public._s01p_cuenta_de(p_company); v_ini date := date_trunc('month', p_mes)::date;
  v_dia smallint; v_bloques jsonb; v_lock public.fiscal_period_lock; v_cambios int;
begin
  select month_close_day into v_dia from public.company where id = p_company;
  v_bloques := jsonb_build_array(
    public.conta_cierre_bloque_ventas(p_company, v_ini), public.conta_cierre_bloque_compras(p_company, v_ini),
    public.conta_cierre_bloque_plataformas(p_company, v_ini), public.conta_cierre_bloque_bancos(p_company, v_ini),
    public.conta_cierre_bloque_justificantes(p_company, v_ini), public.conta_cierre_bloque_laboral(p_company, v_ini),
    public.conta_cierre_bloque_repite(p_company, v_ini), public.conta_cierre_bloque_asientos(p_company, v_ini),
    public.conta_cierre_bloque_iva(p_company, v_ini));
  select * into v_lock from public.fiscal_period_lock where company_id = p_company and month = v_ini and reopened_at is null;
  select count(*) into v_cambios from public.conta_mes_cambio c where c.lock_id = v_lock.id;
  return jsonb_build_object(
    'mes', v_ini, 'dia_cierre', v_dia,
    'se_cierra_el', case when v_dia is not null then (v_ini + interval '1 month' + (v_dia - 1) * interval '1 day')::date end,
    'estado', case when v_lock.id is null then 'abierto' when v_cambios > 0 then 'cerrado_con_cambios' else 'cerrado' end,
    'cerrado', case when v_lock.id is not null then jsonb_build_object('el', v_lock.locked_at, 'por', v_lock.locked_by_name, 'tipo', v_lock.kind, 'cambios', v_cambios) end,
    'faltan', (select count(*) from jsonb_array_elements(v_bloques) b where b->>'estado' in ('rojo', 'ambar')),
    'sin_medir', (select count(*) from jsonb_array_elements(v_bloques) b where b->>'estado' = 'sin_medir'),
    'listo', not exists (select 1 from jsonb_array_elements(v_bloques) b where b->>'estado' in ('rojo', 'ambar', 'sin_medir')),
    'no_aplican', (select count(*) from jsonb_array_elements(v_bloques) b where b->>'estado' = 'no_aplica'),
    'bloques', v_bloques);
end $$;

do $$
declare f text;
begin
  foreach f in array array['conta_cierre_bloque_ventas', 'conta_cierre_bloque_compras', 'conta_cierre_bloque_plataformas', 'conta_cierre_bloque_bancos',
                           'conta_cierre_bloque_justificantes', 'conta_cierre_bloque_laboral', 'conta_cierre_bloque_repite', 'conta_cierre_bloque_asientos',
                           'conta_cierre_bloque_iva', 'conta_cierre_mes'] loop
    execute format('revoke all on function public.%I(uuid, date) from public, anon', f);
    execute format('grant execute on function public.%I(uuid, date) to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public._s01p_cuenta_de(uuid) from public, anon, authenticated;
