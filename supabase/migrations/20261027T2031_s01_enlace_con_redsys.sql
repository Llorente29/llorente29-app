-- 20261027T2031_s01_enlace_con_redsys.sql
--
-- S01 · PR 1 · El enlace de pago cobra con REDSYS o con Stripe. El enlace, la
-- página (pagar.html) y el aviso de cobrado son los mismos: solo cambia el
-- proveedor (_s01_proveedor_enlace, de la 2030: Redsys si la empresa lo tiene
-- listo y elegido; si no, Stripe con la tarjeta activa).
--
--   · conta_enlace_pago_para: hay enlace si la empresa cobra con alguno de los
--     dos (antes, solo con Stripe).
--   · conta_enlace_pago_ver: «sin_cobro» si no cobra con ninguno; los métodos,
--     los del proveedor; y dice cuál es («stripe» o «redsys»), para que la
--     página diga dónde se paga. Sigue sin enseñar ningún dato del proveedor.
--   · conta_enlace_pago_datos: además el proveedor y los datos del TPV (sin la
--     clave: esa la pide conta-pago aparte, a conta_cobro_redsys_datos).
--   · conta_enlace_pago_cobrado (Stripe): el cobro lo hace _s01_enlace_cobrar,
--     el mismo que usa Redsys, y queda apuntado que fue con Stripe. Lo que hace
--     y lo que devuelve, igual que antes.
--
-- CAMBIA EN CALIENTE, con la misma firma (regla 2: ninguna sobrecarga). Lo de
-- antes es el texto de la 1121, el mismo que hay en producción (md5 del cuerpo,
-- 27/10, solo lectura): conta_enlace_pago_para 6f8e0215…, conta_enlace_pago_ver
-- 84a2d513…, conta_enlace_pago_datos 5bc6c477…, conta_enlace_pago_cobrado
-- 39479a1c…. Hoy en producción: 0 enlaces y 0 cuentas de Stripe.
--
-- Y dos CHECK que solo amplían (Respuesta 1 al S01 · PR 1): todo lo que valía
-- sigue valiendo. NOT VALID y validados después, como la 0836.
--   · journal_entry.source_type admite «customer_payment»: el asiento del cobro
--     por el enlace (la pasarela contra la 430), gemelo de «supplier_payment».
--   · treasury_account.kind admite «pasarela»: la cuenta de tesorería de
--     «Stripe · por abonar» y «TPV del banco · por abonar», para que Bancos la
--     enseñe con su saldo. Sin IBAN (el CHECK del IBAN es solo para «bank»).
--
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
-- cambia: public.treasury_account · prueba: supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
-- cambia: public.conta_enlace_pago_para · prueba: supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
-- cambia: public.conta_enlace_pago_ver · prueba: supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
-- cambia: public.conta_enlace_pago_datos · prueba: supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
-- cambia: public.conta_enlace_pago_cobrado · prueba: supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261027T2031_s01_enlace_con_redsys.down.sql
-- Cada función se guarda antes con _respaldar_funcion, y su vuelta atrás la
-- restaura byte a byte desde ese respaldo (_restaurar_funcion).

select public._respaldar_funcion('public.conta_enlace_pago_para(uuid)', '20261027T2031_s01_enlace_con_redsys');
select public._respaldar_funcion('public.conta_enlace_pago_ver(text)', '20261027T2031_s01_enlace_con_redsys');
select public._respaldar_funcion('public.conta_enlace_pago_datos(text)', '20261027T2031_s01_enlace_con_redsys');
select public._respaldar_funcion('public.conta_enlace_pago_cobrado(text,text,text,numeric,text,date)', '20261027T2031_s01_enlace_con_redsys');

alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array[
  'sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank',
  'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing', 'migrated', 'purchase_accrual', 'purchase_accrual_reversal',
  'customer_invoice', 'customer_payment'])) not valid;
alter table public.journal_entry validate constraint journal_entry_source_type_check;

alter table public.treasury_account drop constraint if exists treasury_account_kind_check;
alter table public.treasury_account add constraint treasury_account_kind_check check (kind = any (array['bank', 'card', 'cash', 'pasarela'])) not valid;
alter table public.treasury_account validate constraint treasury_account_kind_check;

-- El enlace de pago de una factura (solo el servidor): el abierto que tenga, o
-- uno nuevo. Null si la empresa no cobra con tarjeta (ni Redsys ni Stripe), si
-- es de plataforma, si está cobrada o si no queda nada pendiente.
create or replace function public.conta_enlace_pago_para(p_invoice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.customer_invoice; c record; v_prov text; v_token text;
begin
  select * into v from public.customer_invoice where id = p_invoice;
  if v.id is null or v.status <> 'emitida' then return null; end if;
  select * into c from public.conta_factura_cobro where invoice_id = p_invoice;
  if c.invoice_id is null or c.de_plataforma or c.total <= 0 or c.pendiente < 0.005 then return null; end if;
  v_prov := public._s01_proveedor_enlace(v.company_id);
  if v_prov is null then return null; end if;
  select token into v_token from public.conta_enlace_pago where invoice_id = p_invoice and status = 'abierto';
  if v_token is not null then return v_token; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.conta_enlace_pago (account_id, company_id, invoice_id, token) values (v.account_id, v.company_id, v.id, v_token);
  perform public._conta_venta_evento(v.id, 'enlace_pago', 'Enlace de pago preparado (tarjeta'
    || case when public._s01_metodos_enlace(v.company_id) ? 'bizum' then ' y Bizum' else '' end || ').', null, 'Sumied');
  return v_token;
end $$;

-- Lo que enseña la página de pago, SIN CUENTA (anon): con el token y nada más.
-- Cuenta la apertura. Nunca enseña datos del proveedor: solo cuál es.
create or replace function public.conta_enlace_pago_ver(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.conta_enlace_pago; v public.customer_invoice; c record; co public.company; v_prov text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('estado', 'no_existe'); end if;
  select * into e from public.conta_enlace_pago where token = p_token;
  if e.id is null then return jsonb_build_object('estado', 'no_existe'); end if;
  select * into v from public.customer_invoice where id = e.invoice_id;
  select * into c from public.conta_factura_cobro where invoice_id = e.invoice_id;
  select * into co from public.company where id = e.company_id;
  v_prov := public._s01_proveedor_enlace(e.company_id);
  if e.status = 'abierto' then
    update public.conta_enlace_pago set aperturas = aperturas + 1, abierto_at = now() where id = e.id;
  end if;
  return jsonb_build_object(
    'estado', case when e.status = 'pagado' then 'pagado' when e.status = 'anulado' then 'anulado'
                   when c.pendiente < 0.005 then 'cobrada' when v_prov is null then 'sin_cobro' else 'abierto' end,
    'empresa', coalesce(nullif(trim(co.trade_name), ''), co.legal_name), 'color', co.color,
    'factura', v.number_text, 'fecha', v.issue_date, 'vence', v.due_date, 'total', c.total, 'pendiente', c.pendiente,
    'proveedor', coalesce(e.proveedor, v_prov),
    'metodos', public._s01_metodos_enlace(e.company_id),
    'pagado', case when e.status = 'pagado' then jsonb_build_object('el', e.pagado_at, 'con', e.metodo, 'importe', e.importe) end);
end $$;

-- Los datos para preparar el pago (solo el servidor: conta-pago). Sin la clave del TPV.
create or replace function public.conta_enlace_pago_datos(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enlace', e.id, 'estado', e.status, 'empresa_id', e.company_id, 'factura_id', e.invoice_id, 'factura', v.number_text, 'pendiente', c.pendiente,
                            'empresa', coalesce(nullif(trim(co.trade_name), ''), co.legal_name), 'correo', nullif(lower(trim(v.email_to)), ''),
                            'stripe', s.stripe_account_id, 'modo', s.modo, 'tarjeta', s.tarjeta, 'bizum', s.bizum,
                            'proveedor', public._s01_proveedor_enlace(e.company_id),
                            'redsys', case when r.company_id is not null then jsonb_build_object('comercio', r.comercio, 'terminal', r.terminal, 'bizum', r.bizum,
                                                                                                  'modo', r.modo, 'cobra', r.cobra) end)
    from public.conta_enlace_pago e
    join public.customer_invoice v on v.id = e.invoice_id
    join public.conta_factura_cobro c on c.invoice_id = e.invoice_id
    join public.company co on co.id = e.company_id
    left join public.conta_cobro_stripe s on s.company_id = e.company_id
    left join public.conta_cobro_redsys r on r.company_id = e.company_id
   where e.token = p_token
$$;

-- Stripe confirma el pago (solo el servidor: el aviso de Stripe). Una vez por
-- sesión: el segundo aviso no hace nada. El cobro, por _s01_enlace_cobrar (el
-- motor de la E1, sin pasar de lo pendiente), y queda apuntado que fue Stripe.
create or replace function public.conta_enlace_pago_cobrado(p_sesion text, p_stripe text, p_pago_ref text, p_importe numeric, p_metodo text, p_fecha date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.conta_enlace_pago;
begin
  select * into e from public.conta_enlace_pago where sesion = p_sesion for update;
  if e.id is null then return jsonb_build_object('hecho', false, 'motivo', 'no_existe'); end if;
  if e.status = 'pagado' then return jsonb_build_object('hecho', false, 'motivo', 'ya_cobrado'); end if;
  if not exists (select 1 from public.conta_cobro_stripe where company_id = e.company_id and stripe_account_id = p_stripe) then
    return jsonb_build_object('hecho', false, 'motivo', 'otra_cuenta');
  end if;
  return public._s01_enlace_cobrar(e.id, p_importe, p_metodo, p_pago_ref, 'stripe', p_fecha);
end $$;
