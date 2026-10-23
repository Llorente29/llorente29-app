-- supabase/migrations/20261208T0830_d07c_prepago_en_todas_las_listas.sql
-- cambia: public.conta_recibida_guardar · prueba: supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql
-- cambia: public.mark_supplier_invoice_paid · prueba: supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql
-- cambia: public.customer_fiscal · prueba: supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql
-- cambia: public.payment_method · prueba: supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql
--
-- D07c · «SALDO PREPAGO» EN TODAS LAS LISTAS DE FORMAS DE PAGO (Julio, 23/10).
-- La 0800 amplió los dos CHECK de payment_method (supplier y supplier_invoice),
-- pero no la lista de conta_recibida_guardar: guardar la ficha de una recibida
-- con «Saldo prepago Catcher» daba «No conozco la forma de pago "prepaid":
-- transfer, direct_debit, card o cash». Regla de Julio desde hoy: cuando se
-- añade un valor nuevo, se buscan TODAS las listas que lo comprueban, no solo
-- los CHECK.
--
-- Buscadas en producción el 23/10 (solo lectura): las funciones cuyo cuerpo
-- nombra direct_debit, los CHECK que lo nombran, los enums y el catálogo
-- payment_method. Las que son FORMAS DE PAGO de una factura, todas con
-- 'prepaid' desde aquí:
--   1. conta_recibida_guardar: su lista (v_formas) y el error, en español y
--      con el nombre de cada forma («Puede ser: Tarjeta, Efectivo, …»).
--      Cuerpo de partida, el de PRODUCCIÓN (pg_get_functiondef, md5
--      08126d47a81d33fbb3826ce6b84179d8, la 0790).
--   2. mark_supplier_invoice_paid: la forma con que se pagó (y su error, con
--      los nombres). De partida, la de PRODUCCIÓN (md5 192d75fa8906f443db5800ee209b0e9a).
--   3. supplier_invoice_paid_method_check (con qué se pagó): solo amplía.
--   4. customer_fiscal_payment_method_check (la ficha fiscal del cliente):
--      solo amplía, para que todas las listas digan lo mismo.
--   5. payment_method_kind_check (el catálogo de formas de pago) y la fila
--      «Saldo prepago Catcher (40700001)» de la empresa de Foodint (propia,
--      no de sistema): de ahí sale el desplegable de la ficha del proveedor.
--      La fila, si no está.
-- Las que NO se tocan, y por qué: tax_obligation/tax_return payment_mode (cómo
-- se paga un impuesto a Hacienda: domiciliación, NRC…, no la forma de pago de
-- una factura); _bank_factura_aprobada_con_pago (no comprueba una lista:
-- deduce transfer o direct_debit del cargo del banco). Enums: ninguno.
--
-- Misma firma en las dos funciones: create or replace, sin sobrecarga (regla 2).
-- Los CHECK solo amplían: toda fila que cabía antes cabe ahora. No toca filas
-- salvo la del catálogo (nueva, de Foodint). No toca el camino del pedido.
-- sin hueco: no retira nada al aplicarse; el «delete from journal_entry» va
-- dentro de conta_recibida_guardar (el de la 0790, sin tocar) y solo quita el
-- asiento PROPUESTO de una recibida que alguien acaba de cambiar, para que se
-- vuelva a proponer con lo nuevo. Ningún resumen del día ni asiento validado.
-- Vuelta atrás: supabase/vuelta-atras/20261208T0830_d07c_prepago_en_todas_las_listas.down.sql

-- 1 · conta_recibida_guardar ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conta_recibida_guardar(p_invoice uuid, p_cambios jsonb, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_f public.supplier_invoice;
  v_n public.supplier_invoice;
  v_c jsonb := coalesce(p_cambios, '{}'::jsonb);
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_claves constant text[] := array['proveedor', 'numero', 'fecha', 'local', 'vence', 'forma_pago', 'iva', 'retencion', 'gasto', 'asiento_a_mano'];
  v_raras text[];
  v_cambios jsonb := '[]'::jsonb;
  v_textos text[] := '{}';
  v_guardado text[] := '{}';
  v_al_asiento boolean := false;
  v_quitados int := 0;
  v_vence_antes date; v_vence date;
  v_iva_antes jsonb; v_iva jsonb;
  v_gasto_antes jsonb; v_gasto jsonb;
  v_ret_antes jsonb; v_ret jsonb;
  v_tasa uuid; v_tasas uuid[]; v_tipo numeric; v_importe numeric;
  v_x jsonb; v_uuid uuid; v_txt text; v_fecha date; v_mal int;
  v_debe numeric; v_haber numeric;
  v_formas constant jsonb := '{"transfer": "Transferencia", "direct_debit": "Domiciliación", "card": "Tarjeta", "cash": "Efectivo", "prepaid": "Saldo prepago Catcher (40700001)"}'::jsonb;
begin
  if jsonb_typeof(v_c) <> 'object' then
    raise exception 'Los cambios no se entienden: tiene que ser un objeto con lo que cambia.' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_raras from jsonb_object_keys(v_c) k where not (k = any (v_claves));
  if v_raras is not null then
    raise exception 'No sé guardar: %. Lo que sé guardar: %.', array_to_string(v_raras, ', '), array_to_string(v_claves, ', ') using errcode = '22023';
  end if;

  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'
                and e.source_id = v_f.id and e.status = 'validado') then
    raise exception 'Ya está contabilizada: para cambiarla, anula su asiento.' using errcode = '22023';
  end if;
  v_n := v_f;

  -- Proveedor
  if v_c ? 'proveedor' then
    v_uuid := nullif(v_c ->> 'proveedor', '')::uuid;
    if v_uuid is null then raise exception 'Una factura tiene proveedor.' using errcode = '22023'; end if;
    if not exists (select 1 from public.supplier s where s.id = v_uuid and s.account_id = v_f.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
    end if;
    if v_uuid is distinct from v_f.supplier_id then
      v_n.supplier_id := v_uuid; v_al_asiento := true; v_guardado := array_append(v_guardado, 'proveedor');
      v_cambios := v_cambios || jsonb_build_object('campo', 'proveedor', 'antes', v_f.supplier_id, 'ahora', v_uuid);
      v_textos := array_append(v_textos, format('Proveedor %s → %s',
        coalesce((select s.name from public.supplier s where s.id = v_f.supplier_id), '—'), (select s.name from public.supplier s where s.id = v_uuid)));
    end if;
  end if;

  -- Número
  if v_c ? 'numero' then
    v_txt := nullif(trim(v_c ->> 'numero'), '');
    if v_txt is distinct from v_f.invoice_number then
      v_n.invoice_number := v_txt; v_al_asiento := true; v_guardado := array_append(v_guardado, 'numero');
      v_cambios := v_cambios || jsonb_build_object('campo', 'numero', 'antes', v_f.invoice_number, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Número %s → %s', coalesce(v_f.invoice_number, '—'), coalesce(v_txt, '—')));
    end if;
  end if;

  -- Fecha
  if v_c ? 'fecha' then
    v_fecha := nullif(v_c ->> 'fecha', '')::date;
    if v_fecha is null then raise exception 'Una factura tiene fecha.' using errcode = '22023'; end if;
    if v_fecha is distinct from v_f.invoice_date then
      v_n.invoice_date := v_fecha; v_al_asiento := true; v_guardado := array_append(v_guardado, 'fecha');
      v_cambios := v_cambios || jsonb_build_object('campo', 'fecha', 'antes', v_f.invoice_date, 'ahora', v_fecha);
      v_textos := array_append(v_textos, format('Fecha %s → %s', coalesce(to_char(v_f.invoice_date, 'DD/MM/YYYY'), '—'), to_char(v_fecha, 'DD/MM/YYYY')));
    end if;
  end if;

  -- Local
  if v_c ? 'local' then
    v_uuid := nullif(v_c ->> 'local', '')::uuid;
    if v_uuid is not null and not exists (select 1 from public.locations l where l.id = v_uuid and l.account_id = v_f.account_id) then
      raise exception 'Ese local no es de esta cuenta.' using errcode = '42501';
    end if;
    if v_uuid is distinct from v_f.location_id then
      v_n.location_id := v_uuid; v_al_asiento := true; v_guardado := array_append(v_guardado, 'local');
      v_cambios := v_cambios || jsonb_build_object('campo', 'local', 'antes', v_f.location_id, 'ahora', v_uuid);
      v_textos := array_append(v_textos, format('Local %s → %s',
        coalesce((select l.name from public.locations l where l.id = v_f.location_id), 'común'), coalesce((select l.name from public.locations l where l.id = v_uuid), 'común')));
    end if;
  end if;

  -- Forma de pago (prevista)
  if v_c ? 'forma_pago' then
    v_txt := nullif(v_c ->> 'forma_pago', '');
    if v_txt is not null and not (v_formas ? v_txt) then
      raise exception 'No conozco la forma de pago «%». Puede ser: %.', v_txt,
        (select string_agg(x.value, ', ' order by x.key) from jsonb_each_text(v_formas) x) using errcode = '22023';
    end if;
    if v_txt is distinct from v_f.payment_method then
      v_n.payment_method := v_txt; v_guardado := array_append(v_guardado, 'forma_pago');
      v_cambios := v_cambios || jsonb_build_object('campo', 'forma_pago', 'antes', v_f.payment_method, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Forma de pago %s → %s', coalesce(v_formas ->> v_f.payment_method, 'sin decir'), coalesce(v_formas ->> v_txt, 'sin decir')));
    end if;
  end if;

  -- IVA por tipos: se rehace entero y, con él, los totales.
  if v_c ? 'iva' then
    if jsonb_typeof(v_c -> 'iva') <> 'array' then raise exception 'El IVA va por tipos: una lista.' using errcode = '22023'; end if;
    select count(*) into v_mal from jsonb_array_elements(v_c -> 'iva') t
     where jsonb_typeof(t -> 'tipo') <> 'number' or jsonb_typeof(t -> 'base') <> 'number' or jsonb_typeof(t -> 'cuota') <> 'number';
    if v_mal > 0 then raise exception 'Cada línea de IVA lleva su tipo, su base y su cuota (% sin ellos).', v_mal using errcode = '22023'; end if;
    select count(*) - count(distinct (t ->> 'tipo')::numeric) into v_mal from jsonb_array_elements(v_c -> 'iva') t;
    if v_mal > 0 then raise exception 'Un mismo tipo de IVA va en una sola línea.' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_c -> 'iva') t
                where nullif(t ->> 'tipo_id', '') is not null
                  and not exists (select 1 from public.tax_rate r where r.id = (t ->> 'tipo_id')::uuid and (r.is_system or r.account_id = v_f.account_id))) then
      raise exception 'Ese tipo de IVA no es de esta cuenta.' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('tipo', x.vat_pct, 'base', x.base, 'cuota', x.vat_amount, 'recargo_tipo', x.surcharge_pct,
                                                 'recargo', nullif(x.surcharge_amount, 0), 'tipo_id', x.tax_rate_id) order by x.vat_pct), '[]'::jsonb)
      into v_iva_antes from public.supplier_invoice_tax x where x.supplier_invoice_id = v_f.id;
    select coalesce(jsonb_agg(jsonb_build_object('tipo', (t ->> 'tipo')::numeric, 'base', round((t ->> 'base')::numeric, 2), 'cuota', round((t ->> 'cuota')::numeric, 2),
                                                 'recargo_tipo', nullif(t ->> 'recargo_tipo', '')::numeric, 'recargo', nullif(round(coalesce(nullif(t ->> 'recargo', '')::numeric, 0), 2), 0),
                                                 'tipo_id', nullif(t ->> 'tipo_id', '')::uuid) order by (t ->> 'tipo')::numeric), '[]'::jsonb)
      into v_iva from jsonb_array_elements(v_c -> 'iva') t;
    if v_iva is distinct from v_iva_antes
       or (select sum((t ->> 'base')::numeric) from jsonb_array_elements(v_iva) t) is distinct from v_f.tax_base_total then
      delete from public.supplier_invoice_tax x where x.supplier_invoice_id = v_f.id;
      insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount, surcharge_pct, surcharge_amount)
      select v_f.account_id, v_f.id, nullif(t ->> 'tipo_id', '')::uuid, (t ->> 'tipo')::numeric, (t ->> 'base')::numeric, (t ->> 'cuota')::numeric,
             nullif(t ->> 'recargo_tipo', '')::numeric, coalesce(nullif(t ->> 'recargo', '')::numeric, 0)
        from jsonb_array_elements(v_iva) t;
      select sum((t ->> 'base')::numeric), sum((t ->> 'cuota')::numeric), sum(nullif(t ->> 'recargo', '')::numeric)
        into v_n.tax_base_total, v_n.tax_total, v_n.surcharge_total from jsonb_array_elements(v_iva) t;
      v_n.tax_base_total := coalesce(v_n.tax_base_total, 0); v_n.tax_total := coalesce(v_n.tax_total, 0);
      v_al_asiento := true; v_guardado := array_append(v_guardado, 'iva');
      v_cambios := v_cambios || jsonb_build_object('campo', 'iva', 'antes', v_iva_antes, 'ahora', v_iva);
      v_textos := array_append(v_textos, format('IVA %s de base y %s de cuota → %s y %s',
        public.compras_euros(v_f.tax_base_total), public.compras_euros(v_f.tax_total), public.compras_euros(v_n.tax_base_total), public.compras_euros(v_n.tax_total)));
    end if;
  end if;

  -- Retención: su tipo (withholding_rate), su base y su importe; o ninguna.
  if v_c ? 'retencion' then
    v_x := v_c -> 'retencion';
    v_ret_antes := case when v_f.withholding_rate_id is null and v_f.withholding_amount is null then null
                        else jsonb_build_object('tipo_id', v_f.withholding_rate_id, 'base', v_f.withholding_base, 'importe', v_f.withholding_amount) end;
    v_importe := case when jsonb_typeof(v_x) = 'object' then round(nullif(v_x ->> 'importe', '')::numeric, 2) end;
    if v_importe is null or v_importe = 0 then
      v_tasa := null; v_ret := null;
    else
      if v_importe < 0 then raise exception 'La retención se escribe en positivo: se resta del total.' using errcode = '22023'; end if;
      v_tasa := nullif(v_x ->> 'tipo_id', '')::uuid;
      v_tipo := nullif(v_x ->> 'tipo', '')::numeric;
      if v_tasa is not null then
        if not exists (select 1 from public.withholding_rate w where w.id = v_tasa and (w.is_system or w.account_id = v_f.account_id)) then
          raise exception 'Esa retención no es de esta cuenta.' using errcode = '42501';
        end if;
      else
        if v_tipo is null then raise exception 'Dime el tipo de la retención (el %%).' using errcode = '22023'; end if;
        select array_agg(w.id order by w.sort_order, w.code) into v_tasas from public.withholding_rate w
         where w.rate = v_tipo and (w.is_system or w.account_id = v_f.account_id)
           and (w.valid_from is null or w.valid_from <= coalesce(v_n.invoice_date, current_date))
           and (w.valid_to is null or w.valid_to >= coalesce(v_n.invoice_date, current_date));
        if v_tasas is null then raise exception 'No hay ninguna retención del % %%.', v_tipo using errcode = '22023'; end if;
        if cardinality(v_tasas) = 1 then
          v_tasa := v_tasas[1];
        else
          -- Varias del mismo tanto (19 %: alquiler o capital): la que usó este proveedor la última vez.
          select i.withholding_rate_id into v_tasa from public.supplier_invoice i
           where i.account_id = v_f.account_id and i.supplier_id = v_n.supplier_id and i.withholding_rate_id = any (v_tasas)
           order by i.invoice_date desc nulls last, i.created_at desc limit 1;
          if v_tasa is null then
            raise exception 'Hay % retenciones del % %% (%): dime cuál con tipo_id.', cardinality(v_tasas), v_tipo,
              (select string_agg(w.name, ', ' order by w.sort_order, w.code) from public.withholding_rate w where w.id = any (v_tasas)) using errcode = '22023';
          end if;
        end if;
      end if;
      v_ret := jsonb_build_object('tipo_id', v_tasa, 'base', round(nullif(v_x ->> 'base', '')::numeric, 2), 'importe', v_importe);
    end if;
    if v_ret is distinct from v_ret_antes then
      v_n.withholding_rate_id := v_tasa; v_n.withholding_amount := case when v_ret is null then null else v_importe end;
      v_n.withholding_base := case when v_ret is null then null else (v_ret ->> 'base')::numeric end;
      v_al_asiento := true; v_guardado := array_append(v_guardado, 'retencion');
      v_cambios := v_cambios || jsonb_build_object('campo', 'retencion', 'antes', v_ret_antes, 'ahora', v_ret);
      v_textos := array_append(v_textos, format('Retención %s → %s', case when v_f.withholding_amount is null then 'ninguna' else public.compras_euros(v_f.withholding_amount) end,
        case when v_ret is null then 'ninguna' else public.compras_euros(v_importe) end));
    end if;
  end if;

  -- Con el IVA o la retención cambiados, el total: base + cuota + recargo − retención.
  if ('iva' = any (v_guardado) or 'retencion' = any (v_guardado)) and v_n.tax_base_total is not null and v_n.tax_total is not null then
    v_n.grand_total := v_n.tax_base_total + v_n.tax_total + coalesce(v_n.surcharge_total, 0) - coalesce(v_n.withholding_amount, 0);
  end if;

  -- El gasto repartido: cuentas del plan de su empresa, local de la cuenta o común.
  if v_c ? 'gasto' then
    if jsonb_typeof(v_c -> 'gasto') <> 'array' then raise exception 'El gasto va en una lista: cuenta, local y importe.' using errcode = '22023'; end if;
    if jsonb_array_length(v_c -> 'gasto') > 0 and v_n.company_id is null then
      raise exception 'La factura no tiene empresa: no se puede repartir su gasto en un plan.' using errcode = '22023';
    end if;
    select count(*) into v_mal from jsonb_array_elements(v_c -> 'gasto') g
     where nullif(g ->> 'cuenta', '') is null or jsonb_typeof(g -> 'importe') <> 'number';
    if v_mal > 0 then raise exception 'Cada línea del gasto lleva su cuenta y su importe (% sin ellos).', v_mal using errcode = '22023'; end if;
    select string_agg(distinct g ->> 'cuenta', ', ') into v_txt from jsonb_array_elements(v_c -> 'gasto') g
     where not exists (select 1 from public.company_account a where a.company_id = v_n.company_id and a.code = g ->> 'cuenta' and a.status <> 'cerrada');
    if v_txt is not null then raise exception 'Estas cuentas no están (o están cerradas) en el plan de la empresa: %.', v_txt using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_c -> 'gasto') g
                where nullif(g ->> 'local', '') is not null
                  and not exists (select 1 from public.locations l where l.id = (g ->> 'local')::uuid and l.account_id = v_f.account_id)) then
      raise exception 'Un local del gasto no es de esta cuenta.' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('cuenta', x.account_code, 'local', x.location_id, 'comun', x.is_common, 'importe', x.amount) order by x.position), '[]'::jsonb)
      into v_gasto_antes from public.supplier_invoice_expense x where x.supplier_invoice_id = v_f.id;
    select coalesce(jsonb_agg(jsonb_build_object('cuenta', g ->> 'cuenta', 'local', nullif(g ->> 'local', '')::uuid,
                                                 'comun', coalesce((g ->> 'comun')::boolean, nullif(g ->> 'local', '') is null),
                                                 'importe', round((g ->> 'importe')::numeric, 2)) order by o), '[]'::jsonb)
      into v_gasto from jsonb_array_elements(v_c -> 'gasto') with ordinality as e(g, o);
    if v_gasto is distinct from v_gasto_antes then
      delete from public.supplier_invoice_expense x where x.supplier_invoice_id = v_f.id;
      insert into public.supplier_invoice_expense (account_id, supplier_invoice_id, position, account_code, location_id, is_common, amount)
      select v_f.account_id, v_f.id, (o - 1)::int, g ->> 'cuenta', nullif(g ->> 'local', '')::uuid, (g ->> 'comun')::boolean, (g ->> 'importe')::numeric
        from jsonb_array_elements(v_gasto) with ordinality as e(g, o);
      v_al_asiento := true; v_guardado := array_append(v_guardado, 'gasto');
      v_cambios := v_cambios || jsonb_build_object('campo', 'gasto', 'antes', v_gasto_antes, 'ahora', v_gasto);
      v_textos := array_append(v_textos, case when jsonb_array_length(v_gasto) = 0 then 'Gasto: sin reparto, el de la cuenta propuesta'
                                   else format('Gasto: %s', (select string_agg(format('%s %s', g ->> 'cuenta', public.compras_euros((g ->> 'importe')::numeric)), ' + ' order by o)
                                                            from jsonb_array_elements(v_gasto) with ordinality as e(g, o))) end);
    end if;
  end if;

  -- El asiento a mano: tiene que cuadrar, con cuentas del plan de su empresa.
  if v_c ? 'asiento_a_mano' then
    v_x := v_c -> 'asiento_a_mano';
    if jsonb_typeof(v_x) = 'null' then v_x := null; end if;
    if v_x is not null then
      if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) < 2 then
        raise exception 'El asiento a mano lleva al menos dos líneas.' using errcode = '22023';
      end if;
      if v_n.company_id is null then raise exception 'La factura no tiene empresa: no hay plan contra el que hacer el asiento.' using errcode = '22023'; end if;
      select string_agg(distinct coalesce(nullif(l ->> 'cuenta', ''), '(sin cuenta)'), ', ') into v_txt from jsonb_array_elements(v_x) l
       where not exists (select 1 from public.company_account a where a.company_id = v_n.company_id and a.code = l ->> 'cuenta' and a.status <> 'cerrada');
      if v_txt is not null then raise exception 'El asiento a mano usa cuentas que no están en el plan de la empresa: %.', v_txt using errcode = '22023'; end if;
      select round(sum(coalesce(nullif(l ->> 'debe', '')::numeric, 0)), 2), round(sum(coalesce(nullif(l ->> 'haber', '')::numeric, 0)), 2),
             count(*) filter (where coalesce(nullif(l ->> 'debe', '')::numeric, 0) < 0 or coalesce(nullif(l ->> 'haber', '')::numeric, 0) < 0)
        into v_debe, v_haber, v_mal from jsonb_array_elements(v_x) l;
      if v_mal > 0 then raise exception 'En el asiento, el debe y el haber van en positivo.' using errcode = '22023'; end if;
      if v_debe <> v_haber or v_debe = 0 then
        raise exception 'El asiento no cuadra: debe %, haber %.', public.compras_euros(v_debe), public.compras_euros(v_haber) using errcode = '22023';
      end if;
    end if;
    if v_x is distinct from v_f.entry_overrides then
      v_n.entry_overrides := v_x; v_al_asiento := true; v_guardado := array_append(v_guardado, 'asiento_a_mano');
      v_cambios := v_cambios || jsonb_build_object('campo', 'asiento_a_mano', 'antes', v_f.entry_overrides, 'ahora', v_x);
      v_textos := array_append(v_textos, case when v_x is null then 'Asiento: el propuesto' else 'Asiento: a mano' end);
    end if;
  end if;

  -- Vence: con set_supplier_invoice_due_date (su escritura y su registro de siempre).
  if v_c ? 'vence' then
    v_vence := nullif(v_c ->> 'vence', '')::date;
    v_vence_antes := v_f.due_date;
  end if;

  if cardinality(v_guardado) > 0 then
    update public.supplier_invoice
       set supplier_id = v_n.supplier_id, invoice_number = v_n.invoice_number, invoice_date = v_n.invoice_date, location_id = v_n.location_id,
           payment_method = v_n.payment_method, tax_base_total = v_n.tax_base_total, tax_total = v_n.tax_total, surcharge_total = v_n.surcharge_total,
           grand_total = v_n.grand_total, withholding_rate_id = v_n.withholding_rate_id, withholding_amount = v_n.withholding_amount,
           withholding_base = v_n.withholding_base, entry_overrides = v_n.entry_overrides, updated_at = now()
     where id = v_f.id;
  end if;
  if v_c ? 'vence' and v_vence is distinct from v_vence_antes then
    perform public.set_supplier_invoice_due_date(v_f.id, v_vence);
    v_guardado := array_append(v_guardado, 'vence');
    v_cambios := v_cambios || jsonb_build_object('campo', 'vence', 'antes', v_vence_antes, 'ahora', v_vence);
    v_textos := array_append(v_textos, format('Vence %s → %s', coalesce(to_char(v_vence_antes, 'DD/MM/YYYY'), 'sin vencimiento'), coalesce(to_char(v_vence, 'DD/MM/YYYY'), 'sin vencimiento')));
  end if;

  if cardinality(v_guardado) = 0 then
    return jsonb_build_object('guardado', '[]'::jsonb, 'texto', 'No había nada que guardar: todo estaba como está.', 'asiento_quitado', false);
  end if;

  -- Su asiento propuesto, si lo cambiado le afecta: fuera, para volver a proponerlo con lo nuevo.
  if v_al_asiento then
    delete from public.journal_entry e
     where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');
    get diagnostics v_quitados = row_count;
  end if;

  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar', v_cambios);

  return jsonb_build_object(
    'guardado', to_jsonb(v_guardado),
    'texto', 'Guardado: ' || array_to_string(v_textos, ', ') || '.'
             || case when v_quitados > 0 then ' Su asiento propuesto se ha quitado para proponerlo otra vez con lo nuevo.' else '' end,
    'asiento_quitado', v_quitados > 0);
end $function$;

-- 2 · mark_supplier_invoice_paid -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_supplier_invoice_paid(p_invoice_id uuid, p_paid_at date, p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv supplier_invoice%rowtype; v_name text;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  if not found or not belongs_to_account(v_inv.account_id) then raise exception 'No encuentro esa factura.'; end if;
  if v_inv.status not in ('aprobada','pagada') then
    raise exception 'Solo se puede marcar como pagada una factura aprobada.';
  end if;
  if p_paid_at is null then raise exception 'Falta la fecha de pago.'; end if;
  if p_method is not null and p_method not in ('transfer','direct_debit','card','cash','prepaid') then
    raise exception 'No conozco la forma de pago «%». Puede ser: Transferencia, Domiciliación, Tarjeta, Efectivo o Saldo prepago Catcher (40700001).', p_method;
  end if;
  v_name := _actor_name(v_inv.account_id);
  update supplier_invoice set status = 'pagada', paid_at = p_paid_at, paid_method = p_method,
         paid_by = auth.uid(), paid_by_name = v_name, updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'paid', p_paid_at, p_method, auth.uid(), v_name);
end $function$;

-- 3 y 4 · Los CHECK de las formas de pago de facturas y clientes ---------------------------
alter table public.supplier_invoice drop constraint if exists supplier_invoice_paid_method_check;
alter table public.supplier_invoice add constraint supplier_invoice_paid_method_check
  check (paid_method is null or paid_method in ('transfer', 'direct_debit', 'card', 'cash', 'prepaid'));
alter table public.customer_fiscal drop constraint if exists customer_fiscal_payment_method_check;
alter table public.customer_fiscal add constraint customer_fiscal_payment_method_check
  check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash', 'prepaid'));

-- 5 · El catálogo y la fila de Foodint ------------------------------------------------------
alter table public.payment_method drop constraint if exists payment_method_kind_check;
alter table public.payment_method add constraint payment_method_kind_check
  check (kind in ('transfer', 'direct_debit', 'card', 'cash', 'other', 'prepaid'));
-- Una fila PROPIA de la empresa de Foodint, no de sistema: una de sistema exige su
-- base legal y su fuente oficial (payment_method_serie), y «Saldo prepago
-- Catcher» no es una forma de pago de la ley, es la de Catcher. Anclada por
-- cuenta y empresa (regla 9). En una base sin Foodint (staging), ninguna.
insert into public.payment_method (account_id, company_id, is_system, code, name, example, kind, sort_order)
select c.account_id, c.id, false, 'saldo_prepago', 'Saldo prepago Catcher (40700001)', 'Se descuenta del saldo que recargas por adelantado en Catcher', 'prepaid', 50
  from public.company c
 where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and c.id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
   and not exists (select 1 from public.payment_method p where p.company_id = c.id and p.kind = 'prepaid');
