import QRCode from 'qrcode';

/** The wallet address as a QR code's modules, one string of 0s and 1s a row (the game draws it). */
export function qrRows(text: string) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      row += qr.modules.get(y, x) ? '1' : '0';
    }
    rows.push(row);
  }
  return rows;
}

