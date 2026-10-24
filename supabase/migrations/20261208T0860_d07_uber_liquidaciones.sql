-- supabase/migrations/20261208T0860_d07_uber_liquidaciones.sql
-- cambia: public.conta_liquidacion_factura_proponer · prueba: supabase/staging/sql/20261208_d07_uber_liquidaciones_prueba.sql
--
-- D07 · UBER FUERA DE «FACTURAS RECIBIDAS» (Julio, 23/10, camino B).
--
-- 1. conta_liquidacion_factura_proponer (CAMBIA en caliente, misma firma): al
--    leer el correo de una liquidación ya NO crea una factura de comisión
--    provisional (sin número ni PDF, source 'liquidacion'). La factura de
--    comisión de Uber llega cada semana como su propia factura recibida, con
--    su PDF. Lo de antes (el corte: de referencia; sin comisión: sin factura)
--    sigue igual. La llama conta_liquidacion_registrar, que solo usa su texto.
--    Cuerpo de partida, el de PRODUCCIÓN (md5 del cuerpo
--    daff8f19ef7d7b2eca1a2c2c693d3fa8, la 0100 del D01).
-- 2. conta_liquidacion_enlazar_factura(factura, liquidaciones, quién)
--    (AÑADE): enlaza esa factura con las liquidaciones de su semana
--    (channel_settlement.commission_invoice_id). Solo liquidaciones de la
--    cuenta, del canal cuya plataforma es el proveedor de la factura, y sin
--    otra factura; si alguna no, ninguna. Dice cuánto suman contra el total.
--    El asiento de cada liquidación compensa SU parte (la de su correo).
--
-- Las 8 provisionales que ya hay las quita la 0870 (datos, autorizo).
-- Misma firma: create or replace, sin sobrecarga (regla 2). No toca filas. No
-- toca el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261208T0860_d07_uber_liquidaciones.down.sql

-- 1 · Sin provisional ---------------------------------------------------------------------------
create or replace function public.conta_liquidacion_factura_proponer(p_settlement uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cs public.channel_settlement; v_e uuid; v_f jsonb; v_sup uuid; v_rol public.party_role; v_inv uuid; v_410 text;
  v_c623 text; v_c627 text; v_tasa uuid; v_fecha date; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_base numeric; v_iva numeric; v_total numeric; v_bc numeric; v_ba numeric; v_sem int; v_corte date;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null then raise exception 'Esa liquidación no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cs.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone facturas.' using errcode = '42501';
  end if;
  if v_cs.commission_invoice_id is not null then
    return jsonb_build_object('estado', 'ya_estaba', 'factura_id', v_cs.commission_invoice_id, 'texto', 'La factura de comisión ya estaba.');
  end if;
  -- El corte (Julio, 16/10): la contabilidad está cerrada hasta la fecha de corte
  -- de Bancos. Una liquidación que ACABA antes es solo de referencia: sin
  -- factura ni asiento (sirve para contrastar y para casar su cobro). La que
  -- cruza el corte es real: su factura va entera con su fecha (después del fin
  -- del periodo, así que ya del periodo abierto).
  v_corte := public._conta_corte((select company_id from public.platform_store where id = v_cs.store_id));
  if v_corte is not null and v_cs.period_to < v_corte then
    update public.channel_settlement set is_reference = true, updated_at = now() where id = v_cs.id and is_reference is distinct from true;
    perform public._conta_liquidacion_marcar(v_cs.id);
    return jsonb_build_object('estado', 'referencia', 'corte', v_corte,
      'texto', 'De referencia: es de antes del cierre (' || to_char(v_corte - 1, 'DD/MM/YYYY') || '), así que no lleva factura de comisión ni asiento.');
  end if;
  v_f := v_cs.raw->'factura';
  if v_f is null or jsonb_typeof(v_f) <> 'object' or coalesce((v_f->>'total')::numeric, 0) = 0 then
    return jsonb_build_object('estado', 'sin_factura', 'texto', 'Esta liquidación no tiene comisión ni cargos que facturar.');
  end if;
  v_base := (v_f->>'base')::numeric; v_iva := (v_f->>'iva')::numeric; v_total := (v_f->>'total')::numeric;
  v_bc := (v_f->'comision'->>'base')::numeric; v_ba := (v_f->'publicidad'->>'base')::numeric;
  if round(v_base * 100) + round(v_iva * 100) <> round(v_total * 100) or round(v_bc * 100) + round(v_ba * 100) <> round(v_base * 100) then
    raise exception 'La factura de comisión no cuadra: base + IVA no es el total.' using errcode = '22023';
  end if;
  -- D07 (Julio, 23/10, camino B): la factura de comisión de Uber llega CADA
  -- SEMANA, como su propia factura recibida, con su PDF y su número, y se
  -- enlaza con las liquidaciones de su semana (conta_liquidacion_enlazar_factura).
  -- Aquí ya no se crea una provisional sin número ni PDF: salía en «Facturas
  -- recibidas» y en «Por revisar» como si fuera una factura. Si una semana no
  -- llega, lo dice Inicio.
  perform public._conta_liquidacion_marcar(v_cs.id);
  return jsonb_build_object('estado', 'espera_factura', 'total', (v_f->>'total')::numeric,
    'texto', 'Su factura de comisión (' || public.conta_euros_exactos((v_f->>'total')::numeric) ||
             ') llega aparte, cada semana, con su PDF: cuando entre en Facturas recibidas se enlaza con las liquidaciones de su semana.');
end $$;


-- 2 · Enlazar la factura de la semana ------------------------------------------------------------
create or replace function public.conta_liquidacion_enlazar_factura(p_invoice uuid, p_liquidaciones uuid[], p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice; v_mal int; v_n int; v_suma numeric; v_desde date; v_hasta date;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta enlaza facturas con liquidaciones.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'La factura está %: no se enlaza.', v_f.status using errcode = '22023';
  end if;
  if p_liquidaciones is null or cardinality(p_liquidaciones) = 0 then
    raise exception 'Di con qué liquidaciones se enlaza.' using errcode = '22023';
  end if;
  -- De la cuenta, del canal cuya plataforma es el proveedor de la factura, y sin otra factura.
  select count(*) into v_mal
    from unnest(p_liquidaciones) x(id)
    left join public.channel_settlement cs on cs.id = x.id and cs.account_id = v_f.account_id
   where cs.id is null
      or (cs.commission_invoice_id is not null and cs.commission_invoice_id <> v_f.id)
      or not exists (select 1 from public.party_role pl
                       join public.party_role ps on ps.account_id = pl.account_id and ps.party_id = pl.party_id and ps.role = 'supplier'
                      where pl.account_id = v_f.account_id and pl.role = 'platform' and pl.channel_id = cs.channel_id
                        and ps.supplier_id = v_f.supplier_id);
  if v_mal > 0 then
    raise exception '% de las % liquidaciones no son de este proveedor, no son de tu cuenta o ya tienen otra factura: no se enlaza ninguna.',
      v_mal, cardinality(p_liquidaciones) using errcode = '22023';
  end if;
  update public.channel_settlement set commission_invoice_id = v_f.id, updated_at = now()
   where account_id = v_f.account_id and id = any (p_liquidaciones) and commission_invoice_id is distinct from v_f.id;
  get diagnostics v_n = row_count;
  perform public._conta_liquidacion_marcar(cs.id) from public.channel_settlement cs where cs.account_id = v_f.account_id and cs.id = any (p_liquidaciones);
  select round(sum(coalesce((cs.raw->'factura'->>'total')::numeric, 0)), 2), min(cs.period_from), max(cs.period_to)
    into v_suma, v_desde, v_hasta
    from public.channel_settlement cs where cs.account_id = v_f.account_id and cs.id = any (p_liquidaciones);
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar', jsonb_build_array(jsonb_build_object('campo', 'liquidaciones',
          'antes', null, 'ahora', to_jsonb(p_liquidaciones))));
  return jsonb_build_object('enlazadas', cardinality(p_liquidaciones), 'nuevas', v_n, 'suma', v_suma, 'total', v_f.grand_total,
    'cuadra', v_suma = v_f.grand_total,
    'texto', format('Enlazada con %s liquidaciones (del %s al %s): suman %s, %s.', cardinality(p_liquidaciones),
                    to_char(v_desde, 'DD/MM'), to_char(v_hasta, 'DD/MM/YYYY'), public.conta_euros_exactos(v_suma),
                    case when v_suma = v_f.grand_total then 'como la factura'
                         else 'y la factura dice ' || public.conta_euros_exactos(v_f.grand_total) || ': revisa cuáles van' end));
end $$;
revoke all on function public.conta_liquidacion_enlazar_factura(uuid, uuid[], text) from public, anon;
grant execute on function public.conta_liquidacion_enlazar_factura(uuid, uuid[], text) to authenticated;
