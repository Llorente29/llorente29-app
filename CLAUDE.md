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
