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
import { rutaApartadoEmpresa, rutaClientesCuotas } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { leerConexionCegid, leerGuardadoCegid, leerTodoCegid } from '@/modules/conta/services/cegidService'
import { COBRADO, facturasDelMes, nombreDelMesQ10 } from './facturasDelMes'
import { leerFacturasDelMes } from './datos'
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

  // La ficha de cada cobro (el atado de «Clientes y cuotas» y, si no, el enlace atado): la misma para todo lo de abajo.
  const base = useMemo(() => {
    if (!d.datos || !empresa) return null
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene: false }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones: new Map(), cobroCliente: d.datos.cobroCliente })
  }, [d.datos, empresa, mes])

  const cegid = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !cg.datos.clientes.length) return null
    // El código de Cegid de las fichas con algún cobro cobrado este mes (las que se facturan).
    const conCobro = new Map([...base.facturas.map((f) => f.ficha), ...base.pendientes.map((p) => p.ficha).filter((f): f is NonNullable<typeof f> => !!f)].map((f) => [f.partyId, f]))
    const fichas = [...conCobro.values()].map((f) => ({ partyId: f.partyId, nif: f.nif, cuenta430: d.datos!.cuentas.get(f.partyId) ?? null }))
    const codigos = codigosCegid(fichas, cg.datos.clientes)
    const sinCodigo = [...codigos].filter(([, c]) => c.codigo === null).map(([partyId, c]) => ({ nombre: conCobro.get(partyId)?.nombre ?? '', nif: conCobro.get(partyId)?.nif ?? null,
      cuenta430: d.datos!.cuentas.get(partyId) ?? null, porque: c.porque })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    return { codigos, resumen: resumenCodigos(codigos).frase, sinCodigo, retenciones: retencionesDeCegid(codigos, cg.datos.facturas) }
  }, [d.datos, base, cg.datos])

  const modelo = useMemo(() => {
    if (!d.datos || !empresa) return null
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones: cegid?.retenciones ?? new Map<string, number>(), cobroCliente: d.datos.cobroCliente })
  }, [d.datos, empresa, mes, retiene, cegid])

  const tabla = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !cegid) return null
    const sus = new Map(d.datos.suscripciones.map((s) => [s.gcId, s]))
    const fichaDe = new Map([...base.facturas.map((f) => [f.cobro.gcId, f.ficha.partyId] as const), ...base.pendientes.filter((p) => p.ficha).map((p) => [p.cobro.gcId, p.ficha!.partyId] as const)])
    const cobros = d.datos.cobros.filter((c) => c.fecha.slice(0, 7) === mes && (COBRADO as readonly string[]).includes(c.estado)).map((c) => ({
      partyId: fichaDe.get(c.gcId) ?? null, importe: c.importe, concepto: (c.suscripcionId ? sus.get(c.suscripcionId)?.nombre : null) ?? null }))
    return tablaEquivalencias(cobros, cegid.codigos, cg.datos.clientes, cg.datos.conceptos, cg.datos.facturas)
  }, [d.datos, base, cg.datos, cegid, mes])

  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los cobros del mes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !empresa || !modelo) return <TarjetaCargando />

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

  const conectada = !!(con.datos?.conClaves && con.datos.codigo.trim())
  const bloqueCegid = (
    <CegidQ10 conectada={conectada} rutaConectar={rutaApartadoEmpresa('ejercicio')}
      lectura={lectura?.clave === clave ? { estado: lectura.estado, frase: lectura.frase } : con.error ? { estado: 'fallo', frase: `No se ha podido leer la conexión con Cegid: ${con.error}` } : cg.error ? { estado: 'fallo', frase: `No se ha podido leer lo leído de Cegid: ${cg.error}` } : null}
      leidoAt={cg.datos?.leidoAt ?? null} alLeer={() => void leer()} codigos={cegid?.resumen ?? null} sinCodigo={cegid?.sinCodigo ?? null} tabla={tabla} />
  )

  return (
    <FacturasDelMes empresa={empresa.nombre} mes={nombreDelMesQ10(mes)} modelo={modelo} cegid={bloqueCegid}
      rutaVolver={rutaClientesCuotas()} rutaSinCliente={`${rutaClientesCuotas()}?ver=sin-cliente`} />
  )
}
