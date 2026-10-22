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
export { NOMBRE_ORIGEN, totalTeToca, introEnLaHoja, buscarCuentasHoja, type OrigenCasilla, type CuentaHoja } from './valores'
export { PestanasEstado, FiltrosLista, FiltroSelector, FiltroBuscar, TablaLista, type ColumnaLista } from './Lista'
export {
  pestanasConTodas, sumanTodas, leerEstado, conCambio, recordarLista, listaRecordada, leerOrden, escribirOrden, ordenar,
  type PestanaEstado, type EstadoLista, type Sentido,
} from './lista'
export { Ficha, NavegaFicha, Veredicto, BloqueFicha, CampoFicha, FilaCampos, AsientoQueSeCrea, DocumentoFicha, type TipoVeredicto, type TonoCampo } from './Ficha'
export { ControlesInforme, VistaInforme, ComprobacionInforme, TablaInforme, type LineaInforme, type CuentaInforme, type ColumnaInforme } from './Informe'
export { Asistente, PasosAsistente, LeyendaCasillas, Casilla, BloqueAsistente, DeDondeSale, PieAsistente, type PasoAsistente } from './Asistente'
export { HojaDeLineas, BuscarCuentaHoja } from './HojaDeLineas'
