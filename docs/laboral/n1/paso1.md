# N1 · PR 2 · Paso 1 — la ficha nueva (Resumen, Contrato y salario, IRPF)

> 02/11/2026. Rama `claude/n1-pr2-ficha`. Datos de ejemplo: inventados.

## Qué hay

- **Sumied › Laboral › Equipo**: pulsar una persona abre su ficha nueva
  (`/conta/laboral/persona/<id>`). En Folvy no cambia nada.
- **Tres pestañas**, fieles a las pantallas 1 a 3 de la maqueta: Resumen, Contrato
  y salario, Impuestos (IRPF). Las otras cinco (Seguridad Social, Tiempo y turnos,
  Vacaciones, Nóminas, Historial) **no salen** hasta que su maqueta esté
  aprobada (N1·5). Mientras, un enlace en la fila de pestañas lleva a la ficha
  de antes: «Seguridad Social, turnos, vacaciones, nóminas e historial: en la
  ficha de antes».
- **Categoría del convenio**: si falta, sale «Falta la categoría» con la lista
  del convenio; al guardar, se apunta desde hoy y queda en el historial. Sin
  categoría, la tarjeta del mínimo dice «No se puede saber si cobra por encima
  del mínimo del convenio» y por qué.
- **IBAN** en «Cómo cobra»: solo quien tiene el permiso de Laboral; se comprueba
  su dígito de control; en el historial queda quién, cuándo y solo las cuatro
  últimas cifras. Es el único sitio del IBAN (`lab_persona.iban`).
- **Permiso de Laboral**: en «Más acciones», «Darle / Quitarle el permiso de
  Laboral» (solo el administrador, y solo a quien entra en su portal).
- **Volcado de Cegid**: elegir el local ya lo confirma; «Pasar a las fichas»
  avisa antes, nombrando cada centro sin local y cuántas personas se quedan
  fuera; un segundo clic pasa el resto. El «Para saber» dice «en Cegid no traía
  centro» en vez del código interno.

## Lo que la ficha dice «Pendiente» o «Falta» (y por qué)

| Dónde | Qué sale | Por qué |
|---|---|---|
| Su contrato | «Su alta en la Seguridad Social: pendiente» / «Aviso del contrato al SEPE: pendiente» | Pendiente · Sumied lo hará cuando conecte con la Seguridad Social (y con el SEPE) |
| Quién es › Estudios | Falta | El «Bachillerato» de Cegid era su valor por defecto; no hay tabla oficial del SEPE todavía |
| Ocupación | Falta: Cegid no la trae | El CNO no viene en el fichero |
| IRPF › Cómo se ha calculado | Pendiente | Sumied lo calculará cuando haga las nóminas; el tipo es el de la última nómina de Cegid |
| Sus datos para el IRPF (modelo 145) | Falta | Nadie ha rellenado el 145 en Sumied |
| Este mes | Se ve en la ficha de antes | Tiempo y turnos espera su maqueta |

Lo que la maqueta enseñaba y no está, porque no hay dato: el aviso del NIE que
caduca, el importe del trienio, «Se recalcula solo cuando…» y «¿Ha pedido un
tipo más alto?» (si el 145 trae un tipo voluntario, sale en su tarjeta).

## Palabras: antes → después

| Antes | Después |
|---|---|
| Clave 100 | **100 · Indefinido a jornada completa** (el código delante, siempre) |
| Clave 200 | **200 · Indefinido a tiempo parcial** |
| Grupo de cotización 4 | **Grupo 4 · Ayudantes sin título** |
| Grupo de cotización 7 | **Grupo 7 · Auxiliares de oficina** |
| Situación familiar 1 / 2 / 3 | **1 · Sin pareja, con hijos que viven solo con usted** · **2 · Casado/a, y su pareja no gana más de 1.500 € al año** · **3 · Cualquier otra situación** |
| Alta en la TGSS | **Su alta en la Seguridad Social** |
| Contrat@ comunicado | **Aviso del contrato al SEPE** (Contrat@ en pequeño) |
| Modelo 145 | **Sus datos para el IRPF (familia, hijos…)** (modelo 145 en pequeño) |
| CNO | **Ocupación** (CNO en pequeño y gris) |
| Llega en N4 | **Pendiente · Sumied lo hará cuando conecte con la Seguridad Social** |

## Catálogos: oficial → cómo sale

Solo lo que sale en las pantallas 1 a 3; todo lo demás sale con su texto
oficial tal cual.

| Catálogo · código | Oficial | Cómo sale |
|---|---|---|
| contrato 100 | INDEFINIDO TIEMPO COMPLETO – ORDINARIO | 100 · Indefinido a jornada completa |
| contrato 200 | INDEFINIDO TIEMPO PARCIAL – ORDINARIO | 200 · Indefinido a tiempo parcial |
| grupo 1 | Ingenieros y Licenciados. Personal de alta dirección… | Grupo 1 · Titulados universitarios y alta dirección |
| grupo 2 | Ingenieros Técnicos, Peritos y Ayudantes titulados | Grupo 2 · Titulados técnicos |
| grupo 3 | Jefes administrativos y de taller | Grupo 3 · Jefes de oficina o de taller |
| grupo 4 | Ayudantes no titulados | Grupo 4 · Ayudantes sin título |
| grupo 5 | Oficiales administrativos | Grupo 5 · Oficiales de oficina |
| grupo 6 | Subalternos | Grupo 6 · Subalternos (conserjes, ordenanzas…) |
| grupo 7 | Auxiliares administrativos | Grupo 7 · Auxiliares de oficina |
| grupo 8 | Oficiales de Primera y Segunda | Grupo 8 · Oficiales de primera y de segunda |
| grupo 9 | Oficiales de Tercera y Especialistas | Grupo 9 · Oficiales de tercera y especialistas |
| grupo 10 | Peones | Grupo 10 · Peones |
| grupo 11 | Trabajadores menores de 18 años | Grupo 11 · Menores de 18 años |
| país 170 / 724 / 862 | COLOMBIA / ESPAÑA / VENEZUELA | Colombia / España / Venezuela (sin código) |
| IRPF situación 1 | Soltero/a, viudo/a, divorciado/a o separado/a legalmente con hijos… que conviven exclusivamente con Vd. | 1 · Sin pareja, con hijos que viven solo con usted **(cambiado por Julio, 02/11)** |
| IRPF situación 2 | Casado/a y no separado/a legalmente cuyo cónyuge no obtiene rentas superiores a 1.500 euros… | 2 · Casado/a, y su pareja no gana más de 1.500 € al año |
| IRPF situación 3 | Situación familiar distinta de las dos anteriores… | 3 · Cualquier otra situación |
| IRPF discapacidad 33 / 65 / AYUDA | Grado de minusvalía… | Del 33 % al 65 % / Del 65 % o más / Necesita ayuda de otra persona o tiene movilidad reducida |

Fuentes, con enlace y versión, en `lab_catalogo_fuente` (Sistema RED T-12,
T-18, T-19, T-55, T-61, T-72, T-90; AEAT modelo 145).
