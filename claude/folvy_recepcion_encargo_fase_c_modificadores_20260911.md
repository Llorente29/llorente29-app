# Recepción del encargo de la fase C (las pantallas de Modificadores)

**11/09/2026 (Madrid, reloj de la base).** Recibido y archivado. **No se empieza.**

El propio encargo lo dice en su cabecera: *«Estado: preparado. Se entrega a Code
cuando la fase B esté cerrada y verificada… Hasta entonces no se toca: una cosa
cada vez.»* Esta nota existe para que quede constancia de que llegó, de dónde
está en la cola, y de dos cosas ya medidas que quien lo construya necesita saber
antes de escribir la primera línea.

El encargo íntegro **vive fuera del repositorio**, igual que su hermano
`ENCARGO_CODE_modificadores_ninguna_venta_sin_descontar_20260911.md` y que la
lista maestra de reglas. No se copia aquí: una segunda copia de un documento que
no es mío es una segunda verdad esperando a divergir.

## Dónde está en la cola, hoy

Por delante, y en este orden:

1. **Un incidente abierto**: por qué mi escritor de A4a devolvió cero sin dar
   excepción en el pedido de las 14:26:24
   (`claude/folvy_incidente_aplicacion_en_banda_20260911.md`). Reproducirlo en
   transacción deshecha es lo primero.
2. **Fase A sin cerrar**: A2c y A4a ensayados y sin aplicar (van a partir de las
   23:45, reloj de la base), más A4 (qué regenerar y el coste), A5 (el vigía
   diario) y A6 (ensayo por caminos y las cifras antes/después).
3. **Los 516 duplicados**, autorizados por Julio pero después de la fase A.
4. **Fase B entera**: que el extra exista una sola vez, que «qué lleva» cuelgue
   del extra y que «sustituye» viva en la pregunta puesta en un plato.
5. **Entonces**, y sólo entonces, esta fase C.

## Dos cosas medidas que el encargo necesita saber

### 1 · Tablero 7 · «enseñar a Folvy el código» no es lo mismo en HubRise que en Last

El encargo dice: *«Confirmar "es este" enseña a Folvy el código. Se guarda la
relación código → extra, `resolver_opcion_de_extra` la consulta»*. Medido hoy
sobre el cuerpo vivo de las dos piezas:

- **En Last**, el código que trae el pedido es **de Last** (`organizationModifierId`),
  y desde A1 se guarda en `modifier_option.pos_modifier_id`. Aprenderlo es
  escribir esa columna. Hay sitio. *(A2c lo hace ya, de hecho: rescata el código
  de los propios pedidos antes de retirar una opción.)*
- **En HubRise NO hay tal columna, y el código no es suyo: es nuestro.**
  `_modifier_option_ref(option_id)` devuelve `mo.external_id` si existe y, si no,
  `'mo_' || mo.id` para las marcas cuyo catálogo publica Folvy. O sea que la
  referencia con la que casa un pedido de HubRise es **lo que nosotros
  publicamos**, no algo que HubRise asigne.

**Consecuencia:** para una línea de HubRise que llegó con una referencia que
Folvy no conoce, «guardar la relación código → extra» no tiene hoy dónde
escribirse. O se añade una columna (o tabla) de referencias aprendidas por
origen, o para HubRise el arreglo es otro (republicar el catálogo para que la
referencia vuelva a ser la nuestra). **No está decidido, y hay que decidirlo
antes de construir el tablero 7**, que es donde vive el botón «Enlazar».

### 2 · Tablero 7 · «Ya no está en Last» sí tiene su campo, y coincide

`deactivated_by = 'last'` existe a partir de A2c, con exactamente esos dos
valores (`'last'` y `'persona'`) más NULL para lo que se apagó antes de que el
campo existiera. El encargo y la migración dicen lo mismo. Nada que reconciliar.

## Lo que el §0 pedirá medir, y que NO se ha medido

Queda dicho para que nadie lo dé por hecho: **no se ha mirado todavía** qué
dispara `hubrise-catalog-publish`, qué publica de preguntas y opciones, ni
cuánto tarda (§0.1). Es la primera tarea del encargo cuando se entregue, y de su
respuesta depende si la pantalla necesita el aviso «Pendiente de publicar en
Glovo, Uber y la web» (regla 35).
