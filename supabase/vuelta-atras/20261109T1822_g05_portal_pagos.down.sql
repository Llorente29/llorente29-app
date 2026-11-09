-- supabase/vuelta-atras/20261109T1822_g05_portal_pagos.down.sql
-- Vuelta atrás de la 1822: fuera las funciones y la tabla de los pagos desde el
-- portal, las marcas «portal_…» de «Cobrado por otra vía» (el CHECK como antes)
-- y la columna de la puente de Stripe (con ella, la de la demo puesta en la 57200003);
-- «Pendiente de revisar» como estaba (fuera «falta_cuenta_stripe»). Y la 57200003 «Plataforma Stripe» que creó
-- Sumied (la de la demo, al aplicar), con su apunte en el registro del plan, para
-- dejar la base como estaba (nº 57). Solo si nada la usa: con un apunte, un enlace
-- o cualquier otra cosa que la nombre, se queda (borrarla rompería esos asientos).
drop function if exists public.conta_cobro_cuenta_cambiada(uuid, uuid, text, text, text[], text);
drop function if exists public.conta_recibo_pagado_portal(uuid, text, numeric, text);
drop function if exists public._conta_cobro_facturar_portal(uuid, date, text, text, text);
drop function if exists public._conta_cobro_puente(uuid, text, text, text, text);
drop function if exists public._conta_cobro_stripe_no_vale(uuid, text);
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
-- «Pendiente de revisar» como en la 1500: fuera las de la cuenta de Stripe y su tipo.
delete from public.conta_gestoria_diferencia where tipo = 'falta_cuenta_stripe';
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm', 'falta_codigo_cliente', 'cliente_no_de_acuerdo']));
-- La cuenta de Stripe puesta (también la de la demo) se va con su columna.
alter table public.conta_gestoria_ajustes drop column if exists cuenta_stripe;
