Soy Julio Gª Colón, CEO de Folvy. Proyecto serio en desarrollo activo.

ARRANQUE:
1. Confirma que has leído CONTEXTO_CLAUDE.md (§1 estado vivo), folvy_guion_vivo.md (el frente activo) y docs/folvy_impresion_diseno.md (el área de hoy).
2. Resume en 5 líneas dónde estamos y cuál es el frente activo.
3. Aplica el RITUAL DE 4 PASOS antes de construir: RECON (BBDD+repo) → BENCHMARK → DISEÑO para golear (aprobado por mí) → MEDIR.
4. NO toques nada hasta que confirme.

FRENTE ACTIVO HOY: CÓDIGO DE PLATAFORMA REAL en el ticket (frente 0.quater del guion).
El código grande que imprime el ticket (#XXXXX) es hoy un RECORTE de UUID (últimos 5
caracteres de tab.id vía ticketCode/orderCode), NO el código real que el rider pide:
el G406 de Glovo / el código largo de Uber-JE. Ese código real está dentro de raw_tab
(el JSON crudo que sí se guarda) pero SIN extraer a ninguna columna ni al feed.
Por qué es lo primero: sin el número correcto, el ticket no sirve para cuadrar pedidos
con el repartidor — es la pieza que hace el ticket operativo de verdad.

PLAN DEL FRENTE (deuda 0):
1. RECON: `select jsonb_object_keys(raw_tab::jsonb)` de un pedido de cada plataforma
   (Glovo, Uber, JustEat) para localizar bajo qué clave llega el código corto
   (candidatos: displayId, friendlyId, orderCode, pickupCode, o dentro de tab.delivery).
   OJO: G406 es formato Glovo; Uber/JE usan códigos largos distintos (no uniforme).
2. Extraer en el adaptador lastapp-webhook (buildCanonicalFields) a una columna nueva
   `sale.platform_order_code` (+ re-extraer de los raw_tab existentes con un backfill).
3. Exponer platform_order_code en orders_feed.
4. Usar ese código en el renderizador de tickets (ticketRenderer.ts: orderCode()) en
   vez del recorte de UUID. Decisión a confirmar contigo: ¿mostrar ambos (el código de
   plataforma grande + el correlativo Folvy pequeño), como hace Last (G406 + Código Glovo)?

FICHEROS QUE NECESITARÉ (en UN mensaje, cuando arranquemos):
- supabase/functions/lastapp-webhook/index.ts (el adaptador, para extraer el código)
- src/modules/orders/lib/ticketRenderer.ts (para usar el código real en orderCode)
- src/modules/orders/services/ordersFeedService.ts (tipos del feed)
- la migración vigente de orders_feed (20260619T1700) para ampliarla con el campo nuevo
(+ un par de pedidos reales de Glovo/Uber/JE con los que probar)

DESPUÉS de este frente (impresión, en orden):
- Capa 2 del renderizador = imágenes (logo de marca + iconos de alérgeno rasterizados a
  bitmap ESC/POS; hoy salen en texto).
- Modelo printer/print_job (cola + config de impresoras).
- Adaptador SUNMI NT311 Cloud Partner (registro en partner.sunmi.com: APP_ID/APP_KEY,
  activar región EU, exponer URL de Folvy, vincular SN; tiene fricción real, sesión
  dedicada, me guías paso a paso).
- Disparadores: imprimir al servir (sobre kds_ticket_station_state) + manual + reimpresión.

SEGURIDAD PENDIENTE (arrastre, no de hoy): rotar service_role + tokens de webhook.

REGLAS NO NEGOCIABLES (resumen):
- Archivos COMPLETOS, nunca diffs. Pide el original ANTES de modificar.
- Una instrucción operativa por turno, marcada 🖥️ (PowerShell) o 🗃️ (SQL Editor).
- Yo ejecuto, tú diseñas. Pide en UN mensaje todos los ficheros de un tramo.
- Marca SIEMPRE las operaciones (COMMIT/ROLLBACK, build, commit/push, verificar push con
  rev-list 0 0).
- RECON contra fuente primaria (BBDD+repo) antes de diseñar, NO contra el CONTEXTO ni
  contra las migraciones (lección dura: dish_family no existía, era recipe_family →
  rompió el feed en producción; verificar el nombre real de tabla/columna contra la BBDD).
- DEUDA 0: benchmark del mejor ANTES de diseñar; no vender empate como victoria.
- Folvy es para TODA la hostelería, no solo dark kitchens.
- Yo decido cuándo cerrar; no me sesgues a parar por duración.

Empieza por el paso 1 del arranque.
