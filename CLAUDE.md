# Instrucciones de arranque

REGLA CERO: antes de responder cualquier pregunta técnica, lee SIEMPRE CONTEXTO_CLAUDE.md (estado actual, decisiones, roadmap y deudas del proyecto Folvy).

Reglas de trabajo del CEO (Julio):
- Archivos completos, no diffs.
- Pedir el fichero original antes de modificarlo.
- No tocar App.tsx ni AppContext.tsx sin permiso explícito.
- La BBDD es la verdad: verificar vía information_schema antes de decisiones de schema.
- SQL transaccional y revisable ANTES de ejecutar. Claude Code propone, Julio ejecuta y verifica.
- Marcar siempre cada acción operativa (commit, build, push, deploy).
- TypeScript strict, camelCase cliente / snake_case BBDD.

## Reglas ganadas en producción

Cada una costó un incidente real. La fecha es el día que se pagó.

1. **Ninguna corrección vive solo en el desplegado.** Si se toca una edge function, se commitea antes o inmediatamente después. Un deploy sin commit es una corrección con fecha de caducidad: el siguiente despliegue desde el repositorio la borra sin avisar.
   *(27/08, con dos muertos encima: el 13/08 un deploy de `hubrise-webhook` se llevó por delante la captura de `collection_code` — 14 días y 148 pedidos sin el código que ve el cliente — y `resolveHubriseToken` por conexión — el 404 del push. Ninguna de las dos estaba en git. Vigía: `edge-drift-watchdog`, diario.)*

2. **Añadir un parámetro a una función es DROP + CREATE, nunca CREATE OR REPLACE.** Replace no reemplaza: crea una SOBRECARGA, y a partir de ahí las llamadas con la firma vieja son ambiguas.
   *(27/08. Al añadir `p_debounce_window` a `_queue_system_alert` quedaron dos firmas; las llamadas de 4 argumentos empezaron a dar `ERROR 42725 … is not unique` y los SIETE vigías se quedaron sin poder encolar durante minutos. Se detectó porque se probó inmediatamente después de aplicar.)*

3. **`computed_cost = 0` tapa el `fixed_cost` real**, porque el motor usa `COALESCE(computed_cost, fixed_cost, 0)` y cero no es NULL. Al rellenar un coste fijo, poner el computed a NULL.
   *(26/08. Test de regresión T12.)*

4. **`sale.sold_at` está en UTC.** Cualquier análisis de horario de servicio convierte a `Europe/Madrid` ANTES de concluir nada.
   *(26/08. Un "corte a las 21:39" se reportó como dos horas de cena perdidas; eran las 23:39 de Madrid, o sea los últimos 20 minutos del servicio. Dos horas de diagnóstico equivocado.)*

5. **Verificar con la query, no con la afirmación.** Pegar el resultado, no el resumen.
   *(Recurrente. El caso caro: se probó si los combos consumían mirando `stock_movement.source_id = sale_line.id`, pero en ventas `source_id` es la VENTA, no la línea — 45.614 de 46.591. La evidencia no medía lo que se creía.)*

6. **Reprocesar consumo siempre con corte en el último conteo aprobado**, salvo autorización explícita y reanclaje posterior.
   *(25/08. Tres botones vivos reprocesaban a escala 11x por debajo de conteos ya cerrados.)*

7. **Un umbral ordena, no esconde.** Una pantalla que el usuario abre a propósito NUNCA oculta filas; un aviso que le interrumpe SÍ filtra. El umbral decide el **orden** y la **etiqueta**, nunca la **existencia**.
   *Detector automático:* si para ser honesta una pantalla necesita una nota al pie del tipo «y además hay N que no te enseño», el filtro está en el sitio equivocado. Esa nota no es transparencia: es la confesión de que el diseño sabe que está escondiendo algo.
   *Dónde SÍ va un umbral:* en lo que interrumpe a alguien — push, `system_alert`, correo, el badge rojo del menú. Ahí filtrar es respeto por la atención del otro. Un contador puede contar solo lo prioritario, pero no puede decir «0, sin alertas» en verde habiendo filas.
   *(29/08. Stock negativo de Alcalá decía «sin alertas» y resumía «+9 por debajo del umbral (ruido, no listados aquí)» mientras Pedidos enseñaba Coca-Cola Original Lata a −10 ud. El umbral no fallaba —Coca-Cola quedaba fuera por 2,7 latas— fallaba usarlo para decidir la existencia de la fila. Lo caro no es el dato oculto: es que el operario aprende que "sin alertas" no significa "no hay nada", y deja de creerse también las pantallas que dicen la verdad.)*

8. **Un botón que hace algo importante confirma o falla en pantalla.** Callar no es una opción: el silencio se lee como fallo, siembra dobles clics y esconde los errores de verdad.
   *Detector automático:* si al pulsar hay que ir a mirar la base de datos para saber si funcionó, el botón está incompleto. Y la confirmación lleva **contenido**, no un visto: «Publicado. Avisadas 4 personas» dice algo; «Hecho» no.
   *Es la misma familia que la regla 7, un piso más abajo:* la 7 prohíbe esconder filas que existen; la 8 prohíbe esconder que algo ha pasado.
   *(30/08. Julio publicó el cuadrante del 31/08 a las 15:04:35 y la pantalla no dio «ninguna señal de ok, bien, mal o lo que sea». En BBDD todo correcto: status published, celdas intactas y los 4 avisos creados. Éxito silencioso. La misma semana habían aparecido los otros dos de la familia: `kds_heartbeat` con token huérfano devolviendo HTTP 200 —tres días de tablet invisible— y el autocierre degradando sus fallos a `raise warning`, que pg_cron cuenta como éxito: 185 «succeeded» con cero movimientos de stock.)*

9. **Toda consulta o guarda que ancle por NOMBRE filtra primero por `account_id`.** Las tablas son multi-cuenta y el catálogo plantilla del sistema (`Folvy Interno`, `00000000-0000-0000-0000-000000000001`) comparte tablas Y NOMBRES con producción. Un `count(*)` sin `account_id` no da un número equivocado: da un número **que no es de nadie**. Con el cliente 2 dentro, esto se multiplica.
   *Detector automático:* si una cifra va a ir a un encargo, a una migración o a una pantalla, y sale de `recipe_item`, `supplier`, `sale`, `goods_receipt_line` o cualquier tabla con `account_id` — la consulta lleva `account_id`, o la cifra lleva escrito de qué cuentas es. Anclar por nombre sin cuenta es coger la ficha de otro.
   *Excepción, y hay que decirla:* los catálogos GLOBALES sin `account_id` (`vat_category`, `vat_rate`, `family_vat_default`, `connector`) se leen enteros a propósito. Y una huella de «esto no se ha movido» puede ser de tabla entera —es más fuerte así—, pero entonces se etiqueta como tal.
   *(31/08. Mordió CINCO veces el mismo día. «273 de 1.072 artículos con categoría fiscal (25 %)» eran en realidad 188 de 352 en Foodint (53 %): el resto era el catálogo plantilla, y el error no solo daba mal el número, INVERTÍA la conclusión — dije que la mayoría preguntaba y la mayoría resuelve. Luego: «481 direcciones con Spain» eran 475. «921 líneas de albarán» son 834 de Foodint + 87 de la plantilla. «32 de 32 direcciones repetidas de Just Eat» eran 25 de Foodint + 7 de Kitchen Grill LstQ. Y el caro: una migración anclaba AMIRSA por nombre y encontraba DOS, una de Foodint y otra de la plantilla — su guarda anti-homónimos habría abortado la migración entera en la ventana de las 01:30. Dentro de Foodint no hay ni un nombre de proveedor repetido: el duplicado nunca existió, existía la consulta sin cuenta.)*
