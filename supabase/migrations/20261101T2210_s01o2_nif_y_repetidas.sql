-- supabase/migrations/20261101T2210_s01o2_nif_y_repetidas.sql
-- cambia: public.supplier_invoice_repetida · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
-- cambia: public.conta_factura_desde_lectura · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
-- cambia: public.tg_supplier_invoice_no_repetida · prueba: supabase/staging/sql/20261101_s01o2_resto_prueba.sql
--
-- S01o·2 · Una sola clave de NIF, y la guarda de repetidas también sin proveedor
-- (Julio, 01/11, respuesta 6, decisión 1).
--
-- La causa, medida en producción el 01/11: el NIF se normalizaba quitando solo
-- lo que no es letra o cifra y el «ES» de delante. La factura 9BF0758D de
-- Anthropic se leyó «IE4276970QH» y encontró a su proveedor (09:51:50); las
-- 72MQQQA8 se leyeron «EUVATIE4276970QH» (la etiqueta «EU VAT» dentro del NIF),
-- no lo encontraron («No tengo a Anthropic, PBC») y entraron sin proveedor. Sin
-- proveedor, supplier_invoice_repetida y el disparador no comparan nada: la
-- factura y su recibo, el mismo número y total, entraron dos veces. A las 14:08
-- la ficha pasó a guardar «EUVATIE…» (sin registro de quién) y la 9BF0758D dejó
-- de casar.
--
--   1. _conta_nif_clave(texto): mayúsculas, sin lo que no es letra o cifra, sin
--      las etiquetas de delante (EU VAT, VAT, NIF-IVA, NIF, CIF, TVA) y sin el
--      «ES» de un NIF español de 9. La misma para la ficha y para lo leído.
--   2. conta_factura_desde_lectura busca el proveedor con esa clave.
--   3. supplier_invoice_repetida y el disparador comparan también las que no
--      tienen proveedor, por el NIF leído en ellas (+ número + total).
-- Misma firma, sobre la definición VIVA, reemplazando el trozo exacto (para si no
-- está una sola vez); antes, su respaldo, y la vuelta atrás lo restaura.

create or replace function public._conta_nif_clave(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')),
                                              '^(EUVAT|NIFIVA|VATNO|VAT|NIF|CIF|TVA)', ''), '^ES(?=[A-Z0-9]{9}$)', ''), '')
$$;
comment on function public._conta_nif_clave(text) is 'S01o·2 · La clave de un NIF para compararlo: sin etiquetas (EU VAT, VAT, NIF, CIF), sin lo que no es letra o cifra y sin el ES de un NIF español.';

select public._respaldar_funcion('public.supplier_invoice_repetida(uuid,uuid,text,text,date,numeric,uuid)', '20261101T2210_s01o2_nif_y_repetidas');
select public._respaldar_funcion('public.conta_factura_desde_lectura(uuid,uuid)', '20261101T2210_s01o2_nif_y_repetidas');
select public._respaldar_funcion('public.tg_supplier_invoice_no_repetida()', '20261101T2210_s01o2_nif_y_repetidas');

do $$
declare v_def text; v_n int; v_antes text;
begin
  v_def := pg_get_functiondef('public.supplier_invoice_repetida(uuid,uuid,text,text,date,numeric,uuid)'::regprocedure);
  v_antes := 'v_nif text := nullif(regexp_replace(upper(regexp_replace(coalesce(p_nif, ''''), ''[^A-Za-z0-9]'', '''', ''g'')), ''^ES(?=[A-Z0-9]{9}$)'', ''''), '''');';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.supplier_invoice_repetida no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'v_nif text := public._conta_nif_clave(p_nif);');
  v_antes := 'or (v_nif is not null and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''''), ''[^A-Za-z0-9]'', '''', ''g'')), ''^ES(?=[A-Z0-9]{9}$)'', '''') = v_nif))';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.supplier_invoice_repetida no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'or (v_nif is not null and public._conta_nif_clave(s.tax_id) = v_nif)
            -- S01o·2: también las que entraron sin proveedor, por el NIF que se leyó en ellas.
            or (v_nif is not null and i.supplier_id is null and public._conta_nif_clave(i.reading->''factura''->''proveedor''->>''nif'') = v_nif))');
  execute v_def;
  v_def := pg_get_functiondef('public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure);
  v_antes := 'and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''''), ''[^A-Za-z0-9]'', '''', ''g'')), ''^ES(?=[A-Z0-9]{9}$)'', '''') = v_nif';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.conta_factura_desde_lectura no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'and public._conta_nif_clave(s.tax_id) = public._conta_nif_clave(v_nif)');
  execute v_def;
  v_def := pg_get_functiondef('public.tg_supplier_invoice_no_repetida()'::regprocedure);
  v_antes := 'or new.supplier_id is null
     or v_k is null';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.tg_supplier_invoice_no_repetida no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'or (new.supplier_id is null and public._conta_nif_clave(new.reading->''factura''->''proveedor''->>''nif'') is null)
     or v_k is null');
  v_antes := 'where i.account_id = new.account_id and i.supplier_id = new.supplier_id';
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01o·2: public.tg_supplier_invoice_no_repetida no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  v_def := replace(v_def, v_antes, 'where i.account_id = new.account_id
     and (i.supplier_id = new.supplier_id
          -- S01o·2: sin proveedor, por el NIF leído (la factura y el recibo del mismo número).
          or (new.supplier_id is null and i.supplier_id is null
              and public._conta_nif_clave(i.reading->''factura''->''proveedor''->>''nif'') = public._conta_nif_clave(new.reading->''factura''->''proveedor''->>''nif'')))');
  execute v_def;
end $$;
