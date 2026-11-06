// src/modules/conta/gestoria/FichaCliente.tsx
//
// G01 · Tarea 4 · La ficha lateral de un cliente en Clientes y cuotas:
//   · cada servicio con su tarifa y, debajo, cada empleado con la suya
//     («Gestión laboral · <empleado> · 24,20 €»), y el total al mes;
//   · al lado, lo que cobra hoy GoCardless y la diferencia dicha en palabras;
//   · la forma de cobro y el mandato, los 6 últimos cobros con su estado;
//   · lo que dice Bitrix24, de referencia (Sumied no lo cambia).

import { FORMA_COBRO, euros, textoCobro, textoMandato, type ClienteGestoria, type Ficha } from '@/modules/conta/gestoria/vista'

const SITUACION: Record<string, string> = { activo: 'Activo', baja: 'De baja', moroso: 'Moroso', solo_renta: 'Solo la renta' }
const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

export function FichaCliente({ fila, ficha, alCerrar }: { fila: ClienteGestoria; ficha: Ficha | null; alCerrar: () => void }) {
  const m = textoMandato(fila.mandato)
  const c = ficha?.comparacion
  return (
    <div className="cxg-ficha">
      <div className="cxg-ficha-cabeza">
        <div>
          <h2 className="cxg-ficha-titulo">{fila.nombre}</h2>
          <p className="cxg-apoyo">{[fila.nif, fila.emisor].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="cx-enlace" onClick={alCerrar}>Cerrar</button>
      </div>

      {/* La de los totales se explica abajo, junto a las cifras. */}
      {fila.diferencias.some((d) => d.tipo !== 'totales_distintos') && (
        <ul className="cxg-ficha-difs" aria-label="Lo que no cuadra">
          {fila.diferencias.filter((d) => d.tipo !== 'totales_distintos').map((d) => <li key={d.id}>{d.porque}</li>)}
        </ul>
      )}

      <section aria-label="Servicios y tarifas">
        <h3 className="cxg-ficha-sub">Lo que se le cobra en Sumied</h3>
        {!ficha || ficha.servicios.length === 0
          ? <p className="cxg-apoyo">Ninguna línea de alta este mes.</p>
          : ficha.servicios.map((s) => (
            <div key={s.servicio} className="cxg-servicio">
              <div className="cxg-servicio-cabeza"><strong>{s.nombre}</strong><span className="cxg-apoyo">{s.tarifa}</span></div>
              <ul className="cxg-servicio-filas">
                {s.filas.map((x, i) => <li key={i}><span>{x.texto}</span><span className="cxg-cifra">{x.importe}</span></li>)}
              </ul>
            </div>
          ))}
        {c && (
          <dl className="cxg-totales">
            <div><dt>Total al mes en Sumied</dt><dd className="cxg-cifra">{euros(c.sumiedCent)}</dd></div>
            <div><dt>Lo que cobra hoy GoCardless</dt><dd className={c.diferenciaCent ? 'cxg-cifra cxg-distinto' : 'cxg-cifra'}>{euros(c.gocardlessCent)}</dd></div>
          </dl>
        )}
        {ficha && <div className="cxg-explica" data-tono={c?.diferenciaCent ? 'ambar' : 'verde'}>{ficha.diferencia.map((t, i) => <p key={i}>{t}</p>)}</div>}
      </section>

      <section aria-label="Cobro">
        <h3 className="cxg-ficha-sub">Cómo se le cobra</h3>
        <dl className="cxg-datos">
          <div><dt>Forma de cobro</dt><dd>{fila.formaCobro ? FORMA_COBRO[fila.formaCobro] : 'Sin decir'}</dd></div>
          <div><dt>Mandato</dt><dd><span className="cxg-estado" data-tono={m.tono}>{m.texto}</span></dd></div>
        </dl>
        <h3 className="cxg-ficha-sub">Últimos cobros</h3>
        {fila.cobros.length === 0 ? <p className="cxg-apoyo">Ningún cobro en los últimos 6 meses.</p> : (
          <ul className="cxg-cobros">
            {fila.cobros.map((x, i) => {
              const t = textoCobro(x.estado)
              return (
                <li key={i}>
                  <span>{fecha(x.fecha)}</span>
                  <span className="cxg-cifra">{euros(x.importeCent)}</span>
                  <span className="cxg-cobro"><span className="cxg-punto" data-tono={t.tono} aria-hidden="true" />{t.texto}{x.motivo ? ` · ${x.motivo}` : ''}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Lo que dice Bitrix24">
        <h3 className="cxg-ficha-sub">Lo que dice Bitrix24</h3>
        {!fila.bitrix ? <p className="cxg-apoyo">No tiene ficha en Bitrix24.</p> : (
          <dl className="cxg-datos">
            <div><dt>Situación</dt><dd>{fila.bitrix.situacion ? SITUACION[fila.bitrix.situacion] ?? fila.bitrix.situacion : '—'}</dd></div>
            <div><dt>Forma de pago</dt><dd>{fila.bitrix.formaPago ?? '—'}</dd></div>
            <div><dt>Servicios</dt><dd>{fila.bitrix.servicios.length ? fila.bitrix.servicios.join(', ') : '—'}</dd></div>
          </dl>
        )}
        <p className="cxg-apoyo">De referencia: Sumied no cambia la ficha de Bitrix24.</p>
      </section>
    </div>
  )
}
