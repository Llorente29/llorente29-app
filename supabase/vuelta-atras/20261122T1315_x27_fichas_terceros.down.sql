-- supabase/vuelta-atras/20261122T1315_x27_fichas_terceros.down.sql
-- X27 · La vuelta atrás de la 1315: quita las columnas nuevas de supplier y de
-- customer_fiscal (con lo que se haya escrito en ellas). Va después de la de la 1316. Lo que las facturas copiaron
-- de una ficha se queda en la factura (sus columnas son del K11a y del K10b).
alter table public.customer_fiscal drop column if exists usual_tax_rate_ids;
alter table public.customer_fiscal drop column if exists trade_name;
alter table public.customer_fiscal drop column if exists notes;
alter table public.customer_fiscal drop column if exists email;
alter table public.customer_fiscal drop column if exists phone;
alter table public.supplier drop column if exists pay_on_post;
alter table public.supplier drop column if exists exclude_from_347;
alter table public.supplier drop column if exists default_channel_id;
alter table public.supplier drop column if exists default_brand_id;
alter table public.supplier drop constraint if exists supplier_vat_deductible_pct_check;
alter table public.supplier drop column if exists vat_deductible_pct;
