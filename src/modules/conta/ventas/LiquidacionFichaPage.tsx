// src/modules/conta/ventas/LiquidacionFichaPage.tsx
//
// S01j·2 · La ficha de UNA liquidación de plataforma (maqueta 3, aprobada por
// Julio el 01/11): Ventas › Liquidaciones › «Glovo · Bendito Burrito · 1–15/10».
//
//   · Arriba, su estado: su factura de comisión (recibida, en revisión o que
//     falta) y «Llegó por correo el dd/mm», con el enlace a la llegada en
//     Correo de facturas.
//   · Sus cuatro cifras: ventas (con sus pedidos), otros (servicio de entrega,
//     mínimo de pedido, promociones…), su factura de comisión y lo que te
//     ingresa (con su fecha y si ya está casado en Bancos).
//   · De dónde salió: su correo, o «Sin periodo: vino de un fichero antiguo».
// Si las cifras no suman, se dice con los números (regla 7). Para cuadrar con
// tus cierres, la ficha del periodo y el local (la de siempre).

import { Link, useParams } from 'react-router-dom'
import { rutaAjustes, rutaLiquidacionPlataforma, rutaLiquidacionesVentas, rutaRevisarFactura } from '@/config/navegacion'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Chip } from '@/modules/conta/diseno'
import { BloqueFicha, CampoFicha, FilaCampos } from '@/modules/conta/diseno/plantillas'
import { claveGrupo } from '@/modules/conta/lib/liquidacionesPlataforma'
import { deDondeSalio, sumaFicha, tituloFicha } from '@/modules/conta/lib/fichaLiquidacion'
import { leerFichaLiquidacion } from '@/modules/conta/services/liquidacionesVentasService'

const euros = (x: number | null) => (x === null ? '—' : eurosExactos(x))
const dm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

export default function LiquidacionFichaPage() {
  const { id = '' } = useParams()
  const datos = useLeer(id ? () => leerFichaLiquidacion(id) : null, `${id}:ficha-liquidacion`)
  const volver = rutaLiquidacionesVentas('plataformas')
  if (datos.error) return <div className="s-pagina"><EncabezadoPagina titulo="Liquidación" /><p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer la liquidación: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p></div>
  const f = datos.datos
  if (!f) return <div className="s-pagina"><EncabezadoPagina titulo="Liquidación" /><p className="s-apoyo" aria-busy="true">Leyendo la liquidación…</p></div>

  const s = sumaFicha(f)
  const fac = f.factura
  const estadoFactura = !fac ? { texto: 'Falta su factura de comisión', tono: 'falta' as const }
    : fac.en_revision ? { texto: 'Factura de comisión · en revisión', tono: 'duda' as const }
    : { texto: 'Factura de comisión · recibida', tono: 'seguro' as const }
  const grupo = !f.sin_periodo && f.desde && f.hasta ? claveGrupo(f.canal_id, f.local_id, f.desde, f.hasta) : null

  return (
    <div className="s-pagina" data-prueba="ficha-liquidacion" data-sin-periodo={f.sin_periodo ? 'si' : 'no'}>
      <EncabezadoPagina titulo={tituloFicha(f)} migasExtra={[{ etiqueta: 'Liquidaciones', a: volver }]}
        estado={{ texto: estadoFactura.texto, tono: estadoFactura.tono }}
        frase={f.correo
          ? <>Llegó por correo el {dm(f.correo.fecha)} · <Link to={rutaAjustes('correo-facturas')} data-prueba="ver-llegada">Ver la llegada en Correo de facturas</Link></>
          : f.sin_periodo ? 'Sin periodo: vino de un fichero antiguo.' : 'Se subió a mano.'} />

      {f.revisar && <p className="s-aviso-lista" data-tono="duda" role="status">{f.revisar}</p>}
      {s.suma === false && <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="no-suman">{s.texto}</p>}

      <BloqueFicha titulo="Lo que liquida">
        <FilaCampos columnas={4}>
          <CampoFicha etiqueta="Ventas" valor={<>{euros(f.ventas)}{f.pedidos != null ? <span className="s-tarjeta-apoyo"> · {f.pedidos === 1 ? '1 pedido' : `${f.pedidos.toLocaleString('es-ES')} pedidos`}</span> : null}</>} cifra />
          <CampoFicha etiqueta="Comisión" valor={euros(f.comision)} cifra />
          <CampoFicha etiqueta="Otros (entrega, mínimo de pedido, promociones…)" valor={euros(f.otros)} cifra />
          <CampoFicha etiqueta={f.neto !== null && f.neto < 0 ? 'Le debes' : 'Te ingresa'} valor={f.neto === null ? '—' : eurosExactos(Math.abs(f.neto))} cifra
            tono={f.neto !== null && f.neto < 0 ? 'revisar' : 'normal'} />
        </FilaCampos>
        <p className="s-apoyo" data-prueba="cobro">
          {f.cobrado_el ? `Cobrado el ${dm(f.cobrado_el)}${f.cobrado !== null ? ` (${eurosExactos(f.cobrado)})` : ''}: casado en Bancos.`
            : f.pago_el ? `Se paga el ${dm(f.pago_el)} · sin casar aún en Bancos.` : 'Sin fecha de pago · sin casar aún en Bancos.'}
        </p>
      </BloqueFicha>

      <BloqueFicha titulo="Su factura de comisión">
        {fac ? (
          <>
            <FilaCampos columnas={3}>
              <CampoFicha etiqueta="Factura" valor={<Link to={rutaRevisarFactura(fac.id)} data-prueba="ver-factura">{fac.numero ?? fac.codigo ?? 'Sin número'}</Link>} />
              <CampoFicha etiqueta="Base + IVA" valor={`${euros(fac.base)} + ${euros(fac.iva)}`} cifra />
              <CampoFicha etiqueta="Total" valor={euros(fac.total)} cifra />
            </FilaCampos>
            <p className="s-apoyo">Se paga por compensación: la plataforma la descuenta de lo que te ingresa, no se paga por banco.</p>
          </>
        ) : <p className="s-apoyo" data-tono="falta">Aún no ha llegado su factura de comisión. Cuando llegue (por correo o subida en Compras), se liga sola con esta liquidación.</p>}
      </BloqueFicha>

      <BloqueFicha titulo="De dónde salió">
        <p className="s-apoyo" data-prueba="de-donde">{deDondeSalio(f)}</p>
        {f.correo && <p className="s-apoyo">Si el mismo correo se vuelve a leer, esta liquidación se actualiza: no se crea otra.</p>}
        {grupo && <p className="s-apoyo"><Link to={rutaLiquidacionPlataforma(grupo)}>Compararla con tus cierres{f.local ? ` de ${f.local}` : ''}</Link></p>}
        {f.sin_periodo && <p><Chip tono="neutro">Sin periodo</Chip></p>}
      </BloqueFicha>
    </div>
  )
}
