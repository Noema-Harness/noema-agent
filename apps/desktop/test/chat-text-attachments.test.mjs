import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_CHARACTERS,
  MAX_CHAT_ATTACHMENT_COUNT,
  MAX_CHAT_MESSAGE_CHARACTERS,
  isSupportedChatTextAttachment,
  prepareChatMessage,
} from '../src/chat-text-attachments.mjs';

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

test('the text attachment boundary rejects unsupported files and enforces byte limits', async () => {
  assert.equal(isSupportedChatTextAttachment({ name: 'notes.MD' }), true);
  assert.equal(isSupportedChatTextAttachment({ name: 'photo.png' }), false);
  await assert.rejects(
    prepareChatMessage('', [textFile('report.pdf', 'not sent')]),
    /只支持 TXT、Markdown 和 CSV/u,
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
