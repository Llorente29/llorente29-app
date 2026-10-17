# Encargo W02 — Pruebas y lanzamientos sin esperas

Rama: conta/w02-sin-esperas, desde main. Abre el PR en borrador desde el primer commit.
Qué toca: solo .github/workflows/**, los scripts de prueba y e2e (antes-de-subir.sh, la configuración de Playwright, las semillas de staging), el analizador y sus pruebas, y docs/conta/staging.md. Nada de la app ni de pantallas.
Cómo se trabaja: una cosa cada vez. Lo que surja fuera de esto va al PR como pendiente.
Primera copia en el repo: guarda este encargo en el repositorio como claude/encargo_W02_pruebas_sin_esperas.md en tu rama.

## 1. Para qué

Hoy cada tanda pierde una hora o más en esperas que no aportan nada. Medido el 16/10 con la T2 de B:
- La e2e entera dura unos 33 minutos. Si hay que repetirla, se repite entera.
- Las cuatro sesiones (A, B, C, D) comparten un solo staging con un candado. Cuando una pasa su e2e, las otras esperan 30–40 minutos.
- La sesión que entrega una tanda se queda parada. Julio lanza desde la cabeza de la rama, así que la sesión no puede empujar nada hasta que se aplique el real: si empujara, cambiaría el commit que se lanza y habría que repetir la e2e.
- Julio rellena a mano cuatro campos dos veces (ensayo y real) y manda capturas para que se revisen.

Que el ensayo en producción tarde menos de un minuto (#106: 43 s) demuestra que lo que tarda es el trabajo alrededor, no la tanda.

Objetivo: que una tanda lista llegue a producción en minutos, sin perder ninguna de las protecciones de hoy.

## 2. Lo que NO cambia (reglas de siempre)

- En producción solo escribe lo que Julio aprueba. Ninguna sesión de Code lanza un real.
- Ensayo y real salen del mismo commit. El real exige un ensayo en verde de ese commit.
- Las guardas de URL de producción y de Foodint siguen igual, con sus pruebas.
- Se mantienen: el analizador por lo que hace cada fichero, autorizo para los ficheros que destruyen o mueven datos, lock_timeout, *.down.sql probados en staging, la vuelta atrás automática si falla la comprobación de después, y que lo ya aplicado no se reaplica.
- Nunca se aplica entre el minuto :05 y el :10 de cada hora. Si toca en ese hueco, el workflow espera solo hasta el :11.
- Nada real en el repositorio, en staging ni en los logs.
- Los cambios en aplicar-produccion-conta.yml llegan a main en un PR de pocos ficheros que fusiona Julio.

## 3. Paso 1 · Un staging que no se espera (lo primero; es lo que más tiempo quita)

a) Medir antes de tocar. Explica qué es exactamente el candado:
- qué recurso protege: la base de staging, las semillas o los usuarios de prueba;
- por qué hace falta;
- cuánto esperó cada e2e y cuánto duró, en las últimas ejecuciones de A, B, C y D;
- qué parte de los 33 minutos es preparación (migrar y sembrar) y qué parte son pruebas.

b) Propón y recomienda una opción, con tiempos medidos y coste en euros al mes. Opciones a comparar:
1. Un staging propio por frente, por ejemplo ramas de Supabase creadas desde las migraciones y las semillas, que se duermen o borran solas cuando no se usan.
2. Mismo staging, sin candado global: cada frente con su propia cuenta y sus usuarios de prueba (ya hay usuarios por frente), y migraciones que solo añaden. El candado queda solo para el rato corto en que se aplican migraciones.
3. E2e partida en trozos que corren a la vez (shards de Playwright), sumable a 1 o 2. La e2e entera sigue existiendo y es la que vale para dar valores a Julio, pero se reparte en varios trozos en paralelo.

Si una opción cuesta dinero, para y pregunta a Julio con la cifra. No se contrata nada sin su sí.

c) Construye la opción elegida y demuestra que funciona: dos e2e de frentes distintos a la vez, sin esperarse y sin pisarse los datos.

Además: si una e2e falla en una prueba, debe poder repetirse solo lo que falló para diagnosticar. Pero los valores para producción salen siempre de una e2e entera en verde.

## 4. Paso 2 · Lanzar por commit, no por rama

- Campo nuevo "commit" en aplicar-produccion-conta.yml, con el SHA completo o corto. El workflow:
  - hace checkout de ese commit exacto;
  - comprueba que pertenece a la rama elegida;
  - escribe el commit en el resumen.
- Compatibilidad: si el campo va vacío, se comporta como hoy (cabeza de la rama), para que las tandas en curso no se rompan.
- El real exige un ensayo en verde del mismo SHA, no de la misma rama.
- Desde que esto esté en main, la sesión puede seguir empujando a su rama mientras Julio lanza: el commit lanzado queda fijado.

## 5. Paso 3 · Ensayo automático, real con un clic

- Ensayo automático. Cuando la e2e entera de un commit sale en verde y la sesión ha marcado ese commit como tanda, el ensayo contra producción se lanza solo. «Marcar» puede ser una etiqueta en el PR o un fichero tanda.json con la lista de ficheros y lo que declaran que cambia.
  - El ensayo lo lanza GitHub, no la sesión. Sigue siendo una transacción con ROLLBACK.
  - Si el analizador para algo, el ensayo para y lo dice, igual que hoy.
- Real con aprobación. Si el ensayo sale en verde, el real queda esperando la aprobación de Julio en un entorno de GitHub "produccion" con revisor obligatorio. Julio recibe el aviso de GitHub, abre la ejecución, lee el resumen y pulsa Approve.
  - Los valores (rama, commit, produccion, ficheros autorizados) los pone el workflow desde el ensayo. Nadie los copia.
  - Los ficheros que necesitan autorizo salen en el resumen con su nombre, en una línea propia, antes del botón. Aprobar es autorizarlos.
- Configuración que hace Julio. El entorno produccion y su revisor se crean en Settings del repositorio, y eso lo hace Julio. Deja en el PR una guía de seis líneas, click a click.
- Una tanda cada vez, como hoy. Si hay un real esperando aprobación, el siguiente ensayo espera. El orden lo decide Julio aprobando: no hay carrera entre frentes.
- Lanzamiento manual de siempre: sigue funcionando igual, como plan B.

## 6. Diseño (sección obligatoria)

Julio lee el resumen de la ejecución en el móvil antes de aprobar, así que lo importante tiene que ir arriba, en una pantalla y en palabras de oficina:
1. Primera línea: «Ensayo en verde · se van a aplicar N ficheros · cambian X filas de Y». Si es rojo: «No se puede aplicar: <motivo en una frase>».
2. Qué cambia, solo las medidas que se mueven, en una tabla corta de antes / después. Las que quedan igual se resumen en «las otras 10 medidas, iguales».
3. Qué autorizas al aprobar, fichero a fichero, en una línea cada uno.
4. Vuelta atrás: «probada, deja todo como estaba» o el motivo si no.
5. Debajo, plegado, el detalle técnico de hoy: filas de serie, huellas y avisos de Node.

Entrega capturas del resumen en ordenador y en 390 px: una en verde, una en rojo y una con autorizo.

## 7. Pruebas

- Commit:
  - SHA que no pertenece a la rama → para;
  - real con ensayo verde de otro SHA → para;
  - campo vacío → igual que hoy.
- Ensayo automático:
  - solo con e2e entera en verde y tanda marcada;
  - con e2e parcial no se lanza.
- Aprobación:
  - sin aprobación no se aplica;
  - aprobación entre :05 y :10 → espera al :11.
- Una cada vez: con un real esperando aprobación, un segundo ensayo queda en cola.
- Guardas: las de URL y Foodint siguen y tienen su prueba.
- Staging: dos e2e de frentes distintos a la vez, sin esperarse y con los datos de cada uno intactos.

## 8. Entrega, por pasos

1. Medición y propuesta del paso 1, con tiempos y coste. Para aquí: Julio elige.
2. Paso 1 construido y demostrado. Es un PR propio.
3. Pasos 2 y 3 juntos, en un PR de pocos ficheros a main, con la guía para Julio y las capturas del resumen. Lo fusiona Julio.

Coordinación:
- Avisa antes de fusionar. Claude avisa a A, B, C y D de cómo se trabaja desde entonces: lanzar por commit, marcar la tanda y no quedarse parados.
- Mientras haya un real de otra sesión a medias, no se fusiona nada que cambie el workflow de producción.

Ahora: solo 1a y 1b. Entrega la propuesta y para.
