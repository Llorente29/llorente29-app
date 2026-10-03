// src/modules/conta/apartados/Resumen.tsx
//
// Pestaña Resumen de la ficha en ordenador (maqueta Proveedor.dc.html):
// cuatro cifras grandes, tres bloques (Impuestos, Cómo le pagas,
// Contabilidad), «Con quién hablas» y «Últimas facturas». Debajo, lo que
// aporten otros módulos que la cuenta tenga (por ejemplo, Cocina).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Dato, Tarjeta } from '@/modules/conta/components/ui'
import { ListaFacturas } from '@/modules/conta/components/Facturas'
import { Propuestas } from '@/modules/conta/components/Propuestas'
import { diaMes, euros, listaPorcentajes } from '@/modules/conta/lib/formato'
import { enmascararIban } from '@/modules/conta/lib/iban'
import { pideIban } from '@/modules/conta/lib/completitud'
import { cuentaPgc } from '@/modules/conta/lib/pgc'
import { tieneCertificadoBanco } from '@/modules/conta/services/proveedorService'
import { PAYMENT_METHOD_LABEL, ROLE_LABEL, VAT_REGIME_LABEL } from '@/modules/conta/types'
import { nombreFormaPago } from '@/modules/conta/lib/opcionesFicha'
import { accionContacto, textoDireccion, textoPlazo, textoRetencion } from '@/modules/conta/lib/textosFicha'
import type { SeccionDeFicha } from '@/modules/conta/extensiones'

export function Cifras() {
  const { cifras } = useFicha()
  if (!cifras) return null
  const vacio = <span className="cf-cifra-vacia">Aún no hay facturas suyas</span>
  return (
    <div className="cf-cifras">
      <div className="cf-cifra">
        <span className="cf-cifra-et">Le has comprado este año</span>
        {cifras.compradoEsteAnio !== null ? <span className="cf-cifra-valor">{euros(cifras.compradoEsteAnio)}</span> : vacio}
      </div>
      <div className="cf-cifra">
        <span className="cf-cifra-et cf-debe">Le debes</span>
        {cifras.leDebes !== null ? <span className="cf-cifra-valor">{euros(cifras.leDebes)}</span> : vacio}
      </div>
      <div className="cf-cifra">
        <span className="cf-cifra-et">Próximo pago</span>
        {cifras.proximoPago
          ? <><span className="cf-cifra-valor">{diaMes(cifras.proximoPago.fecha)}</span>
              <span className="cf-cifra-pie">{euros(cifras.proximoPago.importe)}{cifras.proximoPago.facturas > 1 ? ` · ${cifras.proximoPago.facturas} facturas` : ''}</span></>
          : cifras.hayFacturas
            ? <span className="cf-cifra-vacia">{cifras.leDebes ? 'Sin vencimiento puesto' : 'Nada pendiente'}</span>
            : vacio}
      </div>
      <div className="cf-cifra">
        <span className="cf-cifra-et">Facturas este año</span>
        {cifras.hayFacturas ? <span className="cf-cifra-valor">{cifras.facturasEsteAnio}</span> : vacio}
      </div>
    </div>
  )
}

export function BloqueImpuestos() {
  const { datos: { ficha: f } } = useFicha()
  return (
    <Tarjeta titulo="Impuestos" id="b-impuestos">
      <Dato etiqueta="Régimen de IVA" valor={f.vatRegime ? VAT_REGIME_LABEL[f.vatRegime] : null} />
      <Dato etiqueta="IVA habitual" valor={f.usualVatRates.length ? listaPorcentajes(f.usualVatRates) : null} />
      <Dato etiqueta="Retención" valor={textoRetencion(f)} vacio="Sin anotar (es autónomo)" />
      <Dato etiqueta="Dirección fiscal" valor={textoDireccion(f)} />
    </Tarjeta>
  )
}

export function BloquePago() {
  const { datos, rutaApartado } = useFicha()
  const f = datos.ficha
  const cert = tieneCertificadoBanco(datos.documentos)
  return (
    <Tarjeta titulo="Cómo le pagas" id="b-pago">
      <Dato etiqueta="Forma de pago" valor={f.paymentMethod ? nombreFormaPago(datos.opciones, f.paymentMethod, PAYMENT_METHOD_LABEL) : null} />
      <Dato etiqueta="Plazo" valor={textoPlazo(f)} />
      <Dato
        etiqueta="Cuenta bancaria"
        valor={f.iban ? enmascararIban(f.iban) : null}
        vacio={pideIban(f) ? 'Falta el IBAN' : 'No hace falta'}
        pie={f.iban ? (f.ibanVerifiedAt ? 'IBAN comprobado' : 'Sin comprobar') : undefined}
        pieClase={f.ibanVerifiedAt ? 'cf-ok' : 'cf-pendiente'}
      />
      {f.iban && !cert && (
        <Link className="cf-aviso" to={rutaApartado('documentos', 'bank_ownership_certificate')}>Falta el certificado del banco</Link>
      )}
    </Tarjeta>
  )
}

export function BloqueContabilidad() {
  const { datos, cifras } = useFicha()
  const f = datos.ficha
  const tipo = datos.tiposGasto.find((t) => t.id === f.expenseCategoryId) ?? null
  const local = datos.locales.find((l) => l.id === f.defaultLocationId)
  return (
    <Tarjeta titulo="Contabilidad" id="b-contabilidad">
      <Dato etiqueta="Sus facturas se apuntan en" valor={tipo?.name} pie={tipo ? cuentaPgc(tipo.pgcAccountHint) : undefined} />
      {/* Lo único del C01 que va tras el interruptor `conta` (respuesta 1, punto 6). */}
      {datos.conta && (
        <Dato
          etiqueta="Su cuenta"
          valor={f.ledgerAccountCode}
          vacio="Se asigna al activar el plan contable"
          pie={cifras?.leDebes ? `Saldo: le debes ${euros(cifras.leDebes)}` : undefined}
        />
      )}
      <Dato etiqueta="Local habitual" valor={f.defaultLocationId ? (local?.name ?? 'Un local que ya no está activo') : 'Todos'} />
      <Dato etiqueta="Registro sanitario" valor={f.healthRegistryNo ? 'Anotado' : null} pie={f.healthRegistryNo ?? undefined} />
    </Tarjeta>
  )
}

export function BloqueContactos() {
  const { datos, rutaApartado } = useFicha()
  const roles = new Set(datos.contactos.map((c) => c.role))
  const falta = !roles.has('orders') ? 'orders' : !roles.has('admin') ? 'admin' : null
  return (
    <Tarjeta titulo="Con quién hablas" id="b-contactos" estilo={{ padding: '16px 20px', gap: 10 }}>
      {datos.contactos.length === 0 && <p className="cf-nota" style={{ margin: 0 }}>Aún no hay nadie apuntado.</p>}
      {datos.contactos.map((c) => {
        const a = accionContacto(c)
        return (
          <div key={c.id} className="cf-contacto">
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span className="cf-contacto-nombre">{c.name}</span>
              <span className="cf-contacto-detalle">{ROLE_LABEL[c.role]}{c.phone ? ` · ${c.phone}` : c.email ? ` · ${c.email}` : ''}</span>
            </div>
            {a && <a href={a.href}>{a.texto}</a>}
          </div>
        )
      })}
      {falta && (
        <Link className="cf-anadir" to={`${rutaApartado('contactos')}?nuevo=${falta}`}>
          + Añadir contacto de {falta === 'orders' ? 'pedidos' : 'administración'}
        </Link>
      )}
    </Tarjeta>
  )
}

export function BloqueFacturas() {
  const { datos } = useFicha()
  const [todas, setTodas] = useState(false)
  const lista = todas ? datos.facturas : datos.facturas.slice(0, 4)
  return (
    <Tarjeta titulo="Últimas facturas" id="b-facturas" estilo={{ padding: '16px 20px', gap: 6, flexGrow: 1 }}>
      <ListaFacturas facturas={lista} />
      {datos.facturas.length > 4 && (
        <button type="button" className="cf-boton-texto" onClick={() => setTodas((t) => !t)} style={{ alignSelf: 'flex-start' }}>
          {todas ? 'Ver solo las últimas' : `Ver las ${datos.facturas.length}`}
        </button>
      )}
    </Tarjeta>
  )
}

/** Lo que aportan otros módulos. Cada sección decide si tiene algo que enseñar en esta cuenta. */
export function SeccionesExtra() {
  const { datos, extensiones, recargar } = useFicha()
  const [visibles, setVisibles] = useState<SeccionDeFicha[]>([])
  const secciones = extensiones.secciones
  const accountId = datos.ficha.accountId
  useEffect(() => {
    let vivo = true
    const todas = secciones ?? []
    Promise.all(todas.map((s) => s.tieneAlgo(accountId).catch(() => false)))
      .then((r) => { if (vivo) setVisibles(todas.filter((_, i) => r[i])) })
    return () => { vivo = false }
  }, [secciones, accountId])
  if (visibles.length === 0) return null
  return (
    <>
      {visibles.map((s) => (
        <Tarjeta key={s.id} titulo={s.titulo} id={`ext-${s.id}`}>
          {s.render({ accountId, supplierId: datos.ficha.id, supplierName: datos.ficha.name, alCambiar: () => { void recargar() } })}
        </Tarjeta>
      ))}
    </>
  )
}

export default function Resumen() {
  return (
    <>
      <Propuestas />
      <Cifras />
      <div className="cf-cuerpo">
        <div className="cf-bloques">
          <BloqueImpuestos />
          <BloquePago />
          <BloqueContabilidad />
        </div>
        <div className="cf-lateral">
          <BloqueContactos />
          <BloqueFacturas />
        </div>
      </div>
      <SeccionesExtra />
    </>
  )
}

