-- scripts/conta/produccion/cuentas/i01d-autoliquidaciones.sql
--
-- I01d · LO QUE CUENTA LA TANDA DE LAS AUTOLIQUIDACIONES (0300 y 0310), antes
-- y después. SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones.
--
-- Lo que tiene que pasar: las cuatro funciones nuevas, de «no existe» a
-- «existe»; las cuatro que cambian existen antes y después y cambia su huella.
-- El TESTIGO: el 303 del 3T de Foodint calculado desde el libro, de «no
-- existe» a [46] −3.723,44 (el del justificante presentado), sin nada apartado.
-- Los proveedores extranjeros de Foodint: antes Trypleez con país ES y ninguno
-- más; después Trypleez PT y los cuatro de alta, cada uno con su 410. Su libro
-- de IVA y sus declaraciones, IGUAL antes y después.
select clave, valor from (
  select 1 o, 'funciones nuevas de la 0300' clave,
    (select string_agg(n || ':' || case when to_regprocedure(n) is null then 'no existe' else 'existe' end, ' · ' order by n)
       from unnest(array['public.conta_pais_nombre(text)', 'public.conta_proveedor_iva_clase(text,text,text,text,text)',
                         'public.conta_impuesto_303_cajas(public.vat_book_entry)', 'public.conta_impuesto_303_desde_libro(uuid,integer,text)']) n) valor union all
  select 2, 'huellas de las que cambian (md5 del cuerpo)',
    (select string_agg(n || ':' || coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(n)), 'no existe'), ' · ' order by n)
       from unnest(array['public.conta_impuesto_303_calcular(uuid,integer,text)', 'public.conta_libro_iva_deducir_en(uuid,jsonb,integer,text,text)',
                         'public.conta_vat_book_desde_asiento(uuid)', 'public.conta_motivos_para_validar(uuid)']) n) union all
  select 3, 'TESTIGO · 303 del 3T de Foodint desde el libro ([27] · [45] · [46] · no sabe)',
    (select case when to_regprocedure('public.conta_impuesto_303_desde_libro(uuid,integer,text)') is null then 'no existe'
            -- Por texto (query_to_xml): antes de la tanda la función no existe, y llamarla
            -- directamente haría fallar la cuenta entera al leerla.
            else (select x->>'27' || ' · ' || (x->>'45') || ' · ' || (x->>'46') || ' · ' || (x->'no_sabe')::text
                    from (select ((xpath('/row/x/text()', query_to_xml(
                            'select public.conta_impuesto_303_desde_libro(''658728c0-fcd7-46ef-a860-d4e5e6eb21d9'', 2026, ''3T'')::text as x', false, true, '')))[1])::text::jsonb x) t) end) union all
  select 4, 'proveedores extranjeros de Foodint (nombre:país:tipo de NIF:VIES:410)',
    (select coalesce(string_agg(s.name || ':' || s.country_code || ':' || coalesce(s.tax_id_type, '-') || ':' || coalesce(s.tax_id_check_status, '-') || ':' ||
              coalesce((select string_agg(a.code, ',') from public.company_account_link l join public.company_account a on a.id = l.company_account_id
                         where l.account_id = s.account_id and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal'), '-'), ' · ' order by s.name), 'ninguno')
       from public.supplier s
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and (s.country_code <> 'ES' or upper(s.name) in ('TRYPLEEZ, SA', 'ANTHROPIC IRELAND LIMITED', 'HUBRISE SASU', 'SUPABASE PTE. LTD.', 'VERCEL INC.'))) union all
  select 5, 'libro de IVA de Foodint (libro:n)',
    (select coalesce(string_agg(book || ':' || n, ' · ' order by book), 'ninguna')
       from (select book, count(*) n from public.vat_book_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by book) x) union all
  select 6, 'declaraciones de Foodint (estado:n)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguna')
       from (select status, count(*) n from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x)
) t order by o;
