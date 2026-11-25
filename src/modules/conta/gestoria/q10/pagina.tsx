// src/modules/conta/gestoria/q10/pagina.tsx
//
// Q10 · «Las facturas de noviembre» con sus datos. Lee de Sumied (datos.ts) y,
// al pulsar «Leer de ERP10», las facturas emitidas de ERP10 por la conexión:
// las del mes (el último número de la serie) y, en la empresa que retiene, las
// de los meses de antes hasta dar con la última de cada cliente (su
// retención). Pinta con FacturasDelMes.tsx, que no lee nada. SOLO LEE.
// La empresa es la activa de Sumied (o la de ?empresa=) y el mes, el de hoy
// (o el de ?mes=AAAA-MM).

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { rutaClientesCuotas } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { facturaSumiedPdf } from '../../../../../supabase/functions/_shared/facturaSumiedPdf'
import { comprobarSerie, cuentasDeErp10, facturasDelMes, numeroQ10, nifLimpio, nombreDelMesQ10, numerar, partirNumero, retencionesDeErp10, ultimaDeErp10, type FacturaErp10Q10 } from './facturasDelMes'
import { emitirPorTrozos } from './emitir'
import { emitirTrozo, facturasErp10DelMes, leerFacturasDelMes, mesesHaciaAtras } from './datos'
import { datosPdfQ10, emisorQ10 } from './pdf'
import { FacturasDelMes, type Erp10Q10 } from './FacturasDelMes'
import { SERIE_Q10, retieneQ10 } from './serie'

export function FacturasQ10Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas, activa } = useEmpresas()
  const [params] = useSearchParams()
  const empresa = empresas.find((e) => e.id === params.get('empresa')) ?? activa
  const hoy = hoyEnMadrid()
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('mes') ?? '') ? params.get('mes')! : hoy.slice(0, 7)
  const d = useLeer(!cargando && accountId && empresa ? () => leerFacturasDelMes(accountId, empresa.id, mes) : null, `${accountId}:${empresa?.id}:${mes}:q10`)
  const [erp, setErp] = useState<{ clave: string; estado: Erp10Q10['estado']; frase: string; facturas: FacturaErp10Q10[] } | null>(null)
  const clave = `${empresa?.id}:${mes}`
  const deEsta = erp?.clave === clave ? erp : null
  const retiene = retieneQ10(d.datos?.empresa.tax_id)
  const serie = empresa ? SERIE_Q10[empresa.id] ?? null : null

  const modelo = useMemo(() => {
    if (!d.datos || !empresa) return null
    const leido = deEsta?.estado === 'leido'
    const retenciones = retiene && leido ? retencionesDeErp10(deEsta.facturas, d.datos.fichas) : new Map<string, number>()
    // La 430 de cada cliente: la suya en Sumied; si no tiene, la de su última factura en ERP10 (la da de alta la emisión).
    const cuentas = new Map([...(leido ? cuentasDeErp10(deEsta.facturas, d.datos.fichas) : new Map<string, string>()), ...d.datos.cuentas])
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones, emitidas: d.datos.emitidas, cuentas })
  }, [d.datos, empresa, mes, retiene, deEsta])

  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los cobros del mes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !empresa || !modelo) return <TarjetaCargando />
  const datos = d.datos

  const leerErp10 = async () => {
    const leidas: FacturaErp10Q10[] = []
    const poner = (estado: Erp10Q10['estado'], frase: string) => setErp({ clave, estado, frase, facturas: [...leidas] })
    try {
      // Con retención: hasta dar con la última factura de cada cliente que tiene cobros este mes, o hasta enero.
      // Y la 430 de los que no la tienen en Sumied.
      const buscados = new Set(modelo.pendientes.filter((p) => (p.motivo === 'sin_cuenta' || (retiene && p.motivo === 'sin_retencion')) && p.ficha?.nif).map((p) => nifLimpio(p.ficha!.nif)))
      for (const m of mesesHaciaAtras(mes)) {
        poner('leyendo', `Leyendo de ERP10 las facturas de ${nombreDelMesQ10(m)}… (${leidas.length} leídas)`)
        const xs = await facturasErp10DelMes(empresa.id, m)
        leidas.push(...xs)
        for (const x of xs) buscados.delete(nifLimpio(x.nif))
        const conSerie = leidas.some((x) => { const n = partirNumero(x.numero); return !!n && n.anio === Number(mes.slice(0, 4)) && (!serie || n.serie === serie.serie) })
        if (conSerie && buscados.size === 0) break
      }
      const meses = new Set(leidas.map((x) => String(x.fecha).slice(0, 6))).size
      poner('leido', `Leídas de ERP10 ${leidas.length} facturas emitidas${meses ? ` de ${meses} ${meses === 1 ? 'mes' : 'meses'}` : ''}.${retiene ? ' La retención de cada cliente es la de su última factura.' : ''}`)
    } catch (e) {
      poner('fallo', `No se ha podido leer ERP10: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Sin la serie que dijo Julio (una empresa que no es de las dos), se propone seguir la de ERP10, y se dice.
  const ultimaErp = deEsta?.estado === 'leido' ? ultimaDeErp10(deEsta.facturas.map((x) => x.numero), Number(mes.slice(0, 4))) : null
  const sigue = serie ?? (ultimaErp ? { anio: ultimaErp.anio, serie: ultimaErp.serie, desde: ultimaErp.numero + 1 } : null)
  // Con facturas ya emitidas por Sumied: la última de ERP10 puede ser la de antes de la primera o una de las de Sumied
  // (cuando ya han salido a ERP10), nunca una de más allá.
  const anio = Number(mes.slice(0, 4))
  const maxEmitida = Math.max(0, ...modelo.emitidas.map((x) => partirNumero(x.numero)?.numero ?? 0))
  const comprobacion = deEsta?.estado !== 'leido' ? null
    : serie && maxEmitida > 0 ? (ultimaErp && ultimaErp.numero >= serie.desde - 1 && ultimaErp.numero <= maxEmitida
        ? { ok: true, frase: `Sumied va por la ${numeroQ10(anio, serie.serie, maxEmitida)} y la última en ERP10 es la ${numeroQ10(anio, ultimaErp.serie, ultimaErp.numero)}: la siguiente será la ${numeroQ10(anio, serie.serie, maxEmitida + 1)}.` }
        : { ok: false, frase: `Sumied va por la ${numeroQ10(anio, serie.serie, maxEmitida)} y en ERP10 la última es la ${ultimaErp ? numeroQ10(anio, ultimaErp.serie, ultimaErp.numero) : 'ninguna'}: no cuadra. No se emite.` })
    : serie ? comprobarSerie(deEsta.facturas.map((x) => x.numero), serie)
    : ultimaErp ? { ok: false, frase: `Para esta empresa no hay un número de partida dicho: se seguiría la serie de ERP10 desde la ${ultimaErp.anio}/${ultimaErp.serie}/${ultimaErp.numero + 1}. Antes de emitir, que lo confirme Julio.` }
    : { ok: false, frase: `En ERP10 no hay facturas de ${mes.slice(0, 4)}: no se sabe por dónde sigue la serie.` }
  const estadoErp: Erp10Q10 = deEsta
    ? { estado: deEsta.estado, frase: deEsta.frase, serie: comprobacion }
    : { estado: 'sin_leer', frase: retiene
        ? 'Esta empresa factura con retención: hasta leer de ERP10 la última factura de cada cliente, sus facturas esperan en «Pendiente de revisar». Y se comprueba el último número de la serie.'
        : 'Antes de emitir se comprueba en ERP10 el último número de la serie.', serie: null }
  const desde = sigue ? Math.max(sigue.desde, maxEmitida + 1) : null
  const numeros = sigue && desde ? numerar(modelo.facturas, sigue.anio, sigue.serie, desde) : null

  // Emitir: con la serie comprobada en ERP10 y una empresa con su serie dicha. Por trozos de 10, cada uno entero o nada.
  const puede = !!(serie && desde && comprobacion?.ok && ultimaErp && modelo.facturas.length > 0)
  const porque = !serie ? 'Esta empresa no tiene un número de partida dicho por Julio: no se emite.'
    : deEsta?.estado !== 'leido' ? 'Antes de emitir, lee de ERP10: se comprueba el último número de la serie.'
    : !comprobacion?.ok ? 'La serie no cuadra con ERP10: no se emite.'
    : modelo.facturas.length === 0 ? 'No hay facturas por emitir.' : ''
  const emitir = async (avance: (frase: string) => void): Promise<string> => {
    if (!puede || !serie || !desde || !ultimaErp) throw new Error(porque || 'No se puede emitir.')
    const ultimo = numeroQ10(anio, ultimaErp.serie, ultimaErp.numero)
    const deErp10 = cuentasDeErp10(deEsta!.facturas, datos.fichas)
    const todas = modelo.facturas.map((f) => ({ gc_id: f.cobro.gcId, retencion_pct: f.retencion?.pct ?? 0, cuenta_cliente: datos.cuentas.has(f.ficha.partyId) ? null : (deErp10.get(f.ficha.partyId) ?? null) }))
    try {
      return await emitirPorTrozos(todas, desde, nombreDelMesQ10(mes), (de, trozo) => emitirTrozo(empresa.id, mes, de, ultimo, trozo), avance)
    } finally {
      d.recargar()
    }
  }
  const mandatos = new Map(datos.mandatos.map((m) => [m.gcId, m]))

  const verPdf = async (i: number) => {
    const f = modelo.facturas[i]
    const m = f.cobro.mandatoId ? mandatos.get(f.cobro.mandatoId) : undefined
    const bytes = facturaSumiedPdf(jsPDF, datosPdfQ10(f, mes, { emisor: emisorQ10(datos.empresa), numero: null, fecha: hoy, cuenta: m?.final ? { pais: null, final: m.final } : null }))
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    const w = window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return w ? null : 'El navegador no ha dejado abrir el PDF en otra pestaña: permite las ventanas de esta página.'
  }

  return (
    <FacturasDelMes empresa={empresa.nombre} mes={nombreDelMesQ10(mes)} modelo={modelo} numeros={numeros} erp10={estadoErp}
      alLeerErp10={() => void leerErp10()} alVerPdf={verPdf}
      emitir={{ puede, porque, cuantas: modelo.facturas.length, primera: numeros?.[0] ?? null, ultima: numeros?.[numeros.length - 1] ?? null, totalCent: modelo.facturas.reduce((t, f) => t + f.totalCent, 0), fecha: hoy }}
      alEmitir={emitir}
      rutaVolver={rutaClientesCuotas()} rutaSinCliente={`${rutaClientesCuotas()}?ver=sin-cliente`} />
  )
}
