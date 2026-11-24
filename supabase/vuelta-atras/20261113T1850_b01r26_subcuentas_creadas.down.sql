-- supabase/vuelta-atras/20261113T1850_b01r26_subcuentas_creadas.down.sql
-- B01r26 · vuelta atrás de la 1850: quita la tabla de las subcuentas creadas en Diez (las de Diez se quedan allí).
drop table if exists public.conta_diez_subcuenta_creada;
