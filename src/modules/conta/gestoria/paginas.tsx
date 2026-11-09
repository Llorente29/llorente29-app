// src/modules/conta/gestoria/paginas.tsx
//
// G01 · Tarea 4 · Las pantallas de la gestoría, con sus datos: Ventas ›
// Clientes y cuotas, sus Tarifas y el bloque de Ajustes › Cobros. Leen por
// gestoriaService y pintan con las piezas de esta carpeta (que no leen nada:
// así se prueban y se capturan con datos inventados).

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { rutaAjustes, rutaTarifasGestoria } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { useGestoria } from '@/modules/conta/marco/nuevo/contexto'
import {
  altaEmpleado, aplicarUnion, bajaLinea, cambiarReintentos, conectarBitrix, confirmarMapaBitrix, confirmarMapaContactos, ensayoUnion, conectarGocardless, enlazar, guardarTarifa, leerBitrix, leerConexiones, leerGestoria, leerGocardless,
  lineaDesdeGc, noContar, revisada,
} from '@/modules/conta/services/gestoriaService'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ClientesCuotas } from './ClientesCuotas'
import { Tarifas } from './Tarifas'
import { CobrosGestoria } from './CobrosGestoria'
import { PagosConTarjeta } from './g05/PagosConTarjeta'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function ClientesCuotasPage() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const movil = useIsMobile()
  // Los clientes y lo conectado (cada conector se enciende aparte, por conexión).
  const d = useLeer(!cargando && accountId ? async () => {
    const [datos, conexiones] = await Promise.all([leerGestoria(accountId), leerConexiones(accountId)])
    return { datos, conectados: { gocardless: new Set(conexiones.gocardless.filter((g) => g.conectada).map((g) => g.emisorId)), bitrix: !!conexiones.bitrix?.conectada } }
  } : null, `${accountId}:gestoria`)
  const [leyendo, setLeyendo] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const leer = async () => {
    if (!accountId) return
    setLeyendo(true); setAviso(null)
    // Con Bitrix24, su lectura lanza después la de GoCardless; sin él, GoCardless de cada empresa conectada.
    try {
      const c = d.datos?.conectados
      const frases = c?.bitrix ? [await leerBitrix(accountId)] : await Promise.all([...(c?.gocardless ?? [])].map((e) => leerGocardless(e)))
      setAviso({ ok: true, texto: frases.join(' ') }); d.recargar()
    }
    catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setLeyendo(false) }
  }
  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los clientes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos) return <TarjetaCargando />
  return <ClientesCuotas datos={d.datos.datos} conectados={d.datos.conectados} rutaConectar={rutaAjustes('cobros')} emisores={empresas.map((e) => ({ id: e.id, nombre: e.nombre }))} mes={hoyEnMadrid().slice(0, 7)} movil={movil}
    rutaTarifas={rutaTarifasGestoria()} tarifasDe={(cliente, emisor) => `${rutaTarifasGestoria()}?${new URLSearchParams({ cliente, empresa: emisor })}`}
    acciones={{ altaEmpleado, bajaLinea, lineaDesdeGc, noContar, enlazar, revisada }} alHecho={() => d.recargar()} alLeer={() => void leer()} leyendo={leyendo} aviso={aviso} />
}

export function TarifasPage() {
  const { accountId, cargando } = useCuentaConta()
  const [params] = useSearchParams()
  const { empresas } = useEmpresas()
  const d = useLeer(!cargando && accountId ? () => leerGestoria(accountId) : null, `${accountId}:gestoria-tarifas`)
  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer las tarifas: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos) return <TarjetaCargando />
  const vistos = new Map<string, string>()
  for (const f of d.datos.filas) if (f.clienteId) vistos.set(f.clienteId, f.nombre)
  const clientes = [...vistos.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return <Tarifas datos={d.datos} emisores={empresas.map((e) => ({ id: e.id, nombre: e.nombre }))} clientes={clientes} mes={hoyEnMadrid().slice(0, 7)}
    inicial={{ cliente: params.get('cliente'), empresa: params.get('empresa') }}
    alGuardar={async (a) => { const r = await guardarTarifa(a); d.recargar(); return r }} />
}

/** En Ajustes › Cobros: solo si el sector de la empresa activa es Gestoría (G03). */
export function CobrosGestoriaAjustes() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const gestoria = useGestoria()
  // La clave lleva si es gestoría: el marco lo sabe un momento después de montar esto, y useLeer
  // solo vuelve a leer cuando cambia la clave (sin esto no se leía nunca y no salía nada de la gestoría).
  const d = useLeer(!cargando && accountId && gestoria === true ? () => leerConexiones(accountId) : null, `${accountId}:${gestoria}:${cargando}:conexiones-gestoria`)
  if (gestoria !== true) return null
  if (d.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer GoCardless y tu CRM: {d.error}</p>
  if (!d.datos || !accountId) return null
  const tras = async (p: Promise<string>) => { const f = await p; d.recargar(); return f }
  // nº 61 · «Pagos con tarjeta o Bizum»: una por empresa que cobra con GoCardless (sus devueltos se pagan desde el portal).
  const conCobro = empresas.filter((e) => d.datos!.gocardless.some((g) => g.emisorId === e.id && g.conectada))
  return <>
    <CobrosGestoria emisores={empresas.map((e) => ({ id: e.id, nombre: e.razonSocial ?? e.nombre }))} gocardless={d.datos.gocardless} bitrix={d.datos.bitrix}
      acciones={{
        conectarGc: (e, en, t) => tras(conectarGocardless(e, en, t)), leerGc: (e) => tras(leerGocardless(e)),
        reintentos: (e, on) => cambiarReintentos(e, on),
        conectarBitrix: (en, u) => tras(conectarBitrix(accountId, en, u)), leerBitrix: () => tras(leerBitrix(accountId)),
        confirmarMapa: (m) => tras(confirmarMapaBitrix(accountId, m)), confirmarMapaContactos: (m) => tras(confirmarMapaContactos(accountId, m)),
        ensayoUnion: () => ensayoUnion(accountId), aplicarUnion: () => tras(aplicarUnion(accountId)),
      }} />
    {conCobro.map((e) => <PagosConTarjeta key={e.id} empresa={e.id} nombreEmpresa={e.razonSocial ?? e.nombre} />)}
  </>
}

