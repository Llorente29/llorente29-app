// src/modules/conta/gestoria/paginas.tsx
//
// G01 · Tarea 4 · Las pantallas de la gestoría, con sus datos: Ventas ›
// Clientes y cuotas, sus Tarifas y el bloque de Ajustes › Cobros. Leen por
// gestoriaService y pintan con las piezas de esta carpeta (que no leen nada:
// así se prueban y se capturan con datos inventados).

import { useState } from 'react'
import { rutaTarifasGestoria } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { rpc } from '@/modules/conta/services/bd'
import {
  cambiarReintentos, conectarBitrix, conectarGocardless, guardarTarifa, leerBitrix, leerConexiones, leerGestoria, leerGocardless,
} from '@/modules/conta/services/gestoriaService'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ClientesCuotas } from './ClientesCuotas'
import { Tarifas } from './Tarifas'
import { CobrosGestoria } from './CobrosGestoria'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function ClientesCuotasPage() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const movil = useIsMobile()
  const d = useLeer(!cargando && accountId ? () => leerGestoria(accountId) : null, `${accountId}:gestoria`)
  const [leyendo, setLeyendo] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const leer = async () => {
    if (!accountId) return
    setLeyendo(true); setAviso(null)
    try { setAviso({ ok: true, texto: await leerBitrix(accountId) }); d.recargar() }
    catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setLeyendo(false) }
  }
  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los clientes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos) return <TarjetaCargando />
  return <ClientesCuotas datos={d.datos} emisores={empresas.map((e) => ({ id: e.id, nombre: e.nombre }))} mes={hoyEnMadrid().slice(0, 7)} movil={movil}
    rutaTarifas={rutaTarifasGestoria()} alLeer={() => void leer()} leyendo={leyendo} aviso={aviso} />
}

export function TarifasPage() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const d = useLeer(!cargando && accountId ? () => leerGestoria(accountId) : null, `${accountId}:gestoria-tarifas`)
  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer las tarifas: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos) return <TarjetaCargando />
  const vistos = new Map<string, string>()
  for (const f of d.datos.filas) if (f.clienteId) vistos.set(f.clienteId, f.nombre)
  const clientes = [...vistos.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return <Tarifas datos={d.datos} emisores={empresas.map((e) => ({ id: e.id, nombre: e.nombre }))} clientes={clientes} mes={hoyEnMadrid().slice(0, 7)}
    alGuardar={async (a) => { const r = await guardarTarifa(a); d.recargar(); return r }} />
}

/** En Ajustes › Cobros: solo en una cuenta de asesoría (conta_despacho_soy). */
export function CobrosGestoriaAjustes() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const d = useLeer(!cargando && accountId ? async () => {
    const soy = await rpc<{ asesoria?: boolean; clientes?: number } | null>('conta_despacho_soy', { p_account: accountId }).catch(() => null)
    if (!(soy?.asesoria === true || (soy?.clientes ?? 0) > 0)) return null
    return leerConexiones(accountId)
  } : null, `${accountId}:conexiones-gestoria`)
  if (d.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer GoCardless y Bitrix24: {d.error}</p>
  if (!d.datos || !accountId) return null
  const tras = async (p: Promise<string>) => { const f = await p; d.recargar(); return f }
  return <CobrosGestoria emisores={empresas.map((e) => ({ id: e.id, nombre: e.razonSocial ?? e.nombre }))} gocardless={d.datos.gocardless} bitrix={d.datos.bitrix}
    acciones={{
      conectarGc: (e, en, t) => tras(conectarGocardless(e, en, t)), leerGc: (e) => tras(leerGocardless(e)),
      reintentos: (e, on) => cambiarReintentos(e, on),
      conectarBitrix: (en, u) => tras(conectarBitrix(accountId, en, u)), leerBitrix: () => tras(leerBitrix(accountId)),
    }} />
}

