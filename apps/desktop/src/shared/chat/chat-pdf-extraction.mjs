export const MAX_CHAT_PDF_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_CHAT_PDF_PAGES = 40;

/**
 * @param {{name?:string,size:number,arrayBuffer:()=>Promise<ArrayBuffer>}} file
 * @param {{pdfjs?:{getDocument:(options:object)=>{promise:Promise<any>,destroy:()=>Promise<void>},GlobalWorkerOptions:{workerSrc?:string}},workerSrc?:string,maxCharacters?:number}} options
 */
export async function extractChatPdfText(
  file,
  { pdfjs, workerSrc = '', maxCharacters = 12_000 } = {},
) {
  if (
    !Number.isInteger(file?.size) ||
    file.size === 0 ||
    file.size > MAX_CHAT_PDF_ATTACHMENT_BYTES
  ) {
    throw new RangeError('PDF 附件必须为非空文件且不超过 2 MiB。');
  }
  if (!pdfjs?.getDocument || !pdfjs?.GlobalWorkerOptions) {
    throw new TypeError('PDF 阅读器尚未就绪，请重试。');
  }
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new RangeError('PDF 文字提取上限配置无效。');
  }

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new TypeError('PDF 文件读取失败，附件未发送。');
  }
  if (bytes.byteLength > MAX_CHAT_PDF_ATTACHMENT_BYTES) {
    throw new RangeError('PDF 附件不能超过 2 MiB。');
  }

  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
  });
  let document;
  try {
    try {
      document = await loadingTask.promise;
    } catch {
      throw new TypeError('PDF 无法读取；请确认文件未损坏或加密。');
    }
    if (document.numPages > MAX_CHAT_PDF_PAGES) {
      throw new RangeError(`PDF 最多支持 ${MAX_CHAT_PDF_PAGES} 页。`);
    }

    const pages = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      let page;
      let pageText;
      try {
        page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        pageText = textContent.items
          .filter((item) => typeof item?.str === 'string')
          .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
          .join('')
          .replace(/[ \t]+\n/gu, '\n')
          .trim();
      } catch {
        throw new TypeError('PDF 无法读取；请确认文件未损坏或加密。');
      } finally {
        page?.cleanup();
      }
      characterCount += pageText.length;
      if (characterCount > maxCharacters) {
        throw new RangeError(
          `PDF 提取文字超过 ${maxCharacters.toLocaleString('zh-CN')} 个字符；请拆分文件后重试。`,
        );
      }
      if (pageText) pages.push(pageText);
    }

    const content = pages.join('\n\n');
    if (!content) {
      throw new TypeError('PDF 中没有可提取的文字；扫描件图片暂不支持。');
    }
    return content;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
