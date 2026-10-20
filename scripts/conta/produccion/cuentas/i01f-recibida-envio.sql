-- scripts/conta/produccion/cuentas/i01f-recibida-envio.sql
--
-- I01f · LO QUE CUENTA LA TANDA DE LA 0320 (conta_recibida_envio con el
-- tratamiento del IVA y el país del proveedor), antes y después. SOLO LEE.
-- Huellas de definiciones y recuentos de Foodint (regla 9).
--
-- Lo que tiene que pasar: conta_recibida_envio existe antes y después, una
-- sola (sin sobrecarga), y su huella pasa de 6e5ed258… a la de la 0320. Los
-- envíos a Diez de Foodint, IGUAL antes y después (la tanda no envía nada).
select clave, valor from (
  select 1 o, 'conta_recibida_envio (md5 del cuerpo)' clave,
    coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_recibida_envio(uuid)')), 'no existe') valor union all
  select 2, 'conta_recibida_envio (cuántas firmas)',
    (select count(*)::text from pg_proc where proname = 'conta_recibida_envio' and pronamespace = 'public'::regnamespace) union all
  select 3, 'tipos de IVA del catálogo con autoliquidación (código:tratamiento)',
    (select coalesce(string_agg(code || ':' || treatment, ' · ' order by code), 'ninguno') from public.tax_rate where is_system and treatment in ('intra_eu', 'reverse_charge')) union all
  select 4, 'envíos a Diez de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguno')
       from (select status, count(*) n from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x)
) x order by o;
