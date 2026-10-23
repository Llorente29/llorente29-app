// src/modules/conta/diseno/plantillas/index.ts
//
// S02 · Las seis plantillas del patrón único (encargo S02, «Seis plantillas»):
// ninguna pantalla se sale de ellas. Si una pantalla no encaja en una
// plantilla, se cambia la pantalla, no el patrón.
//   1. Bandeja — Inicio (tablero 1).
//   2. Lista — facturas, movimientos, asientos, contactos (tableros 2, 4 y 7).
//   3. Ficha — una factura, un movimiento, un contacto (tableros 3 y 9).
//   4. Informe — balance, mayor, libros de IVA (tablero 6).
//   5. Asistente — presentar un impuesto, dar de alta, cerrar (tablero 8).
//   6. Hoja de líneas — un asiento a mano (tablero 5).
// Los estilos, en plantillas.css (los carga estilo/index.ts).

export { Bandeja, CifrasBandeja, TeTocaHoy, HechoAutomatico, type CifraBandeja, type FilaTeToca } from './Bandeja'
export {
  NOMBRE_ORIGEN, totalTeToca, introEnLaHoja, buscarCuentasHoja, centDeTexto, ordenarAsiento, lineasEnOrden, claveLineaAsiento, totalesAsiento,
  type OrigenCasilla, type CuentaHoja, type LineaAsientoVista, type OrdenAsiento, type TotalesAsiento,
} from './valores'
export { PestanasEstado, FiltrosLista, FiltroSelector, FiltroBuscar, TablaLista, type ColumnaLista } from './Lista'
export {
  pestanasConTodas, sumanTodas, leerEstado, conCambio, recordarLista, listaRecordada, leerOrden, escribirOrden, ordenar,
  type PestanaEstado, type EstadoLista, type Sentido,
} from './lista'
export {
  Ficha, NavegaFicha, Veredicto, BloqueFicha, CampoFicha, FilaCampos, AsientoQueSeCrea, TablaAsiento, DocumentoFicha,
  type TipoVeredicto, type TonoCampo, type ColumnaAsiento, type OpcionesTablaAsiento,
} from './Ficha'
export { ControlesInforme, VistaInforme, ComprobacionInforme, TablaInforme, type LineaInforme, type CuentaInforme, type ColumnaInforme } from './Informe'
export { Asistente, PasosAsistente, LeyendaCasillas, Casilla, BloqueAsistente, DeDondeSale, PieAsistente, type PasoAsistente } from './Asistente'
export { HojaDeLineas, BuscarCuentaHoja } from './HojaDeLineas'
// Cambios sin guardar: la pieza común de toda ficha que se edita (encargo «Ficha de la recibida completa», punto 2).
export { MarcaCambiado, BarraCambios, AvisoSalir, type MensajeGuardado } from './CambiosSinGuardar'
export { DialogoSalir } from './DialogoSalir'
export {
  useCambiosSinGuardar, contarCambios, adoptar, igual, huella, formatoDeSerie, resumenCambios, cuentaCambios, textoSalir, listaY,
  type CambioCampo, type CambiosSinGuardar, type FormatoCampo, type Registro, type ResultadoGuardar,
} from './cambios'
export { useAvisoSalir, destinoDelClic, type AvisoSalirControl, type OpcionesAvisoSalir } from './avisoSalir'
