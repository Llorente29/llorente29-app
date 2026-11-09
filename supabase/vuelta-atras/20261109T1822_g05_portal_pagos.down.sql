-- supabase/vuelta-atras/20261109T1822_g05_portal_pagos.down.sql
-- Vuelta atrás de la 1822: fuera las funciones y la tabla de los pagos desde el
-- portal, las marcas «portal_…» de «Cobrado por otra vía» (el CHECK como antes)
-- y la columna de la puente de Stripe. Y la 57200003 «Plataforma Stripe» que creó
-- Sumied (la de la demo, al aplicar), con su apunte en el registro del plan, para
-- dejar la base como estaba (nº 57). Solo si nada la usa: con un apunte, un enlace
-- o cualquier otra cosa que la nombre, se queda (borrarla rompería esos asientos).
drop function if exists public.conta_cobro_cuenta_cambiada(uuid, uuid, text, text, text[], text);
drop function if exists public.conta_recibo_pagado_portal(uuid, text, numeric, text);
drop function if exists public._conta_cobro_facturar_portal(uuid, date, text, text, text);
drop function if exists public._conta_cobro_puente(uuid, text, text, text, text);
with fuera as (
  delete from public.company_account x
   where x.code = '57200003' and x.name = 'Plataforma Stripe' and x.source = 'manual' and x.created_by_name = 'Sumied'
     and not exists (select 1 from public.journal_line l where l.company_account_id = x.id)
     and not exists (select 1 from public.company_account_link l where l.company_account_id = x.id)
     and not exists (select 1 from public.conta_pasarela_cuenta l where l.company_account_id = x.id)
     and not exists (select 1 from public.conta_ventas_canal_cuenta l where l.company_account_id = x.id)
     and not exists (select 1 from public.conta_ventas_marca l where l.company_account_id = x.id)
     and not exists (select 1 from public.entry_template_line l where l.company_account_id = x.id)
     and not exists (select 1 from public.investment_good l where l.company_account_id = x.id)
     and not exists (select 1 from public.customer_invoice_line l where l.revenue_account_id = x.id)
  returning x.company_id
)
delete from public.company_account_log g using fuera f
 where g.company_id = f.company_id and g.que = 'subcuenta_creada' and g.code = '57200003' and g.done_by_name = 'Sumied';
drop table if exists public.conta_recibo_pago_portal;
delete from public.conta_gc_cobro_otra_via where via in ('portal_banco', 'portal_tarjeta');
alter table public.conta_gc_cobro_otra_via drop constraint if exists conta_gc_cobro_otra_via_via_check;
alter table public.conta_gc_cobro_otra_via add constraint conta_gc_cobro_otra_via_via_check check (via = any (array['transferencia'::text, 'efectivo'::text]));
alter table public.conta_gestoria_ajustes drop column if exists cuenta_stripe;
