# API DiezREC (facturación de Cegid) · documentación

Copia de la documentación oficial que facilitó Julio el 25/11/2026 (última actualización del proveedor: 06/11/2026). Sin claves; el token de los ejemplos, como «{token}».

```
API DiezREC
Introducción a la API · Última actualización: 06/11/2026
Descripción general
DiezREC proporciona una API mediante un servicio web de tipo REST/JSON que permite a aplicaciones de terceros acceder a los datos de facturación de la asesoría: clientes, conceptos de facturación, series, facturas e incidencias.

Permite consultar los clientes, las series y las facturas emitidas, y consultar, añadir, modificar y borrar los conceptos de facturación y las incidencias de cada cliente.

El acceso está disponible tanto para el usuario principal como para los usuarios secundarios.
URL base
Todas las rutas de esta documentación son relativas a la URL base del servicio:

https://apirec.diezsoftware.com
Primeros pasos
Solicitar a Diez Software el clientId y el clientSecret de la aplicación integradora.
Obtener un token llamando a WS Login con esas claves y el usuario y contraseña del usuario.
Incluir el token en la cabecera Authorization de cada llamada: Authorization: Bearer {token}.
Consultar los servicios de datos, por ejemplo Consultar clientes.
Autenticación
Para consumir los servicios de la API es necesario identificar dos entidades:

Entidad	Descripción
APLICACIÓN INTEGRADORA	Aplicación que integra la API en su software. Se identifica con el clientId y el clientSecret que Diez Software proporciona para esta API.
USUARIO	Usuario de Diez Software (principal o secundario) cuyos datos se van a consultar. Se identifica con su userName y password, que facilita el propio cliente o su asesoría. Debe tener contratado DiezREC o el ERP de Diez Software.
Obtención y uso del token
Con los cuatro datos anteriores se llama a WS Login, que devuelve un token de acceso (auth_token). Ese token debe enviarse en todas las demás llamadas, en la cabecera Authorization precedido de la palabra Bearer:

Authorization: Bearer {token}
El token tiene una validez de 2 horas (el campo expires_in de la respuesta indica los segundos). Una vez caducado, las llamadas devuelven 401 Unauthorized y es necesario volver a llamar a WS Login.

El usuario principal puede indicar en el campo empresa de WS Login la empresa a la que quiere acceder. Los usuarios secundarios acceden a la empresa que tienen asignada.

El clientSecret y la contraseña del usuario son datos confidenciales. No deben incluirse en aplicaciones cliente públicas (webs o apps móviles); las llamadas a la API deben hacerse desde el servidor de la aplicación integradora.
Filtrado y paginación
Los servicios que devuelven listados (por ejemplo Consultar clientes) admiten parámetros de consulta con sintaxis OData para filtrar, seleccionar campos, ordenar y paginar los resultados:

Parámetro	Descripción	Ejemplo
$filter	Filtra los resultados. Los campos BOOLEAN se filtran con true o false.	$filter=codigoPostal eq 46001
$select	Campos que se devuelven, separados por comas. Si se omite, se devuelven todos.	$select=codigo,nombreComercial,nif
$orderby	Ordena los resultados. Admite asc y desc.	$orderby=nombreComercial desc
$top	Número de elementos por página. Máximo y valor por defecto: 200.	$top=50
$skip	Número de página que se quiere obtener, empezando en 0. No es el número de registros a saltar.	$skip=2
Para recorrer un listado por páginas, indique siempre $orderby, de forma que todas las páginas se obtengan con el mismo orden.
Respuesta paginada
Los servicios de listado devuelven siempre la misma estructura, con los registros dentro de datos:

Campo	Tipo	Puede ser null	Descripción
resultadosTotales	INT	No	Número de resultados totales para la consulta.
paginaActual	INT	No	Página solicitada: el valor recibido en $skip, o 1 si no se envía o es 0.
elementosPorPagina	INT	No	Número de elementos por página ($top). Si todos los resultados caben en una página, devuelve el máximo (200).
elementosEnPagina	INT	No	Número de elementos incluidos en esta página.
datos	ARRAY	No	Registros de la página. Su estructura depende del servicio.
La respuesta no indica el número de páginas: se calcula a partir de resultadosTotales y del $top enviado. Si la página solicitada en $skip no existe, se devuelven registros del principio del listado.
Tipos de datos
A continuación se definen los tipos de datos utilizados en la API:

Tipo	Descripción
INT	Número entero.
DECIMAL	Número con decimales (separador .).
STRING	Cadena de texto.
BOOLEAN	Valor lógico: true o false.
FECHA	Fecha. Su formato se indica en la descripción de cada campo.
ARRAY	Lista de elementos del mismo tipo.
OBJETO	Estructura JSON con sus propios campos.
En esta API, las fechas se devuelven como número entero (tipo INT).

En las tablas de respuesta, la columna Puede ser null indica qué campos pueden devolverse sin valor.

Códigos HTTP
Los servicios devuelven los siguientes códigos HTTP:

Código HTTP	Descripción
200 - OK	La petición se ha procesado correctamente.
204 - No Content	El registro solicitado no existe, o no se ha podido guardar. La respuesta no tiene cuerpo.
400 - Bad Request	La petición no es válida: faltan datos obligatorios, algún dato tiene un formato incorrecto o las credenciales no son correctas. El cuerpo incluye el detalle del error.
401 - Unauthorized	No se ha enviado el token, no es válido o ha caducado. La respuesta no tiene cuerpo.
404 - Not Found	El servicio solicitado no existe, o un parámetro de la ruta no tiene el formato esperado (por ejemplo, un código de cliente que no es numérico).
5XX - Server Errors	Error interno del servidor o de alguno de los servicios que utiliza la API. Si se repite, contacte con Diez Software.
Formato de los errores de validación
Los errores de identificación se devuelven con código 400 y el siguiente formato:

{
  "error de acceso": [ "Usuario desconocido." ]
}
Junto a error de acceso puede aparecer la clave Error con más detalle, por ejemplo "Error 7 - No tiene contratado el programa."

Si faltan campos obligatorios o algún campo tiene un formato incorrecto, el error se devuelve con este otro formato:

{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "traceId": "00-...",
  "errors": {
    "UserName": [ "The UserName field is required." ]
  }
}
El resto de errores 400 (por ejemplo, al consultar un listado o al actualizar un registro que no existe) se devuelven como un texto con el mensaje de error, por ejemplo Debe indicar un código de concepto existente.

WS Autenticación
Login
POST
/api/Auth/login
Sin token
Descripción
Identifica a la aplicación integradora y al usuario, y devuelve el token de acceso necesario para el resto de servicios.

Parámetros de entrada
Cuerpo de la petición en formato JSON (Content-Type: application/json):

Campo	Tipo	Obligatorio	Descripción
userName	STRING	Sí	Usuario de Diez Software (principal o secundario).
password	STRING	Sí	Contraseña del usuario.
clientId	STRING	Sí	Identificador de la aplicación integradora, proporcionado por Diez Software.
clientSecret	STRING	Sí	Clave secreta de la aplicación integradora, proporcionada por Diez Software.
empresa	STRING	No	Código numérico de la empresa o nombre de la base de datos a la que se desea acceder. Solo se tiene en cuenta para el usuario principal.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
id	STRING	No	Identificador del cliente de Diez Software al que pertenece el usuario.
auth_token	STRING	No	Token de acceso que se debe enviar en la cabecera Authorization.
expires_in	INT	No	Segundos de validez del token (7200 = 2 horas).
Códigos HTTP
Código HTTP	Descripción
200	Identificación correcta. Devuelve el token.
400	Faltan datos, algún dato tiene un formato incorrecto, el clientId / clientSecret no son válidos (Aplicación desconocida) o el usuario y contraseña no son correctos o no tienen acceso a la API (Usuario desconocido).
500	Error interno al validar las credenciales.
Ejemplos
Petición
curl -X POST "https://apirec.diezsoftware.com/api/Auth/login" \
  -H "Content-Type: application/json" \
  -d '{"userName":"USUARIO","password":"CONTRASEÑA","clientId":"CLIENT_ID","clientSecret":"CLIENT_SECRET"}'
Respuesta
{
  "id": "1234",
  "auth_token": "{token}",
  "expires_in": 7200
}
WS Clientes
Consultar clientes
GET
/api/Customers
Requiere token
Descripción
Devuelve el listado de clientes.

Parámetros de entrada
Parámetros en la URL (query string):

Campo	Tipo	Obligatorio	Descripción
$filter	STRING	No	Filtro con sintaxis OData. Ver Filtrado y paginación.
$select	STRING	No	Campos a devolver, separados por comas.
$orderby	STRING	No	Ordenación con sintaxis OData.
$top	INT	No	Elementos por página (máximo 200).
$skip	INT	No	Número de página, empezando en 0.
Respuesta del servicio
Devuelve una respuesta paginada. Cada elemento de datos tiene los siguientes campos:

Campo	Tipo	Puede ser null	Descripción
codigo	INT	No	Código del cliente.
nombreComercial	STRING	Sí	Nombre comercial.
nombreFisCal	STRING	Sí	Nombre fiscal o razón social.
direccion	STRING	Sí	Dirección.
codigoPostal	INT	No	Código postal.
pob	STRING	Sí	Población.
pro	STRING	Sí	Provincia.
nif	STRING	Sí	NIF.
telefonos	STRING	Sí	Teléfonos.
email	STRING	Sí	Email.
fechaInicio	INT	No	Fecha de inicio, como número entero.
Códigos HTTP
Código HTTP	Descripción
200	Consulta correcta. Devuelve una respuesta paginada.
400	Los parámetros de consulta no son válidos o se ha producido un error al obtener los datos. El cuerpo contiene el mensaje de error.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Customers?$filter=codigoPostal eq 46001&$orderby=nombreComercial" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "resultadosTotales": 1,
  "paginaActual": 1,
  "elementosPorPagina": 200,
  "elementosEnPagina": 1,
  "datos": [
    {
      "codigo": 1,
      "nombreComercial": "EMPRESA EJEMPLO",
      "nombreFisCal": "EMPRESA EJEMPLO S.L.",
      "direccion": "CL MAYOR 1",
      "codigoPostal": 46001,
      "pob": "VALENCIA",
      "pro": "VALENCIA",
      "nif": "B00000000",
      "telefonos": "900000000",
      "email": "usuario@ejemplo.com",
      "fechaInicio": 0
    }
  ]
}
Consultar cliente
GET
/api/Customers/GetCustomer/{codigo}
Requiere token
Descripción
Devuelve los datos de un cliente a partir de su código, incluidos los conceptos de facturación que tiene asignados.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
codigo	INT	Sí	Código del cliente.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
codigo	INT	No	Código del cliente.
nombreComercial	STRING	Sí	Nombre comercial.
nombreFisCal	STRING	Sí	Nombre fiscal o razón social.
direccion	STRING	Sí	Dirección.
codigoPostal	INT	No	Código postal.
pob	STRING	Sí	Población.
pro	STRING	Sí	Provincia.
nif	STRING	Sí	NIF.
telefonos	STRING	Sí	Teléfonos.
email	STRING	Sí	Email.
fechaInicio	INT	No	Fecha de inicio, como número entero.
detalleConceptos	ARRAY	Sí	Conceptos de facturación asignados al cliente. Ver Detalle de concepto.
Detalle de concepto

Campo	Tipo	Puede ser null	Descripción
codigoConcepto	STRING	Sí	Código del concepto de facturación.
importe	DECIMAL	Sí	Importe.
cantidad	DECIMAL	Sí	Cantidad.
totalLinea	DECIMAL	Sí	Total de la línea.
descripcionExtensa	STRING	Sí	Descripción extensa.
descripcion	STRING	Sí	Descripción.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve el cliente.
204	No existe ningún registro con esos datos. La respuesta no tiene cuerpo.
401	Token no enviado, no válido o caducado.
404	codigo no es un número entero.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Customers/GetCustomer/{codigo}" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "codigo": 1,
  "nombreComercial": "EMPRESA EJEMPLO",
  "nombreFisCal": "EMPRESA EJEMPLO S.L.",
  "direccion": "CL MAYOR 1",
  "codigoPostal": 46001,
  "pob": "VALENCIA",
  "pro": "VALENCIA",
  "nif": "B00000000",
  "telefonos": "900000000",
  "email": "usuario@ejemplo.com",
  "fechaInicio": 0,
  "detalleConceptos": [
    {
      "codigoConcepto": "HON01",
      "importe": 100,
      "cantidad": 1,
      "totalLinea": 100,
      "descripcionExtensa": null,
      "descripcion": "HONORARIOS MENSUALES"
    }
  ]
}
WS Conceptos
Consultar conceptos
GET
/api/Concepts
Requiere token
Descripción
Devuelve el listado de conceptos de facturación.

Parámetros de entrada
Parámetros en la URL (query string):

Campo	Tipo	Obligatorio	Descripción
$filter	STRING	No	Filtro con sintaxis OData. Ver Filtrado y paginación.
$select	STRING	No	Campos a devolver, separados por comas.
$orderby	STRING	No	Ordenación con sintaxis OData.
$top	INT	No	Elementos por página (máximo 200).
$skip	INT	No	Número de página, empezando en 0.
Respuesta del servicio
Devuelve una respuesta paginada. Cada elemento de datos tiene los siguientes campos:

Campo	Tipo	Puede ser null	Descripción
codigo	STRING	Sí	Código del concepto (máximo 5 caracteres).
importe	DECIMAL	Sí	Importe.
descripcion	STRING	Sí	Descripción.
area	INT	Sí	Área: 1 = Fiscal, 2 = Contable, 3 = Facturación, 4 = Laboral, 5 = Tareas internas, 6 = Común.
extraordinario	BOOLEAN	Sí	Indica si es un concepto extraordinario.
Códigos HTTP
Código HTTP	Descripción
200	Consulta correcta. Devuelve una respuesta paginada.
400	Los parámetros de consulta no son válidos o se ha producido un error al obtener los datos. El cuerpo contiene el mensaje de error.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Concepts?$orderby=descripcion&$top=50" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "resultadosTotales": 1,
  "paginaActual": 1,
  "elementosPorPagina": 200,
  "elementosEnPagina": 1,
  "datos": [
    {
      "codigo": "HON01",
      "importe": 100,
      "descripcion": "HONORARIOS MENSUALES",
      "area": 3,
      "extraordinario": false
    }
  ]
}
Consultar concepto
GET
/api/Concepts/GetConcept/{codigo}
Requiere token
Descripción
Devuelve todos los datos de un concepto de facturación a partir de su código.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
codigo	STRING	Sí	Código del concepto.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
codigo	STRING	Sí	Código del concepto (máximo 5 caracteres).
importe	DECIMAL	Sí	Importe.
descripcion	STRING	Sí	Descripción.
area	INT	Sí	Área: 1 = Fiscal, 2 = Contable, 3 = Facturación, 4 = Laboral, 5 = Tareas internas, 6 = Común.
extraordinario	BOOLEAN	Sí	Indica si es un concepto extraordinario.
porIva	DECIMAL	Sí	Porcentaje de IVA.
gastoSuplido	STRING	Sí	Indica si es un gasto suplido (* = sí).
conRetencion	STRING	Sí	Indica si lleva retención (* = sí).
ivaIncluido	STRING	Sí	Indica si el importe incluye el IVA (* = sí).
descripcionExtensa	STRING	Sí	Descripción extensa. Si está guardada en formato RTF, se devuelve como texto sin formato.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve el concepto.
204	No existe ningún registro con esos datos. La respuesta no tiene cuerpo.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Concepts/GetConcept/{codigo}" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "codigo": "HON01",
  "importe": 100,
  "descripcion": "HONORARIOS MENSUALES",
  "area": 3,
  "extraordinario": false,
  "porIva": 21,
  "gastoSuplido": null,
  "conRetencion": "*",
  "ivaIncluido": null,
  "descripcionExtensa": "Honorarios de asesoría mensual."
}
Añadir concepto
POST
/api/Concepts/concept
Requiere token
Descripción
Añade un concepto de facturación y devuelve sus datos.

Si ya existe un concepto con el mismo codigo, se actualiza en lugar de añadirse, igual que en Actualizar concepto.

Parámetros de entrada
Cuerpo de la petición en formato JSON (Content-Type: application/json):

Campo	Tipo	Obligatorio	Descripción
codigo	STRING	No	Código del concepto (máximo 5 caracteres).
importe	DECIMAL	No	Importe.
descripcion	STRING	No	Descripción.
area	INT	No	Área: 1 = Fiscal, 2 = Contable, 3 = Facturación, 4 = Laboral, 5 = Tareas internas, 6 = Común.
extraordinario	BOOLEAN	No	Indica si es un concepto extraordinario.
porIva	DECIMAL	No	Porcentaje de IVA.
gastoSuplido	STRING	No	Indica si es un gasto suplido (* = sí).
conRetencion	STRING	No	Indica si lleva retención (* = sí).
ivaIncluido	STRING	No	Indica si el importe incluye el IVA (* = sí).
descripcionExtensa	STRING	No	Descripción extensa. Si está guardada en formato RTF, se devuelve como texto sin formato.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
codigo	STRING	Sí	Código del concepto (máximo 5 caracteres).
importe	DECIMAL	Sí	Importe.
descripcion	STRING	Sí	Descripción.
area	INT	Sí	Área: 1 = Fiscal, 2 = Contable, 3 = Facturación, 4 = Laboral, 5 = Tareas internas, 6 = Común.
extraordinario	BOOLEAN	Sí	Indica si es un concepto extraordinario.
porIva	DECIMAL	Sí	Porcentaje de IVA.
gastoSuplido	STRING	Sí	Indica si es un gasto suplido (* = sí).
conRetencion	STRING	Sí	Indica si lleva retención (* = sí).
ivaIncluido	STRING	Sí	Indica si el importe incluye el IVA (* = sí).
descripcionExtensa	STRING	Sí	Descripción extensa. Si está guardada en formato RTF, se devuelve como texto sin formato.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve los datos del concepto guardado.
204	No se ha podido guardar el registro. La respuesta no tiene cuerpo.
400	El cuerpo no es válido. El cuerpo de la respuesta contiene el detalle.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X POST "https://apirec.diezsoftware.com/api/Concepts/concept" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"HON01","importe":100,"descripcion":"HONORARIOS MENSUALES","area":3,"extraordinario":false,"porIva":21,"gastoSuplido":null,"conRetencion":"*","ivaIncluido":null,"descripcionExtensa":"Honorarios de asesoría mensual."}'
Respuesta
{
  "codigo": "HON01",
  "importe": 100,
  "descripcion": "HONORARIOS MENSUALES",
  "area": 3,
  "extraordinario": false,
  "porIva": 21,
  "gastoSuplido": null,
  "conRetencion": "*",
  "ivaIncluido": null,
  "descripcionExtensa": "Honorarios de asesoría mensual."
}
Actualizar concepto
PUT
/api/Concepts/concept
Requiere token
Descripción
Actualiza un concepto de facturación existente, identificado por su codigo, y devuelve sus datos actualizados.

Se actualizan importe, porIva, gastoSuplido, conRetencion, ivaIncluido, descripcion y descripcionExtensa. area y extraordinario no se modifican.

Parámetros de entrada
Cuerpo de la petición en formato JSON (Content-Type: application/json):

Campo	Tipo	Obligatorio	Descripción
codigo	STRING	No	Código del concepto (máximo 5 caracteres).
importe	DECIMAL	No	Importe.
descripcion	STRING	No	Descripción.
area	INT	No	Área: 1 = Fiscal, 2 = Contable, 3 = Facturación, 4 = Laboral, 5 = Tareas internas, 6 = Común.
extraordinario	BOOLEAN	No	Indica si es un concepto extraordinario.
porIva	DECIMAL	No	Porcentaje de IVA.
gastoSuplido	STRING	No	Indica si es un gasto suplido (* = sí).
conRetencion	STRING	No	Indica si lleva retención (* = sí).
ivaIncluido	STRING	No	Indica si el importe incluye el IVA (* = sí).
descripcionExtensa	STRING	No	Descripción extensa. Si está guardada en formato RTF, se devuelve como texto sin formato.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
codigo	STRING	Sí	Código del concepto (máximo 5 caracteres).
importe	DECIMAL	Sí	Importe.
descripcion	STRING	Sí	Descripción.
area	INT	Sí	Área: 1 = Fiscal, 2 = Contable, 3 = Facturación, 4 = Laboral, 5 = Tareas internas, 6 = Común.
extraordinario	BOOLEAN	Sí	Indica si es un concepto extraordinario.
porIva	DECIMAL	Sí	Porcentaje de IVA.
gastoSuplido	STRING	Sí	Indica si es un gasto suplido (* = sí).
conRetencion	STRING	Sí	Indica si lleva retención (* = sí).
ivaIncluido	STRING	Sí	Indica si el importe incluye el IVA (* = sí).
descripcionExtensa	STRING	Sí	Descripción extensa. Si está guardada en formato RTF, se devuelve como texto sin formato.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve los datos actualizados del concepto.
204	No se ha podido guardar el registro. La respuesta no tiene cuerpo.
400	No se ha indicado el codigo, no existe ningún concepto con ese código o el cuerpo no es válido. El cuerpo de la respuesta contiene el detalle.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X PUT "https://apirec.diezsoftware.com/api/Concepts/concept" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"HON01","importe":100,"descripcion":"HONORARIOS MENSUALES","area":3,"extraordinario":false,"porIva":21,"gastoSuplido":null,"conRetencion":"*","ivaIncluido":null,"descripcionExtensa":"Honorarios de asesoría mensual."}'
Respuesta
{
  "codigo": "HON01",
  "importe": 100,
  "descripcion": "HONORARIOS MENSUALES",
  "area": 3,
  "extraordinario": false,
  "porIva": 21,
  "gastoSuplido": null,
  "conRetencion": "*",
  "ivaIncluido": null,
  "descripcionExtensa": "Honorarios de asesoría mensual."
}
Borrar concepto
DELETE
/api/Concepts/delete/{codigo}
Requiere token
Descripción
Borra un concepto de facturación a partir de su código.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
codigo	STRING	Sí	Código del concepto.
Respuesta del servicio
Valor lógico (BOOLEAN) con el resultado de la operación.

Códigos HTTP
Código HTTP	Descripción
200	Devuelve el resultado de la operación: false si no se ha podido borrar.
401	Token no enviado, no válido o caducado.
500	No existe ningún concepto con ese código.
Ejemplos
Petición
curl -X DELETE "https://apirec.diezsoftware.com/api/Concepts/delete/{codigo}" \
  -H "Authorization: Bearer {token}"
Respuesta
true
WS Series
Consultar series
GET
/api/Sets
Requiere token
Descripción
Devuelve el listado de series de facturación.

Parámetros de entrada
Parámetros en la URL (query string):

Campo	Tipo	Obligatorio	Descripción
$filter	STRING	No	Filtro con sintaxis OData. Ver Filtrado y paginación.
$select	STRING	No	Campos a devolver, separados por comas.
$orderby	STRING	No	Ordenación con sintaxis OData.
$top	INT	No	Elementos por página (máximo 200).
$skip	INT	No	Número de página, empezando en 0.
Respuesta del servicio
Devuelve una respuesta paginada. Cada elemento de datos tiene los siguientes campos:

Campo	Tipo	Puede ser null	Descripción
codigo	STRING	Sí	Código de la serie.
descripcion	STRING	Sí	Descripción.
Códigos HTTP
Código HTTP	Descripción
200	Consulta correcta. Devuelve una respuesta paginada.
400	Los parámetros de consulta no son válidos o se ha producido un error al obtener los datos. El cuerpo contiene el mensaje de error.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Sets?$orderby=codigo" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "resultadosTotales": 1,
  "paginaActual": 1,
  "elementosPorPagina": 200,
  "elementosEnPagina": 1,
  "datos": [
    {
      "codigo": "A",
      "descripcion": "SERIE GENERAL"
    }
  ]
}
Consultar serie
GET
/api/Sets/GetSet/{codigo}
Requiere token
Descripción
Devuelve los datos de una serie de facturación a partir de su código.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
codigo	STRING	Sí	Código de la serie.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
codigo	STRING	Sí	Código de la serie.
descripcion	STRING	Sí	Descripción.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve la serie.
204	No existe ningún registro con esos datos. La respuesta no tiene cuerpo.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Sets/GetSet/{codigo}" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "codigo": "A",
  "descripcion": "SERIE GENERAL"
}
WS Facturas
Consultar facturas
GET
/api/Invoices
Requiere token
Descripción
Devuelve el listado de facturas emitidas, cada una con sus líneas.

Parámetros de entrada
Parámetros en la URL (query string):

Campo	Tipo	Obligatorio	Descripción
$filter	STRING	No	Filtro con sintaxis OData. Ver Filtrado y paginación.
$select	STRING	No	Campos a devolver, separados por comas.
$orderby	STRING	No	Ordenación con sintaxis OData.
$top	INT	No	Elementos por página (máximo 200).
$skip	INT	No	Número de página, empezando en 0.
Respuesta del servicio
Devuelve una respuesta paginada. Cada elemento de datos tiene los siguientes campos:

Campo	Tipo	Puede ser null	Descripción
ejercicio	INT	No	Ejercicio (año) de la factura.
serie	STRING	Sí	Serie de la factura.
codigo	INT	No	Número de la factura dentro de la serie.
cliente	INT	Sí	Código del cliente.
nombreFiscal	STRING	Sí	Nombre fiscal del cliente.
nif	STRING	Sí	NIF del cliente.
direccion	STRING	Sí	Dirección del cliente.
codigoPostal	INT	Sí	Código postal del cliente.
poblacion	STRING	Sí	Población del cliente.
provincia	STRING	Sí	Provincia del cliente.
base1	DECIMAL	Sí	Base imponible 1.
base2	DECIMAL	Sí	Base imponible 2.
base3	DECIMAL	Sí	Base imponible 3.
base4	DECIMAL	Sí	Base imponible 4.
porIva1	DECIMAL	Sí	Porcentaje de IVA de la base 1.
porIva2	DECIMAL	Sí	Porcentaje de IVA de la base 2.
porIva3	DECIMAL	Sí	Porcentaje de IVA de la base 3.
porIva4	DECIMAL	Sí	Porcentaje de IVA de la base 4.
cuotaIva1	DECIMAL	Sí	Cuota de IVA de la base 1.
cuotaIva2	DECIMAL	Sí	Cuota de IVA de la base 2.
cuotaIva3	DECIMAL	Sí	Cuota de IVA de la base 3.
cuotaIva4	DECIMAL	Sí	Cuota de IVA de la base 4.
totalFactura	DECIMAL	Sí	Total de la factura.
retencion	DECIMAL	Sí	Importe de la retención.
fecha	INT	Sí	Fecha de la factura, como número entero.
suplidos	DECIMAL	Sí	Importe de los suplidos.
baseRetencion	DECIMAL	Sí	Base de la retención.
porcentajeRetencion	DECIMAL	Sí	Porcentaje de retención.
provisionFondos	DECIMAL	Sí	Provisión de fondos.
importeBruto	DECIMAL	Sí	Importe bruto.
porcentajeDescuento	DECIMAL	Sí	Porcentaje de descuento.
descuentoCliente	DECIMAL	Sí	Descuento del cliente.
fechaSubida	INT	Sí	Fecha de subida, como número entero.
details	ARRAY	Sí	Líneas de la factura. Ver Línea de factura.
Línea de factura

Campo	Tipo	Puede ser null	Descripción
linea	INT	No	Número de línea.
codigoConcepto	STRING	Sí	Código del concepto de facturación.
importe	DECIMAL	Sí	Importe.
iva	DECIMAL	Sí	IVA.
tituloConcepto	STRING	Sí	Título del concepto.
porcentajeIva	DECIMAL	Sí	Porcentaje de IVA.
texto	STRING	Sí	Texto de la línea.
cantidad	DECIMAL	Sí	Cantidad.
esSuplido	BOOLEAN	No	Indica si es un suplido.
llevaRetencion	BOOLEAN	No	Indica si lleva retención.
total	DECIMAL	Sí	Total de la línea.
porcentajeDescuento	DECIMAL	Sí	Porcentaje de descuento.
importeDescuento	DECIMAL	Sí	Importe del descuento.
importeBruto	DECIMAL	Sí	Importe bruto.
Códigos HTTP
Código HTTP	Descripción
200	Consulta correcta. Devuelve una respuesta paginada.
400	Los parámetros de consulta no son válidos o se ha producido un error al obtener los datos. El cuerpo contiene el mensaje de error.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Invoices?$filter=ejercicio eq 2026 and serie eq 'A'&$orderby=codigo desc" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "resultadosTotales": 1,
  "paginaActual": 1,
  "elementosPorPagina": 200,
  "elementosEnPagina": 1,
  "datos": [
    {
      "ejercicio": 2026,
      "serie": "A",
      "codigo": 1,
      "cliente": 1,
      "nombreFiscal": "EMPRESA EJEMPLO S.L.",
      "nif": "B00000000",
      "direccion": "CL MAYOR 1",
      "codigoPostal": 46001,
      "poblacion": "VALENCIA",
      "provincia": "VALENCIA",
      "base1": 100,
      "base2": 0,
      "base3": 0,
      "base4": 0,
      "porIva1": 21,
      "porIva2": 0,
      "porIva3": 0,
      "porIva4": 0,
      "cuotaIva1": 21,
      "cuotaIva2": 0,
      "cuotaIva3": 0,
      "cuotaIva4": 0,
      "totalFactura": 106,
      "retencion": 15,
      "fecha": null,
      "suplidos": 0,
      "baseRetencion": 100,
      "porcentajeRetencion": 15,
      "provisionFondos": 0,
      "importeBruto": 100,
      "porcentajeDescuento": 0,
      "descuentoCliente": 0,
      "fechaSubida": null,
      "details": [
        {
          "linea": 1,
          "codigoConcepto": "HON01",
          "importe": 100,
          "iva": 21,
          "tituloConcepto": "HONORARIOS MENSUALES",
          "porcentajeIva": 21,
          "texto": null,
          "cantidad": 1,
          "esSuplido": false,
          "llevaRetencion": true,
          "total": 100,
          "porcentajeDescuento": 0,
          "importeDescuento": 0,
          "importeBruto": 100
        }
      ]
    }
  ]
}
Consultar factura
GET
/api/Invoices/GetInvoice/{ejercicio}/{serie}/{codigo}
Requiere token
Descripción
Devuelve los datos de una factura y sus líneas a partir de su ejercicio, serie y número.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
ejercicio	INT	Sí	Ejercicio (año) de la factura.
serie	STRING	Sí	Serie de la factura.
codigo	INT	Sí	Número de la factura dentro de la serie.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
ejercicio	INT	No	Ejercicio (año) de la factura.
serie	STRING	Sí	Serie de la factura.
codigo	INT	No	Número de la factura dentro de la serie.
cliente	INT	Sí	Código del cliente.
nombreFiscal	STRING	Sí	Nombre fiscal del cliente.
nif	STRING	Sí	NIF del cliente.
direccion	STRING	Sí	Dirección del cliente.
codigoPostal	INT	Sí	Código postal del cliente.
poblacion	STRING	Sí	Población del cliente.
provincia	STRING	Sí	Provincia del cliente.
base1	DECIMAL	Sí	Base imponible 1.
base2	DECIMAL	Sí	Base imponible 2.
base3	DECIMAL	Sí	Base imponible 3.
base4	DECIMAL	Sí	Base imponible 4.
porIva1	DECIMAL	Sí	Porcentaje de IVA de la base 1.
porIva2	DECIMAL	Sí	Porcentaje de IVA de la base 2.
porIva3	DECIMAL	Sí	Porcentaje de IVA de la base 3.
porIva4	DECIMAL	Sí	Porcentaje de IVA de la base 4.
cuotaIva1	DECIMAL	Sí	Cuota de IVA de la base 1.
cuotaIva2	DECIMAL	Sí	Cuota de IVA de la base 2.
cuotaIva3	DECIMAL	Sí	Cuota de IVA de la base 3.
cuotaIva4	DECIMAL	Sí	Cuota de IVA de la base 4.
totalFactura	DECIMAL	Sí	Total de la factura.
retencion	DECIMAL	Sí	Importe de la retención.
fecha	INT	Sí	Fecha de la factura, como número entero.
suplidos	DECIMAL	Sí	Importe de los suplidos.
baseRetencion	DECIMAL	Sí	Base de la retención.
porcentajeRetencion	DECIMAL	Sí	Porcentaje de retención.
provisionFondos	DECIMAL	Sí	Provisión de fondos.
importeBruto	DECIMAL	Sí	Importe bruto.
porcentajeDescuento	DECIMAL	Sí	Porcentaje de descuento.
descuentoCliente	DECIMAL	Sí	Descuento del cliente.
fechaSubida	INT	Sí	Fecha de subida, como número entero.
details	ARRAY	Sí	Líneas de la factura. Ver Línea de factura.
Las líneas de details tienen la estructura de Línea de factura.

Códigos HTTP
Código HTTP	Descripción
200	Devuelve la factura.
204	No existe ningún registro con esos datos. La respuesta no tiene cuerpo.
401	Token no enviado, no válido o caducado.
404	ejercicio o codigo no son números enteros.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Invoices/GetInvoice/{ejercicio}/{serie}/{codigo}" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "ejercicio": 2026,
  "serie": "A",
  "codigo": 1,
  "cliente": 1,
  "nombreFiscal": "EMPRESA EJEMPLO S.L.",
  "nif": "B00000000",
  "direccion": "CL MAYOR 1",
  "codigoPostal": 46001,
  "poblacion": "VALENCIA",
  "provincia": "VALENCIA",
  "base1": 100,
  "base2": 0,
  "base3": 0,
  "base4": 0,
  "porIva1": 21,
  "porIva2": 0,
  "porIva3": 0,
  "porIva4": 0,
  "cuotaIva1": 21,
  "cuotaIva2": 0,
  "cuotaIva3": 0,
  "cuotaIva4": 0,
  "totalFactura": 106,
  "retencion": 15,
  "fecha": null,
  "suplidos": 0,
  "baseRetencion": 100,
  "porcentajeRetencion": 15,
  "provisionFondos": 0,
  "importeBruto": 100,
  "porcentajeDescuento": 0,
  "descuentoCliente": 0,
  "fechaSubida": null,
  "details": [
    {
      "linea": 1,
      "codigoConcepto": "HON01",
      "importe": 100,
      "iva": 21,
      "tituloConcepto": "HONORARIOS MENSUALES",
      "porcentajeIva": 21,
      "texto": null,
      "cantidad": 1,
      "esSuplido": false,
      "llevaRetencion": true,
      "total": 100,
      "porcentajeDescuento": 0,
      "importeDescuento": 0,
      "importeBruto": 100
    }
  ]
}
WS Incidencias
Consultar incidencias
GET
/api/Incidences
Requiere token
Descripción
Devuelve el listado de incidencias de facturación de los clientes.

Parámetros de entrada
Parámetros en la URL (query string):

Campo	Tipo	Obligatorio	Descripción
$filter	STRING	No	Filtro con sintaxis OData. Ver Filtrado y paginación.
$select	STRING	No	Campos a devolver, separados por comas.
$orderby	STRING	No	Ordenación con sintaxis OData.
$top	INT	No	Elementos por página (máximo 200).
$skip	INT	No	Número de página, empezando en 0.
Respuesta del servicio
Devuelve una respuesta paginada. Cada elemento de datos tiene los siguientes campos:

Campo	Tipo	Puede ser null	Descripción
cliente	INT	No	Código del cliente.
incidencia	INT	No	Número de la incidencia dentro del cliente.
concepto	STRING	Sí	Código del concepto de facturación (máximo 5 caracteres).
titulo	STRING	Sí	Título (máximo 45 caracteres).
importe	DECIMAL	Sí	Importe.
ivaConcepto	STRING	Sí	IVA del concepto (máximo 5 caracteres).
porcentajeIva	DECIMAL	Sí	Porcentaje de IVA.
textoConcepto	STRING	Sí	Texto del concepto (máximo 250 caracteres).
unidades	DECIMAL	Sí	Unidades.
llevaRetencion	BOOLEAN	No	Indica si lleva retención.
esSuplido	BOOLEAN	No	Indica si es un suplido.
estaFacturado	BOOLEAN	No	Indica si la incidencia ya está facturada.
fecha	INT	Sí	Fecha, como número entero.
mes	INT	Sí	Mes.
ano	INT	Sí	Año.
numeroFactura	INT	Sí	Número de la factura en la que se ha facturado.
total	DECIMAL	Sí	Total.
serieFactura	STRING	Sí	Serie de la factura en la que se ha facturado (máximo 5 caracteres).
anoFactura	INT	Sí	Año de la factura en la que se ha facturado.
textoIncidencia	STRING	Sí	Texto de la incidencia.
incluyeIva	BOOLEAN	No	Indica si el importe incluye el IVA.
Códigos HTTP
Código HTTP	Descripción
200	Consulta correcta. Devuelve una respuesta paginada.
400	Los parámetros de consulta no son válidos o se ha producido un error al obtener los datos. El cuerpo contiene el mensaje de error.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Incidences?$filter=cliente eq 1 and estaFacturado eq false" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "resultadosTotales": 1,
  "paginaActual": 1,
  "elementosPorPagina": 200,
  "elementosEnPagina": 1,
  "datos": [
    {
      "cliente": 1,
      "incidencia": 2,
      "concepto": "HON01",
      "titulo": "GESTIÓN ADICIONAL",
      "importe": 50,
      "ivaConcepto": null,
      "porcentajeIva": 21,
      "textoConcepto": "Gestión adicional del mes.",
      "unidades": 1,
      "llevaRetencion": false,
      "esSuplido": false,
      "estaFacturado": false,
      "fecha": null,
      "mes": 11,
      "ano": 2026,
      "numeroFactura": null,
      "total": 60.5,
      "serieFactura": null,
      "anoFactura": null,
      "textoIncidencia": null,
      "incluyeIva": false
    }
  ]
}
Consultar incidencia
GET
/api/Incidences/GetIncidence/{client}/{incidence}
Requiere token
Descripción
Devuelve los datos de una incidencia a partir del código del cliente y del número de incidencia.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
client	INT	Sí	Código del cliente.
incidence	INT	Sí	Número de la incidencia.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
cliente	INT	No	Código del cliente.
incidencia	INT	No	Número de la incidencia dentro del cliente.
concepto	STRING	Sí	Código del concepto de facturación (máximo 5 caracteres).
titulo	STRING	Sí	Título (máximo 45 caracteres).
importe	DECIMAL	Sí	Importe.
ivaConcepto	STRING	Sí	IVA del concepto (máximo 5 caracteres).
porcentajeIva	DECIMAL	Sí	Porcentaje de IVA.
textoConcepto	STRING	Sí	Texto del concepto (máximo 250 caracteres).
unidades	DECIMAL	Sí	Unidades.
llevaRetencion	BOOLEAN	No	Indica si lleva retención.
esSuplido	BOOLEAN	No	Indica si es un suplido.
estaFacturado	BOOLEAN	No	Indica si la incidencia ya está facturada.
fecha	INT	Sí	Fecha, como número entero.
mes	INT	Sí	Mes.
ano	INT	Sí	Año.
numeroFactura	INT	Sí	Número de la factura en la que se ha facturado.
total	DECIMAL	Sí	Total.
serieFactura	STRING	Sí	Serie de la factura en la que se ha facturado (máximo 5 caracteres).
anoFactura	INT	Sí	Año de la factura en la que se ha facturado.
textoIncidencia	STRING	Sí	Texto de la incidencia.
incluyeIva	BOOLEAN	No	Indica si el importe incluye el IVA.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve la incidencia.
204	No existe ningún registro con esos datos. La respuesta no tiene cuerpo.
401	Token no enviado, no válido o caducado.
404	client o incidence no son números enteros.
Ejemplos
Petición
curl -X GET "https://apirec.diezsoftware.com/api/Incidences/GetIncidence/{client}/{incidence}" \
  -H "Authorization: Bearer {token}"
Respuesta
{
  "cliente": 1,
  "incidencia": 2,
  "concepto": "HON01",
  "titulo": "GESTIÓN ADICIONAL",
  "importe": 50,
  "ivaConcepto": null,
  "porcentajeIva": 21,
  "textoConcepto": "Gestión adicional del mes.",
  "unidades": 1,
  "llevaRetencion": false,
  "esSuplido": false,
  "estaFacturado": false,
  "fecha": null,
  "mes": 11,
  "ano": 2026,
  "numeroFactura": null,
  "total": 60.5,
  "serieFactura": null,
  "anoFactura": null,
  "textoIncidencia": null,
  "incluyeIva": false
}
Añadir incidencia
POST
/api/Incidences/incidence
Requiere token
Descripción
Añade una incidencia a un cliente y devuelve sus datos.

Si incidencia es 0, la API asigna automáticamente el número. Si ya existe una incidencia con el mismo cliente e incidencia, se actualiza en lugar de añadirse.

Parámetros de entrada
Cuerpo de la petición en formato JSON (Content-Type: application/json):

Campo	Tipo	Obligatorio	Descripción
cliente	INT	Sí	Código del cliente.
incidencia	INT	Sí	Número de la incidencia dentro del cliente.
concepto	STRING	No	Código del concepto de facturación (máximo 5 caracteres).
titulo	STRING	No	Título (máximo 45 caracteres).
importe	DECIMAL	No	Importe.
ivaConcepto	STRING	No	IVA del concepto (máximo 5 caracteres).
porcentajeIva	DECIMAL	No	Porcentaje de IVA.
textoConcepto	STRING	No	Texto del concepto (máximo 250 caracteres).
unidades	DECIMAL	No	Unidades.
llevaRetencion	BOOLEAN	Sí	Indica si lleva retención.
esSuplido	BOOLEAN	Sí	Indica si es un suplido.
estaFacturado	BOOLEAN	Sí	Indica si la incidencia ya está facturada.
fecha	INT	No	Fecha, como número entero.
mes	INT	No	Mes.
ano	INT	No	Año.
numeroFactura	INT	No	Número de la factura en la que se ha facturado.
total	DECIMAL	No	Total.
serieFactura	STRING	No	Serie de la factura en la que se ha facturado (máximo 5 caracteres).
anoFactura	INT	No	Año de la factura en la que se ha facturado.
textoIncidencia	STRING	No	Texto de la incidencia.
incluyeIva	BOOLEAN	Sí	Indica si el importe incluye el IVA.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
cliente	INT	No	Código del cliente.
incidencia	INT	No	Número de la incidencia dentro del cliente.
concepto	STRING	Sí	Código del concepto de facturación (máximo 5 caracteres).
titulo	STRING	Sí	Título (máximo 45 caracteres).
importe	DECIMAL	Sí	Importe.
ivaConcepto	STRING	Sí	IVA del concepto (máximo 5 caracteres).
porcentajeIva	DECIMAL	Sí	Porcentaje de IVA.
textoConcepto	STRING	Sí	Texto del concepto (máximo 250 caracteres).
unidades	DECIMAL	Sí	Unidades.
llevaRetencion	BOOLEAN	No	Indica si lleva retención.
esSuplido	BOOLEAN	No	Indica si es un suplido.
estaFacturado	BOOLEAN	No	Indica si la incidencia ya está facturada.
fecha	INT	Sí	Fecha, como número entero.
mes	INT	Sí	Mes.
ano	INT	Sí	Año.
numeroFactura	INT	Sí	Número de la factura en la que se ha facturado.
total	DECIMAL	Sí	Total.
serieFactura	STRING	Sí	Serie de la factura en la que se ha facturado (máximo 5 caracteres).
anoFactura	INT	Sí	Año de la factura en la que se ha facturado.
textoIncidencia	STRING	Sí	Texto de la incidencia.
incluyeIva	BOOLEAN	No	Indica si el importe incluye el IVA.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve los datos de la incidencia guardada.
204	No se ha podido guardar el registro. La respuesta no tiene cuerpo.
400	El cuerpo no es válido (por ejemplo, un texto supera su longitud máxima). El cuerpo de la respuesta contiene el detalle.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X POST "https://apirec.diezsoftware.com/api/Incidences/incidence" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"cliente":1,"incidencia":0,"concepto":"HON01","titulo":"GESTIÓN ADICIONAL","importe":50,"porcentajeIva":21,"textoConcepto":"Gestión adicional del mes.","unidades":1,"llevaRetencion":false,"esSuplido":false,"estaFacturado":false,"mes":11,"ano":2026,"total":60.5,"incluyeIva":false}'
Respuesta
{
  "cliente": 1,
  "incidencia": 2,
  "concepto": "HON01",
  "titulo": "GESTIÓN ADICIONAL",
  "importe": 50,
  "ivaConcepto": null,
  "porcentajeIva": 21,
  "textoConcepto": "Gestión adicional del mes.",
  "unidades": 1,
  "llevaRetencion": false,
  "esSuplido": false,
  "estaFacturado": false,
  "fecha": null,
  "mes": 11,
  "ano": 2026,
  "numeroFactura": null,
  "total": 60.5,
  "serieFactura": null,
  "anoFactura": null,
  "textoIncidencia": null,
  "incluyeIva": false
}
Actualizar incidencia
PUT
/api/Incidences/incidence
Requiere token
Descripción
Actualiza una incidencia existente, identificada por cliente e incidencia, y devuelve sus datos actualizados.

Parámetros de entrada
Cuerpo de la petición en formato JSON (Content-Type: application/json):

Campo	Tipo	Obligatorio	Descripción
cliente	INT	Sí	Código del cliente.
incidencia	INT	Sí	Número de la incidencia dentro del cliente.
concepto	STRING	No	Código del concepto de facturación (máximo 5 caracteres).
titulo	STRING	No	Título (máximo 45 caracteres).
importe	DECIMAL	No	Importe.
ivaConcepto	STRING	No	IVA del concepto (máximo 5 caracteres).
porcentajeIva	DECIMAL	No	Porcentaje de IVA.
textoConcepto	STRING	No	Texto del concepto (máximo 250 caracteres).
unidades	DECIMAL	No	Unidades.
llevaRetencion	BOOLEAN	Sí	Indica si lleva retención.
esSuplido	BOOLEAN	Sí	Indica si es un suplido.
estaFacturado	BOOLEAN	Sí	Indica si la incidencia ya está facturada.
fecha	INT	No	Fecha, como número entero.
mes	INT	No	Mes.
ano	INT	No	Año.
numeroFactura	INT	No	Número de la factura en la que se ha facturado.
total	DECIMAL	No	Total.
serieFactura	STRING	No	Serie de la factura en la que se ha facturado (máximo 5 caracteres).
anoFactura	INT	No	Año de la factura en la que se ha facturado.
textoIncidencia	STRING	No	Texto de la incidencia.
incluyeIva	BOOLEAN	Sí	Indica si el importe incluye el IVA.
Respuesta del servicio
Campo	Tipo	Puede ser null	Descripción
cliente	INT	No	Código del cliente.
incidencia	INT	No	Número de la incidencia dentro del cliente.
concepto	STRING	Sí	Código del concepto de facturación (máximo 5 caracteres).
titulo	STRING	Sí	Título (máximo 45 caracteres).
importe	DECIMAL	Sí	Importe.
ivaConcepto	STRING	Sí	IVA del concepto (máximo 5 caracteres).
porcentajeIva	DECIMAL	Sí	Porcentaje de IVA.
textoConcepto	STRING	Sí	Texto del concepto (máximo 250 caracteres).
unidades	DECIMAL	Sí	Unidades.
llevaRetencion	BOOLEAN	No	Indica si lleva retención.
esSuplido	BOOLEAN	No	Indica si es un suplido.
estaFacturado	BOOLEAN	No	Indica si la incidencia ya está facturada.
fecha	INT	Sí	Fecha, como número entero.
mes	INT	Sí	Mes.
ano	INT	Sí	Año.
numeroFactura	INT	Sí	Número de la factura en la que se ha facturado.
total	DECIMAL	Sí	Total.
serieFactura	STRING	Sí	Serie de la factura en la que se ha facturado (máximo 5 caracteres).
anoFactura	INT	Sí	Año de la factura en la que se ha facturado.
textoIncidencia	STRING	Sí	Texto de la incidencia.
incluyeIva	BOOLEAN	No	Indica si el importe incluye el IVA.
Códigos HTTP
Código HTTP	Descripción
200	Devuelve los datos actualizados de la incidencia.
204	No se ha podido guardar el registro. La respuesta no tiene cuerpo.
400	incidencia es 0, no existe ninguna incidencia con esos datos o el cuerpo no es válido. El cuerpo de la respuesta contiene el detalle.
401	Token no enviado, no válido o caducado.
Ejemplos
Petición
curl -X PUT "https://apirec.diezsoftware.com/api/Incidences/incidence" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"cliente":1,"incidencia":2,"concepto":"HON01","titulo":"GESTIÓN ADICIONAL","importe":50,"ivaConcepto":null,"porcentajeIva":21,"textoConcepto":"Gestión adicional del mes.","unidades":1,"llevaRetencion":false,"esSuplido":false,"estaFacturado":false,"fecha":null,"mes":11,"ano":2026,"numeroFactura":null,"total":60.5,"serieFactura":null,"anoFactura":null,"textoIncidencia":null,"incluyeIva":false}'
Respuesta
{
  "cliente": 1,
  "incidencia": 2,
  "concepto": "HON01",
  "titulo": "GESTIÓN ADICIONAL",
  "importe": 50,
  "ivaConcepto": null,
  "porcentajeIva": 21,
  "textoConcepto": "Gestión adicional del mes.",
  "unidades": 1,
  "llevaRetencion": false,
  "esSuplido": false,
  "estaFacturado": false,
  "fecha": null,
  "mes": 11,
  "ano": 2026,
  "numeroFactura": null,
  "total": 60.5,
  "serieFactura": null,
  "anoFactura": null,
  "textoIncidencia": null,
  "incluyeIva": false
}
Borrar incidencia
DELETE
/api/Incidences/delete/{client}/{incidence}
Requiere token
Descripción
Borra una incidencia a partir del código del cliente y del número de incidencia.

Parámetros de entrada
Parámetros en la ruta:

Campo	Tipo	Obligatorio	Descripción
client	INT	Sí	Código del cliente.
incidence	INT	Sí	Número de la incidencia.
Respuesta del servicio
Valor lógico (BOOLEAN) con el resultado de la operación.

Códigos HTTP
Código HTTP	Descripción
200	Devuelve el resultado de la operación: false si no se ha podido borrar.
401	Token no enviado, no válido o caducado.
404	client o incidence no son números enteros.
500	No existe ninguna incidencia con esos datos.
Ejemplos
Petición
curl -X DELETE "https://apirec.diezsoftware.com/api/Incidences/delete/{client}/{incidence}" \
  -H "Authorization: Bearer {token}"
Respuesta
true
```
