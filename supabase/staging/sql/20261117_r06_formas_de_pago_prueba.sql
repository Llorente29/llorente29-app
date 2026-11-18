-- supabase/staging/sql/20261117_r06_formas_de_pago_prueba.sql
--
-- SOLO STAGING. Prueba del R06 (20261117T2130_r06_formas_de_pago), que el ensayo
-- de staging pone delante en la misma sesión. Todo en una transacción con
-- ROLLBACK: staging no cambia. Lo que crea: public._conta_tpv_formas_de,
-- public._conta_tpv_cuenta_de, public.conta_tpv_formas,
-- public.conta_tpv_asiento_ejemplo y public.conta_tpv_formas_guardar. No cambia
-- nada que exista.
--
-- Monta, dentro de la transacción, una cuenta inventada con un administrador (u)
-- y una empresa con días del TPV (NIF B00000000). El día 09/11 es el ejemplo
-- INVENTADO de Revo del R04, con un pago en efectivo cambiado a «Too Good To Go»,
-- una forma de pago que no tiene cuenta.
--
--   1. Lo que crea y sus permisos.
--   2. El día queda en espera con su frase (la de la propuesta, que no cambia).
--   3. conta_tpv_formas: «Too Good To Go» nueva, con su importe del mes y un día
--      sin validar; Deliverect partido por plataforma, cada una con su cuenta.
--   4. El asiento de ejemplo sin elegir nada: «Too Good To Go» sin cuenta, con
--      su importe; debe y haber, 1.100,00. Y no deja nada escrito.
--   5. El asiento de ejemplo con la cuenta que se está eligiendo: ya no hay
--      ninguna sin cuenta, y sale en la 43000003. Tampoco deja nada escrito.
--   6. Guardar: sin cuenta no guarda y lo dice; con ella, el 09/11 pasa a
--      «Listo para validar», y lo dice con contenido. Un usuario sin permiso no
--      guarda.
--   7. La vuelta atrás quita las cinco funciones.
--
-- Como el cliente: u en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R06: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La cuenta, su administrador, un usuario de solo lectura y la empresa ---------------------
do $$
declare
  u constant uuid := 'ae060000-0000-4000-8000-000000000001';
  v constant uuid := 'ae060000-0000-4000-8000-000000000002';
  x constant uuid := 'ae060000-0000-4000-8000-000000000010';
  t constant uuid := 'ae060000-0000-4000-8000-000000000012';
  c uuid;
  r10 uuid := (select id from public.tax_rate where code = 'iva_reducido' and is_system and valid_to is null limit 1);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'tpv@r06-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', 'mira@r06-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R06', 'r06-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R06', now(), now()), (v, x, 'worker', true, 'Mira R06', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step) values (t, x, 'Prueba R06 TPV, S.L.', 'B00000000', 'nombre');
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (x, t, '2026', date '2026-01-01', date '2026-12-31');
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, sales_tax_rate_code) values (t, x, 'pymes', 8, 'iva_reducido');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (x, t, 'pymes', '70000000', '700', 'Ventas', 'template', 'serie'),
    (x, t, 'pymes', '47700000', '477', 'IVA repercutido', 'template', 'serie'),
    (x, t, 'pymes', '57000000', '570', 'Caja, efectivo', 'template', 'serie'),
    (x, t, 'pymes', '57200001', '572', 'Banco, tarjeta', 'own', 'manual'),
    (x, t, 'pymes', '43000001', '4300', 'Glovo', 'own', 'manual'),
    (x, t, 'pymes', '43000002', '4300', 'Uber Eats', 'own', 'manual'),
    (x, t, 'pymes', '43000003', '4300', 'Too Good To Go', 'own', 'manual');
  select id into c from public.company_account where company_id = t and code = '47700000';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values
    (x, t, c, 'tax_rate', r10::text, 'repercutido', 'manual');
  insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
  select x, t, w.forma, w.canal, a.id, 'Prueba R06'
    from (values ('Efectivo', null, '57000000'), ('Tarjeta', null, '57200001'), ('Deliverect', 'Glovo', '43000001'), ('Deliverect', 'UberEats', '43000002')) w(forma, canal, cuenta)
    join public.company_account a on a.company_id = t and a.code = w.cuenta;
end $$;

-- El día del ejemplo, como lo da el lector (R04), con el primer pago en efectivo cambiado a «Too Good To Go».
create temp table _prueba_r06 (clave text primary key, j jsonb) on commit drop;
insert into _prueba_r06 values ('ejemplo', $ejemplo$
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
update _prueba_r06 set j = jsonb_set(j, array['cobros', (select (o - 1)::text from jsonb_array_elements(j -> 'cobros') with ordinality z(c, o) where c ->> 'forma' = 'Efectivo' order by o limit 1), 'forma'], '"Too Good To Go"')
 where clave = 'ejemplo';
insert into _prueba_r06 select 'tgtg', to_jsonb((select (c ->> 'importe')::numeric from _prueba_r06 p, jsonb_array_elements(p.j -> 'cobros') c where p.clave = 'ejemplo' and c ->> 'forma' = 'Too Good To Go'));
grant select on _prueba_r06 to authenticated;

-- 1 · Lo que crea y sus permisos -------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.conta_tpv_formas(uuid, uuid)') is null or to_regprocedure('public.conta_tpv_asiento_ejemplo(uuid, jsonb)') is null
     or to_regprocedure('public.conta_tpv_formas_guardar(uuid, jsonb, text)') is null then
    raise exception 'PRUEBA R06 · 1: falta una función.';
  end if;
  if has_function_privilege('anon', 'public.conta_tpv_formas(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_tpv_formas_guardar(uuid, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_tpv_formas_de(uuid, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public._conta_tpv_cuenta_de(uuid, text, text)', 'execute') then
    raise exception 'PRUEBA R06 · 1: anon ejecuta una función de las formas de pago, o un usuario una interna.';
  end if;
  raise notice '1 OK: las cinco funciones y sus permisos.';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'ae060000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 2 · El día, en espera con su frase ------------------------------------------------------------
do $$
declare t constant uuid := 'ae060000-0000-4000-8000-000000000012'; r jsonb;
begin
  perform public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', (select j from _prueba_r06 where clave = 'ejemplo'), 'Prueba R06');
  r := public.conta_tpv_dias(t, null, null);
  if r -> 0 ->> 'estado' <> 'en_espera' or r -> 0 ->> 'motivo' <> 'Falta decir a qué cuenta va «Too Good To Go».' then
    raise exception 'PRUEBA R06 · 2: el día no está en espera por «Too Good To Go»: %', r -> 0;
  end if;
  raise notice '2 OK: el 09/11, en espera: %', r -> 0 ->> 'motivo';
end $$;

-- 3 · Las formas de pago, con su cuenta y lo del mes --------------------------------------------
do $$
declare t constant uuid := 'ae060000-0000-4000-8000-000000000012'; r jsonb; n jsonb; v_f text;
begin
  r := public.conta_tpv_formas(t, null);
  select f into n from jsonb_array_elements(r -> 'formas') f where f ->> 'forma' = 'Too Good To Go';
  if n is null or not (n ->> 'nueva')::boolean or n ->> 'cuenta' is not null or (n ->> 'en_mes')::numeric <> (select (j #>> '{}')::numeric from _prueba_r06 where clave = 'tgtg')
     or (n ->> 'dias_sin_validar')::int <> 1 then
    raise exception 'PRUEBA R06 · 3: «Too Good To Go» no sale nueva, con su importe y un día sin validar: %', n;
  end if;
  if r ->> 'mes' <> '2026-11-01' or r ->> 'ejemplo_dia' <> '2026-11-09' then raise exception 'PRUEBA R06 · 3: el mes o el día de ejemplo no son los del 09/11: %', r; end if;
  select string_agg(f ->> 'forma' || coalesce(' · ' || (f ->> 'canal'), '') || ' → ' || coalesce(f ->> 'cuenta', 'sin cuenta') || ' (' || (f ->> 'en_mes') || ')', '; ' order by o)
    into v_f from jsonb_array_elements(r -> 'formas') with ordinality z(f, o);
  if v_f not like '%Deliverect · Glovo → 43000001 (300.00)%' or v_f not like '%Deliverect · UberEats → 43000002 (200.00)%' or v_f not like '%Tarjeta → 57200001 (420.00)%' then
    raise exception 'PRUEBA R06 · 3: Deliverect no sale partido por plataforma con su cuenta, o falta la tarjeta: %', v_f;
  end if;
  raise notice '3 OK: %', v_f;
end $$;

-- 4 · El asiento de ejemplo sin elegir nada: no deja nada escrito ---------------------------------
do $$
declare t constant uuid := 'ae060000-0000-4000-8000-000000000012'; d uuid; r jsonb; antes text; despues text; v_l text;
begin
  select id into d from public.conta_tpv_dia where company_id = t;
  select string_agg(forma || '/' || coalesce(canal, '') || '/' || company_account_id, ',' order by forma, canal) into antes from public.conta_tpv_forma_cuenta where company_id = t;
  r := public.conta_tpv_asiento_ejemplo(d, '[]'::jsonb);
  select string_agg(format('%s %s %s %s', coalesce(l ->> 'cuenta', l ->> 'forma' || ' · sin cuenta'), coalesce(l ->> 'nombre', ''), l ->> 'debe', l ->> 'haber'), E'\n' order by o)
    into v_l from jsonb_array_elements(r -> 'lineas') with ordinality z(l, o);
  if r ->> 'motivo' is not null or (r ->> 'sin_cuenta')::int <> 1 or (r ->> 'debe')::numeric <> 1100 or (r ->> 'haber')::numeric <> 1100
     or not exists (select 1 from jsonb_array_elements(r -> 'lineas') l where (l ->> 'sin_cuenta')::boolean and l ->> 'forma' = 'Too Good To Go'
                     and (l ->> 'debe')::numeric = (select (j #>> '{}')::numeric from _prueba_r06 where clave = 'tgtg')) then
    raise exception 'PRUEBA R06 · 4: el ejemplo no sale con «Too Good To Go» sin cuenta y 1.100,00 a cada lado: %', r;
  end if;
  select string_agg(forma || '/' || coalesce(canal, '') || '/' || company_account_id, ',' order by forma, canal) into despues from public.conta_tpv_forma_cuenta where company_id = t;
  if antes is distinct from despues then raise exception 'PRUEBA R06 · 4: el ejemplo ha dejado algo escrito.'; end if;
  raise notice E'4 OK: el ejemplo sin elegir, sin escribir nada:\n%', v_l;
end $$;

-- 5 · El asiento de ejemplo con la cuenta que se está eligiendo -----------------------------------
do $$
declare t constant uuid := 'ae060000-0000-4000-8000-000000000012'; d uuid; r jsonb; v_c uuid; v_l text;
begin
  select id into d from public.conta_tpv_dia where company_id = t;
  select id into v_c from public.company_account where company_id = t and code = '43000003';
  r := public.conta_tpv_asiento_ejemplo(d, jsonb_build_array(jsonb_build_object('forma', 'Too Good To Go', 'canal', null, 'cuenta_id', v_c)));
  select string_agg(format('%s %s %s %s', l ->> 'cuenta', l ->> 'nombre', l ->> 'debe', l ->> 'haber'), E'\n' order by o)
    into v_l from jsonb_array_elements(r -> 'lineas') with ordinality z(l, o);
  if (r ->> 'sin_cuenta')::int <> 0 or not exists (select 1 from jsonb_array_elements(r -> 'lineas') l where l ->> 'cuenta' = '43000003' and l ->> 'nombre' = 'Too Good To Go')
     or (r ->> 'debe')::numeric <> 1100 then
    raise exception 'PRUEBA R06 · 5: el ejemplo con la cuenta elegida no sale en la 43000003: %', r;
  end if;
  if exists (select 1 from public.conta_tpv_forma_cuenta where company_id = t and lower(forma) = 'too good to go') then
    raise exception 'PRUEBA R06 · 5: el ejemplo ha dejado guardada la cuenta.';
  end if;
  if (public.conta_tpv_dias(t, null, null) -> 0 ->> 'estado') <> 'en_espera' then raise exception 'PRUEBA R06 · 5: el ejemplo ha cambiado el día.'; end if;
  raise notice E'5 OK: el ejemplo con la cuenta elegida, sin guardarla:\n%', v_l;
end $$;
reset role;

-- 6 · Guardar ----------------------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'ae060000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t constant uuid := 'ae060000-0000-4000-8000-000000000012'; v_c uuid; v_msg text;
begin
  select id into v_c from public.company_account where company_id = t and code = '43000003';
  begin
    perform public.conta_tpv_formas_guardar(t, jsonb_build_array(jsonb_build_object('forma', 'Too Good To Go', 'cuenta_id', v_c)), null);
    raise exception 'PRUEBA R06 · 6: un usuario sin permiso ha guardado.';
  exception when insufficient_privilege then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '6a OK: sin permiso no guarda: %', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'ae060000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t constant uuid := 'ae060000-0000-4000-8000-000000000012'; v_c uuid; v_msg text; r jsonb;
begin
  select id into v_c from public.company_account where company_id = t and code = '43000003';
  begin
    perform public.conta_tpv_formas_guardar(t, jsonb_build_array(jsonb_build_object('forma', 'Too Good To Go', 'cuenta_id', null)), null);
    raise exception 'PRUEBA R06 · 6: ha guardado sin cuenta.';
  exception when invalid_parameter_value then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg <> 'Falta elegir a qué cuenta va «Too Good To Go».' then raise exception 'PRUEBA R06 · 6: la frase sin cuenta no es la esperada: %', v_msg; end if;
  r := public.conta_tpv_formas_guardar(t, jsonb_build_array(jsonb_build_object('forma', 'Too Good To Go', 'canal', null, 'cuenta_id', v_c)), null);
  if r ->> 'texto' <> 'Guardado: Too Good To Go a la 43000003 · Too Good To Go. El 09/11 pasa a «Listo para validar». Vale para los días que aún no están validados.' then
    raise exception 'PRUEBA R06 · 6: la frase de guardar no es la esperada: %', r ->> 'texto';
  end if;
  if (public.conta_tpv_dias(t, null, null) -> 0 ->> 'estado') <> 'por_validar' then raise exception 'PRUEBA R06 · 6: el día no ha pasado a por validar.'; end if;
  raise notice '6b OK: sin cuenta: «%». Con ella: «%»', v_msg, r ->> 'texto';
end $$;
reset role;

-- 7 · La vuelta atrás -------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261117T2130_r06_formas_de_pago.down.sql
do $$ begin
  if to_regprocedure('public.conta_tpv_formas(uuid, uuid)') is not null or to_regprocedure('public.conta_tpv_asiento_ejemplo(uuid, jsonb)') is not null
     or to_regprocedure('public.conta_tpv_formas_guardar(uuid, jsonb, text)') is not null or to_regprocedure('public._conta_tpv_formas_de(uuid, uuid[])') is not null
     or to_regprocedure('public._conta_tpv_cuenta_de(uuid, text, text)') is not null then
    raise exception 'PRUEBA R06 · 7: la vuelta atrás dejó algo.';
  end if;
  raise notice '7 OK: la vuelta atrás quita las cinco funciones.';
  raise notice 'PRUEBA R06: 7 de 7 bien.';
end $$;

rollback;
