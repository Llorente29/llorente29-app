# Parte · TPV Sala · S1 (mesas, comensales, envíos a cocina) · 08/10/2026

Rama: `claude/affectionate-albattani-6lv2af`. **Nada aplicado en producción. Nada fusionado a `main`.**

## 0. Paso 0 — hecho en la rama

`tpv/nota-de-cocina-llega-a-cocina` fusionada en la rama de trabajo (commit de fusión). Llega a `main`
con el PR de S1. Retira la `20260816T1101`.

## 1. La sección 1 del encargo, medida (12:11–12:40 Madrid, solo lectura)

| # | Afirmación | Medido | ¿Cuadra? |
|---|---|---|---|
| 1 | Una cuenta llega a cocina una vez | `tg_auto_print_on_accept` dispara al pasar a `accepted` (INSERT o cambio), con deduplicado por `sale_id+doc_type+printer` y `payload {mode:'by_order'}` | Sí |
| 2 | Las líneas no tienen identidad | `_adapt_folvy_pos_order` hace `delete from sale_line where sale_id=… and map_source<>'manual'` y reinserta. FK: `kds_line_state` CASCADE, `stock_movement.sale_line_id` SET NULL | Sí |
| 3 | `service_type` no admite comer en local | CHECK: `platform_delivery, own_delivery, pickup`. «Mostrador» = `tpv-mostrador`, `dine_in` | Sí |
| 4 | Precio por `_shop_reprice_line` | Lee `menu_item.price` + modificadores + combo + BOGO | Sí |
| 5 | No hay zonas/mesas/envíos | Ninguna tabla de ese nombre (solo `delivery_zone` y `course*` de formación) | Sí |
| 6 | `printWorker` solo pide el pedido entero | `order_for_print(p_device_token, p_sale_id)` | Sí |
| 7 | `kds_board` saca la venta al darla por lista | No medido a fondo: S1 no toca `kds_board` | — |

Dos cosas que **no estaban en la sección 1** y cambian el diseño:

- **La cocina puede cerrar la venta antes de cobrar.** `trg_sale_close_on_complete` llama a `close_sale`
  cuando `order_status` pasa a `completed` → `status='closed'`. Por eso «Cobrada» se lee de `paid_at`, nunca
  de `status`.
- **`pos_open_sales` y «Recuperar» habrían destrozado una mesa.** Recuperar una cuenta del TPV la vuelve a
  guardar con `upsert_pos_sale`, que borra y reinserta. Ahora `pos_open_sales` no lista mesas y
  `upsert_pos_sale` rechaza una cuenta con mesa.

## 2. Lo construido

**Base** — `supabase/migrations/20261009T0040_tpv_sala_s1_mesas_comensales_envios.sql`
(vuelta atrás: `supabase/vuelta-atras/20261009T0040_…down.sql`). Lleva una guarda que **aborta dentro de la banda**.

- Tablas: `dining_zone`, `dining_table`, `dining_config` (umbral ámbar), `sale_fire`, `void_reason`,
  `sale_line_void`. RLS: leer, la cuenta; escribir configuración, admin/encargado; envíos y anulaciones,
  solo las funciones.
- `sale`: `table_id, covers, served_by, served_by_name, bill_requested_at, table_cleared_at`;
  CHECK `service_type` + `dine_in`; CHECK «mesa ⇒ comensales»; índice único «una cuenta viva por mesa».
- `sale_line`: `fire_id` (NULL = sin enviar), `voided_at`.
- Funciones: `pos_floor`, `pos_table_open`, `pos_table_detail`, `pos_table_add_lines`,
  `pos_table_set_pending_qty`, `pos_table_remove_pending_line`, `pos_table_fire`, `pos_table_void_line`,
  `pos_void_reasons`, `pos_table_request_bill`, `pos_table_charge`, `pos_table_clear`.
- Sustitución quirúrgica sobre lo VIVO (guarda «aparece exactamente 1 vez»):
  `tg_auto_print_on_accept` (una mesa no imprime el pedido entero), `upsert_pos_sale` (rechaza mesas),
  `pos_open_sales` (no lista mesas), `order_for_print` **+ `p_fire_id`, DROP + CREATE**, permisos restaurados
  y comprobados dentro de la misma migración (aborta si no están anon, authenticated y service_role).
- `_shop_reprice_line` y `_adapt_folvy_pos_order` **no se tocan**. La inserción de una línea es una copia
  de su bucle (`_pos_insert_order_line`), sin borrar nada antes.

**Front**
- `/tpv`: cabecera **Vender · Sala · Cuentas**. Sala = pestañas por zona con ocupación, rejilla de mesas
  (número, comensales, estado con color+icono+palabra, tiempo en ámbar desde el umbral, importe) y
  «Ahora mismo» (comensales por zona). Abrir mesa = «¿Cuántos son?» 1–8 / «Son más de 8», sin confirmar.
  Mesa abierta = la pantalla de venta con la cuenta de la mesa en el panel derecho: líneas por envío con su
  hora, «Sin enviar», **Enviar a cocina**, **Sacar la cuenta**, **Cobrar** (aislado), **Mesa lista**.
  Tocar una línea enviada abre la anulación (motivo obligatorio). Cada botón confirma o falla en pantalla
  con contenido, y **si no hay impresora lo dice** («NO ha salido papel»).
- Oficina: «Sala y mesas (TPV)» en Configuración → Locales → el local, debajo de Impresoras. Mesas de golpe
  con «1-6», «T1-T4» o lista; orden con flechas; ensanchar a 2 huecos; umbral ámbar.
- Ticket de cocina (imagen y texto): con mesa, la cabecera es **MESA N** grande, **ZONA · N COMENSALES**,
  banda **ENVÍO N · hh:mm**. `printWorker.ts` pasa `p_fire_id` solo si el trabajo lo trae. **Paquete OTA.**
- La venta rápida (Mostrador / Para llevar) no cambia: sus ventas no tienen `table_id`.

## 3. Cómo se ha comprobado (y cómo no)

- **En producción: solo lectura.** Los seis fragmentos que se sustituyen aparecen **1/1/1/1/1/1** en las
  definiciones vivas de hoy. Nadie más llama a `order_for_print` en SQL (0 dependencias en `pg_proc`).
- **NO se ha ensayado contra producción**: aplica `ALTER TABLE` sobre `sale` y reescribe
  `order_for_print` → banda. El ensayo está escrito: `claude/sql/20261009_tpv_sala_s1_ensayo.sql`.
- **En un Postgres 16 local** con el esqueleto de las tablas que tocan las funciones (columnas copiadas de
  producción) y copias de las funciones vivas: migración aplicada, el ensayo entero **ejecutado**:
  **19 de 19 en verde** (abrir 4 con 4; tres envíos y tres tickets de cocina; `order_for_print(envío)`
  devuelve 1 línea por envío con mesa 4, Sala, 4 comensales y su número; sin envío, la cuenta entera; ids
  intactos; quitar sin enviar; anular enviada a 0 € con motivo y «ANULADO» encolado; cuenta; cobro; mesa
  lista → libre y `completed`; consumo con `sale_line_id` no nulo; Mostrador imprime como siempre;
  `upsert_pos_sale` rechaza la mesa; `pos_open_sales` no la lista). La vuelta atrás, probada también ahí:
  devuelve `order_for_print` a dos parámetros y quita los tres añadidos.
  **Límite de esa prueba:** `_shop_reprice_line` y `generate_sale_consumption` eran simplificaciones; el
  consumo real solo lo prueba el ensayo de esta noche.
- Lint, la misma vara a los dos lados: `origin/main` **1375 (1075 errores / 300 avisos)**, rama **1375 (1075 / 300)**.
- Pruebas: `origin/main` 10 fallidas / 2515 bien; rama 10 fallidas / 2520 bien. **Las mismas 10** (capturas
  de pantalla que necesitan navegador); las 5 nuevas (`tests/unit/pos/parseTableNames.test.ts`) en verde.
- `npm run build` exacto, borrando `*.tsbuildinfo`: **verde**.
- Regla 40: los nombres nuevos entre comillas (`dining_zone`, `dining_table`, `dining_config`, `pos_*`,
  `sale.table_id`/`table_cleared_at`) **no existen hoy en la base**: los crea la migración. Hasta aplicarla,
  la pestaña Sala daría error. Por eso **no se fusiona antes de aplicar**.
- `src/types/database.ts`: tipos escritos a mano con la forma del generador. Se regeneran al aplicar.

## 4. Lo que falta y quién

| Paso | Quién | Cuándo |
|---|---|---|
| Pegar la migración en el ensayo y ejecutarlo (transacción revertida) | Julio | **00:30–12:15** |
| Aplicar la migración (sale ya la guarda de banda) | Julio | misma ventana, tras el ensayo en verde |
| Regenerar `database.ts` y comprobar diferencias con los míos | Code | tras aplicar |
| PR a `main`, `npm run build` limpio, Vercel READY | Code + Julio | tras aplicar |
| Paquete OTA (printWorker + ticket) por el procedimiento de `PENDIENTE_UNICO_las_tablets_20260921.md` | Julio | tras READY |
| Montar Sala (6) y Terraza (4) en Folvy Interno desde oficina | Julio / administrativo | tras READY |
| Impresora de cocina en el local de laboratorio | Julio | antes de la prueba de los tres tickets |

**Folvy Interno hoy no tiene ni impresoras ni tablets en ninguno de sus 3 locales** (medido). Sin una
impresora y una tablet pareada en el local de prueba no puede salir ningún ticket: la pantalla lo dirá
(«NO ha salido papel»), pero la prueba de los tres tickets de §5 necesita las dos cosas.

## 5. Bloqueado / decisiones para Julio

1. **La maqueta no está en el repositorio ni en Drive.** `claude/maqueta_tpv_sala/`,
   `folvy_tpv_sistema_diseno_20260811.md`, `folvy_tpv_benchmark_y_plan_demo_20261008.md`,
   `folvy_tpv_decisiones_arquitectura_20260811.md` y `PENDIENTE_UNICO_las_tablets_20260921.md`: ninguno
   existe en git (ni en ninguna rama) ni en la carpeta de Drive que refleja `claude/`. **Lo construido sigue
   el texto del encargo y los tokens de `tpvTokens.css`, NO la maqueta.** Hace falta subirla para ajustarlo y
   hacer las capturas «al lado».
2. **Anular no devuelve el stock.** El plato puede estar hecho. Si se quiere devolver, es tocar
   `generate_sale_consumption` y va con su propio ensayo (regla 10).
3. **«Sacar la cuenta» imprime el documento de bolsa** (`doc_type='bag'`), el mismo que el ticket de
   mostrador. Para la demo vale; una cuenta de mesa propia es su propio cambio.
4. **Una tablet con el paquete viejo** imprime la cuenta ENTERA en cada envío (ignora `fire_id`): imprime de
   más, nunca deja de imprimir. Se corrige con el paquete. El «ANULADO» va ya compuesto y lo imprime
   cualquier paquete.
5. **La pantalla de cocina** enseña la cuenta, no separa rondas (S6). Lo anulado sigue apareciendo en ella.
6. **Canal propio «Sala»** (`tpv-sala`, `dine_in`), hermano de «Mostrador», creado la primera vez que se abre
   una mesa en cada cuenta. Las ventas de mesa no se mezclan con las de mostrador en los informes por canal.
