-- 20260721T2300_cfg3_courier_alta.sql
-- CFG-3: ALTAS de repartidor. Datos de liquidación del autónomo (NIF/IBAN) +
-- matrícula, vínculo con empleado de plantilla, enlace mágico a la PWA (sin
-- instalar ni registrarse — ventaja ya medida vs Onfleet/Deliveroo) y su reseteo.

-- 1) Columnas de alta/liquidación en courier.
ALTER TABLE public.courier
  ADD COLUMN IF NOT EXISTS nif           text,
  ADD COLUMN IF NOT EXISTS iban          text,
  ADD COLUMN IF NOT EXISTS vehicle_plate text;

-- 2) upsert_courier: guarda nif/iban/matrícula (kind/employee_id ya venían de CFG-2).
CREATE OR REPLACE FUNCTION public.upsert_courier(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_acc uuid; v_id uuid;
begin
  v_acc := (current_user_account_ids())[1];
  if v_acc is null or not current_user_is_admin_or_manager_of(v_acc) then raise exception 'forbidden'; end if;
  v_id := nullif(p->>'id','')::uuid;
  if v_id is null then
    insert into courier(account_id,name,phone,kind,employee_id,transport_type,vehicle_plate,nif,iban,
      assigned_locations,cost_model,cost_value,rate_base,rate_per_km,rate_min_pickup,rate_pickup_fee,rate_tiers,active,on_shift)
    values (v_acc, p->>'name', nullif(p->>'phone',''),
      coalesce(nullif(p->>'kind',''),'freelance'), nullif(p->>'employee_id','')::uuid,
      nullif(p->>'transport_type',''), nullif(p->>'vehicle_plate',''), nullif(p->>'nif',''), nullif(p->>'iban',''),
      case when jsonb_typeof(p->'assigned_locations')='array' then (select coalesce(array_agg(x::uuid),'{}'::uuid[]) from jsonb_array_elements_text(p->'assigned_locations') x) else '{}'::uuid[] end,
      coalesce(nullif(p->>'cost_model',''),'per_order'), nullif(p->>'cost_value','')::numeric,
      nullif(p->>'rate_base','')::numeric, nullif(p->>'rate_per_km','')::numeric,
      nullif(p->>'rate_min_pickup','')::numeric, nullif(p->>'rate_pickup_fee','')::numeric,
      case when jsonb_typeof(p->'rate_tiers')='array' then p->'rate_tiers' else null end,
      coalesce((p->>'active')::boolean,true), coalesce((p->>'on_shift')::boolean,false))
    returning id into v_id;
  else
    update courier set name=p->>'name', phone=nullif(p->>'phone',''),
      kind=coalesce(nullif(p->>'kind',''),kind),
      employee_id=case when p ? 'employee_id' then nullif(p->>'employee_id','')::uuid else employee_id end,
      transport_type=nullif(p->>'transport_type',''), vehicle_plate=nullif(p->>'vehicle_plate',''),
      nif=nullif(p->>'nif',''), iban=nullif(p->>'iban',''),
      assigned_locations=case when jsonb_typeof(p->'assigned_locations')='array' then (select coalesce(array_agg(x::uuid),'{}'::uuid[]) from jsonb_array_elements_text(p->'assigned_locations') x) else assigned_locations end,
      cost_model=coalesce(nullif(p->>'cost_model',''),cost_model), cost_value=nullif(p->>'cost_value','')::numeric,
      rate_base=nullif(p->>'rate_base','')::numeric, rate_per_km=nullif(p->>'rate_per_km','')::numeric,
      rate_min_pickup=nullif(p->>'rate_min_pickup','')::numeric, rate_pickup_fee=nullif(p->>'rate_pickup_fee','')::numeric,
      rate_tiers=case when jsonb_typeof(p->'rate_tiers')='array' then p->'rate_tiers' else rate_tiers end,
      active=coalesce((p->>'active')::boolean,active), on_shift=coalesce((p->>'on_shift')::boolean,on_shift), updated_at=now()
    where id=v_id and account_id=v_acc;
  end if;
  return v_id;
end; $function$;

-- 3) Resetear el enlace mágico (revocar el token anterior).
CREATE OR REPLACE FUNCTION public.courier_reset_token(p_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tok text; v_acc uuid;
begin
  select account_id into v_acc from courier where id = p_id;
  if v_acc is null or not current_user_is_admin_or_manager_of(v_acc) then raise exception 'forbidden'; end if;
  update courier set access_token = 'cour_'||replace(gen_random_uuid()::text,'-',''), updated_at=now()
   where id = p_id and account_id = any(current_user_account_ids())
   returning access_token into v_tok;
  return v_tok;
end; $function$;

-- 4) reparto_settings: exponer token/nif/iban/matrícula/employee_id por repartidor
--    + lista de empleados (para vincular un repartidor de plantilla).
CREATE OR REPLACE FUNCTION public.reparto_settings()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with acc as (select unnest(current_user_account_ids()) as id)
  select jsonb_build_object(
    'track_base_url', (select a.track_base_url from accounts a join acc on acc.id=a.id order by a.id limit 1),
    'carriers', coalesce((
        select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by t.ord, t.name)
        from (
          select 'own_fleet'::text as code, 'Flota propia'::text as name, 0 as ord
          union
          select co.code, co.name, 1 as ord
          from account_connector ac
          join connector co on co.id = ac.connector_id
          where ac.account_id in (select id from acc)
            and coalesce(ac.is_active, false)
            and co.category = 'logistics'
        ) t
      ), '[]'::jsonb),
    -- employees no tiene account_id: se escopa por sus locales (location_id / assigned_locations).
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.name)
      from employees e
      where coalesce(e.active,true)
        and exists (select 1 from locations l
                    where l.account_id in (select id from acc)
                      and (e.location_id = l.id or l.id = any(e.assigned_locations)))
      ),'[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'id',l.id,'name',l.name,'mode',coalesce(l.dispatch_mode,'auto'),
        'broker',l.dispatch_broker,'notify',coalesce(l.customer_notify_enabled,false)) order by l.name)
      from locations l where l.account_id in (select id from acc)),'[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'priority',r.priority,'location_id',r.location_id,'weekdays',r.weekdays,
        'time_from',r.time_from,'time_to',r.time_to,'min_total',r.min_total,'max_total',r.max_total,
        'margin_floor_pct',r.margin_floor_pct,'then_carrier',r.then_carrier,'fallback_carrier',r.fallback_carrier,
        'carrier_chain',r.carrier_chain,'max_distance_km',r.max_distance_km,
        'strategy',r.strategy,'is_active',r.is_active) order by r.priority)
      from dispatch_rule r where r.account_id in (select id from acc)),'[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'phone',c.phone,'kind',c.kind,'employee_id',c.employee_id,
        'transport_type',c.transport_type,'vehicle_plate',c.vehicle_plate,'nif',c.nif,'iban',c.iban,
        'access_token',c.access_token,
        'assigned_locations',c.assigned_locations,'cost_model',c.cost_model,'cost_value',c.cost_value,
        'rate_base',c.rate_base,'rate_per_km',c.rate_per_km,'rate_min_pickup',c.rate_min_pickup,
        'rate_pickup_fee',c.rate_pickup_fee,'rate_tiers',c.rate_tiers,
        'active',c.active,'on_shift',c.on_shift) order by c.name)
      from courier c where c.account_id in (select id from acc)),'[]'::jsonb)
  );
$function$;
