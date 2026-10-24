// src/modules/conta/diseno/index.ts
//
// S01 · El sistema de diseño de contabilidad, en un solo sitio. Las pantallas
// del esqueleto importan de aquí y de ningún otro sitio de piezas
// (diseno-reglas.test.ts lo comprueba). Los estilos se cargan desde
// estilo/index.ts (tokens.css y diseno.css).
//
// Tabla, Formulario y Documento son las tres piezas del M01 (#211), que ya
// cumplen el sistema; se exportan desde aquí con su nombre del sistema y se
// mudarán a esta carpeta cuando las pantallas pasen al esqueleto.

export { Boton, BotonEnlace, Tecla } from './Boton'
export { Campo, Texto, Importe, Fecha, Selector, Subcuenta } from './Campo'
export { Chip } from './Chip'
export { Cifra } from './Cifra'
export { Dialogo } from './Dialogo'
export { Icono } from './Icono'
export { ICONOS, TAM_ICONO, TRAZO_ICONO, type NombreIcono } from './iconos'
export { Tarjeta, TarjetaCifra, type TonoTarjeta } from './Tarjeta'
export {
  clasesBoton, expandirSubcuenta, importeDeTexto, opcionesConGuardado, textoCifra, textoDeImporte, tonoDeEstado,
  type OpcionSelector, type TonoChip, type VarianteBoton,
} from './valores'
export { TablaDensa as Tabla, type ColumnaDensa as ColumnaTabla } from '@/modules/conta/ui/tabla/TablaDensa'
export { FormularioBloques as Formulario, type Bloque } from '@/modules/conta/ui/formulario/FormularioBloques'
export { PanelDocumento as Documento } from '@/modules/conta/ui/documento/PanelDocumento'
