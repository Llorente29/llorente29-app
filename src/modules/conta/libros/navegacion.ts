// src/modules/conta/libros/navegacion.ts
//
// C05 · La regla de navegación del módulo en tres niveles (encargo §7, tomada
// de Cegid ERP despacho, maqueta N13cLibros):
//   1. el menú lateral de la app;
//   2. pestañas de área bajo el título de la sección;
//   3. barra de acciones agrupadas: cada acción con su nombre y una línea de
//      dato o estado, agrupadas con la etiqueta del grupo debajo, todas
//      visibles (nunca tras «···»); a la derecha, «Tuyos»: Favoritos y Buscar
//      (Ctrl K abre cualquier opción por su nombre).
// Dos clics como máximo a cualquier opción. Lo que la empresa no usa sale en
// gris con «ninguno» y no desaparece (son libros obligatorios: regla 7 de
// CLAUDE.md, un umbral ordena y no esconde).
//
// Núcleo puro: la estructura de Libros, los favoritos y la búsqueda. Las otras
// secciones se pasan a esta regla en el encargo de reorganización.

export interface Accion {
  id: string
  nombre: string
  /** Palabras con las que también se encuentra en «Buscar». */
  sinonimos?: string[]
  /** Lo que se construye en el C05b: sale con su estado y lo que falta. */
  c05b?: boolean
}
export interface Grupo { etiqueta: string; acciones: Accion[] }
export interface Area { id: string; nombre: string; grupos: Grupo[] }

export const AREAS_LIBROS: Area[] = [
  { id: 'diario', nombre: 'Diario', grupos: [
    { etiqueta: 'Diario', acciones: [
      { id: 'libro-diario', nombre: 'Libro diario', sinonimos: ['asientos', 'diario detallado'] },
      { id: 'diario-resumido', nombre: 'Diario resumido', sinonimos: ['resumen mensual'] },
    ] },
  ] },
  { id: 'mayor', nombre: 'Mayor y saldos', grupos: [
    { etiqueta: 'Cuentas', acciones: [
      { id: 'libro-mayor', nombre: 'Libro mayor', sinonimos: ['mayor', 'extracto de cuenta'] },
      { id: 'sumas-saldos', nombre: 'Sumas y saldos', sinonimos: ['balance de comprobación', 'balance de sumas y saldos'] },
      { id: 'acumulados', nombre: 'Acumulados', sinonimos: ['saldos por mes', 'evolución'] },
    ] },
  ] },
  { id: 'registro', nombre: 'Libros registro de IVA', grupos: [
    { etiqueta: 'Facturas', acciones: [
      { id: 'expedidas', nombre: 'Expedidas', sinonimos: ['facturas emitidas', 'ventas', 'libro de facturas expedidas'] },
      { id: 'recibidas', nombre: 'Recibidas', sinonimos: ['facturas recibidas', 'compras', 'gastos'] },
    ] },
    { etiqueta: 'Otros libros', acciones: [
      { id: 'bienes-inversion', nombre: 'Bienes de inversión', sinonimos: ['inmovilizado', 'regularización de bienes'] },
      { id: 'intracomunitarias', nombre: 'Intracomunitarias', sinonimos: ['operaciones intracomunitarias', 'art. 66'] },
      { id: 'suplidos', nombre: 'Suplidos', sinonimos: ['gastos suplidos'] },
      { id: 'retenciones', nombre: 'Retenciones', sinonimos: ['111', '115', 'irpf'] },
    ] },
    { etiqueta: 'Salidas', acciones: [
      { id: 'formato-aeat', nombre: 'Formato AEAT', sinonimos: ['requerimiento', 'exportar libros', 'excel hacienda'] },
    ] },
  ] },
  { id: 'balances', nombre: 'Balances', grupos: [
    { etiqueta: 'Estados', acciones: [
      { id: 'balance', nombre: 'Balance de situación', sinonimos: ['balance', 'activo', 'pasivo'] },
      { id: 'pyg', nombre: 'Pérdidas y ganancias', sinonimos: ['cuenta de resultados', 'pyg', 'resultado por local'] },
      { id: 'ecpn', nombre: 'Cambios en el patrimonio neto', sinonimos: ['ecpn', 'igrpn'] },
    ] },
    { etiqueta: 'Salidas', acciones: [
      { id: 'balances-pdf', nombre: 'PDF', sinonimos: ['imprimir balance'] },
      { id: 'balances-excel', nombre: 'Excel', sinonimos: ['exportar balance'] },
    ] },
  ] },
  { id: 'anuales', nombre: 'Cuentas anuales y Registro', grupos: [
    { etiqueta: 'Cuentas anuales', acciones: [
      { id: 'cuentas-anuales', nombre: 'Cuentas anuales del ejercicio', sinonimos: ['modelo', 'pymes', 'abreviado'] },
      { id: 'mapeo', nombre: 'Qué cuentas alimentan cada línea', sinonimos: ['configuración de cuentas anuales', 'mapeo'] },
    ] },
    { etiqueta: 'Registro Mercantil', acciones: [
      { id: 'memoria', nombre: 'Memoria y certificación', c05b: true, sinonimos: ['actas', 'certificación de acuerdos'] },
      { id: 'legalizacion', nombre: 'Legalización de libros', c05b: true, sinonimos: ['legalia'] },
      { id: 'deposito', nombre: 'Depósito de cuentas', c05b: true, sinonimos: ['registro mercantil', 'depositar'] },
    ] },
  ] },
  { id: 'cierre', nombre: 'Cierre', grupos: [
    { etiqueta: 'Cierre', acciones: [
      { id: 'ejercicios', nombre: 'Ejercicios', sinonimos: ['años', 'abrir ejercicio'] },
      { id: 'cerrar-mes', nombre: 'Cerrar el mes', sinonimos: ['bloquear mes'] },
      { id: 'cierre-ejercicio', nombre: 'Regularización, cierre y apertura', sinonimos: ['cerrar el ejercicio', 'asiento de apertura', 'regularización'] },
    ] },
  ] },
]

export const accionesDe = (area: Area): Accion[] => area.grupos.flatMap((g) => g.acciones)

/** El área y la acción de una ruta; sin acción, la primera del área. */
export function resolver(areaId: string | undefined, accionId: string | undefined): { area: Area; accion: Accion } {
  const area = AREAS_LIBROS.find((a) => a.id === areaId) ?? AREAS_LIBROS[0]
  const acciones = accionesDe(area)
  return { area, accion: acciones.find((x) => x.id === accionId) ?? acciones[0] }
}

/** Dónde está una acción (para Favoritos y Buscar, que saltan de área). */
export function dondeEsta(accionId: string): { area: Area; grupo: Grupo; accion: Accion } | null {
  for (const area of AREAS_LIBROS) for (const grupo of area.grupos) {
    const accion = grupo.acciones.find((a) => a.id === accionId)
    if (accion) return { area, grupo, accion }
  }
  return null
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Buscar (Ctrl K): por nombre, sinónimo, grupo o área; primero lo que empieza igual. */
export function buscar(q: string): { area: Area; grupo: Grupo; accion: Accion }[] {
  const n = normal(q)
  if (!n) return []
  const todo = AREAS_LIBROS.flatMap((area) => area.grupos.flatMap((grupo) => grupo.acciones.map((accion) => ({ area, grupo, accion }))))
  const puntos = (x: (typeof todo)[number]) => {
    const nombres = [x.accion.nombre, ...(x.accion.sinonimos ?? [])].map(normal)
    if (nombres.some((s) => s.startsWith(n))) return 3
    if (nombres.some((s) => s.includes(n))) return 2
    if (normal(x.grupo.etiqueta).includes(n) || normal(x.area.nombre).includes(n)) return 1
    return 0
  }
  return todo.map((x) => ({ x, p: puntos(x) })).filter((y) => y.p > 0).sort((a, b) => b.p - a.p).map((y) => y.x)
}

/** Favoritos de cada persona (en su navegador: es una comodidad, no un dato). */
const CLAVE = (usuario: string) => `folvy.conta.libros.favoritos.${usuario}`
export function leerFavoritos(usuario: string, almacen: Pick<Storage, 'getItem'> | null): string[] {
  try {
    const v = almacen?.getItem(CLAVE(usuario))
    const lista = v ? (JSON.parse(v) as unknown) : []
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string' && !!dondeEsta(x)) : []
  } catch { return [] }
}
export function alternarFavorito(usuario: string, accionId: string, almacen: Pick<Storage, 'getItem' | 'setItem'> | null): string[] {
  const actual = leerFavoritos(usuario, almacen)
  const nuevo = actual.includes(accionId) ? actual.filter((x) => x !== accionId) : [...actual, accionId]
  try { almacen?.setItem(CLAVE(usuario), JSON.stringify(nuevo)) } catch { /* sin almacén: solo en esta pantalla */ }
  return nuevo
}

/** El dato o estado de cada acción (lo pone la página con lo que lee). «ninguno» = gris, nunca escondido. */
export interface EstadoAccion { texto: string; tono: 'verde' | 'ambar' | 'gris' | 'rojo' }
export const NINGUNO: EstadoAccion = { texto: 'ninguno', tono: 'gris' }
