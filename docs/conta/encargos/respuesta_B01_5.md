# B01 — Respuesta 5 (tarea 6 revisada · prepara la 7)

Muy bien. Hiciste tú los retoques, cazaste tu propio fallo en la semilla y has dejado la comprobación de importes cortados para siempre. Prepara la tarea 7 sin lanzar nada.

## 1. Tu pregunta: pasada diaria sin nadie delante

Ahora no. Mientras los movimientos solo entran subiendo un extracto, el agente ya pasa en cada subida y la pasada diaria no aporta nada.

- Se hará con el contrato del agregador, cuando los movimientos entren solos. Irá con una función del servidor con su propia identidad y con autorización de Julio, porque es un cambio de seguridad.
- Mientras tanto, el agente nocturno no avisa en ámbar si un día no hubo pasada pero tampoco movimientos nuevos. Solo avisa si hay movimientos sin pasar.

## 2. La semilla

- Las aperturas de los bancos B01 son asientos reales: en la semilla van validadas, no propuestas, aunque hayas arreglado la fecha.
- En las cuentas compartidas (A y B) no se dejan propuestas sueltas ni nada que cambie lo que ven las pruebas de otros frentes.

## 3. Tarea 7 · Informe final y tanda (no la lances)

- Informe final:
  - capturas de ordenador y móvil lado a lado, comparadas con N17;
  - el contraste con su tabla «por encima / igual / por debajo»;
  - las cifras de lo aprendido (74,9 % · 22,1 % → 13,3 %).
- Tanda para producción:
  - qué va: las migraciones 0100 a 0160, la semilla de Foodint (serie 4, corte 01/10 y sus tres cuentas) y el front;
  - en este orden: base y luego front;
  - con la salida del analizador (paso 8) contra el contexto de producción medido, solo leyendo.
- Antes de la tanda, mide en producción y solo leyendo:
  - las tres cuentas bancarias de Foodint (57200001/2/3) y su saldo en el libro a 30/09;
  - que el IBAN de cada una está en su ficha.

  Así el primer extracto real cuadra o dice por qué no.
- Los 50 asientos de octubre: la huella `577331bd…` sigue igual antes y después.
- Qué queda apagado en producción:
  - el agregador;
  - «Conectar»;
  - «Por correo»;
  - la barra de la IA si solo dice «Muy pronto».
- Agente nocturno: «Plan contable» y «Datos maestros» salen en rojo por semillas de otros frentes. Di en el informe qué semilla y qué comprobación son, para que yo se lo pase a quien toque. No las toques.

Para con el informe y la tanda listos. El orden de las tres tandas lo digo yo, y Julio lanza el ensayo.
