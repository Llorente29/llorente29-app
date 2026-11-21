// src/modules/conta/ventas/DiaTpvPage.tsx
//
// R15 · La ficha de un día del TPV de fuera (Revo y los que vengan), con el
// diseño de la ficha del cierre (CierrePage): los datos a la izquierda y el PDF
// «Resumen de ventas» a la derecha. Lo lee todo conta_tpv_dia_ficha (R15):
//   · de dónde es (programa, día, canal) y quién lo subió, en qué subida;
//   · el rango de facturas de cada contador, las facturas con NIF una a una y las
//     devoluciones;
//   · el aviso de la factura que pasa del límite de la simplificada (punto 4);
//   · la base y el IVA por tipo; los cobros por forma con su cuenta;
//   · contabilizado: sus dos asientos (enlazados), su PDF y su salida a ERP10
//     (punto 7); en espera: su motivo y «Elegir la cuenta».
// La factura del día nunca va a Verifactu (punto 6): Verifactu solo registra las
// facturas que emite Sumied (customer_invoice), y un día del TPV no es una.
// Lo que se dice, sin pantalla, en lib/diaTpv.ts.

import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { rutaAsiento, rutaCierres } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { diaMes, eurosExactos } from '@/modules/conta/lib/formato'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton } from '@/modules/conta/diseno'
import { AsientoQueSeCrea, BloqueFicha, CampoFicha, DocumentoFicha, Ficha, FilaCampos } from '@/modules/conta/diseno/plantillas'
import { leerAsiento } from '@/modules/conta/services/diarioService'
import { urlDocumento } from '@/modules/conta/services/conDiezService'
import { leerFichaDia, leerLibroDia } from '@/modules/conta/services/tpvSubirService'
import { validarDiaTpv } from '@/modules/conta/services/tpvDiaService'
import { esperaPorCuenta } from '@/modules/conta/lib/subirTpv'
import { NOMBRE_ESTADO_DIA, NOMBRE_TIPO_FACTURA, avisoLimite, claseFilaLibro, fraseDiaTpv, numeroAsiento, ordenarLibro, textoFilaLibro, textoSubida, tituloDiaTpv } from '@/modules/conta/lib/diaTpv'
import { textoDeNumero } from '@/modules/conta/lib/facturasVenta'
import { FormasDePago } from './tpv/FormasDePago'

const tipo = (t: number) => `${t.toLocaleString('es-ES')} %`
const ERP10: Record<string, string> = { pendiente: 'Pendiente de salir', salido: 'Salido', enviado: 'Salido' }

export default function DiaTpvPage() {
  const { diaId } = useParams<{ diaId: string }>()
  const { search } = useLocation()
  const { accountId, userName } = useCuentaConta()
  const marco = useMarco()
  const [vuelta, setVuelta] = useState(0)
  const [cuentas, setCuentas] = useState(false)
  const [validando, setValidando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const ficha = useLeer(accountId && diaId ? () => leerFichaDia(diaId) : null, `${accountId}:${diaId}:dia-tpv:${vuelta}`)
  const d = ficha.datos
  const factura = useLeer(accountId && d?.factura ? () => leerAsiento(accountId, d.factura!.id) : null, `${accountId}:${d?.factura?.id}:asiento`)
  const cobro = useLeer(accountId && d?.cobro ? () => leerAsiento(accountId, d.cobro!.id) : null, `${accountId}:${d?.cobro?.id}:asiento-cobro`)
  const pdf = useLeer(d?.pdf ? () => urlDocumento(d.pdf!.ruta) : null, `${d?.pdf?.ruta}:pdf`)
  // R15b · El día en el libro de IVA: por serie, cada factura con NIF y cada devolución.
  const libro = useLeer(accountId && diaId ? () => leerLibroDia(diaId) : null, `${accountId}:${diaId}:dia-tpv-libro:${vuelta}`)
  const volver = <Link to={`${rutaCierres()}${search}`} className="s-boton s-boton-secundario">Volver a los cierres</Link>

  if (ficha.error) return <div className="s-pagina"><EncabezadoPagina titulo="Día del TPV" /><p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer el día: {ficha.error} <button type="button" className="s-boton s-boton-enlace" onClick={ficha.recargar}>Reintentar</button></p></div>
  if (!d) return <div className="s-pagina"><EncabezadoPagina titulo="Día del TPV" /><div className="s-lista" aria-busy="true" aria-label="Cargando el día"><div className="s-lista-cargando" /></div></div>

  const est = NOMBRE_ESTADO_DIA[d.estado]
  const porCuenta = d.estado === 'en_espera' && esperaPorCuenta(d.motivo)

  async function contabilizar() {
    setValidando(true); setAviso(null)
    try {
      const v = await validarDiaTpv(d!.id, userName)
      setAviso({ ok: true, texto: v.cobroNumero != null
        ? `Contabilizado: la factura del día es el asiento nº ${v.numero.toLocaleString('es-ES')} y su cobro el nº ${v.cobroNumero.toLocaleString('es-ES')}, con su PDF.`
        : `Contabilizado: el asiento nº ${v.numero.toLocaleString('es-ES')}, con su PDF.` })
      setVuelta((x) => x + 1)
    } catch (e) {
      setAviso({ ok: false, texto: `No se ha contabilizado: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setValidando(false)
    }
  }

  const principal = d.estado === 'por_validar'
    ? <Boton variante="principal" disabled={validando} onClick={() => void contabilizar()}>{validando ? 'Contabilizando…' : 'Contabilizar'}</Boton>
    : porCuenta ? <Boton variante="principal" onClick={() => setCuentas(true)}>Elegir la cuenta</Boton>
    : volver
  const mas: GrupoDeAcciones[] = [{
    titulo: 'Más acciones',
    acciones: [
      ...(d.factura ? [{ id: 'factura', etiqueta: 'Ver la factura del día', dato: numeroAsiento(d.factura), a: rutaAsiento(d.factura.id), grupo: '' }] : []),
      ...(d.cobro ? [{ id: 'cobro', etiqueta: 'Ver su cobro', dato: numeroAsiento(d.cobro), a: rutaAsiento(d.cobro.id), grupo: '' }] : []),
      ...(pdf.datos ? [{ id: 'abrir', etiqueta: 'Abrir el PDF aparte', alPulsar: () => window.open(pdf.datos!, '_blank', 'noopener'), grupo: '' }] : []),
    ],
  }]
  const enLineas = (xs: { nombreCuenta: string; cuenta: string; debe: number; haber: number }[]) =>
    xs.map((x) => ({ nombre: x.nombreCuenta, codigo: x.cuenta, debe: x.debe ? textoDeNumero(x.debe) : null, haber: x.haber ? textoDeNumero(x.haber) : null }))
  const limite = avisoLimite(d.sobre_limite, d.limite)
  const subida = textoSubida(d)

  const datos = (
    <>
      <div role="status" aria-live="polite">
        {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} data-prueba="aviso-dia">{aviso.texto}</p>}
      </div>
      {d.estado === 'en_espera' && d.motivo && (
        <p className="s-aviso-lista" data-tono="duda" data-prueba="en-espera">
          <strong>En espera.</strong> {d.motivo}{porCuenta && <> <button type="button" className="s-boton s-boton-enlace" onClick={() => setCuentas(true)}>Elegir la cuenta</button></>}
        </p>
      )}
      {limite && <p className="s-aviso-lista" data-tono="duda" data-prueba="sobre-limite">{limite}</p>}

      <BloqueFicha titulo="El día">
        <FilaCampos columnas={2}>
          <CampoFicha etiqueta="De dónde" valor={`${d.programa_nombre} · toda la empresa`} />
          <CampoFicha etiqueta="Día" valor={d.dia.split('-').reverse().join('/')} cifra />
          <CampoFicha etiqueta="Canal" valor="TPV" />
          <CampoFicha etiqueta="Total" valor={eurosExactos(d.total)} cifra />
          {subida && <CampoFicha etiqueta="Subido" valor={subida} ancho={2} />}
        </FilaCampos>
      </BloqueFicha>

      <BloqueFicha titulo="Facturas">
        <table className="cxv-tabla" aria-label="Facturas del día" data-prueba="contadores">
          <thead><tr><th>Serie</th><th className="s-cifra">Facturas</th><th>Numeración</th><th className="s-cifra">Total</th></tr></thead>
          <tbody>{d.contadores.map((c) => (
            <tr key={c.contador ?? ''}>
              <td>{c.contador ?? 'Sin serie'}</td>
              <td className="s-cifra">{c.facturas.toLocaleString('es-ES')}</td>
              <td className="s-cifra">{c.primero == null ? '—' : String(c.primero) === String(c.ultimo) ? String(c.primero) : `${c.primero} a ${c.ultimo}`}</td>
              <td className="s-cifra">{eurosExactos(c.total)}</td>
            </tr>
          ))}</tbody>
        </table>
        {d.con_nif.length > 0 && (
          <>
            <h4 className="cxg-ficha-sub">Facturas con NIF</h4>
            <table className="cxv-tabla" aria-label="Facturas con NIF" data-prueba="con-nif">
              <thead><tr><th>Factura</th><th>Cliente</th><th className="s-cifra">Base</th><th className="s-cifra">IVA</th><th className="s-cifra">Total</th></tr></thead>
              <tbody>{d.con_nif.map((f) => (
                <tr key={f.numero}>
                  <td className="s-cifra">{f.numero}</td>
                  <td>{f.cliente ?? 'Sin nombre'} <span className="s-tarjeta-apoyo">· {f.nif}</span></td>
                  <td className="s-cifra">{eurosExactos(f.base)}</td>
                  <td className="s-cifra">{eurosExactos(f.cuota)}</td>
                  <td className="s-cifra">{eurosExactos(f.total)}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
        {d.devoluciones.length > 0 && (
          <p className="s-apoyo" data-prueba="devoluciones">
            {d.devoluciones.length === 1 ? 'Una devolución' : `${d.devoluciones.length} devoluciones`}, que restan: {d.devoluciones.map((x) => `la ${x.numero} (${eurosExactos(x.total)})`).join(', ')}.
          </p>
        )}
      </BloqueFicha>

      {libro.datos && libro.datos.filas.length > 0 && (
        <BloqueFicha titulo={libro.datos.enLibro ? 'En el libro de IVA' : 'Cómo irá al libro de IVA'}>
          <table className="cxv-tabla" aria-label="En el libro de IVA" data-prueba="libro-del-dia">
            <thead><tr><th>Qué</th><th>Tipo</th><th>NIF</th><th className="s-cifra">IVA</th><th className="s-cifra">Base</th><th className="s-cifra">Cuota</th><th className="s-cifra">Total</th></tr></thead>
            <tbody>{ordenarLibro(libro.datos.filas).map((f) => {
              const c = claseFilaLibro(f)
              return (
                <tr key={`${f.tipo_factura}|${f.serie ?? ''}|${f.numero ?? ''}|${f.tipo}`} data-clase={c} data-tono={c === 'r5' ? 'falta' : undefined}>
                  <td>{c === 'r5' ? <span className="s-tarjeta-apoyo" data-tono="falta">{textoFilaLibro(f)}</span> : textoFilaLibro(f)}</td>
                  <td>{f.tipo_factura}<span className="s-tarjeta-apoyo"> · {NOMBRE_TIPO_FACTURA[f.tipo_factura] ?? f.tipo_factura}</span></td>
                  <td>{f.nif ?? '—'}</td>
                  <td className="s-cifra">{tipo(f.tipo)}</td>
                  <td className="s-cifra">{eurosExactos(f.base)}</td>
                  <td className="s-cifra">{eurosExactos(f.cuota)}</td>
                  <td className="s-cifra">{eurosExactos(f.total)}</td>
                </tr>
              )
            })}</tbody>
          </table>
          <p className="s-apoyo">Cada serie del TPV va en su fila, con su primer y su último número; cada factura con NIF, en la suya, con su cliente; y cada devolución, aparte, como rectificativa (RIVA, art. 63.4 y 63.6). El asiento del día no cambia.</p>
        </BloqueFicha>
      )}

      <BloqueFicha titulo="Base e IVA">
        <table className="cxv-tabla" aria-label="Base e IVA por tipo" data-prueba="iva">
          <thead><tr><th>Tipo</th><th className="s-cifra">Facturas</th><th className="s-cifra">Base</th><th className="s-cifra">IVA</th></tr></thead>
          <tbody>
            {d.iva.map((t) => <tr key={t.tipo}><td>{tipo(t.tipo)}</td><td className="s-cifra">{t.facturas.toLocaleString('es-ES')}</td><td className="s-cifra">{eurosExactos(t.base)}</td><td className="s-cifra">{eurosExactos(t.cuota)}</td></tr>)}
            <tr><td><strong>Total</strong></td><td /><td className="s-cifra"><strong>{eurosExactos(d.base)}</strong></td><td className="s-cifra"><strong>{eurosExactos(d.cuota)}</strong></td></tr>
          </tbody>
        </table>
      </BloqueFicha>

      <BloqueFicha titulo="Cómo se cobró">
        <table className="cxv-tabla" aria-label="Cómo se cobró" data-prueba="cobros">
          <thead><tr><th>Forma de pago</th><th className="s-cifra">Pagos</th><th>Cuenta</th><th className="s-cifra">Importe</th></tr></thead>
          <tbody>{d.cobros.map((c) => (
            <tr key={c.forma}>
              <td>{c.forma}</td>
              <td className="s-cifra">{c.pagos.toLocaleString('es-ES')}</td>
              <td>{c.cuenta ? `${c.nombre ?? ''} (${c.cuenta})`
                : c.por_canal ? <span className="s-tarjeta-apoyo">La de cada canal</span>
                : <button type="button" className="s-boton s-boton-enlace" data-tono="duda" onClick={() => setCuentas(true)}>Cuenta sin elegir</button>}</td>
              <td className="s-cifra">{eurosExactos(c.importe)}</td>
            </tr>
          ))}</tbody>
        </table>
      </BloqueFicha>

      {d.factura ? (
        <>
          <AsientoQueSeCrea titulo={d.cobro ? '1 · La factura del día' : 'Su asiento'} lineas={enLineas(factura.datos?.apuntes ?? [])}
            nota={<><Link to={rutaAsiento(d.factura.id)} data-prueba="ver-factura-del-dia">Ver el asiento {numeroAsiento(d.factura)}</Link> · Contabilizado. Entra en el traspaso del mes.</>}
            vacio={factura.error ? `No se ha podido leer su asiento: ${factura.error}` : 'Leyendo su asiento…'} />
          {d.cobro && (
            <AsientoQueSeCrea titulo="2 · El cobro del día" lineas={enLineas(cobro.datos?.apuntes ?? [])}
              nota={<><Link to={rutaAsiento(d.cobro.id)} data-prueba="ver-cobro-del-dia">Ver el asiento {numeroAsiento(d.cobro)}</Link> · Va con la factura del día: se validan y se deshacen juntos.</>}
              vacio={cobro.error ? `No se ha podido leer su cobro: ${cobro.error}` : 'Leyendo su cobro…'} />
          )}
        </>
      ) : (
        <BloqueFicha titulo="Sus asientos">
          <p className="s-apoyo">{d.estado === 'por_validar' ? 'Al contabilizarlo se hacen sus dos asientos (la factura del día y su cobro) y su PDF.' : 'Sin asientos todavía: mira el motivo de arriba.'}</p>
        </BloqueFicha>
      )}

      <BloqueFicha titulo="Salida a ERP10">
        <p className="s-apoyo" data-prueba="erp10">
          {d.erp10
            ? `${ERP10[d.erp10.estado] ?? d.erp10.estado}${d.erp10.documento ? ` · ${d.erp10.serie ? `${d.erp10.serie} ` : ''}${d.erp10.documento}` : ''}${d.erp10.cuando ? ` · ${diaMes(d.erp10.cuando)}` : ''}.`
            : d.factura ? 'Aún no ha salido a ERP10: sale con el traspaso del mes.' : 'Sale a ERP10 cuando esté contabilizado.'}
          {' '}No va a Verifactu: sus facturas son las del TPV, no las emite Sumied.
        </p>
      </BloqueFicha>
    </>
  )

  const doc = (
    <div className="cxf-derecha">
      <DocumentoFicha titulo={d.pdf?.nombre ?? 'Resumen de ventas'} descargar={pdf.datos ?? null}
        oculto={marco?.documentoOculto ?? false} alOcultar={(x) => marco?.ocultarDocumento(x)}>
        {pdf.datos && <PapelPdf url={pdf.datos} titulo={`El resumen de ventas del ${diaMes(d.dia)}`} />}
        {!pdf.datos && <p className="s-apoyo">{pdf.error ? `No se ha podido abrir su PDF: ${pdf.error}` : d.pdf ? 'Abriendo el PDF…' : 'Su PDF «Resumen de ventas» se hace al contabilizarlo.'}</p>}
      </DocumentoFicha>
    </div>
  )

  return (
    <div className="s-pagina" data-prueba="ficha-dia-tpv" data-estado={d.estado}>
      <EncabezadoPagina titulo={tituloDiaTpv(d.programa_nombre, d.dia)} estado={{ texto: est.texto, tono: est.tono }} frase={fraseDiaTpv(d)}
        migasExtra={[{ etiqueta: diaMes(d.dia) }]}
        principal={principal} masAcciones={mas} />
      <Ficha datos={datos} documento={doc} documentoOculto={marco?.documentoOculto ?? false} reglaAnchos />
      <BotonPulgar>{principal}</BotonPulgar>
      {cuentas && (
        <FormasDePago companyId={d.company_id} quien={userName} diaId={d.id} alCerrar={() => setCuentas(false)}
          alGuardar={() => { setCuentas(false); setAviso({ ok: true, texto: 'Cuentas guardadas. Si ya no le falta nada, el día queda listo: pulsa «Contabilizar».' }); setVuelta((x) => x + 1) }} />
      )}
    </div>
  )
}
