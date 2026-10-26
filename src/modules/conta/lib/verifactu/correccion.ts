// src/modules/conta/lib/verifactu/correccion.ts
//
// V03 · E3 · Lo que leen las pantallas de «Me he equivocado en…», «Comprobar con
// Hacienda», «Comprobar la cadena» y «Exportar los registros». Lo que pasa lo
// decide la base (verifactu_previsto, _verifactu_cuadrar,
// verifactu_comprobar_cadena); aquí solo se dice en palabras y se ordena.

export type AccionCorreccion = 'rectificar' | 'anular' | 'subsanar'

export interface CambioPrevisto { campo: string; que: string; antes: string | null; despues: string | null }

/** Lo que va a pasar (verifactu_previsto): se enseña ANTES de confirmar. */
export interface Previsto {
  accion: AccionCorreccion
  puede: boolean
  frase: string
  aviso: string | null
  cambios: CambioPrevisto[]
  numero: string
}

export const OPCIONES_CORRECCION: readonly { accion: AccionCorreccion; titulo: string; cuando: string }[] = [
  { accion: 'rectificar', titulo: 'La factura de mi cliente está mal', cuando: 'Importes, líneas o sus datos: se hace una rectificativa y se la mandas.' },
  { accion: 'anular', titulo: 'No tenía que haberla emitido', cuando: 'Un duplicado, una prueba: queda anulada y Hacienda recibe su anulación.' },
  { accion: 'subsanar', titulo: 'Solo está mal lo que tiene Hacienda', cuando: 'La factura está bien, pero su registro no: se manda uno nuevo que lo sustituye.' },
]

// ── Comprobar con Hacienda ─────────────────────────────────────────────────

export interface FacturaDelCuadre { num_serie: string; fecha: string; invoice_id?: string | null }
export interface DistintaDelCuadre extends FacturaDelCuadre {
  que: 'estado' | 'huella' | 'importe' | 'sumied_no_la_dio_por_buena'
  sumied: { estado: string | null; importe: number | null; huella: string | null }
  hacienda: { estado: string | null; importe: number | null; huella: string | null; codigo: number | null; descripcion: string | null }
}
export interface ResultadoCuadre {
  hacienda: number
  cuadran: number
  en_camino: number
  rechazadas: number
  falta_en_hacienda: (FacturaDelCuadre & { esperado: string | null })[]
  solo_en_hacienda: (FacturaDelCuadre & { estado: string; importe: number | null })[]
  distintas: DistintaDelCuadre[]
  ok: boolean
  mes: string
  cuadrado_at: string
}

export interface CuadreVisto {
  id: string
  entorno: 'pruebas' | 'real'
  ejercicio: number
  periodo: string
  estado: 'pedido' | 'consultando' | 'hecho' | 'fallo'
  pedido_at: string
  pedido_por: string | null
  empezado_at: string | null
  terminado_at: string | null
  paginas: number
  error: string | null
  resultado: ResultadoCuadre | null
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreMes = (ejercicio: number, periodo: string) => `${MESES[Number(periodo) - 1] ?? periodo} de ${ejercicio}`

/** Los meses que se pueden comprobar: del actual (en Madrid) hacia atrás, hasta 18, sin pasar de octubre de 2024. */
export function mesesParaComprobar(ahora: Date, cuantos = 18): { valor: string; texto: string }[] {
  const [a, m] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(ahora).split('-').map(Number)
  const out: { valor: string; texto: string }[] = []
  for (let i = 0; i < cuantos; i++) {
    const total = a * 12 + (m - 1) - i
    const anio = Math.floor(total / 12), mes = (total % 12) + 1
    if (anio * 100 + mes < 202410) break
    const p = String(mes).padStart(2, '0')
    out.push({ valor: `${anio}-${p}-01`, texto: nombreMes(anio, p).replace(/^./, (c) => c.toUpperCase()) })
  }
  return out
}

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

/** Cuánto lleva esperando, en palabras. */
const espera = (desde: string, ahora: Date) => {
  const min = Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / 60000))
  return min < 1 ? 'hace un momento' : `hace ${plural(min, 'minuto', 'minutos')}`
}

export interface TextoCuadre {
  tono: 'espera' | 'ok' | 'duda' | 'falta'
  titulo: string
  frase: string
  /** Sigue esperando: la pantalla vuelve a mirar. */
  esperando: boolean
}

/** Lo que dice la pantalla de un cuadre, en cualquiera de sus estados (regla 8: siempre dice algo). */
export function textoCuadre(c: CuadreVisto, ahora: Date): TextoCuadre {
  const mes = nombreMes(c.ejercicio, c.periodo)
  const donde = c.entorno === 'pruebas' ? ' (entorno de pruebas de Hacienda)' : ''
  if (c.estado === 'pedido' || c.estado === 'consultando') {
    const desde = c.estado === 'pedido' ? c.pedido_at : (c.empezado_at ?? c.pedido_at)
    const tarda = ahora.getTime() - new Date(c.pedido_at).getTime() > 5 * 60000
    return {
      tono: tarda ? 'duda' : 'espera', esperando: true,
      titulo: c.estado === 'pedido' ? `Preguntado a Hacienda por ${mes}${donde}` : `Hacienda está contestando por ${mes}${donde}`,
      frase: (c.estado === 'pedido' ? `Pedido ${espera(desde, ahora)}` : `Leyendo su respuesta${c.paginas ? ` (${plural(c.paginas, 'página', 'páginas')})` : ''}, desde ${espera(desde, ahora)}`)
        + (tarda ? '. Está tardando más de lo normal: si en un rato sigue igual, puede que el envío a Hacienda esté apagado o que Hacienda no conteste. Puedes cerrar esto y mirarlo luego.' : '. Puedes cerrar esto: el resultado se queda guardado.'),
    }
  }
  if (c.estado === 'fallo') {
    return { tono: 'falta', esperando: false, titulo: `No se ha podido comprobar ${mes}${donde}`, frase: c.error ?? 'Hacienda no ha contestado.' }
  }
  const r = c.resultado
  if (!r) return { tono: 'falta', esperando: false, titulo: `Comprobado ${mes}${donde}`, frase: 'El resultado no se ha guardado: vuelve a pedirlo.' }
  const problemas = r.falta_en_hacienda.length + r.solo_en_hacienda.length + r.distintas.length
  const camino = r.en_camino ? ` ${plural(r.en_camino, 'registro está', 'registros están')} de camino y Hacienda aún no ${r.en_camino === 1 ? 'lo tiene' : 'los tiene'}.` : ''
  const rech = r.rechazadas ? ` ${plural(r.rechazadas, 'factura rechazada', 'facturas rechazadas')} sin subsanar: Hacienda no ${r.rechazadas === 1 ? 'la tiene' : 'las tiene'}, como debe ser hasta que se corrija.` : ''
  if (problemas === 0) {
    return {
      tono: 'ok', esperando: false, titulo: `${mes.replace(/^./, (x) => x.toUpperCase())} cuadra con Hacienda${donde}`,
      frase: r.hacienda === 0 && r.cuadran === 0
        ? `Ni Hacienda ni Sumied tienen registros de ${mes}.${camino}${rech}`
        : `Hacienda tiene ${plural(r.hacienda, 'registro', 'registros')} de ${mes} y ${r.cuadran === r.hacienda ? 'todos son' : `${plural(r.cuadran, 'es', 'son')}`} los de Sumied, con la misma huella y el mismo importe.${camino}${rech}`,
    }
  }
  return {
    tono: 'falta', esperando: false, titulo: `${mes.replace(/^./, (x) => x.toUpperCase())} no cuadra con Hacienda${donde}`,
    frase: [
      r.falta_en_hacienda.length ? `${plural(r.falta_en_hacienda.length, 'factura que Sumied dio por recibida no está', 'facturas que Sumied dio por recibidas no están')} en Hacienda` : null,
      r.solo_en_hacienda.length ? `Hacienda tiene ${plural(r.solo_en_hacienda.length, 'registro que no es', 'registros que no son')} de Sumied` : null,
      r.distintas.length ? `${plural(r.distintas.length, 'factura no dice', 'facturas no dicen')} lo mismo en los dos sitios` : null,
    ].filter(Boolean).join('; ') + `. ${plural(r.cuadran, 'cuadra', 'cuadran')}.${camino}${rech} Abajo, cuál y qué hacer.`,
  }
}

const QUE_DISTINTA: Record<DistintaDelCuadre['que'], string> = {
  estado: 'Hacienda la tiene en otro estado',
  huella: 'Hacienda tiene otra huella: no es el registro que guardó Sumied',
  importe: 'Hacienda tiene otro importe',
  sumied_no_la_dio_por_buena: 'Hacienda la tiene, pero a Sumied le dijo que la rechazaba (o no contestó)',
}

const ESTADO_HACIENDA: Record<string, string> = { Correcto: 'recibida', AceptadoConErrores: 'recibida con avisos', Anulado: 'anulada' }
const fechaCorta = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4)

export interface FilaDescuadre { numero: string; fecha: string; invoiceId: string | null; que: string; hacer: string }

/** Cada factura que no cuadra, con qué le pasa y qué hacer. */
export function filasDescuadre(r: ResultadoCuadre): FilaDescuadre[] {
  return [
    ...r.falta_en_hacienda.map((f) => ({
      numero: f.num_serie, fecha: fechaCorta(f.fecha), invoiceId: f.invoice_id ?? null,
      que: `Sumied la dio por ${ESTADO_HACIENDA[f.esperado ?? ''] ?? 'recibida'} y Hacienda no la tiene.`,
      hacer: 'Ábrela y, en «Me he equivocado en…», manda su registro de nuevo («Solo está mal lo que tiene Hacienda»).',
    })),
    ...r.distintas.map((f) => ({
      numero: f.num_serie, fecha: fechaCorta(f.fecha), invoiceId: f.invoice_id ?? null,
      que: `${QUE_DISTINTA[f.que]}${f.que === 'estado' ? `: ${ESTADO_HACIENDA[f.hacienda.estado ?? ''] ?? f.hacienda.estado}, y en Sumied ${ESTADO_HACIENDA[f.sumied.estado ?? ''] ?? f.sumied.estado}` : ''}${f.que === 'importe' ? `: ${f.hacienda.importe ?? '—'} €, y en Sumied ${f.sumied.importe ?? '—'} €` : ''}.`,
      hacer: f.que === 'sumied_no_la_dio_por_buena'
        ? 'Ábrela: si la factura está bien, subsánala para que los dos sitios digan lo mismo.'
        : 'Ábrela y subsana su registro; si sigue igual, pásaselo a tu asesoría con este resultado.',
    })),
    ...r.solo_en_hacienda.map((f) => ({
      numero: f.num_serie, fecha: fechaCorta(f.fecha), invoiceId: null,
      que: `Hacienda tiene un registro ${ESTADO_HACIENDA[f.estado] ?? f.estado} con este número que no ha mandado Sumied.`,
      hacer: 'Si la hiciste con otro programa, es normal. Si no, pásaselo a tu asesoría: alguien ha mandado a tu nombre.',
    })),
  ]
}

// ── La cadena ──────────────────────────────────────────────────────────────

export interface ProblemaCadena { registro: string | null; num_serie: string | null; tipo: string | null; que: string; frase: string }
export interface CadenaEntorno {
  entorno: 'real' | 'pruebas'; nif: string; registros: number; de_otras_empresas: number
  desde: string | null; hasta: string | null; ok: boolean; problemas: ProblemaCadena[]; problemas_total: number
}
export interface Cadena { ok: boolean; registros: number; problemas: number; cadenas: CadenaEntorno[]; comprobada_at: string; frase: string }

// ── Exportar los registros (para una inspección) ───────────────────────────

export interface RegistroExportar {
  entorno: string; tipo: string; subsanacion: boolean; rechazo_previo: string | null; sin_registro_previo: boolean
  nif_emisor: string; num_serie: string; fecha_expedicion: string; tipo_factura: string | null
  cuota_total: number | null; importe_total: number | null; primer_registro: boolean
  anterior_num_serie: string | null; anterior_fecha: string | null; huella_anterior: string | null
  fecha_hora_huso: string; generado_at: string; cadena_huella: string; huella: string
  estado: string; codigo_error: number | null; descripcion_error: string | null; csv: string | null; respondido_at: string | null
}

export const COLUMNAS_EXPORTAR = [
  { titulo: 'Entorno' }, { titulo: 'Tipo' }, { titulo: 'Subsanación' }, { titulo: 'Rechazo previo' }, { titulo: 'Sin registro previo' },
  { titulo: 'NIF emisor' }, { titulo: 'Número' }, { titulo: 'Fecha de expedición' }, { titulo: 'Tipo de factura' },
  { titulo: 'Cuota total', cifra: true }, { titulo: 'Importe total', cifra: true }, { titulo: 'Primer registro' },
  { titulo: 'Anterior: número' }, { titulo: 'Anterior: fecha' }, { titulo: 'Anterior: huella' },
  { titulo: 'Fecha, hora y huso' }, { titulo: 'Generado' }, { titulo: 'Lo que entra en la huella' }, { titulo: 'Huella (SHA-256)' },
  { titulo: 'Estado en Hacienda' }, { titulo: 'Código' }, { titulo: 'Lo que dijo Hacienda' }, { titulo: 'CSV de Hacienda' }, { titulo: 'Contestado' },
] as const

const SN = (b: boolean) => (b ? 'S' : 'N')
const ESTADO_REGISTRO: Record<string, string> = {
  pendiente: 'Pendiente de enviar', enviando: 'Enviándose', correcto: 'Correcto', aceptado_con_errores: 'Aceptado con errores', incorrecto: 'Rechazado',
}

/** Una fila por registro, en el orden de la cadena: con lo que entra en la huella, para poder recalcularla. */
export function filasExportar(rs: readonly RegistroExportar[]): (string | number | null)[][] {
  return [...rs].sort((a, b) => a.entorno.localeCompare(b.entorno) || a.generado_at.localeCompare(b.generado_at)).map((r) => [
    r.entorno === 'real' ? 'Real' : 'Pruebas', r.tipo === 'alta' ? 'Alta' : 'Anulación', SN(r.subsanacion), r.rechazo_previo, SN(r.sin_registro_previo),
    r.nif_emisor, r.num_serie, fechaCorta(r.fecha_expedicion), r.tipo_factura,
    r.cuota_total, r.importe_total, SN(r.primer_registro),
    r.anterior_num_serie, r.anterior_fecha ? fechaCorta(r.anterior_fecha) : null, r.huella_anterior,
    r.fecha_hora_huso, r.generado_at, r.cadena_huella, r.huella,
    ESTADO_REGISTRO[r.estado] ?? r.estado, r.codigo_error, r.descripcion_error, r.csv, r.respondido_at,
  ])
}
