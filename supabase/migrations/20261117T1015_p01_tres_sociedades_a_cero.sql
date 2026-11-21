-- supabase/migrations/20261117T1015_p01_tres_sociedades_a_cero.sql
--
-- P01 · Las tres sociedades del P01 vuelven a cero (Julio, 17/11). Cuenta
-- a175c0b8-2eaf-4285-9688-53042910a86e; sociedades 328360db-736f-4d45-b4ee-ecf1ca96fa15,
-- bd73d3ae-2a43-4896-a70a-73f92b62c065 y 86d8022d-7a92-4f9d-9cf9-d53729e96ef1. Aquí solo
-- van sus identificadores (T11): ni el nombre de la cuenta ni el de las sociedades.
--
-- Lo que entró reenviando correo a mano, sin orden y sin contabilizar, se borra:
--   · las facturas recibidas, con sus líneas, su IVA y sus cambios (en cascada);
--   · la bandeja de documentos y su actividad;
--   · el registro de correos entrados, las propuestas pendientes y las facturas esperadas;
--   · el proveedor creado en la cuenta (sus disparadores quitan su party_role, su party
--     si se queda sin papel, y su enlace contable, con su línea en company_account_log).
-- Y se deja cada sociedad en su sitio:
--   · trade_name = legal_name en las tres (el desplegable enseña trade_name ?? legal_name);
--   · la que no tiene ejercicio recibe el de 2026, con el mismo insert que abrirEjercicio
--     y los valores del de las otras dos;
--   · el corte, por conta_fijar_corte (la función de Ajustes › Ejercicio): lo de hasta el
--     31/10/2026 es de ERP10 (Cegid ERP despacho), y _conta_corte devuelve 2026-11-01.
--     Lo fija el administrador que ha tomado la decisión (su id, no su nombre), como una
--     persona de la cuenta y solo en esta transacción (el patrón de la 20261106T2350).
--
-- Se quedan, sin tocar: las sociedades y su cuenta, usuarios y permisos, sus cuentas
-- contables (company_account y los enlaces que no son del proveedor), sus buzones, sus
-- locales, su perfil fiscal y sus ajustes. Nada de otra empresa ni de otra cuenta.
--
-- Guardas, todas antes de tocar nada (si una falla, para y no deja nada):
--   · las tres existen, son de la cuenta, con razón social distinta y sin corte puesto;
--   · 0 asientos, 0 libro de IVA, 0 emitidas y 0 movimientos de banco en las tres, y 0
--     ventas en la cuenta: si aparece uno, ya no es «nada contabilizado»;
--   · bank_settings.cutover_date nulo en las tres (si no, _conta_corte no daría el 01/11);
--   · quien fija el corte sigue siendo administrador activo de la cuenta;
--   · nada de otra empresa nombra lo que se borra, y el proveedor no lo usa nada que se quede;
--   · lo que se va a borrar es EXACTAMENTE lo medido en el ensayo (las cifras, abajo).
-- Y después: dentro, todo a 0; fuera de las tres, las mismas cifras antes y después en
-- cada tabla tocada; los tres nombres distintos; y _conta_corte = 2026-11-01 en las tres.
--
-- Los PDF (receipt-uploads, bajo «a175c0b8-2eaf-4285-9688-53042910a86e/») no se pueden
-- borrar desde SQL: storage.objects tiene protect_objects_delete. Los borra Julio desde el
-- almacén, con la lista del parte (como la tanda claude-dl1-borrar-factura-410).
--
-- SIN VUELTA ATRÁS, a propósito: se pide partir de cero. Los originales siguen en el
-- correo de quien los reenvió.
--
-- Las tres funciones son de un solo uso: al final de este mismo fichero, en la misma
-- transacción y después de usarlas, se borran (Julio, 17/11: no se dejan restos). Solo
-- la prueba de staging, en su transacción con ROLLBACK, las conserva para llamarlas con
-- sociedades inventadas (p01.prueba_conserva = 'si', un ajuste local de la transacción).

-- ── Lo que hay DENTRO: lo que se va a borrar, tabla a tabla ─────────────────────
create or replace function public._p01_dentro(p_cuenta uuid, p_empresas uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  with si as (select id from public.supplier_invoice where company_id = any(p_empresas)),
       di as (select id from public.document_inbox where company_id = any(p_empresas)),
       pr as (select id from public.supplier where account_id = p_cuenta)
  select jsonb_build_object(
    'supplier_invoice',          (select count(*) from si),
    'supplier_invoice_line',     (select count(*) from public.supplier_invoice_line where supplier_invoice_id in (select id from si)),
    'supplier_invoice_tax',      (select count(*) from public.supplier_invoice_tax where supplier_invoice_id in (select id from si)),
    'supplier_invoice_change',   (select count(*) from public.supplier_invoice_change where supplier_invoice_id in (select id from si)),
    'document_inbox',            (select count(*) from di),
    'document_activity',         (select count(*) from public.document_activity a where a.company_id = any(p_empresas)
                                    or a.inbox_id in (select id from di) or a.supplier_invoice_id in (select id from si)),
    'inbound_email_log',         (select count(*) from public.inbound_email_log where company_id = any(p_empresas)),
    'conta_propuesta_pendiente', (select count(*) from public.conta_propuesta_pendiente where company_id = any(p_empresas)),
    'supplier_expected_invoice', (select count(*) from public.supplier_expected_invoice where company_id = any(p_empresas)),
    'supplier',                  (select count(*) from pr),
    'supplier_contact',          (select count(*) from public.supplier_contact where supplier_id in (select id from pr)),
    'party_role',                (select count(*) from public.party_role where supplier_id in (select id from pr)),
    'company_account_link_proveedor', (select count(*) from public.company_account_link
                                    where entity = 'supplier' and entity_id in (select id::text from pr)))
$$;

-- ── Lo que hay FUERA: las mismas tablas, sin las tres sociedades ni su cuenta ───
create or replace function public._p01_fuera(p_cuenta uuid, p_empresas uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  with si as (select id from public.supplier_invoice where company_id <> all(p_empresas)),
       pr as (select id from public.supplier where account_id <> p_cuenta)
  select jsonb_build_object(
    'supplier_invoice',          (select count(*) from si),
    'supplier_invoice_line',     (select count(*) from public.supplier_invoice_line where supplier_invoice_id in (select id from si)),
    'supplier_invoice_tax',      (select count(*) from public.supplier_invoice_tax where supplier_invoice_id in (select id from si)),
    'supplier_invoice_change',   (select count(*) from public.supplier_invoice_change where supplier_invoice_id in (select id from si)),
    'document_inbox',            (select count(*) from public.document_inbox where company_id is null or company_id <> all(p_empresas)),
    'document_activity',         (select count(*) from public.document_activity where company_id is null or company_id <> all(p_empresas)),
    'inbound_email_log',         (select count(*) from public.inbound_email_log where company_id is null or company_id <> all(p_empresas)),
    'conta_propuesta_pendiente', (select count(*) from public.conta_propuesta_pendiente where company_id is null or company_id <> all(p_empresas)),
    'supplier_expected_invoice', (select count(*) from public.supplier_expected_invoice where company_id is null or company_id <> all(p_empresas)),
    'supplier',                  (select count(*) from pr),
    'supplier_contact',          (select count(*) from public.supplier_contact where supplier_id in (select id from pr)),
    'party_role',                (select count(*) from public.party_role where account_id <> p_cuenta),
    'party',                     (select count(*) from public.party where account_id <> p_cuenta),
    'company_account_link',      (select count(*) from public.company_account_link where company_id is null or company_id <> all(p_empresas)),
    'company_account_log',       (select count(*) from public.company_account_log where company_id is null or company_id <> all(p_empresas)),
    'company',                   (select count(*) from public.company where id <> all(p_empresas)),
    'company_trade_name',        (select md5(coalesce(string_agg(id::text || ':' || coalesce(trade_name, ''), '|' order by id), ''))
                                    from public.company where id <> all(p_empresas)),
    'fiscal_year',               (select count(*) from public.fiscal_year where company_id <> all(p_empresas)),
    'fiscal_period_lock',        (select count(*) from public.fiscal_period_lock where company_id <> all(p_empresas)))
$$;

-- ── Hacerlo ─────────────────────────────────────────────────────────────────────
create or replace function public._p01_a_cero(p_cuenta uuid, p_empresas uuid[], p_actor uuid,
  p_hasta date, p_programa text, p_esperado jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int := coalesce(cardinality(p_empresas), 0);
  v_mal text; v_dentro jsonb; v_fuera_antes jsonb; v_fuera_despues jsonb; v_despues jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_e uuid; v_modelo public.fiscal_year; v_creados int := 0; v_cortes jsonb := '{}'::jsonb; v_r jsonb;
begin
  if v_n = 0 or (select count(distinct x) from unnest(p_empresas) x) <> v_n then
    raise exception 'P01 a cero: la lista de sociedades está vacía o repetida. No se toca nada.';
  end if;
  if p_hasta is null or coalesce(trim(p_programa), '') = '' then
    raise exception 'P01 a cero: falta el día de corte o el programa. No se toca nada.';
  end if;

  -- 1. Las guardas, todas antes de tocar nada.
  select string_agg(m, ' ') into v_mal from (
    select format('Las %s sociedades no están todas, o alguna no es de la cuenta.', v_n) m
     where (select count(*) from public.company where id = any(p_empresas) and account_id = p_cuenta) <> v_n
    union all select 'Alguna razón social está vacía o se repite: los nombres no quedarían distintos.'
     where (select count(distinct legal_name) from public.company
             where id = any(p_empresas) and coalesce(trim(legal_name), '') <> '') <> v_n
    union all select 'Hay asientos.' where exists (select 1 from public.journal_entry where company_id = any(p_empresas))
    union all select 'Hay apuntes en el libro de IVA.' where exists (select 1 from public.vat_book_entry where company_id = any(p_empresas))
    union all select 'Hay facturas emitidas.' where exists (select 1 from public.customer_invoice where company_id = any(p_empresas))
    union all select 'Hay movimientos de banco.' where exists (select 1 from public.bank_movement where company_id = any(p_empresas))
    union all select 'Hay ventas en la cuenta.' where exists (select 1 from public.sale where account_id = p_cuenta)
    union all select 'El día de corte de Bancos no está vacío: _conta_corte no daría el que se fija.'
     where exists (select 1 from public.bank_settings where company_id = any(p_empresas) and cutover_date is not null)
    union all select 'Alguna ya tiene corte.' where exists (select 1 from unnest(p_empresas) e where public._conta_corte(e) is not null)
    union all select 'Quien fija el corte ya no es administrador activo de la cuenta.'
     where not exists (select 1 from public.user_profiles where user_id = p_actor and account_id = p_cuenta and role = 'admin' and active)
    union all select 'Ninguna tiene el ejercicio del día de inicio, para copiarlo.'
     where not exists (select 1 from public.fiscal_year where company_id = any(p_empresas) and p_hasta + 1 between starts_on and ends_on)
    union all select 'Alguna tiene ejercicios, pero no el del día de inicio.'
     where exists (select 1 from unnest(p_empresas) e
                    where exists (select 1 from public.fiscal_year f where f.company_id = e)
                      and not exists (select 1 from public.fiscal_year f where f.company_id = e and p_hasta + 1 between f.starts_on and f.ends_on))
    union all select 'Algo de otra empresa nombra lo que se borra.'
     where exists (select 1 from public.document_activity a
                    where (a.company_id is null or a.company_id <> all(p_empresas))
                      and (a.inbox_id in (select id from public.document_inbox where company_id = any(p_empresas))
                           or a.supplier_invoice_id in (select id from public.supplier_invoice where company_id = any(p_empresas))))
        or exists (select 1 from public.document_inbox d
                    where (d.company_id is null or d.company_id <> all(p_empresas))
                      and (d.supplier_invoice_id in (select id from public.supplier_invoice where company_id = any(p_empresas))
                           or d.duplicate_of_invoice_id in (select id from public.supplier_invoice where company_id = any(p_empresas))
                           or d.expected_id in (select id from public.supplier_expected_invoice where company_id = any(p_empresas))))
        or exists (select 1 from public.supplier_invoice s
                    where s.company_id <> all(p_empresas)
                      and (s.corrects_invoice_id in (select id from public.supplier_invoice where company_id = any(p_empresas))
                           or s.supplier_id in (select id from public.supplier where account_id = p_cuenta)))
    union all select 'El proveedor de la cuenta lo usa algo que se queda.'
     where exists (select 1 from public.supplier x where x.account_id = p_cuenta and (
             exists (select 1 from public.purchase where supplier_id = x.id)
          or exists (select 1 from public.purchase_order where supplier_id = x.id)
          or exists (select 1 from public.goods_receipt where supplier_id = x.id)
          or exists (select 1 from public.goods_receipt_path where supplier_id = x.id)
          or exists (select 1 from public.ctb_notification_queue where supplier_id = x.id)
          or exists (select 1 from public.compliance_document where supplier_id = x.id)
          or exists (select 1 from public.supplier where invoiced_by_supplier_id = x.id)
          or exists (select 1 from public.conta_pago_remesa_linea where supplier_id = x.id)
          or exists (select 1 from public.conta_pago_salida where supplier_id = x.id)
          or exists (select 1 from public.invoice_approval_rule where supplier_id = x.id)
          or exists (select 1 from public.licensed_settlement where supplier_id = x.id)
          or exists (select 1 from public.purchase_accrual where supplier_id = x.id)))
  ) z;
  if v_mal is not null then raise exception 'P01 a cero: no se toca nada. %', v_mal; end if;

  v_dentro := public._p01_dentro(p_cuenta, p_empresas);
  if v_dentro is distinct from p_esperado then
    raise exception 'P01 a cero: no se toca nada. Lo que hay no es lo medido en el ensayo. Hay %; se esperaba %.', v_dentro, p_esperado;
  end if;
  v_fuera_antes := public._p01_fuera(p_cuenta, p_empresas);

  -- 2. El borrado, en el orden de las claves ajenas.
  delete from public.document_activity a
   where a.company_id = any(p_empresas)
      or a.inbox_id in (select id from public.document_inbox where company_id = any(p_empresas))
      or a.supplier_invoice_id in (select id from public.supplier_invoice where company_id = any(p_empresas));
  -- La bandeja «factura» tiene que tener su factura (document_inbox_check2) y la «repetida», la
  -- suya: se sueltan antes de borrar las facturas (las filas se borran justo después).
  update public.document_inbox set status = 'descartado', supplier_invoice_id = null, duplicate_of_invoice_id = null, expected_id = null
   where company_id = any(p_empresas);
  delete from public.supplier_invoice where company_id = any(p_empresas);   -- líneas, IVA y cambios, en cascada
  delete from public.document_inbox where company_id = any(p_empresas);
  delete from public.inbound_email_log where company_id = any(p_empresas);
  delete from public.conta_propuesta_pendiente where company_id = any(p_empresas);
  delete from public.supplier_expected_invoice where company_id = any(p_empresas);
  delete from public.supplier where account_id = p_cuenta;                 -- contacto en cascada; party y enlace, por sus disparadores

  -- 3. Cada sociedad con su nombre.
  update public.company set trade_name = legal_name where id = any(p_empresas) and trade_name is distinct from legal_name;

  -- 4. El ejercicio que falta: el insert de abrirEjercicio, con el de las otras.
  select * into v_modelo from public.fiscal_year
   where company_id = any(p_empresas) and p_hasta + 1 between starts_on and ends_on
   order by company_id limit 1;
  for v_e in select e from unnest(p_empresas) e where not exists (select 1 from public.fiscal_year f where f.company_id = e) loop
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, previous_year_id, created_by)
    values (p_cuenta, v_e, v_modelo.code, v_modelo.starts_on, v_modelo.ends_on, null, p_actor);
    v_creados := v_creados + 1;
  end loop;

  -- 5. El corte, por conta_fijar_corte, como la persona: su usuario y su cuenta activa, solo aquí.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || p_cuenta::text, true);
  foreach v_e in array p_empresas loop
    v_r := public.conta_fijar_corte(v_e, p_hasta, p_programa);
    v_cortes := v_cortes || jsonb_build_object(v_e::text, v_r);
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);

  -- 6. Las comprobaciones de después.
  v_despues := public._p01_dentro(p_cuenta, p_empresas);
  if exists (select 1 from jsonb_each_text(v_despues) where value <> '0') then
    raise exception 'P01 a cero: después de borrar queda algo dentro: %.', v_despues;
  end if;
  v_fuera_despues := public._p01_fuera(p_cuenta, p_empresas);
  if v_fuera_despues is distinct from v_fuera_antes then
    raise exception 'P01 a cero: fuera de las sociedades algo ha cambiado. Antes %; después %.', v_fuera_antes, v_fuera_despues;
  end if;
  if (select count(distinct trade_name) from public.company where id = any(p_empresas)) <> v_n then
    raise exception 'P01 a cero: los nombres no han quedado distintos.';
  end if;
  if exists (select 1 from unnest(p_empresas) e where public._conta_corte(e) is distinct from p_hasta + 1) then
    raise exception 'P01 a cero: _conta_corte no da el % en todas.', p_hasta + 1;
  end if;

  return jsonb_build_object('borrado', v_dentro, 'fuera_antes', v_fuera_antes, 'fuera_despues', v_fuera_despues,
    'ejercicios_creados', v_creados, 'cortes', v_cortes, 'dia_de_inicio', p_hasta + 1);
end $$;

revoke all on function public._p01_dentro(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public._p01_fuera(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public._p01_a_cero(uuid, uuid[], uuid, date, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._p01_a_cero(uuid, uuid[], uuid, date, text, jsonb) is
  'P01. Deja a cero unas sociedades sin nada contabilizado: borra lo entrado por correo (recibidas, bandeja, correos, propuestas, esperadas y los proveedores de la cuenta), pone trade_name = legal_name, abre el ejercicio que falte y fija el corte con conta_fijar_corte como un administrador. Para si lo que hay no es lo esperado. Solo una tanda.';

-- ── Las tres sociedades del P01 ─────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := 'a175c0b8-2eaf-4285-9688-53042910a86e';
  v_r jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'P01 a cero: sin la cuenta de las tres sociedades, no hay nada que hacer.';
    return;
  end if;
  v_r := public._p01_a_cero(
    v_acc,
    array['328360db-736f-4d45-b4ee-ecf1ca96fa15', 'bd73d3ae-2a43-4896-a70a-73f92b62c065', '86d8022d-7a92-4f9d-9cf9-d53729e96ef1']::uuid[],
    'e298629b-9d34-4d62-9a00-ff7c3fa29a1a',   -- el administrador de la cuenta que lo ha decidido
    date '2026-10-31',                        -- lo de hasta aquí es del programa de antes
    'erp10',                                  -- Cegid ERP despacho
    -- Lo medido el 17/11 (solo leyendo); manda el ensayo: si no coincide, para.
    jsonb_build_object(
      'supplier_invoice', 51, 'supplier_invoice_line', 244, 'supplier_invoice_tax', 60, 'supplier_invoice_change', 2,
      'document_inbox', 73, 'document_activity', 214, 'inbound_email_log', 76, 'conta_propuesta_pendiente', 36,
      'supplier_expected_invoice', 2, 'supplier', 1, 'supplier_contact', 1, 'party_role', 1,
      'company_account_link_proveedor', 1));
  raise notice 'P01 a cero: hecho. %', v_r;
end $$;

-- ── No se dejan restos: las tres funciones, fuera ──────────────────────────────
do $$
begin
  if coalesce(current_setting('p01.prueba_conserva', true), '') = 'si' then
    raise notice 'P01 a cero: la prueba conserva las funciones (solo dentro de su ROLLBACK).';
    return;
  end if;
  drop function public._p01_a_cero(uuid, uuid[], uuid, date, text, jsonb);
  drop function public._p01_fuera(uuid, uuid[]);
  drop function public._p01_dentro(uuid, uuid[]);
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like '\_p01\_%') then
    raise exception 'P01 a cero: quedan funciones _p01_ en la base.';
  end if;
end $$;
