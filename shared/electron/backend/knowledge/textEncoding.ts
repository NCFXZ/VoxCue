import { analyse } from 'chardet';

const encodingError = () => Error('无法识别文本编码，请另存为 UTF-8 后重试。');
const invalidText = () => Error('文件不是有效文本，请检查内容后重试。');
const controls = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u;

function validateText(text: string) {
  if (text.length > 8_000_000) throw Error('解析后的文字超过 8 MB，请拆分文档。');
  if (!text.trim() || controls.test(text)) throw invalidText();
  return text;
}

function decode(bytes: Uint8Array, encoding: string) {
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw encodingError();
  }
  return validateText(text);
}

function utf16WithoutBom(bytes: Uint8Array): string | undefined {
  if (bytes.length < 8 || bytes.length % 2) return;
  const pairs = Math.min(bytes.length / 2, 32_768);
  let evenZeros = 0,
    oddZeros = 0;
  for (let i = 0; i < pairs * 2; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  // Only infer byte order from a strong ASCII/NUL pattern. Pure CJK UTF-16
  // without a BOM is ambiguous with legacy encodings and must not be guessed.
  if (oddZeros / pairs >= 0.3 && evenZeros / pairs <= 0.02) return 'utf-16le';
  if (evenZeros / pairs >= 0.3 && oddZeros / pairs <= 0.02) return 'utf-16be';
}

function supportedEncoding(name: string): string | undefined {
  switch (name.toLowerCase()) {
    case 'gb18030':
    case 'gbk':
      return 'gb18030';
    case 'big5':
      return 'big5';
    case 'iso-8859-1':
    case 'windows-1252':
      return 'windows-1252';
  }
}

export function decodeKnowledgeText(bytes: Uint8Array): string {
  if (!bytes.length) throw invalidText();
  if (bytes.length > 20 * 1024 * 1024) throw Error('文件超过 20 MB，请拆分文档。');
  // UTF-32 starts like UTF-16LE; reject it before checking UTF-16 BOMs.
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  )
    throw encodingError();
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode(bytes, 'utf-8');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode(bytes, 'utf-16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode(bytes, 'utf-16be');
  const utf16 = utf16WithoutBom(bytes);
  if (utf16) return decode(bytes, utf16);
  // NUL is not valid document text. Do not let legacy decoders disguise binary.
  if (bytes.includes(0)) throw invalidText();
  let utf8: string | undefined;
  try {
    utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Use statistical recognition only after strict Unicode paths fail.
  }
  if (utf8 !== undefined) return validateText(utf8);
  const matches = analyse(bytes.subarray(0, 65_536));
  const first = matches[0],
    second = matches[1];
  const encoding = first && supportedEncoding(first.name);
  if (!encoding || first.confidence < 60 || (second && first.confidence - second.confidence < 15))
    throw encodingError();
  // Validate the complete document, including bytes beyond the detection sample.
  return decode(bytes, encoding);
}
