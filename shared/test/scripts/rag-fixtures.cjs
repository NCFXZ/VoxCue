const projectRequire = require('node:module').createRequire(
  require('node:path').join(process.cwd(), 'package.json'),
);
// Synthetic fixtures only. No user documents, personal facts or network access.
exports.pdf = (pages = ['PID sensor feedback controls lift-off.', 'The synthetic gain is 37.']) => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < pages.length; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const stream = `BT /F1 12 Tf 40 740 Td (${pages[i].replace(/[\\()]/g, '\\$&')}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(content));
    content += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
};
exports.docx = async (paragraphs = ['中文 DOCX sensor feedback.', 'Second paragraph is retained.']) => {
  const { createRequire } = require('node:module');
  const req = createRequire(projectRequire.resolve('mammoth'));
  const Zip = req('jszip');
  const zip = new Zip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map(text => '<w:p><w:r><w:t>' +
        text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') +
        '</w:t></w:r></w:p>').join('') + '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

// Minimal Word 97 binary document: CFB v3, two regular streams and one text piece.
// Keeping both streams at 4096 bytes avoids the unrelated CFB mini-stream path.
exports.doc = (
  body = '中文 DOC sensor feedback.\rSecond paragraph is retained.\r项目\x07数值\x07\rPID\x0737\x07\r',
  { compressed = false, tableStream = '0Table' } = {},
) => {
  const normalized = body.replace(/\r?\n/g, '\r');
  if (compressed && /[^\x00-\x7f]/.test(normalized))
    throw Error('Compressed synthetic DOC text must be ASCII.');
  if (!['0Table', '1Table'].includes(tableStream))
    throw Error('Invalid synthetic DOC table stream.');
  const text = Buffer.from(normalized, compressed ? 'ascii' : 'utf16le');
  if (text.length > 2560) throw Error('Synthetic DOC text exceeds the fixture stream.');
  const bytes = Buffer.alloc(19 * 512);
  const header = bytes.subarray(0, 512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44); // FAT sector count.
  header.writeUInt32LE(0, 48); // Directory starts at sector 0.
  header.writeUInt32LE(4096, 56);
  header.writeInt32LE(-2, 60); // No mini FAT or DIFAT extension.
  header.writeInt32LE(-2, 68);
  header.fill(0xff, 76);
  header.writeUInt32LE(1, 76); // FAT lives at sector 1.

  const directory = bytes.subarray(512, 1024);
  const entry = (index, name, type, sector, size) => {
    const data = directory.subarray(index * 128, (index + 1) * 128);
    const encoded = Buffer.from(name + '\0', 'utf16le');
    encoded.copy(data);
    data.writeUInt16LE(encoded.length, 64);
    data[66] = type;
    data[67] = 1;
    for (const offset of [68, 72, 76]) data.writeInt32LE(-1, offset);
    data.writeInt32LE(sector, 116);
    data.writeUInt32LE(size, 120);
    return data;
  };
  entry(0, 'Root Entry', 5, -2, 0).writeUInt32LE(1, 76);
  entry(1, 'WordDocument', 2, 2, 4096).writeUInt32LE(2, 68);
  entry(2, tableStream, 2, 10, 4096)[67] = 0;
  const fat = bytes.subarray(1024, 1536);
  fat.fill(0xff);
  fat.writeInt32LE(-2, 0);
  fat.writeInt32LE(-3, 4);
  for (let sector = 2; sector < 18; sector++)
    fat.writeInt32LE(sector === 9 || sector === 17 ? -2 : sector + 1, sector * 4);

  const word = bytes.subarray(1536, 5632);
  word.writeUInt16LE(0xa5ec, 0);
  word.writeUInt16LE(0x00c1, 2); // Word 97 Fib version.
  word.writeUInt16LE(0x0409, 6);
  word.writeUInt16LE(0x1004 | (tableStream === '1Table' ? 0x0200 : 0), 10);
  word.writeUInt16LE(0x00bf, 12);
  word.writeUInt32LE(0x600, 0x18);
  word.writeUInt32LE(0x600 + text.length, 0x1c);
  word.writeUInt16LE(14, 0x20);
  word.writeUInt16LE(22, 0x3e);
  word.writeUInt32LE(4096, 0x40);
  word.writeUInt32LE(normalized.length, 0x4c);
  word.writeUInt16LE(93, 0x98);
  word.writeUInt32LE(21, 0xfa); // Empty character/paragraph formatting PLCs.
  word.writeUInt32LE(4, 0xfe);
  word.writeUInt32LE(25, 0x102);
  word.writeUInt32LE(4, 0x106);
  word.writeUInt32LE(0, 0x1a2); // fcClx.
  word.writeUInt32LE(21, 0x1a6); // lcbClx.
  text.copy(word, 0x600);
  const table = bytes.subarray(5632);
  table[0] = 2; // Pcdt, containing one PlcPcd piece.
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(normalized.length, 9);
  table.writeUInt32LE(compressed ? 0x40000c00 : 0x600, 15);
  table.writeUInt32LE(0x600 + text.length, 21);
  table.writeUInt32LE(0x600 + text.length, 25);
  return bytes;
};
