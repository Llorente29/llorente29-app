# B01 — Respuesta 4 (tarea 5 revisada · sigue con la 6)

> Copia de trabajo de la respuesta de Julio (13/10/2026), íntegra.

Muy buen trabajo. La pantalla de Movimientos se entiende a la primera: cada fila dice qué cree Folvy y por qué, y tiene un solo botón principal. Bien cazados el «Casado» que no se veía y la tarjeta sin preguntar. Sigue con la tarea 6 después de los retoques de abajo. Para antes de la 7.

## 1. Barra con muchos bancos: una sola fila (decisión de Julio)

* Todo en una fila, con nombres cortos de banco (alias de la cuenta, editable en «Cuentas y extractos»).
* A partir de cinco bancos, los que no caben van a «y N más», que abre la lista.
* El banco con más dudas va siempre a la vista.
* En Libros no se toca nada.

## 2. Retoques vistos en la captura de Movimientos

1. La barra de la IA tapa una fila. En la captura, la del pago con tarjeta de 10/10 queda debajo y no se lee.
   * Nada flotante puede tapar contenido: la tabla deja hueco al final, o la barra se aparta.
   * Además, si la barra solo contesta «Muy pronto», no se enseña en Bancos (regla del módulo: lo que no funciona no se enseña), igual que ya hace C con la marca.
2. «Conectar · pronto» no se enseña. Aparece cuando exista el agregador (tarea 6, punto 3), no antes.
3. Botones con el mismo peso para el mismo papel:
   * en ámbar, el principal (azul) es «Sí» y el secundario «Otra cosa»;
   * en gris, el principal es «Decirlo yo»;
   * en verde, «Ver» y «Deshacer» van en secundario.
   Hoy «Sí» sale en blanco y «Decirlo yo» en azul, y eso confunde.
4. La ruta de arriba: «Bancos › Banco B01 · Norte · ES-- ···· 0011» lleva caracteres raros. Debe decir «Bancos › Banco B01 · Norte · ···0011».
5. El saldo que «difiere» en staging: añade el asiento de apertura a la semilla B01. Así la demostración enseña un saldo que cuadra, y el «difiere» sale solo cuando de verdad difiera, con su porqué.
6. Móvil: en el informe de la 6 pon la captura de Movimientos en el móvil al lado de la de ordenador. Quiero verla.

## 3. Las reglas propuestas

Aceptado bajar lo que se queda sin propuesta del 22,1 % al 13,3 % aunque los errores pasen del 3,0 % al 4,6 %, con dos condiciones:

* lo que sale de una regla aprendida es siempre probable, nunca seguro, hasta que la persona confirme la regla;
* una regla que acumula dos correcciones se apaga sola y lo dice en «Lo que ha hecho Folvy».

## 4. Tarea 6

1. Agente «Conciliación»:
   * corre después de cada extracto subido y una vez al día;
   * deja su resumen en la banda verde («He casado yo…») y en «Lo que ha hecho Folvy»;
   * nunca valida nada fuera de lo que ya permite el encargo.
2. Cierre del mes del banco:
   * el saldo del banco y el de contabilidad, y la lista de lo que explica la diferencia;
   * no se cierra con movimientos sin casar, salvo que la persona lo marque a sabiendas y quede registrado.
3. Interfaz del agregador con proveedor simulado:
   * preparada para Enable Banking, que cobra por cuenta conectada (Julio está pidiendo presupuesto);
   * el movimiento que entra por el agregador y el mismo por Norma 43 se reconocen como el mismo, por huella;
   * el consentimiento caduca a los 180 días: avisa 7 días antes y dice cómo renovarlo con un clic.
   Nada de esto se enseña en pantalla hasta que exista el contrato.
4. E2e: sigue sin lanzar nada con otra en marcha. Cuando C fusione los usuarios por frente, trae `main`.

Para antes de la 7 con capturas de ordenador y móvil del cierre del mes, de la banda del agente y de los retoques del punto 2.
