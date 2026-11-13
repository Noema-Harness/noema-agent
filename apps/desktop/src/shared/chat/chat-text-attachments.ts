import { MAX_CHAT_PDF_ATTACHMENT_BYTES } from './chat-pdf-extraction.ts';

export const MAX_CHAT_ATTACHMENT_COUNT = 5;
export const MAX_CHAT_ATTACHMENT_BYTES = 256 * 1024;
export { MAX_CHAT_PDF_ATTACHMENT_BYTES };
export const MAX_CHAT_ATTACHMENT_CHARACTERS = 12_000;
export const MAX_CHAT_MESSAGE_CHARACTERS = 100_000;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);

export function isSupportedChatAttachment(file: { name?: string }) {
  const extension = String(file?.name ?? '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return TEXT_EXTENSIONS.has(extension ?? '') || extension === 'pdf';
}

export function maxChatAttachmentBytes(file: { name?: string }) {
  const extension = String(file?.name ?? '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return extension === 'pdf'
    ? MAX_CHAT_PDF_ATTACHMENT_BYTES
    : MAX_CHAT_ATTACHMENT_BYTES;
}

/**
 * Prepare text files as part of the same user message. No file paths or binary
 * assets survive this conversion; the resulting message is what history stores
 * and the selected model receives.
 */
export async function prepareChatMessage(
  text: string,
  files: Array<{
    name: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }>,
  {
    extractPdfText,
  }: {
    extractPdfText?: (file: {
      name: string;
      size: number;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }) => Promise<string>;
  } = {},
) {
  if (!Array.isArray(files) || files.length === 0) return text;
  if (files.length > MAX_CHAT_ATTACHMENT_COUNT) {
    throw new RangeError(
      `每条消息最多添加 ${MAX_CHAT_ATTACHMENT_COUNT} 个附件。`,
    );
  }

  const attachments = await Promise.all(
    files.map(async (file) => {
      const name = Array.from(String(file?.name ?? '附件'), (character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f ? ' ' : character;
      })
        .join('')
        .slice(0, 200);
      const extension = name.split('.').pop()?.toLowerCase();
      if (!isSupportedChatAttachment(file)) {
        throw new TypeError(
          `${name}：当前只支持 TXT、Markdown、CSV 和 PDF 文件。`,
        );
      }
      if (
        !Number.isInteger(file.size) ||
        file.size > maxChatAttachmentBytes(file)
      ) {
        throw new RangeError(
          extension === 'pdf'
            ? `${name}：PDF 附件不能超过 2 MiB。`
            : `${name}：单个文本附件不能超过 256 KiB。`,
        );
      }
      if (file.size === 0)
        throw new TypeError(`${name}：空文件没有可发送的内容。`);

      if (extension === 'pdf') {
        if (!extractPdfText) {
          throw new TypeError(`${name}：PDF 阅读器尚未就绪，请重试。`);
        }
        try {
          return { name, content: await extractPdfText(file) };
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : 'PDF 无法读取。';
          throw new TypeError(`${name}：${detail}`);
        }
      }

      let bytes;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        throw new TypeError(`${name}：文件读取失败，附件未发送。`);
      }
      if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
        throw new RangeError(`${name}：单个文本附件不能超过 256 KiB。`);
      }
      let content;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new TypeError(
          `${name}：文件无法按 UTF-8 文本读取；请另存为 UTF-8 后重试。`,
        );
      }
      if (content.includes('\0')) {
        throw new TypeError(
          `${name}：文件包含二进制内容，不能作为文字附件发送。`,
        );
      }
      return { name, content };
    }),
  );

  const attachmentCharacters = attachments.reduce(
    (total, attachment) => total + attachment.content.length,
    0,
  );
  if (attachmentCharacters > MAX_CHAT_ATTACHMENT_CHARACTERS) {
    throw new RangeError(
      `文字附件合计超过 ${MAX_CHAT_ATTACHMENT_CHARACTERS.toLocaleString('zh-CN')} 个字符；请拆分文件后再发送。`,
    );
  }

  const body = attachments
    .map(({ name, content }) => `附件文件：${JSON.stringify(name)}\n${content}`)
    .join('\n\n');
  const prompt = text.trim() ? text : '请阅读以下附件，并根据需要处理。';
  const message = `${prompt}\n\n${body}`;
  if (message.trim().length > MAX_CHAT_MESSAGE_CHARACTERS) {
    throw new RangeError(
      `消息与附件合计不能超过 ${MAX_CHAT_MESSAGE_CHARACTERS.toLocaleString('zh-CN')} 个字符。`,
    );
  }
  return message;
}
