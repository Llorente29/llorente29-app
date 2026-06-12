# Actualización guion vivo — 12/06/2026 (cierre parcial, sesión sigue)

> Pega este bloque en `docs/folvy_guion_vivo.md`. Es el "qué hacer" tras poner
> Llorente29 en producción y construir el dashboard de ventas.

## Estado: Llorente29 EN PRODUCCIÓN

Migración cerrada y verificada. Ventas reales entran al 100% con marca. Dashboard
de ventas en producción. Bug RLS de superadmin (no veía/escribía cuentas ajenas,
~50 tablas) arreglado de raíz.

---

## FRENTE ABIERTO: Dashboard de ventas — hoja de ruta por capas

El dashboard (Folvy Sales → Resumen de ventas) está en producción con:
KPIs (ventas netas, ticket medio, pedidos, vs-periodo-anterior), propias vs cedidas,
ventas por canal, ranking de marcas y locales, heatmap horario (hora local desde
`accounts.timezone`), 4 filtros (local, tipo own/licensed, canal, marca), textos
explicativos. RPC server-side `sales_dashboard`.

**Objetivo: un GRAN dashboard que golee a Otter/Apicbase/R365, con apoyos de IA y
previsiones. Construir por capas, cada una probada y subida antes de la siguiente.**

- **Capa 1 — Parecido con la maqueta** ✅ HECHO (vs-ayer + textos).
- **Capa 2 — Margen real** (siguiente): RPC que cruza ventas × coste de escandallo
  → margen € y % por marca/canal/local, **ponderado por el mix realmente vendido**.
  Activa el KPI "Margen estimado". Diferencial: Otter NO ve coste. Solo platos con
  escandallo casado entran; los sin casar se cuentan aparte (honesto, no infla).
- **Capa 3 — Ingeniería de menú en vivo**: la matriz Estrella/Caballo/Puzzle/Lastre
  YA EXISTE en Kitchen (`menuEngineeringService.ts` + `KitchenMenuEngineeringPage`,
  Kasavana-Smith, umbrales dinámicos, solo 'own' con coste). Enlazar/embeber en el
  dashboard con ventas reales — NO duplicar.
- **Capa 4 — Previsiones / proyección**: tendencia + proyección ("a este ritmo
  cerrarás en ~X€"), semana vs anterior, previsión por franja. Lógica predictiva.
- **Capa 5 — Insights con Folvy AI**: bloque que lee el dashboard y escribe insights
  en lenguaje natural ("las cedidas tiran más hoy", "Milanesa House es tu estrella,
  súbele precio", "Glovo deja menos margen que Uber"). Folvy AI ya ve los 3 módulos.

---

## OTROS PENDIENTES ANOTADOS

1. **Frente 3 de Code — completado masivo de ingredientes** (modo lote IA sobre los
   76 de Llorente29). Diseñado por Code en
   `docs/folvy_completado_masivo_ingredientes_diseno.md`, NO ejecutado. Espera visto
   bueno de Julio. El Edge `enrich-ingredient` ya está redesplegado (funciona).
   Verificar Fase 0 (familias de Llorente29 casan con `family_vat_default`).

2. **Registro de pedidos (ticket consultable)** — el OTRO requisito del cliente
   (operación/Pamela): ver cada pedido como ticket. Dato en `sale` + `raw_tab`
   (completo solo desde el webhook nuevo de hoy; histórico viejo solo `raw_products`).
   Reaprovecha base de `SalesExceptionsPage`. Hora local.

3. **Versionar el SQL de hoy como migraciones** en `supabase/migrations/` (deuda con
   riesgo técnico real: vivo en producción, ausente del repo):
   - RPC `sales_dashboard` (con bloque `prev`).
   - Fixes RLS: `current_user_account_ids` (superadmin → todas las cuentas),
     `belongs_to_account`, `current_user_is_admin_or_manager_of` (+OR is_admin).
   - Switch DML de las 6 tiendas Last a Llorente29.
   - `migrate_brands_and_map` + mapeo Chivuos.
   - Edge desplegados: webhook, catalog-import, enrich-ingredient.
   - Regenerar `src/types/database.ts`.

4. **Menores arrastrados**: rotar credenciales pegadas en chat; www.folvy.app
   NXDOMAIN; doble selector de local en APPCC/Personal; crear username/pin de las 3
   empleadas; modelar "de quién es la licencia" en cedidas (Lobbers ≠ Cloudtown);
   `channel_id` siempre null en `sale` (canal solo como texto — deuda menor).
