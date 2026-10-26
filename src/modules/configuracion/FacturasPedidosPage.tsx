// src/modules/configuracion/FacturasPedidosPage.tsx
//
// V04 · PR 1 · Ajustes de Folvy › «Facturas de los pedidos» (maqueta «Tique de
// bolsa con Verifactu», tablero 4). Estilo nuevo, como «Quién reparte».
//   · El estado de Verifactu de la empresa, con el enlace a Sumied: Folvy no
//     tiene un Verifactu propio, usa el de Sumied (el mismo interruptor).
//   · La serie de cada local: su código (se elige una vez; Folvy propone las
//     dos primeras letras), la serie de este año, el último número y la de las
//     rectificativas. Un local sin código se ve y dice qué pasa con sus tiques
//     (regla 7).
//   · Las marcas: las propias van por nuestra serie; las cedidas las emite el
//     socio desde Last.
// Cada cambio confirma o falla en pantalla, con contenido (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLeer } from '@/modules/conta/libros/contexto'
import { rutaConta } from '@/config/navegacion'
import '@/modules/conta/estilo'
import './facturasPedidos.css'
import { Chip, ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import {
  codigoNoVale, estadoLocal, facturaDeMarca, prefijo, textoVerifactu, ultimoTexto,
  type AjustesFacturas, type LocalFacturas,
} from './lib/facturasPedidos'
import { cargarAjustesFacturas, guardarCodigoLocal } from './services/facturasPedidosService'

const msg = (e: unknown) => (e instanceof Error ? e.message.replace(/^ticket_invoice_\w+: /, '') : String(e))

export default function FacturasPedidosPage() {
  const { activeAccountId } = useActiveAccount()
  const [vuelta, setVuelta] = useState(0)
  const leido = useLeer(activeAccountId ? () => cargarAjustesFacturas(activeAccountId) : null, `${activeAccountId}:facturas-pedidos:${vuelta}`)
  // Lo último leído: al volver a leer (después de guardar) la pantalla no se desmonta y el aviso sigue a la vista (regla 8).
  const [ultimo, setUltimo] = useState<AjustesFacturas | null>(null)
  if (leido.datos && leido.datos !== ultimo) setUltimo(leido.datos)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const cargar = () => setVuelta((v) => v + 1)
  const datos = leido.datos ?? ultimo

  if (leido.error && !datos) return <div className="cx cx-fp"><ErrorConReintento mensaje={msg(leido.error)} reintentar={leido.recargar} /></div>
  if (!datos) return <div className="cx cx-fp"><TarjetaCargando /></div>

  return (
    <div className="cx cx-fp" data-testid="facturas-pedidos">
      <header className="cx-fp-cabeza">
        <span className="cx-fp-miga">Ajustes › Facturas de los pedidos</span>
        <h1 className="cx-fp-titulo">Facturas de los pedidos</h1>
        <p className="cx-fp-intro">
          El tique de la bolsa es la factura simplificada del pedido. Lleva quién factura y un número de la serie del
          local; en las marcas cedidas, los datos y el número de la factura del socio.
        </p>
      </header>

      {aviso && <p className="cx-fp-aviso" data-tono={aviso.ok ? 'ok' : 'falta'} role="status" data-testid="aviso-facturas">{aviso.texto}</p>}

      <section className="cx-tarjeta cx-fp-verifactu" aria-label="Verifactu" data-testid="verifactu-estado">
        {datos.empresas.length === 0 && <p>Aún no hay ninguna empresa dada de alta en Sumied: los tiques llevan el nombre y el NIF de la cuenta.</p>}
        {datos.empresas.map((e) => {
          const t = textoVerifactu(e)
          return (
            <div key={e.companyId} className="cx-fp-empresa">
              <span className="cx-fp-vf" aria-hidden="true">VF</span>
              <div className="cx-fp-empresa-texto">
                <Chip tono={t.tono}>{t.chip}</Chip>
                <p>{t.frase}</p>
                <p className="cx-fp-apoyo">El QR de Hacienda en el tique llega con la próxima entrega: hoy el tique lleva quién factura y su número.</p>
              </div>
              <Link className="cx-boton" to={rutaConta('ajustes/verifactu')}>Ir a Sumied</Link>
            </div>
          )
        })}
      </section>

      <section className="cx-tarjeta" aria-label="Las series de los locales">
        <h2 className="cx-fp-h2">La serie de cada local</h2>
        <p className="cx-fp-apoyo">
          Una por local y por año, correlativa y sin huecos: el número se da al imprimir el tique, y reimprimirlo no
          gasta otro. Delivery, recogida, Shop y sala comparten la serie del local. Las rectificativas van aparte, con la R.
        </p>
        <div className="cx-fp-tabla" role="table" aria-label="Series de los locales">
          <div role="row" className="cx-fp-fila cx-fp-fila-cabeza">
            <span role="columnheader">Local</span><span role="columnheader">Código</span><span role="columnheader">Serie de {datos.año}</span>
            <span role="columnheader">Última</span><span role="columnheader">Rectificativas</span>
          </div>
          {datos.locales.map((l) => (
            <FilaLocal key={l.locationId} l={l} alGuardar={(t) => { setAviso({ ok: true, texto: t }); cargar() }} alFallar={(t) => setAviso({ ok: false, texto: t })} />
          ))}
        </div>
      </section>

      <section className="cx-tarjeta" aria-label="Las marcas">
        <h2 className="cx-fp-h2">Las marcas</h2>
        {datos.cedidasSinFactura7d > 0 && (
          <p className="cx-fp-aviso" data-tono="duda" role="status" data-testid="cedidas-sin-factura">
            {datos.cedidasSinFactura7d === 1 ? 'Un pedido' : `${datos.cedidasSinFactura7d.toLocaleString('es-ES')} pedidos`} de marcas cedidas de los últimos 7 días
            {datos.cedidasSinFactura7d === 1 ? ' llegó' : ' llegaron'} sin la factura de Last: {datos.cedidasSinFactura7d === 1 ? 'su tique salió' : 'sus tiques salieron'} sin «Factura Simplificada». Míralo en Last.
          </p>
        )}
        <div className="cx-fp-tabla" role="table" aria-label="Quién factura cada marca">
          <div role="row" className="cx-fp-fila cx-fp-fila-cabeza cx-fp-fila-marca">
            <span role="columnheader">Marca</span><span role="columnheader">De quién es</span><span role="columnheader">Su factura</span>
          </div>
          {datos.marcas.map((m) => {
            const f = facturaDeMarca(m)
            return (
              <div role="row" key={m.brandId} className="cx-fp-fila cx-fp-fila-marca" data-testid={`marca-${m.nombre}`}>
                <span role="cell" className="cx-fp-nombre">{m.nombre}</span>
                <span role="cell">{m.propia ? <Chip tono="azul">{f.deQuien}</Chip> : <Chip>{f.deQuien}</Chip>}</span>
                <span role="cell" className="cx-fp-apoyo">{f.suFactura}</span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function FilaLocal({ l, alGuardar, alFallar }: { l: LocalFacturas; alGuardar: (texto: string) => void; alFallar: (texto: string) => void }) {
  const fijo = !!l.codigo && l.numeros > 0
  const [codigo, setCodigo] = useState(l.codigo ?? l.propuesto ?? '')
  const [ocupado, setOcupado] = useState(false)
  const noVale = codigoNoVale(codigo)
  const cambia = codigo.trim().toUpperCase() !== (l.codigo ?? '')
  const guardar = () => {
    setOcupado(true)
    void guardarCodigoLocal(l.locationId, codigo, null)
      .then((r) => alGuardar(`Guardado: ${l.nombre} numera con ${r.codigo}. El próximo tique de una marca propia en este local será el ${r.serie}${l.ultimo ? ' (sigue su serie)' : ''}.`))
      .catch((e) => alFallar(`No se ha guardado el código de ${l.nombre}: ${msg(e)}`))
      .finally(() => setOcupado(false))
  }
  return (
    <div role="row" className="cx-fp-fila" data-testid={`local-${l.nombre}`} data-activo={l.activo ? undefined : 'no'}>
      <span role="cell">
        <span className="cx-fp-nombre">{l.nombre}</span>
        {!l.activo && <span className="cx-fp-apoyo"> · cerrado</span>}
        <span className="cx-fp-apoyo cx-fp-estado">{estadoLocal(l)}</span>
      </span>
      <span role="cell">
        {fijo ? <code className="cx-fp-codigo">{l.codigo}</code> : (
          <span className="cx-fp-editar">
            <input className="cx-input cx-fp-input" aria-label={`Código de ${l.nombre}`} value={codigo} maxLength={3}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())} aria-invalid={!!noVale} />
            {cambia && <button type="button" className="cx-boton cx-boton-principal" disabled={ocupado || !!noVale} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>}
            {!l.codigo && l.propuesto && codigo === l.propuesto && <span className="cx-fp-apoyo">Lo propone Folvy</span>}
            {noVale && codigo && <span className="cx-fp-falta">{noVale}</span>}
          </span>
        )}
      </span>
      <span role="cell"><code>{prefijo(l.serie) ?? '—'}</code></span>
      <span role="cell" className="cx-fp-cifra">{ultimoTexto(l.serie, l.ultimo) ?? '—'}</span>
      <span role="cell"><code>{prefijo(l.rectificativas) ?? '—'}</code>{l.ultimoR ? <span className="cx-fp-apoyo"> · última {ultimoTexto(l.rectificativas, l.ultimoR)}</span> : null}</span>
    </div>
  )
}
