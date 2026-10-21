-- ============================================================================
-- PRUEBA (staging) · Textos sin «papel» · la 0370. Todo en una transacción
-- con ROLLBACK.
--
-- Regla de Julio (21/10): en la app nunca «papel» ni «papeles» en un texto que
-- vea alguien. La 0370 cambia SOLO textos en once funciones:
--   public._compras_camino_calcula, public._compras_factura_desde_papel,
--   public.compras_factura_desde_papel, public.compras_sin_iva,
--   public.tg_goods_receipt_path_factura,
--   public.conta_documentos_recibidos, public.company_chart_import_apply,
--   public.company_chart_import_undo, public.party_add_role,
--   public.party_misma_cuenta y public._party_merge.
-- (compras_camino_de, la frase de la tablet de cocina, queda fuera: cocina y
-- reparto no entran ahora.)
--
--   1. Cada una: una sola firma; ningún literal con «papel» salvo las claves
--      ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel'; los
--      comentarios no cuentan); y, devuelto cada texto nuevo al viejo con
--      replace(), el md5 del cuerpo es el de producción del 21/10. O sea: no
--      ha cambiado nada más que los textos.
--   2. _compras_camino_calcula, el CASE nuevo, sobre recepciones sembradas
--      (como la 20261017_compras_camino_prueba, nombres inventados): a nombre
--      de «CONTADO PRUEBA» una factura dice «La factura va a nombre…», un
--      albarán «El albarán va a nombre…»; un albarán-factura sin nombre «El
--      albarán-factura no dice…»; sin documento leído, «No hay documento
--      leído…».
--   3. Los motivos y errores de _compras_factura_desde_papel (interna, sin
--      usuario), llamándola directamente: un documento sin líneas, uno con
--      una línea sin IVA y una lectura de otra cuenta (o que no existe).
--   4. Las puertas de la pantalla, como el administrador de A («set local
--      role authenticated»): compras_factura_desde_papel con una lectura que
--      no existe y compras_sin_iva de un albarán a nombre de la empresa.
--   5. La vuelta atrás, de verdad (\i): las 11 vuelven al md5 de producción
--      del 21/10, con una sola firma cada una.
-- ============================================================================

begin;

-- ── 1 · Solo cambian textos ────────────────────────────────────────────────
do $$
declare
  v_src text; v_rev text; v_lits text; v_n int; v_mal text := ''; v_ok int := 0;
begin
  -- public._compras_camino_calcula
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = '_compras_camino_calcula';
  if v_n <> 1 then v_mal := v_mal || format(' _compras_camino_calcula: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public._compras_camino_calcula(uuid)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' _compras_camino_calcula: aún dice «%s»;', v_lits); end if;
  v_rev := replace(replace(replace(replace(replace(v_src,
      '      v_reason := format(case when v_nombre is null then ''%s no dice a nombre de quién va.''
                              else ''%s va a nombre de «%s», y Folvy no sabe quién es.'' end,
                         case v_tipo when ''albaran'' then ''El albarán'' when ''factura'' then ''La factura''
                                     when ''albaran_factura'' then ''El albarán-factura'' else ''El documento'' end,
                         v_nombre);',
      '      v_reason := case when v_nombre is null then ''El papel no dice a nombre de quién va.''
                       else format(''El papel va a nombre de «%s», y Folvy no sabe quién es.'', v_nombre) end;'),
      '''No hay documento leído y no se sabe cómo factura %s: queda pendiente de factura.''',
      '''No hay papel leído y no se sabe cómo factura %s: queda pendiente de factura.'''),
      '''No hay documento leído y %s factura con cada entrega: sube su factura.''',
      '''No hay papel leído y %s factura con cada entrega: sube su factura.'''),
      '''No hay documento leído; %s manda la factura después.''',
      '''No hay papel leído; %s manda la factura después.'''),
      '''No hay documento leído; %s liquida cada mes.''',
      '''No hay papel leído; %s liquida cada mes.''');
  if md5(v_rev) <> '5cbeb3496b36696e1e002bf23cdd9e8f' then v_mal := v_mal || ' _compras_camino_calcula: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '5cbeb3496b36696e1e002bf23cdd9e8f' then v_mal := v_mal || ' _compras_camino_calcula: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public._compras_factura_desde_papel
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = '_compras_factura_desde_papel';
  if v_n <> 1 then v_mal := v_mal || format(' _compras_factura_desde_papel: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public._compras_factura_desde_papel(uuid, uuid, uuid, uuid, uuid, uuid, text)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' _compras_factura_desde_papel: aún dice «%s»;', v_lits); end if;
  v_rev := replace(replace(replace(replace(v_src,
      '''Factura %s creada desde el documento: %s de base, %s de IVA.''',
      '''Factura %s creada desde el papel: %s de base, %s de IVA.'''),
      '''El documento trae %s línea(s) sin importe o sin IVA: sube la factura en Compras o complétala.''',
      '''El papel trae %s línea(s) sin importe o sin IVA: sube la factura en Compras o complétala.'''),
      '''El documento no trae líneas: sube la factura en Compras.''',
      '''El papel no trae líneas: sube la factura en Compras.'''),
      '''Ese documento no está leído en esta cuenta.''',
      '''Ese papel no está leído en esta cuenta.''');
  if md5(v_rev) <> '104ebec9514b827669fd918c5d1f89fd' then v_mal := v_mal || ' _compras_factura_desde_papel: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '104ebec9514b827669fd918c5d1f89fd' then v_mal := v_mal || ' _compras_factura_desde_papel: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.compras_factura_desde_papel
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'compras_factura_desde_papel';
  if v_n <> 1 then v_mal := v_mal || format(' compras_factura_desde_papel: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.compras_factura_desde_papel(uuid, uuid, uuid, uuid)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' compras_factura_desde_papel: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''Ese documento no existe.''',
      '''Ese papel no existe.''');
  if md5(v_rev) <> '4f4d38df93955ba3268052950c32b35d' then v_mal := v_mal || ' compras_factura_desde_papel: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '4f4d38df93955ba3268052950c32b35d' then v_mal := v_mal || ' compras_factura_desde_papel: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.compras_sin_iva
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'compras_sin_iva';
  if v_n <> 1 then v_mal := v_mal || format(' compras_sin_iva: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.compras_sin_iva(uuid, uuid)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' compras_sin_iva: aún dice «%s»;', v_lits); end if;
  v_rev := replace(replace(v_src,
      '''La recepción no tiene documento leído.''',
      '''La recepción no tiene papel leído.'''),
      '''Solo se apunta sin IVA un documento que va a nombre de otro.''',
      '''Solo se apunta sin IVA un papel que va a nombre de otro.''');
  if md5(v_rev) <> '805d1ed89ae5c424a19b83ec17d311af' then v_mal := v_mal || ' compras_sin_iva: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '805d1ed89ae5c424a19b83ec17d311af' then v_mal := v_mal || ' compras_sin_iva: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.tg_goods_receipt_path_factura
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_goods_receipt_path_factura';
  if v_n <> 1 then v_mal := v_mal || format(' tg_goods_receipt_path_factura: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.tg_goods_receipt_path_factura()'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' tg_goods_receipt_path_factura: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''Folvy no pudo crear la factura desde el documento.''',
      '''Folvy no pudo crear la factura desde el papel.''');
  if md5(v_rev) <> '5fa9ed53935109ea522d7dba29feaff1' then v_mal := v_mal || ' tg_goods_receipt_path_factura: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '5fa9ed53935109ea522d7dba29feaff1' then v_mal := v_mal || ' tg_goods_receipt_path_factura: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.conta_documentos_recibidos
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_documentos_recibidos';
  if v_n <> 1 then v_mal := v_mal || format(' conta_documentos_recibidos: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.conta_documentos_recibidos(uuid, date, date)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' conta_documentos_recibidos: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''La recepción la leyó, pero no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.''',
      '''La recepción la leyó, pero el papel no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.''');
  if md5(v_rev) <> '7e33015af3eeb23e5ffc689007a26887' then v_mal := v_mal || ' conta_documentos_recibidos: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '7e33015af3eeb23e5ffc689007a26887' then v_mal := v_mal || ' conta_documentos_recibidos: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.company_chart_import_apply
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'company_chart_import_apply';
  if v_n <> 1 then v_mal := v_mal || format(' company_chart_import_apply: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.company_chart_import_apply(uuid, jsonb, text)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' company_chart_import_apply: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''El enlace de % no es ni principal ni de pago.''',
      '''Papel no válido en %.''');
  if md5(v_rev) <> '670b04da6349d90c69c06e43c90ac69a' then v_mal := v_mal || ' company_chart_import_apply: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '670b04da6349d90c69c06e43c90ac69a' then v_mal := v_mal || ' company_chart_import_apply: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.company_chart_import_undo
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'company_chart_import_undo';
  if v_n <> 1 then v_mal := v_mal || format(' company_chart_import_undo: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.company_chart_import_undo(uuid, text)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' company_chart_import_undo: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''%s también como cliente, plataforma o socio en Clientes y proveedores''',
      '''%s con otro papel en Clientes y proveedores''');
  if md5(v_rev) <> 'd065d50eb0238f05dafdb0e40cc4f511' then v_mal := v_mal || ' company_chart_import_undo: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = 'd065d50eb0238f05dafdb0e40cc4f511' then v_mal := v_mal || ' company_chart_import_undo: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.party_add_role
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'party_add_role';
  if v_n <> 1 then v_mal := v_mal || format(' party_add_role: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.party_add_role(uuid, text, jsonb)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' party_add_role: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''Desde aquí solo se añade como cliente, plataforma o socio (como proveedor llega con su ficha de Cocina).''',
      '''Ese papel no se añade desde aquí (el de proveedor llega con su ficha de Cocina).''');
  if md5(v_rev) <> 'eea26b75cf76cd59054f44ec19e369ee' then v_mal := v_mal || ' party_add_role: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = 'eea26b75cf76cd59054f44ec19e369ee' then v_mal := v_mal || ' party_add_role: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public.party_misma_cuenta
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'party_misma_cuenta';
  if v_n <> 1 then v_mal := v_mal || format(' party_misma_cuenta: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public.party_misma_cuenta()'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' party_misma_cuenta: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''Ese tercero no es de esta cuenta.''',
      '''El papel y su tercero tienen que ser de la misma cuenta.''');
  if md5(v_rev) <> '981f998d47e5cccd9cdd6a21ea13bdee' then v_mal := v_mal || ' party_misma_cuenta: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = '981f998d47e5cccd9cdd6a21ea13bdee' then v_mal := v_mal || ' party_misma_cuenta: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  -- public._party_merge
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = '_party_merge';
  if v_n <> 1 then v_mal := v_mal || format(' _party_merge: %s firmas (debe ser 1);', v_n); end if;
  select prosrc into v_src from pg_proc where oid = 'public._party_merge(uuid, uuid, text)'::regprocedure;
  select string_agg(distinct m[1], ' | ') into v_lits
    from regexp_matches(regexp_replace(v_src, '--[^\n]*', '', 'g'), '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~* '\mpapel' and m[1] not in ('papel', 'papel_y_ficha', 'sin_papel', 'ultimo_papel');
  if v_lits is not null then v_mal := v_mal || format(' _party_merge: aún dice «%s»;', v_lits); end if;
  v_rev := replace(v_src,
      '''como ''',
      '''su papel de ''');
  if md5(v_rev) <> 'c88e5a6a71c428b3ab863804bf8906de' then v_mal := v_mal || ' _party_merge: devuelto al texto viejo no es el cuerpo de producción (md5 ' || md5(v_rev) || ');'; end if;
  if md5(v_src) = 'c88e5a6a71c428b3ab863804bf8906de' then v_mal := v_mal || ' _party_merge: sigue con el cuerpo de antes (¿falta pasar la 0370?);'; end if;
  v_ok := v_ok + 1;

  if v_mal <> '' then raise exception 'PRUEBA textos · 1:%', v_mal; end if;
  raise notice '1 · % funciones: una sola firma cada una, ningún texto con «papel» (solo las claves papel, papel_y_ficha, sin_papel y ultimo_papel) y, devueltos los textos nuevos a los viejos, el md5 es el de producción del 21/10: no ha cambiado nada más', v_ok;
end $$;

-- ── 2 · _compras_camino_calcula: el tipo de documento con nombre ──────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recepcion(p_id uuid, p_sup uuid, p_doc text, p_nombre text, p_confirmar boolean)
returns uuid language plpgsql as $$
declare v_s uuid;
begin
  if p_doc is not null then
    insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
    values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
            jsonb_build_object('document', jsonb_build_object('doc_type', p_doc, 'bill_to_name', p_nombre), 'lines', '[]'::jsonb),
            'pending_review')
    returning id into v_s;
  end if;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_sup, 'borrador', current_date, v_s, 'T-' || right(p_id::text, 3), 'prueba');
  if p_confirmar then perform confirm_goods_receipt(p_id); end if;
  return p_id;
end $$;

do $$
declare
  c_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := 'c0c37000-0000-4000-8000-000000000001';  -- «Obrador Prueba Siete»: con cada entrega
  v_d uuid := 'c0c37000-0000-4000-8000-000000000002';  -- «Gourmet Prueba Ocho»: albarán y factura después
  r record; v text; v_mal text := ''; v_n int := 0;
begin
  insert into supplier (id, account_id, name, invoicing_mode, created_by_name) values
    (v_e, c_cuenta, 'Obrador Prueba Siete, S.A.', 'per_delivery', 'prueba'),
    (v_d, c_cuenta, 'Gourmet Prueba Ocho, S.L.', 'delivery_note_then_invoice', 'prueba');
  perform pg_temp.recepcion('c0c37000-0000-4000-8000-000000000101', v_e, 'factura',         'CONTADO PRUEBA', false);
  perform pg_temp.recepcion('c0c37000-0000-4000-8000-000000000102', v_e, 'albaran',         'CONTADO PRUEBA', false);
  perform pg_temp.recepcion('c0c37000-0000-4000-8000-000000000103', v_e, 'albaran_factura', null,             false);
  perform pg_temp.recepcion('c0c37000-0000-4000-8000-000000000104', v_e, null,              null,             false);
  perform pg_temp.recepcion('c0c37000-0000-4000-8000-000000000105', v_d, null,              null,             false);
  -- Esta sí se confirma (para el paso 4): un albarán a nombre de la empresa,
  -- camino «pendiente de factura».
  perform pg_temp.recepcion('c0c37000-0000-4000-8000-000000000106', v_d, 'albaran', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA', true);
  for r in select * from (values
      ('c0c37000-0000-4000-8000-000000000101'::uuid, 'La factura va a nombre de «CONTADO PRUEBA», y Folvy no sabe quién es.'),
      ('c0c37000-0000-4000-8000-000000000102'::uuid, 'El albarán va a nombre de «CONTADO PRUEBA», y Folvy no sabe quién es.'),
      ('c0c37000-0000-4000-8000-000000000103'::uuid, 'El albarán-factura no dice a nombre de quién va.'),
      ('c0c37000-0000-4000-8000-000000000104'::uuid, 'No hay documento leído y Obrador Prueba Siete, S.A. factura con cada entrega: sube su factura.'),
      ('c0c37000-0000-4000-8000-000000000105'::uuid, 'No hay documento leído; Gourmet Prueba Ocho, S.L. manda la factura después.')) t(id, esperado) loop
    v := public._compras_camino_calcula(r.id)->>'reason';
    if v is distinct from r.esperado then v_mal := v_mal || format(' %s: «%s» (esperaba «%s»);', right(r.id::text, 3), v, r.esperado); end if;
    v_n := v_n + 1;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA textos · 2: el motivo del camino no es el esperado:%', v_mal; end if;
  raise notice '2 · _compras_camino_calcula: % de % motivos como se esperaba (factura, albarán y albarán-factura por su nombre; sin documento, «No hay documento leído»)', v_n, v_n;
end $$;

-- ── 3 · _compras_factura_desde_papel y compras_factura_desde_papel ────────
do $$
declare
  c_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c_local  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e uuid := 'c0c37000-0000-4000-8000-000000000001';
  v_s uuid; v jsonb;
begin
  -- Sin líneas: la lectura de la recepción 101 (sembrada en el paso 2 con '[]').
  select ai_session_id into v_s from goods_receipt where id = 'c0c37000-0000-4000-8000-000000000101';
  v := public._compras_factura_desde_papel(c_cuenta, v_s, v_e, c_local, null, null, null);
  if v->>'motivo' is distinct from 'El documento no trae líneas: sube la factura en Compras.' then
    raise exception 'PRUEBA textos · 3: sin líneas, el motivo es «%».', v->>'motivo';
  end if;

  -- Una línea con importe y sin IVA.
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (c_cuenta, 'photo',
          jsonb_build_object('document', jsonb_build_object('doc_type', 'factura', 'doc_number', 'T-SIN-IVA'),
                             'lines', jsonb_build_array(jsonb_build_object('line_amount', 10, 'vat_pct', null))),
          'pending_review')
  returning id into v_s;
  v := public._compras_factura_desde_papel(c_cuenta, v_s, v_e, c_local, null, null, null);
  if v->>'motivo' is distinct from 'El documento trae 1 línea(s) sin importe o sin IVA: sube la factura en Compras o complétala.' then
    raise exception 'PRUEBA textos · 3: con una línea sin IVA, el motivo es «%».', v->>'motivo';
  end if;

  -- Una lectura que no es de esta cuenta (aquí, que no existe).
  begin
    perform public._compras_factura_desde_papel(c_cuenta, 'c0c37000-0000-4000-8000-0000000009ff', v_e, c_local, null, null, null);
    raise exception 'PRUEBA textos · 3: con una lectura que no existe, _compras_factura_desde_papel no ha fallado.';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'Ese documento no está leído en esta cuenta.' then raise exception 'PRUEBA textos · 3: el error es «%».', sqlerrm; end if;
  end;
  raise notice '3 · _compras_factura_desde_papel (interna, sin grant a authenticated: se llama sin usuario): sin líneas, una línea sin IVA y una lectura de otra cuenta, con «documento» en los tres';
end $$;

-- ── 4 · Las puertas de la pantalla, como el usuario de A ───────────────────
-- compras_factura_desde_papel y compras_sin_iva tienen grant a authenticated:
-- se llaman como el administrador de A (C04b R7), sin pg_temp ni tablas.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.compras_factura_desde_papel('c0c37000-0000-4000-8000-0000000009ff', 'c0c37000-0000-4000-8000-000000000001', null, null);
    raise exception 'PRUEBA textos · 4: con una lectura que no existe, compras_factura_desde_papel no ha fallado.';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'Ese documento no existe.' then raise exception 'PRUEBA textos · 4: el error es «%».', sqlerrm; end if;
  end;
  -- La 106 es un albarán a nombre de la empresa: no va a nombre de otro.
  begin
    perform public.compras_sin_iva('c0c37000-0000-4000-8000-000000000106', 'c0c37000-0000-4000-8000-0000000009fe');
    raise exception 'PRUEBA textos · 4: compras_sin_iva ha apuntado sin IVA un albarán a nombre de la empresa.';
  exception when sqlstate '22023' then
    if sqlerrm <> 'Solo se apunta sin IVA un documento que va a nombre de otro.' then raise exception 'PRUEBA textos · 4: el error es «%».', sqlerrm; end if;
  end;
  raise notice '4 · como el usuario de A: compras_factura_desde_papel sin lectura → «Ese documento no existe.»; compras_sin_iva de un albarán a nombre de la empresa → «Solo se apunta sin IVA un documento que va a nombre de otro.»';
end $$;
reset role;

-- ── 5 · La vuelta atrás, de verdad ─────────────────────────────────────────
-- Las 11 funciones vuelven a sus cuerpos de producción del 21/10: cada una
-- con una sola firma y el md5 de partida.
\i supabase/vuelta-atras/20261129T0370_textos_sin_papel.down.sql
do $$
declare r record; v_n int; v_md5 text; v_mal text := ''; v_ok int := 0;
begin
  for r in select * from (values
      ('public._compras_camino_calcula(uuid)', '5cbeb3496b36696e1e002bf23cdd9e8f'),
      ('public._compras_factura_desde_papel(uuid, uuid, uuid, uuid, uuid, uuid, text)', '104ebec9514b827669fd918c5d1f89fd'),
      ('public.compras_factura_desde_papel(uuid, uuid, uuid, uuid)', '4f4d38df93955ba3268052950c32b35d'),
      ('public.compras_sin_iva(uuid, uuid)', '805d1ed89ae5c424a19b83ec17d311af'),
      ('public.tg_goods_receipt_path_factura()', '5fa9ed53935109ea522d7dba29feaff1'),
      ('public.conta_documentos_recibidos(uuid, date, date)', '7e33015af3eeb23e5ffc689007a26887'),
      ('public.company_chart_import_apply(uuid, jsonb, text)', '670b04da6349d90c69c06e43c90ac69a'),
      ('public.company_chart_import_undo(uuid, text)', 'd065d50eb0238f05dafdb0e40cc4f511'),
      ('public.party_add_role(uuid, text, jsonb)', 'eea26b75cf76cd59054f44ec19e369ee'),
      ('public.party_misma_cuenta()', '981f998d47e5cccd9cdd6a21ea13bdee'),
      ('public._party_merge(uuid, uuid, text)', 'c88e5a6a71c428b3ab863804bf8906de')) t(firma, md5) loop
    select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = split_part(split_part(r.firma, '(', 1), '.', 2);
    select md5(prosrc) into v_md5 from pg_proc where oid = to_regprocedure(r.firma);
    if v_n <> 1 or v_md5 is distinct from r.md5 then
      v_mal := v_mal || format(' %s: %s firma(s), md5 %s (esperaba %s);', r.firma, v_n, coalesce(v_md5, '—'), r.md5);
    else
      v_ok := v_ok + 1;
    end if;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA textos · 5: la vuelta atrás no deja lo de producción:%', v_mal; end if;
  raise notice '5 · vuelta atrás: % de 11 funciones con una sola firma y el md5 de producción del 21/10', v_ok;
end $$;

select set_config('request.jwt.claims', '', true);

rollback;
