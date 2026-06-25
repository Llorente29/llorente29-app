create or replace function tg_auto_dispatch_catcher()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.source = 'folvy_shop'
     and new.order_status = 'accepted'
     and new.carrier_order_id is null
     and coalesce(new.dispatch_mode, 'auto') = 'auto'
  then
    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-dispatch',
      headers := jsonb_build_object(
        'Content-Type',                'application/json',
        'x-catcher-dispatch-secret',   'fv_catdisp_tnrMMcaI8gALFCitfvzPGsaHgQa3A83w'
      ),
      body    := jsonb_build_object(
        'sale_id',  new.id,
        'internal', true
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_dispatch_catcher on public.sale;
create trigger trg_auto_dispatch_catcher
  after update on public.sale
  for each row
  when (old.order_status is distinct from new.order_status)
  execute function tg_auto_dispatch_catcher();
