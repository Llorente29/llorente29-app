// src/modules/conta/services/cifrasService.ts
//
// S02 · PR 3 («las cifras»): las tres lecturas de una sola fuente por
// concepto, de la tanda 0490 (20261205T0490_s02_cifras.sql). Los nombres de la
// base van AQUÍ y solo aquí (regla 40: dentro de cadenas no los mira nadie;
// cotejados contra el contrato del PR 3, no contra la base: la tanda aún no
// está aplicada):
//
//   conta_pendientes(p_company uuid) → jsonb
//     { compras_decidir, facturas_para_mirar, facturas_por_aclarar,
//       asientos_por_validar, bancos_confirmar, bancos_aclarar, bancos_validar }
//     (o, en vez de compras_decidir, compras_filas: lo de compras_mirar sin
//     agrupar, y se agrupa aquí con agruparAMirar)
//   conta_saldo_bancos(p_company uuid, p_hasta date) → treasury_account_id,
//     nombre, cuenta, libro_validado, libro_propuesto, extracto_saldo,
//     extracto_hasta, sin_casar, sin_casar_n
//   conta_saldos_terceros(p_company uuid, p_hasta date) → cuenta, nombre,
//     party_id, grupo, saldo_deudor, saldo_acreedor
//
// Las tres comprueban el permiso en la base (la cuenta de la empresa): por eso
// basta la empresa. Mientras una no exista en esa base (staging antes de
// aplicar), su lectura cae a la cuenta de hoy y lo dice en la consola, como
// leerEsperan en useCuentasMenu: quien llama recibe `fuente: 'hoy'`.

import { rpc } from '@/modules/conta/services/bd'
import { saldosCuentas, aSaldoCuenta } from '@/modules/conta/services/librosService'
import { agruparAMirar, type Mirar } from '@/modules/conta/lib/compras'
import { filaDeSaldo, grupoDeCuenta, type GrupoTercero, type Pendientes, type SaldoBanco, type SaldoTercero } from '@/modules/conta/lib/cifrasLibro'

type Fila = Record<string, unknown>

export const FUNCIONES_CIFRAS = {
  pendientes: 'conta_pendientes',
  saldoBancos: 'conta_saldo_bancos',
  saldosTerceros: 'conta_saldos_terceros',
} as const

export type Fuente = 'base' | 'hoy'

const entero = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Math.max(0, Math.round(Number(v))))
const numero = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v))
const numeroO = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const avisar = (funcion: string, e: unknown) =>
  console.warn(`[cifras] no se pudo leer ${funcion} (¿aún no está en esta base?): cuento como hoy`, e)

/** Lo que devuelve conta_pendientes, en camelCase. Una clave que falta o es null: no se ha podido contar. */
export function dePendientes(j: Fila | null | undefined): Pendientes {
  const o = j ?? {}
  const filas = o.compras_filas as Mirar | null | undefined
  return {
    // La 0490 devuelve compras_decidir SIEMPRE null y las filas crudas en compras_filas:
    // el número lo da agruparAMirar, la vara de la pantalla de Compras.
    comprasDecidir: entero(o.compras_decidir)
      ?? (filas ? agruparAMirar({ recepciones: filas.recepciones ?? [], sin_camino: filas.sin_camino ?? [], fichas: filas.fichas ?? [] }).length : null),
    facturasParaMirar: entero(o.facturas_para_mirar),
    facturasPorAclarar: entero(o.facturas_por_aclarar),
    asientosPorValidar: entero(o.asientos_por_validar),
    bancosConfirmar: entero(o.bancos_confirmar),
    bancosAclarar: entero(o.bancos_aclarar),
    bancosValidar: entero(o.bancos_validar),
  }
}

/** conta_pendientes de la empresa, o null si no se puede leer (y quien llama cuenta como hoy). */
export async function leerPendientes(companyId: string): Promise<Pendientes | null> {
  try {
    return dePendientes(await rpc<Fila | null>(FUNCIONES_CIFRAS.pendientes, { p_company: companyId }))
  } catch (e) {
    avisar(FUNCIONES_CIFRAS.pendientes, e)
    return null
  }
}

export function deSaldoBanco(f: Fila): SaldoBanco {
  return {
    treasuryAccountId: texto(f.treasury_account_id), nombre: texto(f.nombre) ?? String(f.cuenta ?? ''), cuenta: String(f.cuenta ?? ''),
    libroValidado: numeroO(f.libro_validado), libroPropuesto: numeroO(f.libro_propuesto),
    extractoSaldo: numeroO(f.extracto_saldo), extractoHasta: texto(f.extracto_hasta),
    sinCasar: numeroO(f.sin_casar), sinCasarN: numeroO(f.sin_casar_n),
  }
}

const GRUPOS: readonly GrupoTercero[] = ['cliente', 'proveedor', 'acreedor', 'anticipo', 'por_localizar']

export function deSaldoTercero(f: Fila): SaldoTercero {
  const cuenta = String(f.cuenta ?? ''); const nombre = texto(f.nombre) ?? ''
  const g = texto(f.grupo)
  return {
    cuenta, nombre, partyId: texto(f.party_id),
    grupo: g && (GRUPOS as readonly string[]).includes(g) ? (g as GrupoTercero) : grupoDeCuenta(cuenta, nombre),
    saldoDeudor: numero(f.saldo_deudor), saldoAcreedor: numero(f.saldo_acreedor),
  }
}

/** La cuenta de hoy: los saldos de balance del libro (conta_saldos_cuentas, lo validado) por subcuenta a `hasta`. */
async function saldosDeHoy(companyId: string, hasta: string) {
  const s = await saldosCuentas(companyId, `${hasta.slice(0, 7)}-01`, hasta)
  return s.map((x) => ({ ...aSaldoCuenta(x, 'balance'), name: x.name }))
}

/**
 * Una fila por banco (conta_saldo_bancos). La cuenta de hoy, si no está:
 * la 572 de cada banco del libro (lo validado), sin propuestos ni extracto
 * (no los sabe: null, y la pantalla no los inventa).
 */
export async function leerSaldoBancos(companyId: string, hasta: string): Promise<{ filas: SaldoBanco[]; fuente: Fuente }> {
  try {
    const filas = (await rpc<Fila[] | null>(FUNCIONES_CIFRAS.saldoBancos, { p_company: companyId, p_hasta: hasta })) ?? []
    return { filas: filas.map(deSaldoBanco), fuente: 'base' }
  } catch (e) {
    avisar(FUNCIONES_CIFRAS.saldoBancos, e)
    const s = await saldosDeHoy(companyId, hasta)
    return {
      fuente: 'hoy',
      filas: s.filter((x) => (x.templateCode ?? x.code).startsWith('572')).map((x) => ({
        treasuryAccountId: null, nombre: x.name, cuenta: x.code, libroValidado: Math.round((x.debe - x.haber) * 100) / 100,
        libroPropuesto: null, extractoSaldo: null, extractoHasta: null, sinCasar: null, sinCasarN: null,
      })),
    }
  }
}

/**
 * Solo la de la base: las filas de conta_saldo_bancos, o null si aún no está
 * (sin cuenta de hoy: Bancos ya tiene la suya, y no se lee dos veces).
 */
export async function leerSaldoBancosSiEsta(companyId: string, hasta: string): Promise<SaldoBanco[] | null> {
  try {
    const filas = (await rpc<Fila[] | null>(FUNCIONES_CIFRAS.saldoBancos, { p_company: companyId, p_hasta: hasta })) ?? []
    return filas.map(deSaldoBanco)
  } catch (e) {
    avisar(FUNCIONES_CIFRAS.saldoBancos, e)
    return null
  }
}

/**
 * El saldo del libro por subcuenta de 40/41/43/44 (conta_saldos_terceros). La
 * cuenta de hoy, si no está: los mismos saldos por subcuenta del libro, con el
 * grupo por su código, pero sin el contacto (party_id null: Contactos sigue
 * con su cuenta de hoy).
 */
export async function leerSaldosTerceros(companyId: string, hasta: string): Promise<{ filas: SaldoTercero[]; fuente: Fuente }> {
  try {
    const filas = (await rpc<Fila[] | null>(FUNCIONES_CIFRAS.saldosTerceros, { p_company: companyId, p_hasta: hasta })) ?? []
    return { filas: filas.map(deSaldoTercero), fuente: 'base' }
  } catch (e) {
    avisar(FUNCIONES_CIFRAS.saldosTerceros, e)
    const s = await saldosDeHoy(companyId, hasta)
    return {
      fuente: 'hoy',
      filas: s.filter((x) => /^4[0134]/.test(x.code))
        .map((x) => filaDeSaldo(x.code, x.name, x.debe - x.haber))
        .filter((f) => f.grupo !== null && (f.saldoDeudor !== 0 || f.saldoAcreedor !== 0)),
    }
  }
}
