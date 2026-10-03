# C00 · Respuesta 1 de Julio (02/10/2026), tras las comprobaciones previas

Copia fiel de las decisiones, para que vivan junto al encargo. Manda sobre lo
que diga `C00_comprobaciones_previas.md` donde choquen.

## Decisiones

- **D1 · Impuestos.** Tabla de impuestos nueva como única fuente del porcentaje;
  las categorías de Cocina (`vat_category`, `family_vat_default`) apuntan a
  ella. `vat_rate` no se amplía ni se borra en este encargo: queda leyendo de la
  tabla nueva por una vista o puente, y en el PR se apunta cómo se retira
  después. Nada de dos listas.
- **D2 · Datos de la cuenta.** El alta propone lo que `accounts` ya tiene
  (razón social, CIF, dirección), marcado como importado, con su origen y con
  confirmación. Nada se da por bueno en silencio. Si la persona lo cambia,
  `accounts` no se toca: la empresa es la fuente nueva. Cómo se reconcilia con
  `accounts` va como pendiente.
- **D3 · Razón social por NIF.** No hay fuente gratuita: la persona escribe el
  nombre y la IA hace el resto. En vez de «He buscado tu NIF: sois…», la IA
  pide el NIF, lo valida y pregunta «¿Cómo se llama la empresa?» (con lo de
  `accounts` propuesto si existe). El proveedor de pago, pendiente sin hacer.
- **D4 · Asesor.** Fuera del alta en este encargo: sin la burbuja del asesor ni
  «Julián, tu asesor, lo está viendo». Vuelve con «Personas y asesor».
- **D5 · «Los que usas».** Se enseñan todas las filas, con las que usas arriba
  y una separación visible («Los que usas» / «Los demás»), sin aviso al pie.
  El filtro de píldoras puede quedarse para acotar, pero nunca abre filtrado.
- **D6 · Plazos 30/60/90.** Solo se definen en la tabla. El reparto en varios
  vencimientos por factura llega con pagos y cobros (pendiente).
- **D7 · Red.** Los agentes nocturnos y la carga de valores oficiales descargan
  desde GitHub Actions; el fichero de referencia (valor, fuente, fecha, huella)
  vive en el repositorio y la carga a staging sale de ahí por el workflow de
  siempre. Julio abre `boe.es`, `sede.agenciatributaria.gob.es`, `ine.es` y
  `datos.canarias.es` en la red del entorno; si al llegar a la tarea 4 no
  están, se tira de GitHub Actions y se dice.

## El ticket al 10 %

No es un error: en reparto de comida el IVA es el 10 %. Queda como
**comprobación** en la sección «Norma» del PR: qué dice la Ley 37/1992
(artículo 91) sobre hostelería y reparto, y si hay excepciones (por ejemplo,
bebidas alcohólicas), con su cita. El ticket no se toca; lo decide Julio.

**Regla general:** antes de llamar «error» a algo del negocio, se confirma con
la norma y se le dice a Julio como pregunta.

## Más

- `folvy-ai`: no se arregla en el C00. Se construye la base nueva del módulo
  (6.1–6.3) y lo de `folvy-ai` queda como pendiente, con sus dos fallos
  localizados.
- Alta de envases: pendiente, sin confirmar.

## Fuera de Folvy

Todo lo de contabilidad tiene que poder venderse solo, a un cliente sin
Cocina, albaranes ni pedidos:

- Las tablas, la empresa y el alta no dependen de ninguna tabla ni función de
  Cocina. Lo que se necesite de `accounts` se lee por un contrato mínimo y
  documentado.
- La relación con `vat_category`/`family_vat_default` va en un solo sentido:
  Cocina lee de contabilidad, nunca al revés.
- Antes de cerrar cada tarea, se comprueba en la cuenta B de staging (sin
  interruptor `conta` ni módulos de cocina) que las pantallas cargan y
  funcionan solas.

## Método

Una cosa cada vez. Capturas de cada pantalla junto a su maqueta al terminar
las tareas 4, 5 y 6. Lo que salga fuera del encargo, al PR como pendiente.
