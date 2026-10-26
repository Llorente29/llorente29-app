// src/modules/conta/lib/sepa.ts
//
// PC01 · Entrega 2 · El fichero de la remesa de transferencias para el banco:
// SEPA Credit Transfer, ISO 20022 pain.001.001.03 (el que piden los bancos
// españoles para pagos a proveedores). Sin React y sin red: recibe los datos
// (conta_remesa_fichero_datos) y devuelve el XML. Lo valida contra el esquema
// OFICIAL una unitaria (tests/fixtures/sepa/pain.001.001.03.xsd).
//
// En pantalla esto se llama «el fichero para el banco»: nada de «pain.001»,
// «XML» ni «SEPA» (palabras de la calle, encargo PC01). Los nombres técnicos
// viven aquí y en el fichero.
//
// Reglas del EPC que no mira el esquema y sí mira el banco:
//   · solo el juego de caracteres latino básico (a-z A-Z 0-9 / - ? : ( ) . , ' +
//     y espacio): los acentos se quitan, la ñ pasa a n y lo demás a espacio;
//   · un identificador no empieza ni acaba en «/» ni lleva «//»;
//   · importes con punto y dos decimales, en euros.
//
// El identificador del mensaje (MsgId) es el de la REMESA, siempre el mismo:
// si el fichero se sube dos veces, el banco rechaza el segundo por repetido y
// no se paga dos veces.

export interface OrdenanteSepa { nombre: string; nif: string | null; iban: string; bic: string | null }
export interface PagoSepa { id: string; importe: number; iban: string; bic: string | null; nombre: string; factura: string | null; fechaFactura: string | null }
export interface DatosRemesaSepa {
  codigo: string
  /** YYYY-MM-DD: el día que el banco hace las transferencias. */
  fechaPago: string
  /** Cuándo se crea el fichero (ISO). */
  creado: string
  ordenante: OrdenanteSepa
  pagos: readonly PagoSepa[]
  /** Sufijo del NIF que da el banco al ordenante (Cuaderno 34). Por defecto «000». */
  sufijo?: string
}

const PERMITIDOS = /[^A-Za-z0-9/\-?:().,'+ ]/g

/** Al juego de caracteres SEPA: sin acentos, ñ → n, lo demás a espacio, sin espacios de más. */
export function textoSepa(s: string, max: number): string {
  const limpio = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/&/g, 'Y').replace(/º/g, 'o').replace(/ª/g, 'a')
    .replace(PERMITIDOS, ' ').replace(/\s+/g, ' ').trim()
  return limpio.slice(0, max).trim()
}

/** Un identificador SEPA: sin espacios, sin «//», sin «/» al principio o al final, hasta 35. */
export function idSepa(s: string): string {
  const x = textoSepa(s, 70).replace(/ /g, '-').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  return x.slice(0, 35).replace(/\/+$/, '')
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export function importeSepa(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Un importe del fichero no es un número.')
  // eslint-disable-next-line no-restricted-syntax -- número ya comprobado: el formato del fichero es punto y dos decimales, no el de pantalla
  return (Math.round(n * 100) / 100).toFixed(2)
}
const iban = (s: string) => s.replace(/\s/g, '').toUpperCase()

/** El agente (banco): con su BIC si se sabe; si no, «NOTPROVIDED» (EPC, solo IBAN, desde 2016). */
function agente(bic: string | null, sangria: string): string {
  const b = bic?.replace(/\s/g, '').toUpperCase()
  return b && /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/.test(b)
    ? `${sangria}<FinInstnId><BIC>${b}</BIC></FinInstnId>`
    : `${sangria}<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`
}

/** Fecha y hora sin milisegundos ni zona (ISODateTime del esquema). */
const fechaHora = (iso: string) => new Date(iso).toISOString().slice(0, 19)

/** El XML del fichero. Los pagos, en el orden en que vienen. */
export function ficheroTransferencias(d: DatosRemesaSepa): string {
  if (d.pagos.length === 0) throw new Error('La remesa no tiene pagos.')
  const total = d.pagos.reduce((t, p) => t + Math.round(p.importe * 100), 0) / 100
  const msg = idSepa(`SUMIED-${d.codigo}`)
  const nombre = textoSepa(d.ordenante.nombre, 70)
  const idOrdenante = d.ordenante.nif ? textoSepa(`${d.ordenante.nif}${d.sufijo ?? '000'}`, 35).replace(/ /g, '') : null
  const txs = d.pagos.map((p, i) => {
    const concepto = textoSepa([p.factura ? `Factura ${p.factura}` : 'Pago', p.fechaFactura ? `de ${p.fechaFactura.split('-').reverse().join('/')}` : ''].join(' '), 140)
    return [
      '      <CdtTrfTxInf>',
      `        <PmtId><EndToEndId>${xml(idSepa(`${d.codigo}-${i + 1}`))}</EndToEndId></PmtId>`,
      `        <Amt><InstdAmt Ccy="EUR">${importeSepa(p.importe)}</InstdAmt></Amt>`,
      ...(p.bic ? ['        <CdtrAgt>', agente(p.bic, '          '), '        </CdtrAgt>'] : []),
      `        <Cdtr><Nm>${xml(textoSepa(p.nombre, 70))}</Nm></Cdtr>`,
      `        <CdtrAcct><Id><IBAN>${iban(p.iban)}</IBAN></Id></CdtrAcct>`,
      `        <RmtInf><Ustrd>${xml(concepto)}</Ustrd></RmtInf>`,
      '      </CdtTrfTxInf>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <CstmrCdtTrfInitn>',
    '    <GrpHdr>',
    `      <MsgId>${xml(msg)}</MsgId>`,
    `      <CreDtTm>${fechaHora(d.creado)}</CreDtTm>`,
    `      <NbOfTxs>${d.pagos.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    `      <InitgPty><Nm>${xml(nombre)}</Nm>${idOrdenante ? `<Id><OrgId><Othr><Id>${xml(idOrdenante)}</Id></Othr></OrgId></Id>` : ''}</InitgPty>`,
    '    </GrpHdr>',
    '    <PmtInf>',
    `      <PmtInfId>${xml(idSepa(`${d.codigo}-PAGOS`))}</PmtInfId>`,
    '      <PmtMtd>TRF</PmtMtd>',
    '      <BtchBookg>true</BtchBookg>',
    `      <NbOfTxs>${d.pagos.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>',
    `      <ReqdExctnDt>${d.fechaPago}</ReqdExctnDt>`,
    `      <Dbtr><Nm>${xml(nombre)}</Nm></Dbtr>`,
    `      <DbtrAcct><Id><IBAN>${iban(d.ordenante.iban)}</IBAN></Id></DbtrAcct>`,
    '      <DbtrAgt>', agente(d.ordenante.bic, '        '), '      </DbtrAgt>',
    '      <ChrgBr>SLEV</ChrgBr>',
    ...txs,
    '    </PmtInf>',
    '  </CstmrCdtTrfInitn>',
    '</Document>',
    '',
  ].join('\n')
}

/** El nombre del fichero que se descarga: «remesa-R-2026-014.xml». */
export const nombreFicheroRemesa = (codigo: string) => `remesa-${codigo.replace(/\//g, '-')}.xml`
