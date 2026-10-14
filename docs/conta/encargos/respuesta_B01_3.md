# B01 — Respuesta 3 (tareas 2–4 revisadas · sigue con la 5)

> Copia de trabajo de la respuesta de Julio (13/10/2026), íntegra.

Muy buen trabajo. La demostración, el freno del IBAN respetado y la medida sobre los apuntes reales son lo que había que ver. Sigue con la tarea 5 (pantallas) y para antes de la 6 con capturas.

## 1. Corrección mía: tarjetas (sustituye el punto 1 de la Respuesta 2)

Dije que Foodint no tenía tarjeta. Era falso: lo supuse a partir de la maqueta. Foodint tiene varias tarjetas de empresa, todas de débito (Julio, 13/10/2026).

* Dónde salen sus pagos: en el Norma 43 de su cuenta. No hay extracto aparte ni cuenta 572 propia.
* Qué hace el motor:
   * reconoce qué tarjeta pagó, por los últimos dígitos que trae el concepto;
   * si la tarjeta está dada de alta, sabe quién la lleva. Así el porqué y el «pídele el ticket a…» van a la persona correcta.
* Alta de tarjetas: como medio de pago de su cuenta bancaria, con los últimos 4 dígitos, el titular y el local. Se hace en «Cuentas y extractos». Nunca se guarda el número entero.
* Tarjetas de crédito por Excel/CSV: lo ya hecho se queda en la base para otras empresas. No tiene pantalla mientras ninguna lo use.
* Pruebas:
   * dos tarjetas de débito inventadas en la misma cuenta, cada pago atribuido a su titular;
   * una tarjeta no dada de alta → «Por aclarar: tarjeta acabada en 1234, ¿de quién es?».

## 2. Contraste: añade Sage y da el veredicto

* Añade Sage (Sage 50 y Sage 200: importación Norma 43 y su conciliación) a Diez, Holded, Pennylane, Puzzle, ContaSOL y a3innuva.
* Tabla en el informe final: una fila por pieza, con lo que tiene cada uno, lo que tenemos nosotros y «por encima / igual / por debajo», sin adornos.
* Lo que hoy está por debajo se dice: la conexión directa con el banco. Holded, a3innuva y Sage la tienen; nosotros subimos el Norma 43, por decisión de no pagar todavía un agregador.
   * Propón cómo dejar la subida en un solo gesto: arrastrar el fichero sobre cualquier pantalla de Bancos, que el fichero sirva para varias cuentas a la vez y que se recuerde a qué cuenta va cada IBAN.
   * Propón también el envío del extracto por correo, aunque se enseñe cuando exista el buzón (E01).
   * Deja el conector preparado para enchufar un agregador sin tocar el motor. Eso ya está en el encargo.
* El 74,9 %: solo se compara con lo que publique cada uno. Si nadie publica cifra, no decimos que les superamos en eso.
* El 22,1 % sin resolver: en el informe, sus cinco grupos mayores (por tipo de concepto, solo recuentos) y cuánto bajaría con las tarjetas dadas de alta y las reglas propuestas.

## 3. Lo que has dejado para coordinar

1. Serie 3 → serie de tesorería: hazlo tú. Que «Pago a…» y el cobro de liquidación propongan en la serie de tesorería de la empresa (en Foodint, la 4), como ya decidimos en la P3.
   * Es un cambio pequeño en un fichero compartido: dilo en el informe.
   * Prueba: las ventas (serie 1) y los 50 asientos propuestos de octubre en producción no cambian.
2. `fuentes.json`: cambio pequeño, tuyo, y dilo en el informe.
   * La descarga solo baja las fuentes nuevas o tocadas en ese push.
   * Si una fuente ya registrada ha cambiado en origen (como los códigos postales), no se sobrescribe en la rama: se avisa en el informe nocturno y se decide aparte.
   * Así nadie vuelve a tener que devolverla a mano.
3. Pruebas de cierre a las 6:00: son de A (el cierre a las 2:00 lo decidió Julio). Se lo pido a A. No las toques.
4. Facturas E2E-001 sobrantes y e2e que se pisan: lo arregla C con usuarios de prueba propios por frente y semillas que limpian lo suyo antes de empezar (PR pequeño a `main`). Hasta que esté fusionado, no lances tu e2e si hay otra en marcha. Cuando esté, trae `main`.
5. `tsconfig.node.json` y P2 en `propuestasLibroService.ts` / `asientosPropuestos.ts`: aceptados.

## 4. Tarea 5 · Pantallas (diseño, sección obligatoria)

* N17, fiel a la maqueta. Si algo no se puede, para y dilo antes de cambiarlo.
* Las cinco sin maqueta, en el mismo estilo, sin esperar maqueta:
   * Reglas;
   * Cuentas y extractos, con las tarjetas de cada cuenta;
   * Cierre del mes;
   * «Subir extracto», el gesto único del punto 2;
   * «Lo que ha hecho Folvy».
* Móvil con el patrón de M4.
* Lenguaje de administrativo y no de contable: movimientos, facturas y tarjetas. Las cuentas van siempre como nombre · código.
* Lo que no funciona no se enseña: nada de «Por correo» en la barra, y nada de tarjetas de crédito sin una empresa que las use.
* Para antes de la 6 con capturas de ordenador y de móvil de la cuenta de A en staging, comparadas con la maqueta.
