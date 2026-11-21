-- supabase/staging/sql/20261117_r05_dia_tpv_prueba.sql
--
-- SOLO STAGING. Prueba del R05 (20261117T1601_r05_dia_tpv_asiento,
-- 20261117T1602_r05_dia_tpv_funciones y 20261117T1603_r05_dia_tpv_anulado), que el ensayo de staging pone delante en
-- la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra lo que cambia: public.journal_entry (el disparador nuevo
-- trg_journal_entry_tpv_anulado), y lo que crea: public.conta_tpv_dia.entry_id,
-- public._conta_tpv_propuesta, public.conta_tpv_dias,
-- public.conta_tpv_dia_para_validar y public.conta_tpv_dia_validar.
--
-- Monta, dentro de la transacción, una cuenta inventada con un administrador (u)
-- y tres empresas: F, que vende con Folvy (un local, Glovo, dos ventas del
-- 09/11); T, con días del TPV; y D, con días del TPV y el envío a Diez
-- encendido. El día de T es el ejemplo INVENTADO de Revo (NIF B00000000), tal
-- como lo lee el lector del R04 (lectorRevo.ts), escrito aquí como valores.
--
--   1. La medida de después (regla 31, la misma vara que
--      20261117_r05_medida_antes.sql) y lo que crea.
--   2. Regla 10: el día del TPV se PROPONE Y VALIDA de verdad (con su PDF):
--      Efectivo 180, Tarjeta 420, Glovo 300 y Uber Eats 200 al debe; ventas
--      999,99 e IVA 100,01 al haber; cuadra; el libro de IVA con 5001 a 5048. Se
--      pega el asiento. Validado, ya no se sustituye.
--   3. Falta la cuenta de una forma de pago: el día queda en espera con su
--      frase; y el salto con el día anterior avisa, sin parar.
--   4. Dos tipos de IVA en un día: una línea por tipo, y dos en el libro.
--   5. La devolución resta una vez: con una liquidación subida que lleva el
--      reembolso de ese día, el asiento del TPV es el mismo y Folvy no propone
--      ningún día del local de T. (Y se dice la deuda sabida: con dos empresas
--      en una cuenta, a T le salen los días del local de F.)
--   6. Una empresa que envía a Diez no valida un día del TPV, y lo dice.
--   7. Anular el asiento de un día del TPV lo devuelve a «guardado»: se puede
--      subir otra vez.
--   8. Regla 10, el otro lado: un día de Folvy de F se propone (conta_proponer_dias,
--      el mismo camino que el cron) y se valida; se pega su asiento. Y la
--      propuesta de F es la misma antes y después de todo lo del TPV.
--   9. Las tres vueltas atrás, sobre estos datos.
--
-- Como el cliente: u en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- 1 · La medida de después (regla 31): la misma consulta que la de antes ----------------
do $$
declare v_n int; v_huella text;
begin
  select count(*), md5(coalesce(string_agg(x.k || '=' || public.conta_propuestas_ventas_dia(x.c, x.l, x.d)::text, '|' order by x.k), ''))
    into v_n, v_huella
    from (select distinct s.company_id as c, s.location_id as l, s.sales_day as d, s.company_id || ':' || s.location_id || ':' || s.sales_day as k
            from public.sales_day_summary s) x;
  raise notice 'MEDIDA R05 · después · días de ventas de Folvy (tabla entera) = % · huella de sus propuestas = %', v_n, v_huella;
end $$;

-- 0 · La cuenta, su administrador y las tres empresas ------------------------------------
do $$
declare
  u constant uuid := 'ae050000-0000-4000-8000-000000000001';
  x constant uuid := 'ae050000-0000-4000-8000-000000000010';
  f constant uuid := 'ae050000-0000-4000-8000-000000000011';
  t constant uuid := 'ae050000-0000-4000-8000-000000000012';
  d constant uuid := 'ae050000-0000-4000-8000-000000000013';
  lf constant uuid := 'ae050000-0000-4000-8000-000000000021';
  lt constant uuid := 'ae050000-0000-4000-8000-000000000022';
  ch constant uuid := 'ae050000-0000-4000-8000-000000000031';
  pg constant uuid := 'ae050000-0000-4000-8000-000000000041';
  e uuid; c uuid;
  r10 uuid := (select id from public.tax_rate where code = 'iva_reducido' and is_system and valid_to is null limit 1);
  r21 uuid := (select id from public.tax_rate where code = 'iva_general' and is_system and valid_to is null limit 1);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'tpv@r05-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R05', 'r05-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R05', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step) values
    (f, x, 'Prueba R05 Folvy, S.L.', 'A00000000', 'nombre'), (t, x, 'Prueba R05 TPV, S.L.', 'B00000000', 'nombre'), (d, x, 'Prueba R05 Diez, S.L.', 'E00000000', 'nombre');
  insert into public.locations (id, account_id, name) values (lf, x, 'Local de prueba F'), (lt, x, 'Local de prueba T');
  insert into public.location_company (location_id, company_id, account_id) values (lf, f, x), (lt, t, x);
  foreach e in array array[f, t, d] loop
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (x, e, '2026', date '2026-01-01', date '2026-12-31');
    insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, sales_tax_rate_code) values (e, x, 'pymes', 8, 'iva_reducido');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
      (x, e, 'pymes', '70000000', '700', 'Ventas', 'template', 'serie'),
      (x, e, 'pymes', '47700000', '477', 'IVA repercutido', 'template', 'serie'),
      (x, e, 'pymes', '57000000', '570', 'Caja, efectivo', 'template', 'serie'),
      (x, e, 'pymes', '57200001', '572', 'Banco, tarjeta', 'own', 'manual'),
      (x, e, 'pymes', '43000001', '4300', 'Glovo', 'own', 'manual'),
      (x, e, 'pymes', '43000002', '4300', 'Uber Eats', 'own', 'manual'),
      (x, e, 'pymes', '43000003', '4300', 'Too Good To Go', 'own', 'manual');
    select id into c from public.company_account where company_id = e and code = '47700000';
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values
      (x, e, c, 'tax_rate', r10::text, 'repercutido', 'manual'), (x, e, c, 'tax_rate', r21::text, 'repercutido', 'manual');
  end loop;
  -- T y D: a qué cuenta va cada forma de pago (Deliverect, por el canal de cada orden).
  foreach e in array array[t, d] loop
    insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
    select x, e, v.forma, v.canal, a.id, 'Prueba R05'
      from (values ('Efectivo', null, '57000000'), ('Tarjeta', null, '57200001'), ('Deliverect', 'Glovo', '43000001'), ('Deliverect', 'UberEats', '43000002')) v(forma, canal, cuenta)
      join public.company_account a on a.company_id = e and a.code = v.cuenta;
  end loop;
  insert into public.conta_diez_envio_empresa (company_id, account_id, enviar) values (d, x, true);
  -- F vende con Folvy: Glovo, con su 430 por la plataforma, y dos ventas cerradas del 09/11.
  insert into public.sales_channel (id, account_id, name, slug) values (ch, x, 'Glovo', 'glovo');
  insert into public.party (id, account_id, name) values (pg, x, 'Glovo (prueba R05)');
  insert into public.party_role (account_id, party_id, role, channel_id) values (x, pg, 'platform', ch);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select x, f, a.id, 'customer', pg::text, 'principal', 'manual' from public.company_account a where a.company_id = f and a.code = '43000001';
  insert into public.sale (account_id, location_id, channel_id, source, external_ref, sold_at, total, taxable_base, tax, status, platform_order_code) values
    (x, lf, ch, 'manual', 'r05-prueba-1', timestamptz '2026-11-09 13:00:00+01', 22.00, 20.00, 2.00, 'closed', 'R05-1'),
    (x, lf, ch, 'manual', 'r05-prueba-2', timestamptz '2026-11-09 14:00:00+01', 11.00, 10.00, 1.00, 'closed', 'R05-2');
end $$;

-- El día del ejemplo, como lo da el lector (R04).
create temp table _prueba_r05 (clave text primary key, j jsonb) on commit drop;
insert into _prueba_r05 values ('ejemplo', $ejemplo$
  {"documentos": [
    {"numero":5001,"contador":"Facturas","fecha":"2026-11-09 12:40:30","orden":"700001","canal":"UberEats","nif":null,"cliente":null,"base":30.23,"cuota":3.02,"total":33.25},
    {"numero":5002,"contador":"Facturas","fecha":"2026-11-09 12:53:30","orden":"700002","canal":"UberEats","nif":null,"cliente":null,"base":18.12,"cuota":1.81,"total":19.93},
    {"numero":5003,"contador":"Facturas","fecha":"2026-11-09 13:06:30","orden":"700003","canal":"Glovo","nif":null,"cliente":null,"base":15.78,"cuota":1.58,"total":17.36},
    {"numero":5004,"contador":"Facturas","fecha":"2026-11-09 13:19:30","orden":"700004","canal":"Glovo","nif":null,"cliente":null,"base":32.05,"cuota":3.21,"total":35.26},
    {"numero":5005,"contador":"Facturas","fecha":"2026-11-09 13:32:30","orden":"700005","canal":"--","nif":null,"cliente":null,"base":15.67,"cuota":1.57,"total":17.24},
    {"numero":5006,"contador":"Facturas","fecha":"2026-11-09 13:45:30","orden":"700006","canal":"--","nif":null,"cliente":null,"base":16.19,"cuota":1.62,"total":17.81},
    {"numero":5007,"contador":"Facturas","fecha":"2026-11-09 13:58:30","orden":"700007","canal":"--","nif":"B00000000","cliente":"Cliente de ejemplo 7","base":36.44,"cuota":3.64,"total":40.08},
    {"numero":5008,"contador":"Facturas","fecha":"2026-11-09 14:11:30","orden":"700008","canal":"--","nif":null,"cliente":null,"base":11.22,"cuota":1.12,"total":12.34},
    {"numero":5009,"contador":"Facturas","fecha":"2026-11-09 14:24:30","orden":"700009","canal":"UberEats","nif":null,"cliente":null,"base":19.59,"cuota":1.96,"total":21.55},
    {"numero":5010,"contador":"Facturas","fecha":"2026-11-09 14:37:30","orden":"700010","canal":"--","nif":null,"cliente":null,"base":25.77,"cuota":2.58,"total":28.35},
    {"numero":5011,"contador":"Facturas","fecha":"2026-11-09 14:50:30","orden":"700011","canal":"Glovo","nif":null,"cliente":null,"base":28.1,"cuota":2.81,"total":30.91},
    {"numero":5012,"contador":"Facturas","fecha":"2026-11-09 15:03:30","orden":"700012","canal":"--","nif":null,"cliente":null,"base":35.89,"cuota":3.59,"total":39.48},
    {"numero":5013,"contador":"Facturas","fecha":"2026-11-09 15:16:30","orden":"700013","canal":"UberEats","nif":null,"cliente":null,"base":12.73,"cuota":1.27,"total":14},
    {"numero":5014,"contador":"Facturas","fecha":"2026-11-09 15:29:30","orden":"700014","canal":"--","nif":null,"cliente":null,"base":29.13,"cuota":2.91,"total":32.04},
    {"numero":5015,"contador":"Facturas","fecha":"2026-11-09 15:42:30","orden":"700015","canal":"--","nif":null,"cliente":null,"base":17.75,"cuota":1.77,"total":19.52},
    {"numero":5016,"contador":"Facturas","fecha":"2026-11-09 15:55:30","orden":"700016","canal":"--","nif":null,"cliente":null,"base":23.4,"cuota":2.34,"total":25.74},
    {"numero":5017,"contador":"Facturas","fecha":"2026-11-09 16:08:30","orden":"700017","canal":"--","nif":null,"cliente":null,"base":26.95,"cuota":2.7,"total":29.65},
    {"numero":5018,"contador":"Facturas","fecha":"2026-11-09 16:21:30","orden":"700018","canal":"UberEats","nif":null,"cliente":null,"base":9.84,"cuota":0.98,"total":10.82},
    {"numero":5019,"contador":"Facturas","fecha":"2026-11-09 16:34:30","orden":"700019","canal":"Glovo","nif":null,"cliente":null,"base":34.85,"cuota":3.49,"total":38.34},
    {"numero":5020,"contador":"Facturas","fecha":"2026-11-09 16:47:30","orden":"700020","canal":"--","nif":"B00000000","cliente":"Cliente de ejemplo 20","base":15.57,"cuota":1.56,"total":17.13},
    {"numero":5021,"contador":"Facturas","fecha":"2026-11-09 17:00:30","orden":"700021","canal":"--","nif":null,"cliente":null,"base":17.04,"cuota":1.7,"total":18.74},
    {"numero":5022,"contador":"Facturas","fecha":"2026-11-09 17:13:30","orden":"700022","canal":"UberEats","nif":null,"cliente":null,"base":8.53,"cuota":0.85,"total":9.38},
    {"numero":5023,"contador":"Facturas","fecha":"2026-11-09 17:26:30","orden":"700023","canal":"--","nif":null,"cliente":null,"base":20.5,"cuota":2.05,"total":22.55},
    {"numero":5024,"contador":"Facturas","fecha":"2026-11-09 17:39:30","orden":"700024","canal":"UberEats","nif":null,"cliente":null,"base":27.36,"cuota":2.74,"total":30.1},
    {"numero":5025,"contador":"Facturas","fecha":"2026-11-09 17:52:30","orden":"700025","canal":"--","nif":null,"cliente":null,"base":14.13,"cuota":1.41,"total":15.54},
    {"numero":5026,"contador":"Facturas","fecha":"2026-11-09 18:05:30","orden":"700026","canal":"UberEats","nif":null,"cliente":null,"base":30.1,"cuota":3.01,"total":33.11},
    {"numero":5027,"contador":"Facturas","fecha":"2026-11-09 18:18:30","orden":"700027","canal":"Glovo","nif":null,"cliente":null,"base":13.93,"cuota":1.39,"total":15.32},
    {"numero":5028,"contador":"Facturas","fecha":"2026-11-09 18:31:30","orden":"700028","canal":"--","nif":null,"cliente":null,"base":40,"cuota":4,"total":44},
    {"numero":5029,"contador":"Facturas","fecha":"2026-11-09 18:44:30","orden":"700029","canal":"--","nif":null,"cliente":null,"base":13.26,"cuota":1.33,"total":14.59},
    {"numero":5030,"contador":"Facturas","fecha":"2026-11-09 18:57:30","orden":"700030","canal":"--","nif":null,"cliente":null,"base":24.21,"cuota":2.42,"total":26.63},
    {"numero":5031,"contador":"Facturas","fecha":"2026-11-09 19:10:30","orden":"700031","canal":"Glovo","nif":null,"cliente":null,"base":26.58,"cuota":2.66,"total":29.24},
    {"numero":5032,"contador":"Facturas","fecha":"2026-11-09 19:23:30","orden":"700032","canal":"--","nif":null,"cliente":null,"base":11.35,"cuota":1.14,"total":12.49},
    {"numero":5033,"contador":"Facturas","fecha":"2026-11-09 19:36:30","orden":"700033","canal":"--","nif":null,"cliente":null,"base":20.47,"cuota":2.05,"total":22.52},
    {"numero":5034,"contador":"Facturas","fecha":"2026-11-09 19:49:30","orden":"700034","canal":"--","nif":null,"cliente":null,"base":12.89,"cuota":1.29,"total":14.18},
    {"numero":5035,"contador":"Facturas","fecha":"2026-11-09 20:02:30","orden":"700035","canal":"--","nif":null,"cliente":null,"base":22.48,"cuota":2.25,"total":24.73},
    {"numero":5036,"contador":"Facturas","fecha":"2026-11-09 20:15:30","orden":"700036","canal":"Glovo","nif":null,"cliente":null,"base":8.79,"cuota":0.88,"total":9.67},
    {"numero":5037,"contador":"Facturas","fecha":"2026-11-09 20:28:30","orden":"700037","canal":"--","nif":null,"cliente":null,"base":10.87,"cuota":1.09,"total":11.96},
    {"numero":5038,"contador":"Facturas","fecha":"2026-11-09 20:41:30","orden":"700038","canal":"UberEats","nif":null,"cliente":null,"base":25.33,"cuota":2.53,"total":27.86},
    {"numero":5039,"contador":"Facturas","fecha":"2026-11-09 20:54:30","orden":"700039","canal":"Glovo","nif":null,"cliente":null,"base":32.39,"cuota":3.24,"total":35.63},
    {"numero":5040,"contador":"Facturas","fecha":"2026-11-09 21:07:30","orden":"700040","canal":"Glovo","nif":null,"cliente":null,"base":21.7,"cuota":2.17,"total":23.87},
    {"numero":5041,"contador":"Facturas","fecha":"2026-11-09 21:20:30","orden":"700041","canal":"--","nif":null,"cliente":null,"base":32.51,"cuota":3.25,"total":35.76},
    {"numero":5042,"contador":"Facturas","fecha":"2026-11-09 21:33:30","orden":"700042","canal":"--","nif":null,"cliente":null,"base":15.12,"cuota":1.51,"total":16.63},
    {"numero":5043,"contador":"Facturas","fecha":"2026-11-09 21:46:30","orden":"700043","canal":"Glovo","nif":null,"cliente":null,"base":18.94,"cuota":1.89,"total":20.83},
    {"numero":5044,"contador":"Facturas","fecha":"2026-11-09 21:59:30","orden":"700044","canal":"--","nif":null,"cliente":null,"base":18.36,"cuota":1.84,"total":20.2},
    {"numero":5045,"contador":"Facturas","fecha":"2026-11-09 22:12:30","orden":"700045","canal":"Glovo","nif":null,"cliente":null,"base":26.55,"cuota":2.65,"total":29.2},
    {"numero":5046,"contador":"Facturas","fecha":"2026-11-09 22:25:30","orden":"700046","canal":"--","nif":null,"cliente":null,"base":18.27,"cuota":1.83,"total":20.1},
    {"numero":5047,"contador":"Facturas","fecha":"2026-11-09 22:38:30","orden":"700047","canal":"Glovo","nif":null,"cliente":null,"base":-10,"cuota":-1,"total":-11},
    {"numero":5048,"contador":"Facturas","fecha":"2026-11-09 22:51:30","orden":"700048","canal":"Glovo","nif":null,"cliente":null,"base":23.06,"cuota":2.31,"total":25.37}
  ],
  "impuestos": [
    {"orden":"700001","tipo":10,"base":30.23,"cuota":3.02},
    {"orden":"700002","tipo":10,"base":18.12,"cuota":1.81},
    {"orden":"700003","tipo":10,"base":15.78,"cuota":1.58},
    {"orden":"700004","tipo":10,"base":32.05,"cuota":3.21},
    {"orden":"700005","tipo":10,"base":15.67,"cuota":1.57},
    {"orden":"700006","tipo":10,"base":16.19,"cuota":1.62},
    {"orden":"700007","tipo":10,"base":36.44,"cuota":3.64},
    {"orden":"700008","tipo":10,"base":11.22,"cuota":1.12},
    {"orden":"700009","tipo":10,"base":19.59,"cuota":1.96},
    {"orden":"700010","tipo":10,"base":25.77,"cuota":2.58},
    {"orden":"700011","tipo":10,"base":28.1,"cuota":2.81},
    {"orden":"700012","tipo":10,"base":35.89,"cuota":3.59},
    {"orden":"700013","tipo":10,"base":12.73,"cuota":1.27},
    {"orden":"700014","tipo":10,"base":29.13,"cuota":2.91},
    {"orden":"700015","tipo":10,"base":17.75,"cuota":1.77},
    {"orden":"700016","tipo":10,"base":23.4,"cuota":2.34},
    {"orden":"700017","tipo":10,"base":26.95,"cuota":2.7},
    {"orden":"700018","tipo":10,"base":9.84,"cuota":0.98},
    {"orden":"700019","tipo":10,"base":34.85,"cuota":3.49},
    {"orden":"700020","tipo":10,"base":15.57,"cuota":1.56},
    {"orden":"700021","tipo":10,"base":17.04,"cuota":1.7},
    {"orden":"700022","tipo":10,"base":8.53,"cuota":0.85},
    {"orden":"700023","tipo":10,"base":20.5,"cuota":2.05},
    {"orden":"700024","tipo":10,"base":27.36,"cuota":2.74},
    {"orden":"700025","tipo":10,"base":14.13,"cuota":1.41},
    {"orden":"700026","tipo":10,"base":30.1,"cuota":3.01},
    {"orden":"700027","tipo":10,"base":13.93,"cuota":1.39},
    {"orden":"700028","tipo":10,"base":40,"cuota":4},
    {"orden":"700029","tipo":10,"base":13.26,"cuota":1.33},
    {"orden":"700030","tipo":10,"base":24.21,"cuota":2.42},
    {"orden":"700031","tipo":10,"base":26.58,"cuota":2.66},
    {"orden":"700032","tipo":10,"base":11.35,"cuota":1.14},
    {"orden":"700033","tipo":10,"base":20.47,"cuota":2.05},
    {"orden":"700034","tipo":10,"base":12.89,"cuota":1.29},
    {"orden":"700035","tipo":10,"base":22.48,"cuota":2.25},
    {"orden":"700036","tipo":10,"base":8.79,"cuota":0.88},
    {"orden":"700037","tipo":10,"base":10.87,"cuota":1.09},
    {"orden":"700038","tipo":10,"base":25.33,"cuota":2.53},
    {"orden":"700039","tipo":10,"base":32.39,"cuota":3.24},
    {"orden":"700040","tipo":10,"base":21.7,"cuota":2.17},
    {"orden":"700041","tipo":10,"base":32.51,"cuota":3.25},
    {"orden":"700042","tipo":10,"base":15.12,"cuota":1.51},
    {"orden":"700043","tipo":10,"base":18.94,"cuota":1.89},
    {"orden":"700044","tipo":10,"base":18.36,"cuota":1.84},
    {"orden":"700045","tipo":10,"base":26.55,"cuota":2.65},
    {"orden":"700046","tipo":10,"base":18.27,"cuota":1.83},
    {"orden":"700047","tipo":10,"base":-10,"cuota":-1},
    {"orden":"700048","tipo":10,"base":23.06,"cuota":2.31}
  ],
  "cobros": [
    {"fila":2,"orden":"700001","forma":"Deliverect","importe":33.25},
    {"fila":3,"orden":"700002","forma":"Deliverect","importe":19.93},
    {"fila":4,"orden":"700003","forma":"Deliverect","importe":17.36},
    {"fila":5,"orden":"700004","forma":"Deliverect","importe":35.26},
    {"fila":6,"orden":"700005","forma":"Efectivo","importe":17.24},
    {"fila":7,"orden":"700006","forma":"Efectivo","importe":17.81},
    {"fila":8,"orden":"700007","forma":"Tarjeta","importe":40.08},
    {"fila":9,"orden":"700008","forma":"Efectivo","importe":12.34},
    {"fila":10,"orden":"700009","forma":"Deliverect","importe":21.55},
    {"fila":11,"orden":"700010","forma":"Tarjeta","importe":28.35},
    {"fila":12,"orden":"700011","forma":"Deliverect","importe":30.91},
    {"fila":13,"orden":"700012","forma":"Tarjeta","importe":39.48},
    {"fila":14,"orden":"700013","forma":"Deliverect","importe":14},
    {"fila":15,"orden":"700014","forma":"Tarjeta","importe":32.04},
    {"fila":16,"orden":"700015","forma":"Efectivo","importe":19.52},
    {"fila":17,"orden":"700016","forma":"Efectivo","importe":25.74},
    {"fila":18,"orden":"700017","forma":"Tarjeta","importe":29.65},
    {"fila":19,"orden":"700018","forma":"Deliverect","importe":10.82},
    {"fila":20,"orden":"700019","forma":"Deliverect","importe":38.34},
    {"fila":21,"orden":"700020","forma":"Tarjeta","importe":17.13},
    {"fila":22,"orden":"700021","forma":"Tarjeta","importe":18.74},
    {"fila":23,"orden":"700022","forma":"Deliverect","importe":9.38},
    {"fila":24,"orden":"700023","forma":"Tarjeta","importe":22.55},
    {"fila":25,"orden":"700024","forma":"Deliverect","importe":30.1},
    {"fila":26,"orden":"700025","forma":"Tarjeta","importe":15.54},
    {"fila":27,"orden":"700026","forma":"Deliverect","importe":33.11},
    {"fila":28,"orden":"700027","forma":"Deliverect","importe":15.32},
    {"fila":29,"orden":"700028","forma":"Efectivo","importe":20},
    {"fila":30,"orden":"700028","forma":"Tarjeta","importe":24},
    {"fila":31,"orden":"700029","forma":"Tarjeta","importe":14.59},
    {"fila":32,"orden":"700030","forma":"Tarjeta","importe":26.63},
    {"fila":33,"orden":"700031","forma":"Deliverect","importe":29.24},
    {"fila":34,"orden":"700032","forma":"Tarjeta","importe":12.49},
    {"fila":35,"orden":"700033","forma":"Efectivo","importe":22.52},
    {"fila":36,"orden":"700034","forma":"Tarjeta","importe":14.18},
    {"fila":37,"orden":"700035","forma":"Efectivo","importe":24.73},
    {"fila":38,"orden":"700036","forma":"Deliverect","importe":9.67},
    {"fila":39,"orden":"700037","forma":"Tarjeta","importe":11.96},
    {"fila":40,"orden":"700038","forma":"Deliverect","importe":27.86},
    {"fila":41,"orden":"700039","forma":"Deliverect","importe":35.63},
    {"fila":42,"orden":"700040","forma":"Deliverect","importe":23.87},
    {"fila":43,"orden":"700041","forma":"Tarjeta","importe":35.76},
    {"fila":44,"orden":"700042","forma":"Tarjeta","importe":16.63},
    {"fila":45,"orden":"700043","forma":"Deliverect","importe":20.83},
    {"fila":46,"orden":"700044","forma":"Tarjeta","importe":20.2},
    {"fila":47,"orden":"700045","forma":"Deliverect","importe":29.2},
    {"fila":48,"orden":"700046","forma":"Efectivo","importe":20.1},
    {"fila":49,"orden":"700047","forma":"Deliverect","importe":-11},
    {"fila":50,"orden":"700048","forma":"Deliverect","importe":25.37}
  ]}
$ejemplo$::jsonb);
-- La propuesta de F antes de todo lo del TPV (para el 8).
insert into _prueba_r05 values ('folvy_antes', to_jsonb(md5(public.conta_propuesta_ventas_dia('ae050000-0000-4000-8000-000000000011', 'ae050000-0000-4000-8000-000000000021', date '2026-11-09')::text)));
grant select on _prueba_r05 to authenticated;

-- Simula la subida de un PDF al bucket (como 20261021_conta_documentos_prueba.sql).
create function pg_temp.r05_pdf(p_cuenta uuid, p_entry uuid, p_sha text, p_bytes int) returns text language plpgsql security definer as $f$
declare r text := p_cuenta || '/' || p_entry || '/' || left(p_sha, 16) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', r, jsonb_build_object('size', p_bytes, 'mimetype', 'application/pdf'));
  return r;
end $f$;
-- El asiento en líneas, para pegarlo.
create function pg_temp.r05_asiento(p_entry uuid) returns text language sql as $f$
  select e.number || ' · ' || e.status || ' · ' || e.concept || E'\n' || string_agg(
           format('    %s %-22s %10s %10s  %s', a.code, left(a.name, 22), case when l.debit <> 0 then to_char(l.debit, 'FM999990.00') else '' end,
                  case when l.credit <> 0 then to_char(l.credit, 'FM999990.00') else '' end, l.concept), E'\n' order by l.position)
    from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
   where e.id = p_entry group by e.number, e.status, e.concept
$f$;
grant execute on function pg_temp.r05_pdf(uuid, uuid, text, int) to authenticated;
grant execute on function pg_temp.r05_asiento(uuid) to authenticated;

-- 1 · Lo que crea ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_tpv_dia' and column_name = 'entry_id') then
    raise exception 'PRUEBA R05 · 1: falta conta_tpv_dia.entry_id.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.journal_entry'::regclass and tgname = 'trg_journal_entry_tpv_anulado') then
    raise exception 'PRUEBA R05 · 1: falta el disparador de public.journal_entry.';
  end if;
  if has_function_privilege('authenticated', 'public._conta_tpv_propuesta(uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_tpv_dias(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.conta_tpv_dia_validar(uuid, uuid, integer, text, text, text, integer, text)', 'execute') then
    raise exception 'PRUEBA R05 · 1: anon ejecuta una función del día del TPV, o un usuario la interna.';
  end if;
  raise notice '1 OK: conta_tpv_dia.entry_id, el disparador de journal_entry y los permisos.';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'ae050000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 2 · Regla 10: el día del TPV, propuesto y validado de verdad ---------------------------------
do $$
declare
  t constant uuid := 'ae050000-0000-4000-8000-000000000012';
  r jsonb; v_dia uuid; p jsonb; v_entry uuid := 'ae050000-0000-4000-8000-0000000000e2'; v_sha text := repeat('ab', 32); v_ruta text; v_l text; v_msg text;
begin
  r := public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', (select j from _prueba_r05 where clave = 'ejemplo'), 'Prueba R05');
  v_dia := (r ->> 'id')::uuid;
  r := public.conta_tpv_dias(t, null, null);
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'estado' <> 'por_validar' or r -> 0 ->> 'motivo' is not null or (r -> 0 ->> 'facturas')::int <> 48
     or r -> 0 ->> 'aviso' is not null or (r -> 0 ->> 'con_nif')::int <> 2 then
    raise exception 'PRUEBA R05 · 2: la lista no da el día por validar: %', r;
  end if;
  p := public.conta_tpv_dia_para_validar(v_dia);
  select string_agg(l ->> 'cuenta' || ' ' || (l ->> 'debe') || '/' || (l ->> 'haber'), ' · ' order by o) into v_l from jsonb_array_elements(p -> 'lineas') with ordinality z(l, o);
  if v_l <> '43000001 300.00/0.00 · 43000002 200.00/0.00 · 57000000 180.00/0.00 · 57200001 420.00/0.00 · 47700000 0.00/100.01 · 70000000 0.00/999.99' then
    raise exception 'PRUEBA R05 · 2: el asiento que saldría no es el del ejemplo: %', v_l;
  end if;
  v_ruta := pg_temp.r05_pdf('ae050000-0000-4000-8000-000000000010', v_entry, v_sha, 4321);
  r := public.conta_tpv_dia_validar(v_dia, v_entry, (p ->> 'numero_previsto')::int, v_ruta, 'ResumenDeVentas_TPV_2026-11-09.pdf', v_sha, 4321, 'Prueba R05');
  raise notice '2 · devuelve: %', r ->> 'texto';
  raise notice E'2 · EL ASIENTO DEL TPV (regla 10):\n%', pg_temp.r05_asiento(v_entry);
  if (select status from public.journal_entry where id = v_entry) <> 'validado'
     or (select sum(debit) from public.journal_line where entry_id = v_entry) <> 1100 or (select sum(credit) from public.journal_line where entry_id = v_entry) <> 1100 then
    raise exception 'PRUEBA R05 · 2: el asiento no está validado o no cuadra a 1.100,00.';
  end if;
  if (select string_agg(concat_ws(' ', invoice_type, number, number_to, documents_count, tax_base, tax_amount, counterpart_name), ' | ') from public.vat_book_entry where entry_id = v_entry and book = 'issued')
     <> 'F4 5001 5048 48 999.99 100.01 VENTAS A CONSUMIDOR FINAL' then
    raise exception 'PRUEBA R05 · 2: el libro de IVA no lleva el rango del TPV: %',
      (select string_agg(concat_ws(' ', invoice_type, number, number_to, documents_count, tax_base, tax_amount, counterpart_name), ' | ') from public.vat_book_entry where entry_id = v_entry);
  end if;
  if not exists (select 1 from public.journal_entry_document where entry_id = v_entry and kind = 'resumen_ventas' and storage_path = v_ruta)
     or (select estado || ':' || entry_id from public.conta_tpv_dia where id = v_dia) <> 'contabilizado:' || v_entry
     or public.conta_tpv_dias(t, null, null) -> 0 ->> 'estado' <> 'validado' then
    raise exception 'PRUEBA R05 · 2: falta el PDF, o el día no queda contabilizado y validado en la lista.';
  end if;
  raise notice '2 OK: validado con su PDF, cuadra a 1.100,00, el libro con F4 de la 5001 a la 5048 (48 facturas), y el día contabilizado.';
  -- Validado, ya no se sustituye (la parada del R03).
  begin
    perform public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', (select j from _prueba_r05 where clave = 'ejemplo'), 'Prueba R05');
    raise exception 'PRUEBA R05 · 2: un día validado se ha sustituido.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '2 OK: después de validar no se sustituye: «%»', v_msg;
end $$;

-- 3 · Falta una cuenta: en espera con su frase; y el salto avisa -------------------------------
do $$
declare
  t constant uuid := 'ae050000-0000-4000-8000-000000000012';
  j jsonb := (select j from _prueba_r05 where clave = 'ejemplo'); r jsonb; x jsonb; v_dia uuid; v_msg text;
begin
  -- El 10/11: las mismas ventas, de la 5051 a la 5098 (faltan la 5049 y la 5050), y un pago con Too Good To Go.
  j := jsonb_build_object(
    'documentos', (select jsonb_agg(jsonb_set(jsonb_set(d, '{numero}', to_jsonb((d ->> 'numero')::int + 50)), '{fecha}', to_jsonb(replace(d ->> 'fecha', '2026-11-09', '2026-11-10'))))
                     from jsonb_array_elements(j -> 'documentos') d),
    'impuestos', j -> 'impuestos',
    'cobros', (select jsonb_agg(case when c ->> 'orden' = '700005' then jsonb_set(c, '{forma}', '"Too Good To Go"') else c end) from jsonb_array_elements(j -> 'cobros') c));
  v_dia := (public.conta_tpv_dia_guardar(t, date '2026-11-10', 'revo', j, 'Prueba R05') ->> 'id')::uuid;
  select e into x from jsonb_array_elements(public.conta_tpv_dias(t, null, null)) e where e ->> 'dia' = '2026-11-10';
  if x ->> 'estado' <> 'en_espera' or x ->> 'motivo' <> 'Falta decir a qué cuenta va «Too Good To Go».' then
    raise exception 'PRUEBA R05 · 3: sin la cuenta de Too Good To Go el día no queda en espera con su frase: %', x;
  end if;
  if x ->> 'aviso' <> 'Entre el 09/11 y el 10/11 faltan las facturas 5049 a 5050, o falta por subir un día.' then
    raise exception 'PRUEBA R05 · 3: el salto no avisa como se espera: %', x ->> 'aviso';
  end if;
  begin
    perform public.conta_tpv_dia_para_validar(v_dia);
    raise exception 'PRUEBA R05 · 3: un día sin la cuenta de una forma de pago se puede validar.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '3 OK: en espera: «%» · aviso: «%» · al validar: «%»', x ->> 'motivo', x ->> 'aviso', v_msg;
end $$;
reset role;
insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
select a.account_id, a.company_id, 'Too Good To Go', null, a.id, 'Prueba R05' from public.company_account a
 where a.company_id = 'ae050000-0000-4000-8000-000000000012' and a.code = '43000003';
set local role authenticated;
do $$
declare x jsonb;
begin
  select e into x from jsonb_array_elements(public.conta_tpv_dias('ae050000-0000-4000-8000-000000000012', null, null)) e where e ->> 'dia' = '2026-11-10';
  if x ->> 'estado' <> 'por_validar' then raise exception 'PRUEBA R05 · 3: con la cuenta puesta, el día sigue sin poder validarse: %', x; end if;
  raise notice '3 OK: con su cuenta, el 10/11 pasa a por validar (el aviso del salto sigue, no para).';
end $$;

-- 4 · Dos tipos de IVA en un día ------------------------------------------------------------------
do $$
declare
  t constant uuid := 'ae050000-0000-4000-8000-000000000012';
  v_dia uuid; p jsonb; r jsonb; v_entry uuid := 'ae050000-0000-4000-8000-0000000000e4'; v_sha text := repeat('cd', 32); v_l text;
begin
  v_dia := (public.conta_tpv_dia_guardar(t, date '2026-11-11', 'revo',
    '{"documentos":[{"numero":5099,"contador":"Facturas","fecha":"2026-11-11 13:00:00","orden":"710001","canal":"--","base":10.00,"cuota":1.00,"total":11.00},
                    {"numero":5100,"contador":"Facturas","fecha":"2026-11-11 14:00:00","orden":"710002","canal":"--","base":10.00,"cuota":2.10,"total":12.10}],
      "impuestos":[{"orden":"710001","tipo":10,"base":10.00,"cuota":1.00},{"orden":"710002","tipo":21,"base":10.00,"cuota":2.10}],
      "cobros":[{"fila":2,"orden":"710001","forma":"Efectivo","importe":11.00},{"fila":3,"orden":"710002","forma":"Efectivo","importe":12.10}]}'::jsonb, 'Prueba R05') ->> 'id')::uuid;
  p := public.conta_tpv_dia_para_validar(v_dia);
  select string_agg(l ->> 'cuenta' || ' ' || (l ->> 'debe') || '/' || (l ->> 'haber') || coalesce(' al ' || (l ->> 'tipo'), ''), ' · ' order by o) into v_l from jsonb_array_elements(p -> 'lineas') with ordinality z(l, o);
  if v_l <> '57000000 23.10/0.00 · 47700000 0.00/1.00 al 10.00 · 47700000 0.00/2.10 al 21.00 · 70000000 0.00/20.00' then
    raise exception 'PRUEBA R05 · 4: con dos tipos el asiento no lleva una línea por tipo: %', v_l;
  end if;
  r := public.conta_tpv_dia_validar(v_dia, v_entry, (p ->> 'numero_previsto')::int, pg_temp.r05_pdf('ae050000-0000-4000-8000-000000000010', v_entry, v_sha, 1234),
                                    'ResumenDeVentas_TPV_2026-11-11.pdf', v_sha, 1234, 'Prueba R05');
  if (select string_agg(tax_rate || ':' || tax_base || ':' || tax_amount || ':' || number || '-' || number_to, ' ' order by tax_rate) from public.vat_book_entry where entry_id = v_entry and book = 'issued')
     <> '10.00:10.00:1.00:5099-5100 21.00:10.00:2.10:5099-5100' then
    raise exception 'PRUEBA R05 · 4: el libro no lleva una anotación por tipo: %', (select string_agg(tax_rate || ':' || tax_base || ':' || tax_amount, ' ') from public.vat_book_entry where entry_id = v_entry);
  end if;
  raise notice '4 OK: dos tipos, dos líneas (% ) y dos anotaciones en el libro.', v_l;
end $$;

-- 5 · La devolución resta una vez, aunque haya una liquidación subida con su reembolso -------------
reset role;
do $$
declare
  t constant uuid := 'ae050000-0000-4000-8000-000000000012'; lt constant uuid := 'ae050000-0000-4000-8000-000000000022';
  v_dia uuid := (select id from public.conta_tpv_dia where company_id = t and dia = date '2026-11-10'); v_antes text; v_despues text;
begin
  v_antes := md5((public._conta_tpv_propuesta(v_dia) -> 'lineas')::text);
  insert into public.channel_settlement_order (account_id, import_key, location_id, order_date, platform_order_code, incidents_refund)
  values ('ae050000-0000-4000-8000-000000000010', 'r05-prueba-reembolso', lt, date '2026-11-10', 'GLOVO: 146', -11.00);
  v_despues := md5((public._conta_tpv_propuesta(v_dia) -> 'lineas')::text);
  if v_antes <> v_despues then raise exception 'PRUEBA R05 · 5: el reembolso de la liquidación ha cambiado el asiento del TPV.'; end if;
  -- Lo que restaría dos veces es un día de Folvy del local de T: no hay ninguno (T no vende con Folvy).
  if exists (select 1 from public.conta_dias_por_asentar(t, date '2026-11-01', date '2026-11-30') x where x.location_id = lt) then
    raise exception 'PRUEBA R05 · 5: Folvy propondría un día del local de T (y el reembolso restaría otra vez).';
  end if;
  -- La deuda que ya se sabe (unión «solo por cuenta» de Folvy, no se arregla aquí): para T salen los días del local de F.
  raise notice '5 · deuda sabida, no de este PR: conta_dias_por_asentar(T) devuelve % día(s) del local de F (la unión «solo por cuenta»).',
    (select count(*) from public.conta_dias_por_asentar(t, date '2026-11-01', date '2026-11-30') x where x.location_id <> lt);
  if (select count(*) from public.conta_devoluciones_del_dia(t, lt, date '2026-11-10')) <> 1 then
    raise exception 'PRUEBA R05 · 5: la liquidación de prueba no lleva su reembolso (la prueba no mediría nada).';
  end if;
  raise notice '5 OK: con la liquidación y su reembolso de 11,00 subidos, el asiento del TPV es el mismo (%), y Folvy no propone ningún día del local de T: resta una vez, en la factura negativa.', v_despues;
end $$;
set local role authenticated;

-- 6 · Una empresa que envía a Diez no valida un día del TPV ---------------------------------------
do $$
declare d constant uuid := 'ae050000-0000-4000-8000-000000000013'; v_dia uuid; x jsonb; v_msg text;
begin
  v_dia := (public.conta_tpv_dia_guardar(d, date '2026-11-09', 'revo', (select j from _prueba_r05 where clave = 'ejemplo'), 'Prueba R05') ->> 'id')::uuid;
  x := public.conta_tpv_dias(d, null, null) -> 0;
  if x ->> 'estado' <> 'en_espera' or x ->> 'motivo' <> 'Esta empresa envía su contabilidad a Diez, y las ventas de un TPV de fuera todavía no se pueden enviar a Diez.' then
    raise exception 'PRUEBA R05 · 6: con Diez encendido el día no queda en espera con su frase: %', x;
  end if;
  begin
    perform public.conta_tpv_dia_validar(v_dia, gen_random_uuid(), 1, 'x', 'x.pdf', repeat('ef', 32), 1, 'Prueba R05');
    raise exception 'PRUEBA R05 · 6: con Diez encendido se ha validado un día del TPV.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '6 OK: «%»', v_msg;
end $$;

-- 7 · Anular el asiento devuelve el día a «guardado» --------------------------------------------
do $$
declare t constant uuid := 'ae050000-0000-4000-8000-000000000012'; v_entry uuid := 'ae050000-0000-4000-8000-0000000000e2'; r jsonb;
begin
  perform public.journal_entry_anular(v_entry, 'Prueba R05: se sube corregido', date '2026-11-12', 'Prueba R05');
  if (select status from public.journal_entry where id = v_entry) <> 'anulado'
     or (select estado || ':' || coalesce(entry_id::text, 'sin asiento') from public.conta_tpv_dia where company_id = t and dia = date '2026-11-09') <> 'guardado:sin asiento' then
    raise exception 'PRUEBA R05 · 7: anulado el asiento, el día no ha vuelto a «guardado».';
  end if;
  r := public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', (select j from _prueba_r05 where clave = 'ejemplo'), 'Prueba R05');
  if not (r ->> 'sustituido')::boolean then raise exception 'PRUEBA R05 · 7: después de anular, subirlo otra vez no lo sustituye.'; end if;
  raise notice '7 OK: anulado el asiento, el 09/11 vuelve a «guardado» y se sube otra vez: «%»', r ->> 'texto';
end $$;
reset role;

-- 8 · Regla 10, el otro lado: un día de Folvy, propuesto y validado; F no cambia ----------------------
do $$
declare
  f constant uuid := 'ae050000-0000-4000-8000-000000000011'; lf constant uuid := 'ae050000-0000-4000-8000-000000000021';
  r jsonb; v_entry uuid;
begin
  if md5(public.conta_propuesta_ventas_dia(f, lf, date '2026-11-09')::text) <> (select j #>> '{}' from _prueba_r05 where clave = 'folvy_antes') then
    raise exception 'PRUEBA R05 · 8: la propuesta de Folvy de F ha cambiado con lo del TPV.';
  end if;
  if public.conta_tpv_dias(f, null, null) <> '[]'::jsonb then raise exception 'PRUEBA R05 · 8: F tiene días del TPV.'; end if;
  r := public.conta_proponer_dias(f, timestamptz '2026-11-17 12:00:00+01', 'Prueba R05');
  select id into v_entry from public.journal_entry where company_id = f and source_type = 'sales_day' and status = 'propuesto';
  if v_entry is null then raise exception 'PRUEBA R05 · 8: el día de Folvy no se ha propuesto: %', r; end if;
end $$;
set local role authenticated;
do $$
declare v_entry uuid := (select id from public.journal_entry where company_id = 'ae050000-0000-4000-8000-000000000011' and source_type = 'sales_day' and status = 'propuesto');
begin
  perform public.journal_entry_validar(v_entry, 'Prueba R05');
  raise notice E'8 · EL ASIENTO DE FOLVY (regla 10):\n%', pg_temp.r05_asiento(v_entry);
  if (select status from public.journal_entry where id = v_entry) <> 'validado' then raise exception 'PRUEBA R05 · 8: el día de Folvy no se ha validado.'; end if;
  raise notice '8 OK: el día de Folvy de F se propone por el camino del cron y se valida, y su propuesta es la misma antes y después de lo del TPV.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 9 · Las tres vueltas atrás, sobre estos datos (la de la 1601 para si hay días validados, a propósito:
-- se quitan antes los días de la prueba) -----------------------------------------------------------
delete from public.conta_tpv_dia where account_id = 'ae050000-0000-4000-8000-000000000010';
\i supabase/vuelta-atras/20261117T1603_r05_dia_tpv_anulado.down.sql
\i supabase/vuelta-atras/20261117T1602_r05_dia_tpv_funciones.down.sql
\i supabase/vuelta-atras/20261117T1601_r05_dia_tpv_asiento.down.sql
do $$ begin
  if to_regprocedure('public.conta_tpv_dia_validar(uuid, uuid, integer, text, text, text, integer, text)') is not null or to_regprocedure('public._conta_tpv_propuesta(uuid)') is not null
     or to_regprocedure('public.conta_tpv_dias(uuid, date, date)') is not null or to_regprocedure('public.conta_tpv_dia_para_validar(uuid)') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.journal_entry'::regclass and tgname = 'trg_journal_entry_tpv_anulado')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_tpv_dia' and column_name = 'entry_id') then
    raise exception 'PRUEBA R05 · 9: la vuelta atrás dejó algo.';
  end if;
  raise notice '9 OK: las tres vueltas atrás quitan las funciones, el disparador y el enlace.';
  raise notice 'PRUEBA R05: 9 de 9 bien.';
end $$;

rollback;
