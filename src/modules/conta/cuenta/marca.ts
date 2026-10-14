// src/modules/conta/cuenta/marca.ts
//
// La marca con la que se enseña contabilidad (C06). Es la segunda pieza del
// contrato con lo de fuera (la primera es contratoCuenta.ts): el módulo no
// escribe nunca el nombre del producto; lo pide aquí. Va con ruta relativa
// porque lo usan también los núcleos puros que compilan los scripts (sin «@/»).
// Sin navegador es Folvy: las pruebas unitarias ven lo de siempre.

export { MARCA, CON_MARCA, type Marca } from '../../../marca/marca'
