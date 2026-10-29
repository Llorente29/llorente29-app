// src/modules/conta/laboral/importar/cegidCabeceras.ts
//
// LAB1 · Importador del historial de personal desde Cegid, tanda 1 (29/10/2026):
// solo las cabeceras. Lo que se espera del paquete `lab_paquete_personal.xlsx`,
// con los nombres de columna que dio Julio el 29/10 (solo nombres, ningún
// valor), y la comparación con lo que trae el fichero que se sube.
//
// Dos clases de hoja:
//   · «tabla»: la primera fila son las cabeceras y cada fila de debajo, un dato.
//   · «campo · valor» (Empresa y Convenio): la primera columna son los nombres
//     de los campos y la segunda, sus valores. De éstas se leen SOLO los nombres
//     (la columna A), nunca la B.
//
// Puro: sin red ni base. La pantalla lee el Excel y le pasa lo leído.

export type ClaseHoja = 'tabla' | 'campo_valor'

export interface HojaEsperada {
  /** El nombre que se guarda en la base (lab_import_fila.hoja). */
  id: string
  /** El nombre de la pestaña en el Excel de Cegid. */
  nombre: string
  clase: ClaseHoja
  /** Las cabeceras (tabla) o los nombres de campo (campo · valor), tal como vienen. */
  columnas: readonly string[]
}

export const HOJAS_CEGID: readonly HojaEsperada[] = [
  {
    id: 'empresa', nombre: 'Empresa', clase: 'campo_valor',
    columnas: ['código ERP10', 'razón social', 'NIF', 'régimen SS', 'CCC', 'convenio', 'dirección', 'teléfono', 'email',
      'representante', 'calendario laboral', 'mutua AT/EP', 'CNAE', 'tipo de empresa', 'pagas extraordinarias', 'cálculo IRPF',
      'emisión de nómina', 'banco de nóminas', 'banco de SS', 'centros de trabajo'],
  },
  {
    id: 'convenio', nombre: 'Convenio', clase: 'campo_valor',
    columnas: ['código ERP10', 'nombre', 'código oficial', 'horas anuales', 'horas día', 'fecha revisión', 'vacaciones',
      'paga 13', 'paga 14', 'observaciones'],
  },
  {
    id: 'tablas_salariales', nombre: 'Tablas_salariales', clase: 'tabla',
    columnas: ['convenio', 'categoria', 'categoria_nombre', 'concepto', 'concepto_nombre', 'importe', 'modo_pago'],
  },
  {
    id: 'conceptos', nombre: 'Conceptos', clase: 'tabla',
    columnas: ['codigo', 'concepto', 'tipo', 'codigo_red'],
  },
  {
    id: 'trabajadores', nombre: 'Trabajadores', clase: 'tabla',
    columnas: ['trabajador', 'nombre', 'nif', 'naf', 'antiguedad', 'nacimiento', 'domicilio', 'cp', 'poblacion', 'provincia',
      'telefono', 'movil', 'email', 'iban', 'nacionalidad', 'nivel_formativo', 'centro', 'convenio', 'categoria', 'puesto', 'sexo',
      'minusvalia', 'grupo_cotizacion', 'grupo_desc', 'primera_alta', 'en_alta_hoy'],
  },
  {
    id: 'contratos', nombre: 'Contratos', clase: 'tabla',
    columnas: ['trabajador', 'contrato_n', 'nombre', 'fecha_alta', 'fecha_fin', 'tipo_contrato', 'coef_parcial', 'grupo_cotizacion',
      'grupo_desc', 'puesto', 'centro', 'convenio'],
  },
  {
    id: 'nominas', nombre: 'Nominas', clase: 'tabla',
    columnas: ['anio', 'mes', 'trabajador', 'recibo', 'nombre', 'nif', 'Devengado', 'Base I.R.P.F.', 'Retención', 'Dinerario',
      'Ret.Din.', 'Especie', 'Ret.Esp.', 'Exento', 'Base C.C.', 'Base AA.TT.', 'S.S.Trab.', 'S.S.Emp.', 'S.S.Bruto.', 'S.S.Total',
      'Compens.', 'Bonificación', 'Exoneración', 'Prorratas', 'Deducciones', 'Líquido', 'Coste', 'Días', 'Laborables', 'Coef. T.P.'],
  },
  {
    id: 'nominas_conceptos', nombre: 'Nominas_conceptos', clase: 'tabla',
    columnas: ['anio', 'mes', 'trabajador', 'recibo', 'nombre', 'tipo', 'concepto_codigo', 'concepto', 'importe'],
  },
  {
    id: 'cuadre_contable', nombre: 'Cuadre_contable', clase: 'tabla',
    columnas: ['anio', 'mes', 'Nómina: devengado', 'Contab.: 640+641', 'Diferencia sueldos', 'Nómina: SS empresa', 'Contab.: 642',
      'de ello RETA autónomos', 'Diferencia SS (sin RETA)', 'Comentario'],
  },
]

/** Lo leído de una pestaña del fichero: su nombre, sus cabeceras (o nombres de campo) y cuántas filas de datos. */
export interface HojaLeida {
  nombre: string
  columnas: string[]
  filas: number
}

export type EstadoHoja = 'igual' | 'diferente' | 'falta' | 'sobra'

export interface ComparacionHoja {
  /** El id de la hoja esperada, o null si el fichero trae una que no se espera. */
  id: string | null
  nombre: string
  estado: EstadoHoja
  filas: number
  /** Las que se esperan y no vienen. */
  faltan: string[]
  /** Las que vienen y no se esperan. */
  nuevas: string[]
}

export interface Comparacion {
  hojas: ComparacionHoja[]
  /** true si no falta ninguna hoja y todas traen las columnas esperadas. */
  completa: boolean
  filas: number
}

/** Para comparar: sin mayúsculas, sin tildes y con los espacios y guiones bajos iguales. */
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s_]+/g, ' ').trim()
}

/** Compara lo leído con lo esperado. Enseña todas las hojas (regla 7): las iguales, las diferentes, las que faltan y las que sobran. */
export function compararCabeceras(leidas: readonly HojaLeida[], esperadas: readonly HojaEsperada[] = HOJAS_CEGID): Comparacion {
  const porNombre = new Map(leidas.map((h) => [normalizar(h.nombre), h]))
  const usadas = new Set<string>()
  const hojas: ComparacionHoja[] = esperadas.map((e) => {
    const h = porNombre.get(normalizar(e.nombre))
    if (!h) return { id: e.id, nombre: e.nombre, estado: 'falta', filas: 0, faltan: [...e.columnas], nuevas: [] }
    usadas.add(normalizar(h.nombre))
    const vienen = new Set(h.columnas.map(normalizar))
    const esperan = new Set(e.columnas.map(normalizar))
    const faltan = e.columnas.filter((c) => !vienen.has(normalizar(c)))
    const nuevas = h.columnas.filter((c) => normalizar(c) !== '' && !esperan.has(normalizar(c)))
    return { id: e.id, nombre: h.nombre, estado: faltan.length || nuevas.length ? 'diferente' : 'igual', filas: h.filas, faltan, nuevas }
  })
  for (const h of leidas) {
    if (usadas.has(normalizar(h.nombre))) continue
    hojas.push({ id: null, nombre: h.nombre, estado: 'sobra', filas: h.filas, faltan: [], nuevas: [...h.columnas] })
  }
  const completa = hojas.every((h) => h.estado === 'igual' || h.estado === 'sobra')
  return { hojas, completa, filas: hojas.reduce((n, h) => n + h.filas, 0) }
}

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

/** Lo que dice el botón al acabar (regla 8): con números, no un «Hecho». */
export function resumenComparacion(c: Comparacion): string {
  const cuenta = (e: EstadoHoja) => c.hojas.filter((h) => h.estado === e).length
  const leidas = c.hojas.filter((h) => h.estado !== 'falta').length
  const partes = [`Leídas ${plural(leidas, 'hoja', 'hojas')} y ${plural(c.filas, 'fila', 'filas')}`]
  const iguales = cuenta('igual'), diferentes = cuenta('diferente'), faltan = cuenta('falta'), sobran = cuenta('sobra')
  partes.push(`${iguales} de ${HOJAS_CEGID.length} como se esperaban`)
  if (diferentes) partes.push(`${plural(diferentes, 'con columnas distintas', 'con columnas distintas')}`)
  if (faltan) partes.push(`${plural(faltan, 'hoja que falta', 'hojas que faltan')}`)
  if (sobran) partes.push(`${plural(sobran, 'hoja que no se esperaba', 'hojas que no se esperaban')}`)
  return partes.join(' · ')
}
