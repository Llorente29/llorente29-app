-- 20260721T2600_cfg4c_quests.sql
-- CFG-4c: RETOS (quests) — la pieza que Catcher NO tiene. "Haz N entregas en la
-- ventana (día/semana) → bono €X". Progreso CALCULADO (sin duplicar estado, sin
-- drift): cuenta entregas completadas del repartidor en la ventana vigente.

-- 1) Tabla de retos por cuenta.
CREATE TABLE IF NOT EXISTS public.courier_bonus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'quest',
  period       text NOT NULL DEFAULT 'week',      -- 'day' | 'week' (semana ISO, lunes)
  target_count int  NOT NULL,
  reward       numeric NOT NULL,
  location_id  uuid REFERENCES public.locations(id) ON DELETE CASCADE,  -- null = todos
  valid_from   date,
  valid_to     date,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_bonus_period_check CHECK (period IN ('day','week')),
  CONSTRAINT courier_bonus_kind_check   CHECK (kind IN ('quest'))
);

ALTER TABLE public.courier_bonus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cb_select ON public.courier_bonus;
DROP POLICY IF EXISTS cb_write  ON public.courier_bonus;
CREATE POLICY cb_select ON public.courier_bonus FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY cb_write  ON public.courier_bonus FOR ALL
  USING (current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin_or_manager_of(account_id));

-- 2) Guardar / borrar reto (admin/manager).
CREATE OR REPLACE FUNCTION public.upsert_courier_bonus(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_acc uuid; v_id uuid;
begin
  v_acc := (current_user_account_ids())[1];
  if v_acc is null or not current_user_is_admin_or_manager_of(v_acc) then raise exception 'forbidden'; end if;
  v_id := nullif(p->>'id','')::uuid;
  if v_id is null then
    insert into courier_bonus(account_id,name,period,target_count,reward,location_id,valid_from,valid_to,is_active)
    values (v_acc, coalesce(nullif(p->>'name',''),'Reto'), coalesce(nullif(p->>'period',''),'week'),
      coalesce((p->>'target_count')::int,0), coalesce((p->>'reward')::numeric,0),
      nullif(p->>'location_id','')::uuid, nullif(p->>'valid_from','')::date, nullif(p->>'valid_to','')::date,
      coalesce((p->>'is_active')::boolean,true))
    returning id into v_id;
  else
    update courier_bonus set name=coalesce(nullif(p->>'name',''),name),
      period=coalesce(nullif(p->>'period',''),period), target_count=coalesce((p->>'target_count')::int,target_count),
      reward=coalesce((p->>'reward')::numeric,reward), location_id=nullif(p->>'location_id','')::uuid,
      valid_from=nullif(p->>'valid_from','')::date, valid_to=nullif(p->>'valid_to','')::date,
      is_active=coalesce((p->>'is_active')::boolean,is_active), updated_at=now()
    where id=v_id and account_id=v_acc;
  end if;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_courier_bonus(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  delete from courier_bonus where id=p_id and account_id = any(current_user_account_ids())
    and current_user_is_admin_or_manager_of(account_id);
end; $function$;

-- 3) Progreso de retos de un repartidor (ventana vigente día/semana), calculado en vivo.
CREATE OR REPLACE FUNCTION public.courier_quest_progress(p_courier_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with c as (select * from public.courier where id = p_courier_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', qb.id, 'name', qb.name, 'period', qb.period,
    'target', qb.target_count, 'reward', qb.reward,
    'location_id', qb.location_id,
    'done', d.done,
    'completed', (d.done >= qb.target_count)
  ) order by qb.reward desc), '[]'::jsonb)
  from public.courier_bonus qb
  cross join lateral (
    select case when qb.period='day'
      then (date_trunc('day',  now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid'
      else (date_trunc('week', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid'
    end as start_ts
  ) w
  cross join lateral (
    select count(*)::int as done
    from public.delivery_assignment da
    where da.courier_id = p_courier_id
      and da.state = 'delivered'
      and da.delivered_at >= w.start_ts
      and (qb.location_id is null or da.location_id = qb.location_id)
  ) d
  where qb.account_id = (select account_id from c)
    and qb.is_active
    and (qb.valid_from is null or (now() at time zone 'Europe/Madrid')::date >= qb.valid_from)
    and (qb.valid_to   is null or (now() at time zone 'Europe/Madrid')::date <= qb.valid_to)
    and (qb.location_id is null
         or (select assigned_locations = '{}'::uuid[] or qb.location_id = any(assigned_locations) from c));
$function$;

-- 4) Progreso por token, para la PWA del repartidor (sin login).
CREATE OR REPLACE FUNCTION public.courier_quests_by_token(p_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.courier;
BEGIN
  c := public._courier_by_token(p_token);
  RETURN public.courier_quest_progress(c.id);
END; $function$;

-- 5) Exponer los retos en settings (para el editor de la web).
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
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.name)
      from employees e
      where coalesce(e.active,true)
        and exists (select 1 from locations l
                    where l.account_id in (select id from acc)
                      and (e.location_id = l.id or l.id = any(e.assigned_locations)))
      ),'[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'id',l.id,'name',l.name,'mode',coalesce(l.dispatch_mode,'auto'),
        'broker',l.dispatch_broker,'notify',coalesce(l.customer_notify_enabled,false),
        'bonus_rain_pct',l.bonus_rain_pct,'bonus_demand_max_pct',l.bonus_demand_max_pct,
        'bonus_combined_cap_pct',l.bonus_combined_cap_pct,'weather_is_raining',l.weather_is_raining,
        'weather_auto',l.weather_auto,'surge_pct',public.location_surge_pct(l.id)) order by l.name)
      from locations l where l.account_id in (select id from acc)),'[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'priority',r.priority,'location_id',r.location_id,'weekdays',r.weekdays,
        'time_from',r.time_from,'time_to',r.time_to,'min_total',r.min_total,'max_total',r.max_total,
        'margin_floor_pct',r.margin_floor_pct,'then_carrier',r.then_carrier,'fallback_carrier',r.fallback_carrier,
        'carrier_chain',r.carrier_chain,'max_distance_km',r.max_distance_km,
        'strategy',r.strategy,'is_active',r.is_active) order by r.priority)
      from dispatch_rule r where r.account_id in (select id from acc)),'[]'::jsonb),
    'bonuses', coalesce((select jsonb_agg(jsonb_build_object(
        'id',qb.id,'name',qb.name,'period',qb.period,'target_count',qb.target_count,'reward',qb.reward,
        'location_id',qb.location_id,'valid_from',qb.valid_from,'valid_to',qb.valid_to,'is_active',qb.is_active)
        order by qb.reward desc)
      from courier_bonus qb where qb.account_id in (select id from acc)),'[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'phone',c.phone,'kind',c.kind,'employee_id',c.employee_id,
        'transport_type',c.transport_type,'vehicle_plate',c.vehicle_plate,'nif',c.nif,'iban',c.iban,
        'access_token',c.access_token,
        'assigned_locations',c.assigned_locations,'cost_model',c.cost_model,'cost_value',c.cost_value,
        'rate_base',c.rate_base,'rate_per_km',c.rate_per_km,'rate_min_pickup',c.rate_min_pickup,
        'rate_pickup_fee',c.rate_pickup_fee,'rate_max',c.rate_max,'rate_tiers',c.rate_tiers,
        'active',c.active,'on_shift',c.on_shift) order by c.name)
      from courier c where c.account_id in (select id from acc)),'[]'::jsonb)
  );
$function$;
