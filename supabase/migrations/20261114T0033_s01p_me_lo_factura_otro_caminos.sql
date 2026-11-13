-- supabase/migrations/20261114T0033_s01p_me_lo_factura_otro_caminos.sql
--
-- S01p·20·2 · «Me lo factura otro», 2 de 2: LO QUE CAMBIA (va después de la 20261113T1910, que
-- añade supplier.invoiced_by_supplier_id y el botón). Con alguien en invoiced_by_supplier_id:
--   1. su ficha no pregunta «cómo factura» ni «tipo de gasto», y sale de «Qué tienes que mirar»;
--   2. no se espera ninguna factura suya: sus recepciones van con el que lo factura (a su
--      liquidación si liquida cada mes; si no, esperando SU factura), con la frase
--      «Lo factura <otro> en su factura de género.»;
--   3. elegir después otra forma la quita (_compras_forma_facturar la borra).
--
-- cambia: public._compras_camino_calcula · prueba: supabase/staging/sql/20261113_s01p_me_lo_factura_otro_prueba.sql
-- cambia: public.compras_ficha_le_falta · prueba: supabase/staging/sql/20261113_s01p_me_lo_factura_otro_prueba.sql
-- cambia: public.compras_mirar · prueba: supabase/staging/sql/20261113_s01p_me_lo_factura_otro_prueba.sql
-- cambia: public._compras_forma_facturar · prueba: supabase/staging/sql/20261113_s01p_me_lo_factura_otro_prueba.sql
--   Las cuatro, con la MISMA firma y el cuerpo vigente con un solo trozo cambiado (reemplazo
--   exacto: si el trozo no está una sola vez, no se toca nada). Respaldo antes, para la vuelta atrás.
--
-- No toca ningún dato. Nada en el camino del pedido.

select public._respaldar_funcion('public._compras_camino_calcula(uuid)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
select public._respaldar_funcion('public.compras_ficha_le_falta(uuid)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
select public._respaldar_funcion('public.compras_mirar(uuid)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
select public._respaldar_funcion('public._compras_forma_facturar(uuid,text,boolean,text)', '20261114T0033_s01p_me_lo_factura_otro_caminos');

-- Un solo trozo por función: tiene que estar una sola vez, o no se toca nada.
do $do$
declare
  v_def text; r record;
begin
  for r in
    select * from (values
      -- 1. El camino de cada recepción: con «me lo factura otro», manda la ficha.
      ('public._compras_camino_calcula(uuid)',
       $viejo$  if s.id is null then
    v_path := 'sin_decidir'; v_how := 'ficha'; v_q := 'sin_papel';
    v_reason := 'La recepción no tiene proveedor: no se sabe cómo factura.';
  elsif v_tipo is null then$viejo$,
       $nuevo$  -- S01p·20·2 · «Me lo factura otro»: el que lo factura, si sigue vivo.
  if s.invoiced_by_supplier_id is not null then
    select * into sp from supplier where id = s.invoiced_by_supplier_id and archived_at is null;
  end if;

  if s.id is null then
    v_path := 'sin_decidir'; v_how := 'ficha'; v_q := 'sin_papel';
    v_reason := 'La recepción no tiene proveedor: no se sabe cómo factura.';
  elsif sp.id is not null then
    -- Manda la ficha: lo que diga el papel no crea ninguna factura ni pregunta nada. Va con el
    -- que lo factura: a su liquidación si liquida cada mes; si no, esperando SU factura.
    v_how := 'ficha'; v_sup := sp.id; v_company := v_unica;
    v_path := case when sp.invoicing_mode = 'monthly_settlement' then 'liquidacion' else 'pendiente_factura' end;
    v_reason := format('Lo factura %s en su factura de género.', sp.name);
  elsif v_tipo is null then$nuevo$,
       'S01p·20·2'),
      -- 2. Su ficha no pregunta el tipo de gasto…
      ('public.compras_ficha_le_falta(uuid)',
       $viejo$  if s.expense_category_id is null and not v_gasto then$viejo$,
       $nuevo$  if s.expense_category_id is null and not v_gasto and s.invoiced_by_supplier_id is null then  -- S01p·20·2$nuevo$,
       'S01p·20·2'),
      -- 3. …y sale de «Qué tienes que mirar».
      ('public.compras_mirar(uuid)',
       $viejo$where s.account_id = p_cuenta and s.archived_at is null$viejo$,
       $nuevo$where s.account_id = p_cuenta and s.archived_at is null and s.invoiced_by_supplier_id is null  -- S01p·20·2: me lo factura otro$nuevo$,
       'S01p·20·2'),
      -- 4. Elegir otra forma quita «me lo factura otro».
      ('public._compras_forma_facturar(uuid,text,boolean,text)',
       $viejo$set invoicing_mode = p_modo,$viejo$,
       $nuevo$set invoicing_mode = p_modo, invoiced_by_supplier_id = null,  -- S01p·20·2$nuevo$,
       'S01p·20·2')
    ) t(firma, viejo, nuevo, marca)
  loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    if strpos(v_def, r.marca) > 0 then continue; end if;   -- ya pasada
    if (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo) <> 1 then
      raise exception 'S01p·20·2: % no es la medida (su trozo no está una sola vez): no se toca.', r.firma;
    end if;
    execute replace(v_def, r.viejo, r.nuevo);
  end loop;
end $do$;

-- La ficha de compras_ficha_le_falta tiene dos sitios: el de la forma también.
do $do$
declare
  v_def text := pg_get_functiondef('public.compras_ficha_le_falta(uuid)'::regprocedure);
  v_viejo text := $viejo$  if s.invoicing_mode is null and not v_lote then$viejo$;
  v_nuevo text := $nuevo$  if s.invoicing_mode is null and not v_lote and s.invoiced_by_supplier_id is null then$nuevo$;
begin
  if strpos(v_def, v_nuevo) > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·20·2: compras_ficha_le_falta no es la medida (la pregunta de la forma no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

