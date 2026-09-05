CREATE OR REPLACE FUNCTION public.reparto_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'id',l.id,'name',l.name,'mode',coalesce(l.dispatch_mode,'auto'),
        'broker',l.dispatch_broker,'notify',coalesce(l.customer_notify_enabled,false)) order by l.name)
      from locations l where l.account_id in (select id from acc)),'[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'priority',r.priority,'location_id',r.location_id,'weekdays',r.weekdays,
        'time_from',r.time_from,'time_to',r.time_to,'min_total',r.min_total,'max_total',r.max_total,
        'margin_floor_pct',r.margin_floor_pct,'then_carrier',r.then_carrier,'fallback_carrier',r.fallback_carrier,
        'strategy',r.strategy,'is_active',r.is_active) order by r.priority)
      from dispatch_rule r where r.account_id in (select id from acc)),'[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'phone',c.phone,'transport_type',c.transport_type,
        'assigned_locations',c.assigned_locations,'cost_model',c.cost_model,'cost_value',c.cost_value,
        'active',c.active,'on_shift',c.on_shift) order by c.name)
      from courier c where c.account_id in (select id from acc)),'[]'::jsonb)
  );
$function$;