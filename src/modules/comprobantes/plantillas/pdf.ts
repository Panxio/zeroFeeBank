import PDFDocument from 'pdfkit';

export interface DatosTransferenciaPdf {
  id: string;
  fecha: string;
  origen: string;
  destino: string;
  monto: string;
}

export interface DatosBoletaComprobantePdf {
  id: string;
  cuenta: string;
  monto: string;
  emitidaEn: string;
  venceEn: string;
  beneficiarioRut: string;
  beneficiarioNombre: string;
  glosa: string;
  retiradorRut: string;
  retiradorNombre: string;
}

export interface DatosBoletaResumenPdf extends DatosBoletaComprobantePdf {
  estado: string;
  cierre: string;
}

function generarBuffer(
  ahora: Date,
  construir: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  const doc = new PDFDocument({
    info: {
      CreationDate: ahora,
      ModDate: ahora,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    construir(doc);
    doc.end();
  });
}

export async function generarTransferenciaPdf(
  datos: DatosTransferenciaPdf,
  ahora: Date,
): Promise<Buffer> {
  return generarBuffer(ahora, (doc) => {
    doc.fontSize(14).text('COMPROBANTE DE TRANSFERENCIA');
    doc.moveDown();

    doc.fontSize(10);
    doc.text('ID de Transacción:');
    doc.text(datos.id);
    doc.moveDown(0.5);

    doc.text('Fecha de Operación:');
    doc.text(datos.fecha);
    doc.moveDown(0.5);

    doc.text('Cuenta de Origen:');
    doc.text(datos.origen);
    doc.moveDown(0.5);

    doc.text('Cuenta de Destino:');
    doc.text(datos.destino);
    doc.moveDown(0.5);

    doc.text('Monto:');
    doc.text(datos.monto);
  });
}

export async function generarBoletaComprobantePdf(
  datos: DatosBoletaComprobantePdf,
  ahora: Date,
): Promise<Buffer> {
  return generarBuffer(ahora, (doc) => {
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#111111').text('zeroFeeBank');
    doc.moveDown(0.3);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#333333').text('COMPROBANTE DE BOLETA DE GARANTIA');
    doc.moveDown(0.8);

    const yId = doc.y;
    doc.rect(72, yId, 468, 36).fillAndStroke('#f4f4f4', '#cccccc');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#555555').text('ID Boleta:', 84, yId + 11, { continued: true });
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text(`  ${datos.id}`);
    doc.y = yId + 48;

    const filas: [string, string][] = [
      ['Cuenta de Origen:', datos.cuenta],
      ['Monto:', datos.monto],
      ['Fecha de Emisión (UTC):', datos.emitidaEn],
      ['Fecha de Vencimiento (UTC):', datos.venceEn],
      ['RUT Beneficiario:', datos.beneficiarioRut],
      ['Nombre Beneficiario:', datos.beneficiarioNombre],
      ['Glosa:', datos.glosa],
      ['RUT Retirador:', datos.retiradorRut],
      ['Nombre Retirador:', datos.retiradorNombre],
    ];

    let currentY = doc.y;
    for (const [rotulo, valor] of filas) {
      const hRotulo = doc.fontSize(10).font('Helvetica-Bold').heightOfString(rotulo, { width: 170 });
      const hValor = doc.fontSize(10).font('Helvetica').heightOfString(valor, { width: 290 });
      const rowHeight = Math.max(hRotulo, hValor) + 6;

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#444444').text(rotulo, 72, currentY, { width: 170 });
      doc.fontSize(10).font('Helvetica').fillColor('#111111').text(valor, 245, currentY, { width: 290 });

      currentY += rowHeight;
    }
  });
}

export async function generarBoletaResumenPdf(
  datos: DatosBoletaResumenPdf,
  ahora: Date,
): Promise<Buffer> {
  return generarBuffer(ahora, (doc) => {
    doc.fontSize(20).font('Helvetica-Bold').text('zeroFeeBank');
    doc.moveDown(0.3);
    doc.fontSize(14).font('Helvetica-Bold').text('RESUMEN DE BOLETA DE GARANTIA');
    doc.moveDown(0.8);

    const yId = doc.y;
    doc.rect(72, yId, 468, 36).fillAndStroke('#f4f4f4', '#cccccc');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#555555').text('ID Boleta:', 84, yId + 11, { continued: true });
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text(`  ${datos.id}`);
    doc.y = yId + 48;

    const filas: [string, string][] = [
      ['Estado:', datos.estado],
      ['Fecha de Cierre (UTC):', datos.cierre],
      ['Cuenta de Origen:', datos.cuenta],
      ['Monto:', datos.monto],
      ['Fecha de Emisión (UTC):', datos.emitidaEn],
      ['Fecha de Vencimiento (UTC):', datos.venceEn],
      ['RUT Beneficiario:', datos.beneficiarioRut],
      ['Nombre Beneficiario:', datos.beneficiarioNombre],
      ['Glosa:', datos.glosa],
      ['RUT Retirador:', datos.retiradorRut],
      ['Nombre Retirador:', datos.retiradorNombre],
    ];

    let currentY = doc.y;
    for (const [rotulo, valor] of filas) {
      const hRotulo = doc.fontSize(10).font('Helvetica-Bold').heightOfString(rotulo, { width: 170 });
      const hValor = doc.fontSize(10).font('Helvetica').heightOfString(valor, { width: 290 });
      const rowHeight = Math.max(hRotulo, hValor) + 6;

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#444444').text(rotulo, 72, currentY, { width: 170 });
      doc.fontSize(10).font('Helvetica').fillColor('#111111').text(valor, 245, currentY, { width: 290 });

      currentY += rowHeight;
    }
  });
}
