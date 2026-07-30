-- 20260730T1500_availability_locations_config.sql
-- ============================================================================
-- CONFIG DE DISPONIBILIDAD POR LOCAL — dos interruptores nuevos en `locations`,
-- mismo patrón que dispatch_mode/dispatch_broker (20260701T1600_dispatch_config_local):
--
--   · availability_auto_mode          'auto' | 'manual' (default 'manual', seguro).
--     Prepara el interruptor para el futuro gatillo de auto-86 por stock (ese
--     gatillo NO existe todavía — depende de que el stock por producto sea
--     fiable — y NO se construye en este encargo). Hoy nadie lo lee; queda
--     cableado para encenderlo marca a marca cuando llegue el momento.
--
--   · availability_other_integrators  text[] (default '{}') — qué otros
--     integradores de pedidos usa este local además de Folvy/HubRise (ej.
--     'last', 'otter', 'deliverect'). Lo lee set_product_availability(_by_token)
--     para decidir si al agotar hay que avisar "desconéctalo también en X"
--     (aviso multi-integrador — Folvy NO escribe en ellos, solo recuerda).
--
-- DDL pura (alter table con default seguro), segura para ejecutar de una vez.
-- Aplicada: —
-- ============================================================================

alter table public.locations
  add column if not exists availability_auto_mode text not null default 'manual'
    check (availability_auto_mode in ('auto', 'manual'));

alter table public.locations
  add column if not exists availability_other_integrators text[] not null default '{}'::text[];

comment on column public.locations.availability_auto_mode is
  'auto|manual — interruptor para el futuro auto-86 por stock (el gatillo real es otro frente, fuera de este encargo). manual = comportamiento actual (nadie auto-86a solo).';
comment on column public.locations.availability_other_integrators is
  'Otros integradores de pedidos que usa este local además de Folvy (ej. last, otter, deliverect). Folvy NO escribe en ellos; set_product_availability(_by_token) los usa solo para avisar al operario que los desconecte a mano al hacer un 86.';
