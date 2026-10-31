import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_CHARACTERS,
  MAX_CHAT_ATTACHMENT_COUNT,
  MAX_CHAT_MESSAGE_CHARACTERS,
  isSupportedChatAttachment,
  MAX_CHAT_PDF_ATTACHMENT_BYTES,
  prepareChatMessage,
} from '../../../src/shared/chat/chat-text-attachments.mjs';
import {
  MAX_CHAT_PDF_PAGES,
  extractChatPdfText,
} from '../../../src/shared/chat/chat-pdf-extraction.mjs';

function textFile(name, text, type = 'text/plain') {
  return new File([text], name, { type });
}

test('text attachments become part of the exact user message sent and stored', async () => {
  const content = await prepareChatMessage('Summarize this.', [
    textFile('notes.md', '# Notes\n\nKeep the launch date private.'),
    textFile('prices.csv', 'item,price\ntea,4'),
  ]);

  assert.match(content, /^Summarize this\./u);
  assert.match(
    content,
    /附件文件："notes\.md"\n# Notes\n\nKeep the launch date private\./u,
  );
  assert.match(content, /附件文件："prices\.csv"\nitem,price\ntea,4/u);
});

test('an attachment-only message gets a clear user request', async () => {
  assert.equal(
    await prepareChatMessage('  ', [textFile('ideas.txt', 'One idea.')]),
    '请阅读以下附件，并根据需要处理。\n\n附件文件："ideas.txt"\nOne idea.',
  );
});

test('plain-text messages pass through unchanged', async () => {
  assert.equal(
    await prepareChatMessage('Keep my spaces.  ', []),
    'Keep my spaces.  ',
  );
});

test('the attachment boundary supports PDF and text formats, and enforces byte limits', async () => {
  assert.equal(isSupportedChatAttachment({ name: 'notes.MD' }), true);
  assert.equal(isSupportedChatAttachment({ name: 'report.PDF' }), true);
  assert.equal(isSupportedChatAttachment({ name: 'photo.png' }), false);
  await assert.rejects(
    prepareChatMessage('', [textFile('photo.png', 'not sent')]),
    /只支持 TXT、Markdown、CSV 和 PDF/u,
  );
  await assert.rejects(
    prepareChatMessage('', [
      textFile('large.txt', 'x'.repeat(MAX_CHAT_ATTACHMENT_BYTES + 1)),
    ]),
    /256 KiB/u,
  );
  await assert.rejects(
    prepareChatMessage(
      '',
      Array.from({ length: MAX_CHAT_ATTACHMENT_COUNT + 1 }, (_, index) =>
        textFile(`${index}.txt`, 'x'),
      ),
    ),
    /最多添加 5 个/u,
  );
});

test('PDF text is extracted into the same message without retaining the file', async () => {
  const file = new File(
    ['pdf bytes are passed to the extractor'],
    'brief.pdf',
    {
      type: 'application/pdf',
    },
  );
  const content = await prepareChatMessage('Review this.', [file], {
    async extractPdfText(selectedFile) {
      assert.equal(selectedFile, file);
      return 'Quarterly plan\nReduce cycle time.';
    },
  });

  assert.equal(
    content,
    'Review this.\n\n附件文件："brief.pdf"\nQuarterly plan\nReduce cycle time.',
  );
  await assert.rejects(prepareChatMessage('', [file]), /PDF 阅读器尚未就绪/u);
  await assert.rejects(
    prepareChatMessage(
      '',
      [new File(['x'.repeat(MAX_CHAT_PDF_ATTACHMENT_BYTES + 1)], 'large.pdf')],
      {
        extractPdfText: async () => 'not reached',
      },
    ),
    /不能超过 2 MiB/u,
  );
});

function makeOnePagePdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new File([pdf], 'brief.pdf', { type: 'application/pdf' });
}

test('the PDF.js extractor reads real PDF text and rejects scanned PDFs', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const text = await extractChatPdfText(makeOnePagePdf('Noema PDF text'), {
    pdfjs,
  });
  assert.match(text, /Noema PDF text/u);

  const emptyPdf = makeOnePagePdf('');
  await assert.rejects(
    extractChatPdfText(emptyPdf, {
      pdfjs: {
        ...pdfjs,
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            async getPage() {
              return {
                async getTextContent() {
                  return { items: [] };
                },
                cleanup() {},
              };
            },
          }),
          async destroy() {},
        }),
      },
    }),
    /扫描件图片暂不支持/u,
  );
});

test('PDF extraction rejects excessive page and extracted-text budgets', async () => {
  const makePdfjs = (numPages, pageText) => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages,
        async getPage() {
          return {
            async getTextContent() {
              return { items: [{ str: pageText, hasEOL: true }] };
            },
            cleanup() {},
          };
        },
      }),
      async destroy() {},
    }),
  });
  const file = makeOnePagePdf('sample');
  await assert.rejects(
    extractChatPdfText(file, { pdfjs: makePdfjs(MAX_CHAT_PDF_PAGES + 1, 'x') }),
    /最多支持 40 页/u,
  );
  await assert.rejects(
    extractChatPdfText(file, {
      pdfjs: makePdfjs(1, 'too many'),
      maxCharacters: 3,
    }),
    /拆分文件后重试/u,
  );
});

test('attachment preparation never truncates oversize, empty, binary, or invalid UTF-8 content', async () => {
  await assert.rejects(
    prepareChatMessage('', [
      textFile('large.md', 'x'.repeat(MAX_CHAT_ATTACHMENT_CHARACTERS + 1)),
    ]),
    /拆分文件/u,
  );
  await assert.rejects(
    prepareChatMessage('', [textFile('empty.txt', '')]),
    /空文件/u,
  );
  await assert.rejects(
    prepareChatMessage('', [textFile('binary.csv', '\u0000')]),
    /二进制内容/u,
  );

  const invalidUtf8 = new File([new Uint8Array([0xc3, 0x28])], 'broken.txt');
  await assert.rejects(prepareChatMessage('', [invalidUtf8]), /UTF-8/u);
  await assert.rejects(
    prepareChatMessage('', [
      {
        name: 'unreadable.txt',
        size: 1,
        async arrayBuffer() {
          throw new Error('read failure');
        },
      },
    ]),
    /文件读取失败/u,
  );
  await assert.rejects(
    prepareChatMessage('x'.repeat(MAX_CHAT_MESSAGE_CHARACTERS), [
      textFile('extra.txt', 'y'),
    ]),
    /消息与附件合计/u,
  );
});

test('filenames cannot inject control characters into attachment labels', async () => {
  const file = new File(['body'], 'line\nbreak.txt');
  const content = await prepareChatMessage('', [file]);
  assert.match(content, /附件文件："line break\.txt"/u);
});
