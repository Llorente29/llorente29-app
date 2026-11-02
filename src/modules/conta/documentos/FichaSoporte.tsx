// src/modules/conta/documentos/FichaSoporte.tsx
//
// S01g · La ficha de una recepción de soporte de la liquidación mensual de un
// socio (CTB), en Facturas recibidas › Otras. Fiel a la maqueta «Sumied ·
// S01g · Recepción de soporte de la liquidación» (visto bueno de Julio, 31/10):
//
//   · el aviso: «No se apunta como compra: entra en la contabilidad con la
//     liquidación mensual de …» (sin nombrar ninguna cuenta);
//   · con su liquidación: con cuál cuadra y el cruce producto a producto, en
//     cantidad y precio (soporte.ts: lo de esta recepción, lo del mes y lo de la
//     Relación); «Ver la liquidación de octubre» y «Aclarar los N en la
//     liquidación»;
//   · sin ella: que aún no ha llegado, «Subir la liquidación de octubre» y lo que
//     trae la recepción;
//   · Más acciones: «Ver el albarán» y «No es soporte de …» (pide confirmar y
//     dice «Vuelve a Por aclarar»).

import { useState } from 'react'
import { CONTA, rutaConta, rutaLiquidacion } from '@/config/navegacion'
import { EncabezadoPagina, BotonPulgar } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, BotonEnlace, Chip, Dialogo } from '@/modules/conta/diseno'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { DialogoPapel } from '@/modules/conta/compras/VerPapel'
import { etiquetaSoporte, mesLargoDe, nombreCortoProveedor, type FilaDocumento, type Soporte } from '@/modules/conta/documentos/documentos'
import { cruceDeLaRecepcion, lineasDeLaRecepcion, resumenDelCruce } from '@/modules/conta/documentos/soporte'
import { lineasDelSocio, lineasDeRecepciones, relacionDeLiquidacion } from '@/modules/conta/services/liquidacionesVentasService'
import { recepcionNoEsSoporte } from '@/modules/conta/services/documentosService'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'

const num = (x: number | null | undefined, d = 2) => x == null ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d })
const cp = (x: { cantidad: number | null; precio: number | null } | null, u: string) => x ? `${num(x.cantidad, 3)} ${u}${x.precio == null ? '' : ` · ${eurosExactos(x.precio)}`}` : '—'
const fechaCorta = (f: string) => f.split('-').reverse().join('/')

async function leerFichaSoporte(accountId: string, fila: FilaDocumento, s: Soporte) {
  if (s.liquidacion) {
    const [relacion, socio] = await Promise.all([relacionDeLiquidacion(accountId, s.liquidacion.id), lineasDelSocio(accountId, s.liquidacion.id)])
    const cruce = cruceDeLaRecepcion(s.codigo ?? '', relacion, socio.casados, socio.lineas)
    // Si la Relación no está, lo que trae la recepción (sus líneas, del mismo cruce).
    return { cruce, lineas: lineasDeLaRecepcion(s.codigo, socio.lineas) }
  }
  const lineas = await lineasDeRecepciones(accountId, new Map([[fila.id, s.codigo]]))
  return { cruce: null, lineas: lineasDeLaRecepcion(s.codigo, lineas) }
}

export function FichaSoporte({ accountId, fila, alVolver, alCambiar }: {
  accountId: string; fila: FilaDocumento; alVolver: string; alCambiar: (mensaje: string) => void
}) {
  const s = fila.soporte!
  const movil = useIsMobile()
  const datos = useLeer(() => leerFichaSoporte(accountId, fila, s), `${fila.id}:${s.liquidacion?.id ?? '-'}`)
  const [papel, setPapel] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prov = nombreCortoProveedor(s.proveedor)
  const mes = mesLargoDe(s.mes)
  const titulo = `Recepción ${s.codigo ?? fila.numero ?? ''} · ${fila.proveedor.nombre ?? prov}`.trim()
  const subir = `${rutaConta(CONTA.rutas.liquidacionNueva)}?${new URLSearchParams({ ...(s.proveedor_id ? { proveedor: s.proveedor_id } : {}), ...(s.local_id ? { local: s.local_id } : {}), mes: s.mes }).toString()}`
  const verLiq = s.liquidacion ? rutaLiquidacion(s.liquidacion.id) : null

  const noEsSoporte = async () => {
    setOcupado(true); setError(null)
    try { alCambiar(await recepcionNoEsSoporte(fila.id)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }

  const mas: GrupoDeAcciones[] = [{ titulo: 'La recepción', acciones: [
    { id: 'albaran', etiqueta: 'Ver el albarán', alPulsar: () => setPapel(true), grupo: 'La recepción' },
    { id: 'no-soporte', etiqueta: `No es soporte de ${prov}`, alPulsar: () => setConfirmar(true), dato: 'Vuelve a «Por aclarar»', grupo: 'La recepción' },
  ] }]
  const principal = verLiq
    ? <BotonEnlace variante="principal" a={verLiq}>{`Ver la liquidación de ${mes}`}</BotonEnlace>
    : <BotonEnlace variante="principal" icono="subir" a={subir}>{`Subir la liquidación de ${mes}`}</BotonEnlace>
  const c = datos.datos?.cruce ?? null
  const lineas = datos.datos?.lineas ?? []

  return (
    <div className="s-pagina cxso-pagina">
      <EncabezadoPagina titulo={titulo} frase={[fila.recepcion?.fecha ? fechaCorta(fila.recepcion.fecha) : null, s.local, fila.numero ? `albarán ${fila.numero}` : null,
        fila.total != null ? eurosExactos(fila.total) : null, 'llegó por cocina'].filter(Boolean).join(' · ')}
        migasExtra={[{ etiqueta: 'Apartadas', a: alVolver }, { etiqueta: s.codigo ?? 'Recepción' }]}
        estado={{ texto: etiquetaSoporte(s), tono: 'accion' }}
        masAcciones={mas} principal={principal} />

      {error && <div className="cx-error" role="alert">{error}</div>}

      <section className="cxso-aviso" aria-label="Cómo se contabiliza">
        <strong>No se apunta como compra: entra en la contabilidad con la liquidación mensual de {prov}.</strong>
        <span>Esta recepción se compara con la «Relación Compras y Ventas» de su liquidación, producto a producto, en cantidad y en precio.</span>
      </section>

      {datos.error ? <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />
        : !datos.datos ? <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el cruce">{[0, 1, 2].map((i) => <Hueso key={i} alto={36} />)}</div>
        : s.liquidacion && c && !c.sinRelacion ? (
          <section className="cxso-tarjeta" aria-label="Con qué liquidación cuadra" data-prueba="cuadra-con">
            <header className="cxso-cabeza">
              <div><span className="cxso-rotulo">CUADRA CON</span><strong>Liquidación de {prov} · {mes} {s.mes.slice(0, 4)}{s.local ? ` · ${s.local}` : ''}</strong></div>
              <Chip tono={c.porAclarar ? 'duda' : 'seguro'}>{resumenDelCruce(c)}</Chip>
            </header>
            {movil ? (
              <ul className="cxso-lista">
                {c.filas.map((f) => (
                  <li key={f.nombre} data-coincide={f.coincide}>
                    <strong>{f.nombre}</strong>
                    <span>Esta recepción: {cp(f.recepcion, f.unidad)}</span>
                    <span>El mes{f.mes ? ` (${f.mes.recepciones} recepciones)` : ''}: {cp(f.mes, f.unidad)}</span>
                    <span>La Relación: {cp(f.relacion, f.unidad)}</span>
                    <Chip tono={f.coincide ? 'seguro' : 'duda'}>{f.coincide ? 'Coincide' : f.texto}</Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <table className="cxso-tabla">
                <thead><tr><th>Producto</th><th className="cxso-num">En esta recepción</th><th className="cxso-num">En el mes</th><th className="cxso-num">En la Relación</th><th>Estado</th></tr></thead>
                <tbody>
                  {c.filas.map((f) => (
                    <tr key={f.nombre} data-coincide={f.coincide}>
                      <td><strong>{f.nombre}</strong></td>
                      <td className="cxso-num">{cp(f.recepcion, f.unidad)}</td>
                      <td className="cxso-num">{cp(f.mes, f.unidad)}{f.mes ? <span className="cx-ayuda"> · {f.mes.recepciones} rec.</span> : null}</td>
                      <td className="cxso-num">{cp(f.relacion, f.unidad)}</td>
                      <td><Chip tono={f.coincide ? 'seguro' : 'duda'}>{f.coincide ? 'Coincide' : f.texto}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <footer className="cxso-pie">La Relación es del mes: la cantidad se compara con la de todas las recepciones de {mes}; el precio, con el de esta. El precio es el importe de la línea entre su cantidad. Lo que no coincide sale primero; nada se esconde.</footer>
            {c.porAclarar > 0 && verLiq && <div className="cxso-acciones"><BotonEnlace a={verLiq}>{`Aclarar ${c.porAclarar === 1 ? 'el 1' : `los ${c.porAclarar}`} en la liquidación`}</BotonEnlace></div>}
          </section>
        ) : (
          <>
            {s.liquidacion ? (
              <section className="cxso-espera" aria-label="La liquidación" data-prueba="sin-relacion">
                <span className="cxso-rotulo">CUADRA CON</span>
                <strong>Liquidación de {prov} · {mes} {s.mes.slice(0, 4)}{s.local ? ` · ${s.local}` : ''}</strong>
                <span>Su «Relación Compras y Ventas» no está entre lo que se leyó al subirla: sin ella no se puede comparar producto a producto.</span>
              </section>
            ) : (
              <section className="cxso-espera" aria-label="Esperando la liquidación" data-prueba="esperando-liquidacion">
                <span className="cxso-rotulo">ESPERANDO LA LIQUIDACIÓN</span>
                <strong>La de {prov} de {mes}{s.local ? ` de ${s.local}` : ''} aún no ha llegado</strong>
                <span>Cuando la subas, cuadro esta recepción con su «Relación Compras y Ventas», producto a producto, y te digo lo que no coincide.</span>
                {/* En el móvil, el botón va abajo, en el pulgar: aquí no se repite. */}
                {!movil && <div className="cxso-acciones"><BotonEnlace variante="principal" icono="subir" a={subir}>{`Subir la liquidación de ${mes}`}</BotonEnlace></div>}
              </section>
            )}
            <section className="cxso-tarjeta" aria-label="Lo que trae esta recepción">
              <header className="cxso-cabeza"><strong>Lo que trae esta recepción</strong></header>
              {lineas.length === 0 ? <p className="cxso-pie">La recepción no tiene líneas con artículo: mira el albarán.</p> : movil ? (
                <ul className="cxso-lineas">
                  {lineas.map((l, i) => (
                    <li key={i}><strong>{l.nombre}</strong><span>{num(l.cantidad, 3)} {l.unidad} · {l.precio == null ? '—' : eurosExactos(l.precio)}</span><span className="s-cifra">{eurosExactos(l.importe)}</span></li>
                  ))}
                </ul>
              ) : (
                <table className="cxso-tabla">
                  <thead><tr><th>Producto</th><th className="cxso-num">Cantidad</th><th className="cxso-num">Precio</th><th className="cxso-num">Importe</th></tr></thead>
                  <tbody>
                    {lineas.map((l, i) => (
                      <tr key={i}><td>{l.nombre}</td><td className="cxso-num">{num(l.cantidad, 3)} {l.unidad}</td><td className="cxso-num">{l.precio == null ? '—' : eurosExactos(l.precio)}</td><td className="cxso-num">{eurosExactos(l.importe)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}

      {movil && <BotonPulgar>{principal}</BotonPulgar>}
      {papel && <DialogoPapel recepcion={fila.id} titulo={titulo} alCerrar={() => setPapel(false)} />}
      {confirmar && (
        <Dialogo titulo={`¿No es soporte de ${prov}?`} explicacion="Vuelve a «Por aclarar», para decidir qué es." alCerrar={() => setConfirmar(false)}
          acciones={<><Boton variante="secundario" onClick={() => setConfirmar(false)} disabled={ocupado}>Cancelar</Boton><Boton variante="principal" onClick={() => void noEsSoporte()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'No es soporte'}</Boton></>}>
          {error && <div className="cx-error" role="alert">{error}</div>}
        </Dialogo>
      )}
    </div>
  )
}
