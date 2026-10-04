# C01b · Contraste: la ficha de proveedor en Holded, Pennylane y Cegid Diez

Media página (encargo §6). Fuentes públicas, consultadas el 04/10/2026.

**Aviso de método:** desde aquí no se pueden abrir las páginas de ayuda de los tres (el proxy las corta). Lo de abajo sale de los fragmentos que devuelve el buscador de esas páginas oficiales. Lo que no aparece se marca «no documentado»: no quiere decir que no exista.

## Qué hacen

**Holded.**
- La ficha tiene pestañas: datos básicos, bancos, preferencias y contabilidad ([crear un contacto](https://help.holded.com/en/articles/6921812-create-a-contact)).
- Banco: IBAN y SWIFT para las remesas, y la referencia y fecha del mandato SEPA. El IBAN también se rellena al pagar una factura.
- Hay una pestaña de archivos para adjuntar documentos ([gestionar contactos](https://help.holded.com/en/articles/6922239-manage-your-contacts)), y personas de contacto ([importar](https://help.holded.com/en/articles/7325554-import-your-contacts)).
- En preferencias se **fija a mano** la cuenta de gasto del contacto, y sus facturas se clasifican con ella ([cuenta de gasto por contacto](https://help.holded.com/en/articles/6984553-assign-a-sales-and-expense-account)).
- No documentado: cifras arriba, validación del IBAN, caducidad de documentos, papel de cada contacto y aprendizaje.

**Pennylane.**
- Guarda el IBAN del proveedor y **avisa si una factura trae otro**. Con aprobación activada, los pagos a ese IBAN quedan parados hasta que alguien lo apruebe ([aprobación de IBAN](https://help.pennylane.com/fr/articles/323970-securiser-les-paiements-avec-l-approbation-des-iban-fournisseurs), [fraude](https://help.pennylane.com/fr/articles/473250-reperer-la-fraude-a-la-facture)).
- Reglas por proveedor: categoría, IVA, cuenta de gasto, plazo y forma de pago para sus facturas futuras ([reglas](https://help.pennylane.com/fr/articles/239273-fournisseurs-creer-des-regles-automatiques-de-categorisation), [forma de pago](https://help.pennylane.com/fr/articles/61158-indiquer-le-mode-de-paiement-d-un-fournisseur)).
- Su OCR aprende de las facturas ya tratadas y sugiere ([OCR](https://help.pennylane.com/fr/articles/18639-decouvrir-l-ocr-pennylane)).
- Un fichero idéntico se rechaza, y si los datos se parecen avisa de posible duplicado ([duplicados](https://help.pennylane.com/fr/articles/18789-archiver-ou-supprimer-des-transactions-bancaires-et-des-factures)).
- No documentado: cifras arriba, contactos con papel y documentos con caducidad.

**Cegid Diez (DiezCON / DiezFAC).**
- No he encontrado ayuda pública sobre su ficha de proveedor: el soporte es por foro, teléfono y chat.
- Consta que DiezFAC pasa facturas, remesas, cobros y pagos a DiezCON, y que tiene un OCR, SCAN ([DiezCON](https://www.cegid.com/ib/es/productos/programa-contabilidad-pymes-autonomos/)).
- Lo de duplicados solo lo cuentan herramientas de terceros.

## Qué hacemos mejor

1. **Todo arriba, en la primera pantalla.** Cuánto le has comprado, cuánto le debes, el próximo pago y la última factura; el % de ficha con lo que falta (cada cosa, un enlace a su campo) y «Pedírselo por correo». Ninguno de los tres documenta un resumen así.
2. **La IA dice lo que ha aprendido y por qué.** «Le pagas por transferencia · Lo confirmaste tú 3 veces» o «Así vienen todas sus facturas», con «Cambiar» y su rastro en «Lo que ha hecho Folvy». En Holded la cuenta se fija a mano. Pennylane sí aprende y tiene reglas, pero no explica en la ficha el porqué de cada propuesta. Y nosotros **nunca** apuntamos nada sin confirmación.
3. **Contactos con papel** (pedidos, comercial, administración, reparto). El de administración es a quien va el aviso de un documento que caduca, y la ficha dice si falta.
4. **Documentos con caducidad**, en ámbar cuando caducan pronto, y el certificado del banco como parte de la ficha completa.
5. **Repetida explicada en la fila:** «Mismo número e importe que la de arriba. No la he apuntado.», fuera de todas las cifras hasta que la persona decida.

## Qué hacen mejor que nosotros (pendiente)

- **Pennylane detecta un IBAN nuevo en una factura y para el pago** hasta que se apruebe. Nosotros comprobamos el IBAN y pedimos el certificado del banco, pero no comparamos el IBAN de cada factura con el de la ficha. Es la defensa contra el fraude del «cambio de cuenta», y va al PR como pendiente (propuesta para el C02, con la lectura de facturas).
- **Pennylane rechaza el fichero idéntico al subirlo.** Nuestra repetida se basa en número e importe, ya dentro: no evita que se suba el mismo PDF dos veces.
