-- supabase/vuelta-atras/20261108T2057_g04_indices_clientes.down.sql
--
-- G04 · La vuelta atrás de la 2057: fuera los siete índices. No hay datos que
-- devolver: la 2057 solo añade índices.
-- sin prueba con datos: solo quita índices; el ensayo de producción la pasa entera, en ROLLBACK.

drop index if exists public.conta_gc_mandato_cliente_idx;
drop index if exists public.conta_gc_suscripcion_cliente_idx;
drop index if exists public.conta_gc_suscripcion_mandato_idx;
drop index if exists public.conta_gestoria_diferencia_cliente_idx;
drop index if exists public.conta_cobro_cliente_gc_idx;
drop index if exists public.conta_gc_cobro_suscripcion_idx;
drop index if exists public.conta_precio_tramo_precio_idx;
