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

**Base — en dos partes** (separadas el 08/10 a las 13:1x, a petición de Julio, para montar la sala hoy):

- **A** `20261008T1315_tpv_sala_s1a_zonas_y_mesas.sql` — `dining_zone`, `dining_table`, `dining_config`,
  `void_reason` y su RLS. **Puede ir en banda**: tablas nuevas, nada vivo las nombra; las claves ajenas van a
  `accounts` y `locations` (cierre SHARE ROW EXCLUSIVE: no bloquea lecturas); medido a las 13:06: 0 funciones
  escriben en `locations`, 0 crons la nombran. No toca `sale` ni `sale_line`.
- **B** `20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql` — todo lo demás. **Fuera de banda**; aborta
  dentro de ella y aborta si falta A.
- Vueltas atrás de las dos en `supabase/vuelta-atras/`. La de A se niega si B sigue aplicada.

Contenido:

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
- Pruebas: `origin/main` 10 fallidas / 2515 bien; rama 10 fallidas / 2520 bien. **Las mismas 10**: son
  pruebas de captura que leen el CSS de `dist/`, y en las dos medidas no había `dist/`. Con el build hecho,
  la rama da **2530 de 2530**. Las 5 nuevas (`tests/unit/pos/parseTableNames.test.ts`) en verde.
- `npm run build` exacto, borrando `*.tsbuildinfo`: **verde**.
- Regla 40: los nombres nuevos entre comillas (`dining_zone`, `dining_table`, `dining_config`, `pos_*`,
  `sale.table_id`/`table_cleared_at`) **no existen hoy en la base**: los crea la migración. Hasta aplicarla,
  la pestaña Sala daría error. Por eso **no se fusiona antes de aplicar**.
- `src/types/database.ts`: tipos escritos a mano con la forma del generador. Se regeneran al aplicar.

## 4. Lo que falta y quién

| Paso | Quién | Cuándo |
|---|---|---|
| Aplicar la parte A | Julio | **ya** (puede ir en banda) |
| Fusionar el front (PR), `npm run build` limpio, Vercel READY. Publica también paquete OTA | Julio | tras A |
| Montar la sala del laboratorio desde oficina | Julio / administrativo | tras READY |
| Pegar la parte B en el ensayo y ejecutarlo (transacción revertida) | Julio | **00:30–12:15** |
| Aplicar la parte B | Julio | misma ventana, tras el ensayo en verde |
| Regenerar `database.ts` y comprobar diferencias con los míos | Code | tras aplicar |
| PR a `main`, `npm run build` limpio, Vercel READY | Code + Julio | tras aplicar |
| Impresora de cocina en el local de laboratorio | Julio | antes de la prueba de los tres tickets |

**Folvy Interno hoy no tiene ni impresoras ni tablets en ninguno de sus 3 locales** (medido). Sin una
impresora y una tablet pareada en el local de prueba no puede salir ningún ticket: la pantalla lo dirá
(«NO ha salido papel»), pero la prueba de los tres tickets de §5 necesita las dos cosas.

## 5. La maqueta (segunda vuelta, 08/10)

Julio subió `Folvy TPV · Sala.html`. Guardada en `claude/maqueta_tpv_sala/` (el HTML tal cual y las seis
pantallas en PNG, sacadas con Chromium sin red). Las pantallas de S1 (1, 2, 3) y la 6 rehechas a ella:

- **Sala:** cabecera de 68 px con local y «día · hora · camarero»; Vender · Sala · Cuentas N sin iconos;
  pestañas de zona de 76 px a tres columnas («6 de 13 ocupadas», la barra «3 cuentas»); rejilla a 5
  columnas que llena el alto; tarjetas de 14 px de radio con borde de 2 px por estado (libre gris, ocupada
  blanco, pide la cuenta ámbar con fondo tintado, cobrada verde con fondo tintado); «Ahora mismo» con el
  total grande y el reparto por zona.
- **Abrir mesa:** pantalla completa (no un diálogo): «Volver a la sala», «Mesa 7 · Sala · 4 sitios ·
  libre», ocho números de 72 px y «Son más de 8».
- **Mesa abierta:** cabecera «← Sala · Mesa 4 · Sala · 4 personas · la lleva Marta» con el tiempo en
  ámbar desde el umbral; la cuenta en un panel de 400 px con filas compactas por envío («Envío 1 · ✓
  Enviado a cocina · 20:05»), «Sin enviar» en azul, total con «por persona», «Enviar a cocina» y «Sacar la
  cuenta» a 76 px y «Cobrar» a 96 px. Tocar una fila sin enviar abre su ficha (cantidad, nota, quitar);
  tocar una enviada, la anulación.
- **Móvil:** dos columnas; cada mesa un hueco.

Capturas lado a lado (maqueta | construido con datos de prueba): `claude/capturas_tpv_sala_s1/`.
Son del componente real con datos inventados, no de producción (la base aún no tiene la migración). En la
del móvil la cabecera es un apaño del banco de pruebas: la cabecera y la barra inferior del móvil son S5.

**Hallazgo de paso:** los tintes con opacidad que ya usaba el TPV (`bg-tpv-warn/15`, `bg-tpv-ok/25`,
`bg-tpv-note/10`, `bg-tpv-danger/10`…) **no se compilan**: Tailwind no aplica opacidad a un color definido
como `var()`, y en `dist/` no hay ni una de esas clases. Esos fondos salen sin pintar desde el 11/08. Para la
Sala van como tokens (`--tpv-*-tint`, `--tpv-*-text`) con los valores exactos de la maqueta; los antiguos
no se tocan aquí.

**Lo que de la maqueta NO se construye en S1** (sin botones que no hacen nada): reservas (panel, «Apuntar
una reserva», «¿Vienen con reserva?»), «Mover o juntar mesas» y «Cambiar de mesa» (S2), «Dividir la
cuenta» y «Caja» (Caja), «Va de primero / segundo / postre» y «Marchar los segundos» (S3), «Más»,
«Buscar», «Conectado» y la barra inferior del móvil (S5).

**Diferencia que decide Julio:** la maqueta dibuja el catálogo de la mesa **sin fotos** (tarjeta con borde
de color, nombre y precio). El encargo dice «la pantalla de venta actual», que lleva fotos desde el 12/08
(decisión tuya: camareros con poca formación reconocen el plato por la foto). He dejado el catálogo como
está. Si la mesa va sin fotos, es un cambio corto.

## 6. Decisiones para Julio

1. Las fotos del catálogo en la mesa (arriba).
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

## 7. Entre A y B (hoy, de la fusión a la noche)

- La pestaña **Sala** del TPV da error («no existe pos_floor»): llega con B. Vender, Mostrador, Para llevar y
  Cuentas no cambian.
- En oficina, «Quitar mesa» mira si la mesa tiene la cuenta abierta con `sale.table_id`, que no existe hasta
  B; el código trata ese error (42703) como «ninguna abierta», que es la verdad mientras no hay B. **No
  verificado contra la API**: desde esta sesión el proxy no deja llegar a Supabase por HTTP.
- La fusión a `main` publica un paquete OTA solo (`build-apk.yml` sube `bundle.json`). Es inocuo sin B: el
  worker solo pide un envío si el trabajo de impresión lo trae, y la cabecera de mesa solo se pinta con mesa.
- El ensayo de B usa zonas y mesas propias («ENSAYO Sala», E1…E10) para no chocar con la sala montada de
  verdad. Probado en local A → B → ensayo: 19 de 19; y la vuelta atrás B → A deja la base como estaba.

## 8. Staging-conta (desde las 13:2x del 08/10) — se trabaja a dos velocidades

Decisión de Julio: desarrollar y ensayar en `staging-conta` (sin banda); la demo, en producción con Folvy
Interno; producción recibe lo ya probado en tandas.

- Aplicado en staging por el conector: la nota de cocina del 08/10 (para igualarla a producción), la parte A
  entera y la B salvo dos piezas. Semilla `supabase/seeds/tpv/seed_tpv_sala_staging.sql`: marca «Casa Lola»
  en Norte Centro, tres productos con escandallo y una impresora.
- **Lo que el conector no puede aplicar** (`delete`/`drop` piden una confirmación que no llega y se agota a
  los 60 s): `supabase/staging/sql/20261008_tpv_sala_s1_lo_que_falta_en_staging.sql` — quitar línea sin
  enviar y `order_for_print` con envío. Lo pega Julio en el editor SQL **de staging**.
- **Primer ensayo con las funciones reales** (no simplificadas), revertido con un error final que lleva los
  resultados: abrir, tres envíos, anular, sacar la cuenta, cobrar, mesa lista, Mostrador, rechazo de
  `upsert_pos_sale`, `pos_open_sales`, `pos_floor`: todo verde. **Consumo real**: −2 cañas, −2 secretos,
  −1 tarta (la anulada descuenta, como quedó decidido), 0 movimientos sin línea. Total 40,00 € (la tarta
  anulada fuera).
- Hallazgo del ensayo, en el ensayo y no en el código: daba por hecha UNA impresora; con dos salen el doble
  de trabajos, que es lo correcto. Ahora cuenta por impresora y copia.
- Pendiente en staging, tras pegar el fichero: `order_for_print` por envío y quitar línea sin enviar
  (`claude/sql/20261008_tpv_sala_s1_ensayo_staging.sql`).
