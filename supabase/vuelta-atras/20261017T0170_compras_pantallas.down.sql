-- ============================================================================
-- Vuelta atrás de Compras · 8 · lo que leen las pantallas. Quita las cinco
-- funciones y las cuatro columnas de la pregunta cerrada. Lo que se pierde:
-- qué preguntas había cerrado alguien («dejarlo así») y su nota; al volver a
-- aplicar, esas preguntas vuelven a salir en «Qué tienes que mirar».
-- ============================================================================
drop function if exists public.compras_liquidacion_productos(uuid);
drop function if exists public.compras_camino_rehacer(uuid);
drop function if exists public.compras_camino_de(uuid);
drop function if exists public.compras_ultimos_papeles(uuid, int);
drop function if exists public.compras_liquidaciones(uuid, date);
drop function if exists public.compras_mirar(uuid);
drop function if exists public.compras_cerrar_pregunta(uuid, text);
alter table public.goods_receipt_path drop column if exists question_closed_at;
alter table public.goods_receipt_path drop column if exists question_closed_by_name;
alter table public.goods_receipt_path drop column if exists question_closed_note;
alter table public.goods_receipt_path drop column if exists question_closed;
