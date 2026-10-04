// src/modules/conta/hooks/useFichaProveedor.ts
//
// Carga todo lo de una ficha de proveedor y ofrece guardar con las reglas del
// núcleo. Un solo sitio para web y móvil.
//
// Al abrir:
//   · si el NIF-IVA europeo está «pendiente» (VIES no contestó), se vuelve a
//     preguntar sola, sin bloquear nada (§5.3, respuesta 2 punto 4);
//   · se buscan datos para proponer (§5.4) solo si a la ficha le falta el
//     NIF, la razón social o la dirección.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContactoProveedor, FichaProveedor } from '@/modules/conta/types'
import {
  comprobarVies, contaActiva, guardarFicha, listarContactos, listarDocumentos, listarFacturas,
  listarLocales, listarPropuestas, listarProveedores, listarTiposGasto, obtenerFicha,
  refrescarPropuestas, tieneCertificadoBanco,
  type DocumentoProveedor, type FacturaDeProveedor, type Local, type Propuesta, type TipoGasto,
} from '@/modules/conta/services/proveedorService'
import { calcularCompletitud, type Completitud } from '@/modules/conta/lib/completitud'
import { calcularCifras, type CifrasFicha } from '@/modules/conta/lib/cifras'
import { detectarRepetidas, type Repetida } from '@/modules/conta/lib/repetidas'
import type { Aprendido } from '@/modules/conta/lib/aprendizaje'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { validarFicha, type ResultadoValidacion } from '@/modules/conta/lib/validacionesFicha'
import { leerOpcionesFicha } from '@/modules/conta/services/fichaTablasService'
import type { OpcionesFicha } from '@/modules/conta/lib/opcionesFicha'

export interface DatosFicha {
  ficha: FichaProveedor
  contactos: ContactoProveedor[]
  propuestas: Propuesta[]
  tiposGasto: TipoGasto[]
  locales: Local[]
  facturas: FacturaDeProveedor[]
  documentos: DocumentoProveedor[]
  /**
   * Los demás proveedores de la cuenta (no archivados): para el NIF repetido y
   * para poner primero lo que más se usa (tipo de gasto, IVA, retención, plazo).
   */
  otros: OtroDeLaCuenta[]
  conta: boolean
  /** IVA, retención, forma y plazo de pago, de las tablas generales del C00 (tarea 7). */
  opciones: OpcionesFicha
}

export interface OtroDeLaCuenta {
  id: string
  name: string
  taxId: string | null
  expenseCategoryId: string | null
  usualTaxRateIds: string[]
  irpfWithholdingPct: number | null
  paymentTermsDays: number | null
}

export interface UsoFicha {
  estado: 'cargando' | 'error' | 'listo' | 'no-existe'
  error: string | null
  datos: DatosFicha | null
  completitud: Completitud | null
  /** Las facturas que repiten número e importe de otra anterior: no cuentan en ninguna cifra (C01b §4). */
  repetidas: Map<string, Repetida>
  /** Sin las repetidas. */
  cifras: CifrasFicha | null
  /** «Lo que he aprendido de este proveedor» (C01b §4). */
  aprendidos: Aprendido[]
  comprobandoVies: boolean
  /** Vuelve a leer sin enseñar el esqueleto (tras guardar). */
  recargar: () => Promise<void>
  /** Tras un error: esqueleto y vuelta a empezar. */
  reintentar: () => void
  /** Valida con el núcleo y guarda. Devuelve los problemas; si hay errores, no guarda. */
  guardar: (cambios: Partial<FichaProveedor>) => Promise<ResultadoValidacion>
  /** Pide a VIES que compruebe el NIF-IVA (en el servidor). */
  comprobarNifUe: () => Promise<void>
}

const FALTA_PARA_PROPONER = (f: FichaProveedor) =>
  !f.taxId?.trim() || !f.legalName?.trim() || !f.fiscalStreet?.trim()

// Se rellena con la tarea 5 del C01b (tabla y funciones de lo aprendido).
const SIN_APRENDIDOS: Aprendido[] = []

type Lectura = { tipo: 'listo'; datos: DatosFicha } | { tipo: 'no-existe' }

/** Todo lo de la ficha, sin tocar estado de React. */
async function leerFicha(
  accountId: string, supplierId: string, yaPropuesto: { current: string | null },
): Promise<Lectura> {
  const ficha = await obtenerFicha(supplierId)
  if (!ficha || ficha.accountId !== accountId) return { tipo: 'no-existe' }
  if (yaPropuesto.current !== supplierId && FALTA_PARA_PROPONER(ficha)) {
    yaPropuesto.current = supplierId
    // Si falla, la ficha se abre igual: proponer es una ayuda, no un requisito.
    await refrescarPropuestas(supplierId).catch(() => 0)
  }
  // Primero las tablas: de ellas sale la empresa, y con ella qué tipos de gasto ocultó.
  const opciones = await leerOpcionesFicha(accountId, hoyEnMadrid())
  const [contactos, propuestas, tiposGasto, locales, facturas, documentos, todos, conta] = await Promise.all([
    listarContactos(supplierId),
    listarPropuestas(supplierId),
    listarTiposGasto(accountId, opciones.empresa?.id ?? null),
    listarLocales(accountId),
    listarFacturas(accountId, supplierId),
    listarDocumentos(accountId, supplierId),
    listarProveedores(accountId),
    contaActiva(accountId),
  ])
  const otros = todos.map((p) => ({
    id: p.id, name: p.name, taxId: p.taxId, expenseCategoryId: p.expenseCategoryId, usualTaxRateIds: p.usualTaxRateIds,
    irpfWithholdingPct: p.irpfWithholdingPct, paymentTermsDays: p.paymentTermsDays,
  }))
  return { tipo: 'listo', datos: { ficha, contactos, propuestas, tiposGasto, locales, facturas, documentos, otros, conta, opciones } }
}

export function useFichaProveedor(accountId: string | null, supplierId: string): UsoFicha {
  const [estado, setEstado] = useState<UsoFicha['estado']>('cargando')
  const [error, setError] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosFicha | null>(null)
  const [comprobandoVies, setComprobandoVies] = useState(false)
  const yaPropuesto = useRef<string | null>(null)
  const yaVies = useRef<string | null>(null)

  // Lee y aplica. El efecto aplica el resultado en el `.then` (no cambia estado
  // en su cuerpo: react-hooks/set-state-in-effect); el estado inicial ya es
  // «cargando», la página monta la ficha con key={supplierId} (otro proveedor =
  // estado nuevo) y «Reintentar» pone el esqueleto desde el botón.
  const aplicar = useCallback((r: Lectura) => {
    if (r.tipo === 'no-existe') { setDatos(null); setEstado('no-existe') }
    else { setDatos(r.datos); setEstado('listo') }
  }, [])
  const fallar = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'No se pudo abrir la ficha.')
    setEstado('error')
  }, [])

  const cargar = useCallback(async () => {
    if (!accountId) return
    try { aplicar(await leerFicha(accountId, supplierId, yaPropuesto)) } catch (e) { fallar(e) }
  }, [accountId, supplierId, aplicar, fallar])

  useEffect(() => {
    if (!accountId) return
    let vivo = true
    leerFicha(accountId, supplierId, yaPropuesto)
      .then((r) => { if (vivo) aplicar(r) })
      .catch((e) => { if (vivo) fallar(e) })
    return () => { vivo = false }
  }, [accountId, supplierId, aplicar, fallar])

  const comprobarNifUe = useCallback(async () => {
    setComprobandoVies(true)
    try {
      await comprobarVies(supplierId)
      await cargar()
    } finally {
      setComprobandoVies(false)
    }
  }, [supplierId, cargar])

  // Reintento solo: un NIF-IVA que quedó «pendiente» se vuelve a preguntar al abrir.
  useEffect(() => {
    const f = datos?.ficha
    if (!f || f.taxIdType !== 'vat_eu' || !f.taxId) return
    if (f.taxIdCheckStatus !== 'pending' && f.taxIdCheckStatus !== null) return
    if (yaVies.current === f.id) return
    yaVies.current = f.id
    // Fuera del cuerpo del efecto: la comprobación cambia estado («Comprobando
    // con la UE…») y no debe hacerlo en el mismo render que la ha disparado.
    const t = window.setTimeout(() => { void comprobarNifUe() }, 0)
    return () => window.clearTimeout(t)
  }, [datos?.ficha, comprobarNifUe])

  const guardar = useCallback(async (cambios: Partial<FichaProveedor>): Promise<ResultadoValidacion> => {
    if (!datos) return { errores: [{ campo: 'name', mensaje: 'La ficha no está cargada.' }], avisos: [] }
    const propuesta: FichaProveedor = { ...datos.ficha, ...cambios }
    const r = validarFicha(propuesta, datos.otros)
    if (r.errores.length > 0) return r
    const guardada = await guardarFicha(datos.ficha.id, cambios)
    setDatos((d) => (d ? { ...d, ficha: guardada } : d))
    // Un NIF-IVA europeo nuevo o cambiado se comprueba en VIES después de guardarlo.
    const cambiaNifUe = guardada.taxIdType === 'vat_eu' && guardada.taxIdCheckStatus === 'pending'
    if (cambiaNifUe) { yaVies.current = guardada.id; void comprobarNifUe() }
    return r
  }, [datos, comprobarNifUe])

  const completitud = useMemo(() => datos
    ? calcularCompletitud({ ficha: datos.ficha, contactos: datos.contactos, tieneCertificadoBanco: tieneCertificadoBanco(datos.documentos) })
    : null, [datos])

  const repetidas = useMemo(() => datos
    ? detectarRepetidas(datos.facturas.map((f) => ({ id: f.id, number: f.invoiceNumber, total: f.grandTotal, status: f.status, createdAt: f.createdAt })))
    : new Map<string, Repetida>(), [datos])

  // Una repetida no se apunta: no cuenta en «Le has comprado», «Le debes» ni el próximo pago.
  const cifras = useMemo(() => datos ? calcularCifras(datos.facturas.filter((f) => !repetidas.has(f.id)), hoyEnMadrid()) : null, [datos, repetidas])

  return {
    estado, error, datos, completitud, repetidas, cifras, comprobandoVies,
    aprendidos: SIN_APRENDIDOS,
    recargar: () => cargar(),
    reintentar: () => { setEstado('cargando'); setError(null); void cargar() },
    guardar,
    comprobarNifUe,
  }
}
