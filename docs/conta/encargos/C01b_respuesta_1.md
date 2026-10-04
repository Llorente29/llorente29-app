# C01b — Respuesta 1 (tras las comprobaciones previas, PR #143)

Julio, 04/10/2026. Con estas decisiones se sigue de la tarea 2 a la 7 sin parar salvo bloqueo.

1. **Lo de la pantalla vieja que la maqueta no enseña**, cada cosa a su sitio, en el estilo nuevo:
   - **Listado de proveedores**: página propia «Proveedores» (buscador, nombre, tipo de gasto, «Le debes», última factura, píldora ámbar «Ficha incompleta» con lo que falta, filtro «Archivados»). Misma tarjeta y tipografía que la ficha; sin maqueta aparte, con captura en `COMPARACION.md`.
   - **Registro sanitario** → pestaña Datos fiscales, y en el bloque Contabilidad de la ficha como hoy.
   - **«Cómo factura»** (por albarán / mensual / etc.) → pestaña Pago, junto a forma y plazo.
   - **Notas** → tarjeta «Notas» en la columna derecha, debajo de «Con quién hablas».
   - **Archivar** → menú «···» de la cabecera, con «Archivar» y «Recuperar»; los archivados salen solo con el filtro del listado.
   - **Precio pactado / proveedor principal por artículo** → dentro de «Artículos que le compras», como hoy.
2. **`notify_group` se queda en `supplier`**: es la marca de «avisar a la central», no un dato de contacto.
3. **`compliance_docs_due`** manda al contacto de administración y, si no hay, al principal; si no hay ninguno, no manda nada y la ficha lo enseña en «Falta: contacto de administración».
4. **La plantilla también.** `migrate_kitchen_core` pasa a clonar contactos y dirección estructurada en vez de las columnas viejas, con prueba de clonado en staging (cuenta nueva desde la plantilla: mismo resultado antes y después). El movimiento de datos incluye todas las cuentas; nada de Folvy Interno se usa como dato de prueba, solo se migra.
5. **Alta desde albarán**: crea el contacto principal y la dirección «por confirmar»; no escribe en las columnas viejas.
6. **Borrar las pantallas del C01 sin ruta** y reutilizar su núcleo y servicios (validaciones, completitud, `proveedorService`). Lo que no se reutilice, fuera; el PR dice qué se borró.
7. **Menú**: una sola página y una sola ruta; se llega desde donde está hoy (Cocina › Proveedores) y, si existe el menú de Compras/Supply, también desde ahí con el mismo enlace. Sin duplicar.
8. **`usual_vat_rates` entra**: columna nueva de referencias a `tax_rate`; la vieja se elimina en el fichero de eliminación. Añadir al agente «Datos maestros e impuestos» la comprobación de que todo IVA de proveedor apunta a un `tax_rate` vigente.

**Método:** semillas de staging con los casos que faltan (tarea 2). Capturas junto a las maquetas al terminar la tarea 4, ordenador y móvil, incluido el listado. Lo de fuera, al PR como pendiente. Nada en producción.
