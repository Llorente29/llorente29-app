// src/modules/conta/gestoria/q10/pagina.tsx
//
// Q10 · «Las facturas de noviembre» con sus datos. Lee de Sumied (datos.ts) lo cobrado por GoCardless y, de lo leído
// de la facturación de Cegid (cegidService.ts, conta_cegid_*), el código de cliente de cada ficha, la retención de su
// última factura y la tabla de equivalencias. «Leer de Cegid» lo vuelve a leer por la conexión (conta-cegid-leer:
// solo lee). Pinta con FacturasDelMes.tsx y CegidQ10.tsx, que no leen nada.
// Respuesta 1 al Q10 (25/11): las facturas las emite Cegid; Sumied no emite ni numera.
// La empresa es la activa de Sumied (o la de ?empresa=) y el mes, el de hoy (o el de ?mes=AAAA-MM).

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { rutaApartadoEmpresa, rutaClientesCuotas } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { leerConexionCegid, leerGuardadoCegid, leerTodoCegid } from '@/modules/conta/services/cegidService'
import { facturaSumiedPdf } from '../../../../../supabase/functions/_shared/facturaSumiedPdf'
import { COBRADO, facturasDelMes, nombreDelMesQ10 } from './facturasDelMes'
import { leerFacturasDelMes } from './datos'
import { datosPdfQ10, emisorQ10 } from './pdf'
import { FacturasDelMes } from './FacturasDelMes'
import { CegidQ10 } from './CegidQ10'
import { codigosCegid, resumenCodigos, retencionesDeCegid, tablaEquivalencias } from './equivalencias'
import { retieneQ10 } from './serie'

export function FacturasQ10Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas, activa } = useEmpresas()
  const [params] = useSearchParams()
  const empresa = empresas.find((e) => e.id === params.get('empresa')) ?? activa
  const hoy = hoyEnMadrid()
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('mes') ?? '') ? params.get('mes')! : hoy.slice(0, 7)
  const anio = Number(mes.slice(0, 4))
  const [vuelta, setVuelta] = useState(0)
  const [lectura, setLectura] = useState<{ clave: string; estado: 'leyendo' | 'leido' | 'fallo'; frase: string } | null>(null)
  const clave = `${empresa?.id}:${mes}`
  const listo = !cargando && accountId && empresa
  const d = useLeer(listo ? () => leerFacturasDelMes(accountId, empresa.id, mes) : null, `${accountId}:${empresa?.id}:${mes}:q10`)
  // La conexión y lo leído de Cegid: si fallan (la base sin la 1840, sin permiso…), la página sigue y lo dice.
  const con = useLeer(listo ? () => leerConexionCegid(accountId, empresa.id) : null, `${accountId}:${empresa?.id}:q10-cegid-con`)
  const cg = useLeer(listo ? () => leerGuardadoCegid(empresa.id, anio) : null, `${empresa?.id}:${anio}:q10-cegid:${vuelta}`)
  const retiene = retieneQ10(d.datos?.empresa.tax_id)

  const cegid = useMemo(() => {
    if (!d.datos || !cg.datos || !cg.datos.clientes.length) return null
    const fichas = d.datos.fichas.map((f) => ({ partyId: f.partyId, nif: f.nif, cuenta430: d.datos!.cuentas.get(f.partyId) ?? null }))
    const codigos = codigosCegid(fichas, cg.datos.clientes)
    return { codigos, resumen: resumenCodigos(codigos).frase, retenciones: retencionesDeCegid(codigos, cg.datos.facturas) }
  }, [d.datos, cg.datos])

  const modelo = useMemo(() => {
    if (!d.datos || !empresa) return null
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones: cegid?.retenciones ?? new Map<string, number>() })
  }, [d.datos, empresa, mes, retiene, cegid])

  const tabla = useMemo(() => {
    if (!d.datos || !cg.datos || !cegid) return null
    const sus = new Map(d.datos.suscripciones.map((s) => [s.gcId, s]))
    const enl = new Map(d.datos.enlaces.map((e) => [e.gcClienteId, e]))
    const cobros = d.datos.cobros.filter((c) => c.fecha.slice(0, 7) === mes && (COBRADO as readonly string[]).includes(c.estado)).map((c) => {
      const s = c.suscripcionId ? sus.get(c.suscripcionId) : undefined
      const e = s?.gcClienteId ? enl.get(s.gcClienteId) : undefined
      return { partyId: e?.estado === 'atado' ? e.partyId : null, importe: c.importe, concepto: s?.nombre ?? null }
    })
    return tablaEquivalencias(cobros, cegid.codigos, cg.datos.clientes, cg.datos.conceptos, cg.datos.facturas)
  }, [d.datos, cg.datos, cegid, mes])

  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los cobros del mes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !empresa || !modelo) return <TarjetaCargando />
  const datos = d.datos
  const mandatos = new Map(datos.mandatos.map((m) => [m.gcId, m]))

  const leer = async () => {
    setLectura({ clave, estado: 'leyendo', frase: 'Entrando en la facturación de Cegid…' })
    try {
      const frase = await leerTodoCegid(empresa.id, anio, (f) => setLectura({ clave, estado: 'leyendo', frase: f }))
      setLectura({ clave, estado: 'leido', frase })
    } catch (e) {
      setLectura({ clave, estado: 'fallo', frase: `No se ha podido leer de Cegid: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setVuelta((v) => v + 1)
    }
  }

  const verPdf = async (i: number) => {
    const f = modelo.facturas[i]
    const m = f.cobro.mandatoId ? mandatos.get(f.cobro.mandatoId) : undefined
    const bytes = facturaSumiedPdf(jsPDF, datosPdfQ10(f, mes, { emisor: emisorQ10(datos.empresa), numero: null, fecha: hoy, cuenta: m?.final ? { pais: null, final: m.final } : null }))
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    const w = window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return w ? null : 'El navegador no ha dejado abrir el PDF en otra pestaña: permite las ventanas de esta página.'
  }

  const conectada = !!(con.datos?.conClaves && con.datos.codigo.trim())
  const bloqueCegid = (
    <CegidQ10 conectada={conectada} rutaConectar={rutaApartadoEmpresa('ejercicio')}
      lectura={lectura?.clave === clave ? { estado: lectura.estado, frase: lectura.frase } : con.error ? { estado: 'fallo', frase: `No se ha podido leer la conexión con Cegid: ${con.error}` } : cg.error ? { estado: 'fallo', frase: `No se ha podido leer lo leído de Cegid: ${cg.error}` } : null}
      leidoAt={cg.datos?.leidoAt ?? null} alLeer={() => void leer()} codigos={cegid?.resumen ?? null} tabla={tabla} />
  )

  return (
    <FacturasDelMes empresa={empresa.nombre} mes={nombreDelMesQ10(mes)} modelo={modelo} cegid={bloqueCegid} alVerPdf={verPdf}
      rutaVolver={rutaClientesCuotas()} rutaSinCliente={`${rutaClientesCuotas()}?ver=sin-cliente`} />
  )
}
