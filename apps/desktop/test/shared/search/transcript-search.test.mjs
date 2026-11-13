import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findTranscriptMatches,
  searchTranscriptHistory,
  userReferencesPastNoemaContext,
} from '../../../src/shared/search/transcript-search.ts';

test('history recall triggers on an explicit reference to prior conversation, not casual remembering', () => {
  assert.equal(
    userReferencesPastNoemaContext('你还记得我们上次讨论的碰撞箱办法吗？'),
    true,
  );
  assert.equal(
    userReferencesPastNoemaContext('我之前说过希望优先看到测试结果。'),
    true,
  );
  assert.equal(userReferencesPastNoemaContext('记得买牛奶。'), false);
  assert.equal(userReferencesPastNoemaContext('今天想聊聊咖啡。'), false);
});

const messages = [
  {
    id: 'user-1',
    role: 'user',
    content: '我们之后要验证 Noema 的长期对话是否好找。',
    createdAt: '2026-10-15T08:00:00.000Z',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: '检索只读取本地已保存的原文，不会修改模型上下文。',
    createdAt: '2026-10-15T08:00:01.000Z',
  },
];

test('search is case-insensitive, trims whitespace, and preserves timeline order', () => {
  assert.deepEqual(findTranscriptMatches(messages, '  NOEMA '), [
    {
      id: 'user-1',
      source: 'message',
      role: 'user',
      createdAt: '2026-10-15T08:00:00.000Z',
      snippet: '我们之后要验证 Noema 的长期对话是否好找。',
    },
  ]);
});

test('search supports direct Chinese substring matches and returns a bounded excerpt', () => {
  const longMessage = {
    ...messages[1],
    content: `${'前文'.repeat(40)}独立核验结果${'后文'.repeat(40)}`,
  };
  const [match] = findTranscriptMatches([longMessage], '核验结果');

  assert.equal(match.id, 'assistant-1');
  assert.match(match.snippet, /^…/);
  assert.match(match.snippet, /核验结果/);
  assert.match(match.snippet, /…$/);
  assert.ok(match.snippet.length < longMessage.content.length);
});

test('empty or unmatched queries do not produce results', () => {
  assert.deepEqual(findTranscriptMatches(messages, '  '), []);
  assert.deepEqual(findTranscriptMatches(messages, '不存在的词'), []);
});

test('local timeline search includes captures and keeps message/capture chronology', () => {
  const captures = [
    {
      id: 'capture-later',
      content: '记录：Noema 速记应能离线搜索。',
      createdAt: '2026-10-15T09:00:00.000Z',
      updatedAt: '2026-10-15T09:00:00.000Z',
      discussionTurnId: null,
    },
    {
      id: 'capture-earlier',
      content: '先记下 Noema 的搜索体验。',
      createdAt: '2026-10-15T07:00:00.000Z',
      updatedAt: '2026-10-15T07:00:00.000Z',
      discussionTurnId: null,
    },
  ];

  assert.deepEqual(
    findTranscriptMatches(messages, 'Noema', captures).map(
      ({ id, source }) => ({ id, source }),
    ),
    [
      { id: 'capture-earlier', source: 'capture' },
      { id: 'user-1', source: 'message' },
      { id: 'capture-later', source: 'capture' },
    ],
  );
});

test('agent history search finds a bounded source outside the recent context', () => {
  const transcript = [
    {
      ...messages[0],
      id: 'old-user-message',
      turnId: 'old-turn',
      status: 'complete',
      turnStatus: 'completed',
      content:
        '我后来让模型用体素化工具生成 Minecraft 模组模型的碰撞箱，这次才稳定。',
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      ...messages[1],
      id: `recent-${index}`,
      turnId: `recent-turn-${index}`,
      status: 'complete',
      turnStatus: 'completed',
      content: `最近讨论了普通事项 ${index}。`,
    })),
    {
      ...messages[1],
      id: 'current-user-message',
      turnId: 'current-turn',
      role: 'user',
      status: 'complete',
      turnStatus: 'streaming',
      content: '我们上次聊的 Minecraft 碰撞箱是什么办法？',
    },
  ];

  const [match] = searchTranscriptHistory(transcript, 'Minecraft 碰撞箱', {
    currentTurnId: 'current-turn',
  });

  assert.equal(match.id, 'old-user-message');
  assert.equal(match.role, 'user');
  assert.match(match.snippet, /体素化工具/);
  assert.ok(match.snippet.length <= 322);
});

test('agent history search excludes the current turn and incomplete history', () => {
  const transcript = [
    {
      ...messages[0],
      id: 'unfinished',
      turnId: 'unfinished-turn',
      status: 'failed',
      turnStatus: 'failed',
      content: 'Noema 历史记忆检索设计草案',
    },
    {
      ...messages[0],
      id: 'current',
      turnId: 'current-turn',
      status: 'complete',
      turnStatus: 'streaming',
      content: 'Noema 历史记忆检索设计草案',
    },
  ];

  assert.deepEqual(
    searchTranscriptHistory(transcript, 'Noema 历史记忆检索', {
      currentTurnId: 'current-turn',
    }),
    [],
  );
});

test('agent history search returns no broad match for generic reference words', () => {
  const transcript = messages.map((message, index) => ({
    ...message,
    turnId: `turn-${index}`,
    status: 'complete',
    turnStatus: 'completed',
  }));

  assert.deepEqual(
    searchTranscriptHistory(transcript, '之前我们讨论什么', {
      currentTurnId: 'current-turn',
    }),
    [],
  );
});

test('explicit past query ranks the relevant source above unrelated recent turns', () => {
  const transcript = [
    {
      ...messages[0],
      id: 'passphrase-source',
      turnId: 'passphrase-turn',
      status: 'complete',
      turnStatus: 'completed',
      content: '我之前给出的测试标记是 NOEMA-HISTORY-unique-marker。',
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      ...messages[1],
      id: `unrelated-${index}`,
      turnId: `unrelated-turn-${index}`,
      status: 'complete',
      turnStatus: 'completed',
      content: `植物养护与地铁路线话题 ${index}。`,
    })),
  ];

  const matches = searchTranscriptHistory(
    transcript,
    '[NOEMA E2E] 请回忆我之前给出的测试标记是什么？',
    { currentTurnId: 'current-turn' },
  );

  assert.equal(matches[0].id, 'passphrase-source');
  assert.match(matches[0].snippet, /NOEMA-HISTORY-unique-marker/);
});

test('history excerpts redact credential-shaped values before returning or sending them', () => {
  const token = 'sk-proj-1234567890abcdefghijklmnop';
  const transcript = [
    {
      ...messages[0],
      id: 'credential-source',
      turnId: 'credential-turn',
      status: 'complete',
      turnStatus: 'completed',
      content: `FreeLLMAPI API Key: ${token}`,
    },
  ];

  const [match] = searchTranscriptHistory(transcript, 'FreeLLMAPI API Key', {
    currentTurnId: 'current-turn',
  });

  assert.ok(match);
  assert.equal(match.redacted, true);
  assert.match(match.snippet, /已隐藏疑似凭据/);
  assert.doesNotMatch(match.snippet, /sk-proj-/);
});

test('history excerpts redact PEM private key blocks before returning or sending them', () => {
  const privateKey = [
    '-----BEGIN PRIVATE KEY-----',
    ...Array.from(
      { length: 24 },
      (_, index) => `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj${index}`,
    ),
    '-----END PRIVATE KEY-----',
  ].join('\n');
  const transcript = [
    {
      ...messages[0],
      id: 'pem-source',
      turnId: 'pem-turn',
      status: 'complete',
      turnStatus: 'completed',
      content: `部署说明：\n${privateKey}\n请勿外发。`,
    },
  ];

  const [match] = searchTranscriptHistory(transcript, '部署说明 请勿外发', {
    currentTurnId: 'current-turn',
  });

  assert.ok(match);
  assert.equal(match.redacted, true);
  assert.doesNotMatch(match.snippet, /BEGIN PRIVATE KEY|MIIEvQIB/);
  assert.match(match.snippet, /已隐藏疑似凭据/);
});

test('history redaction recognizes common bearer, provider, and labeled credential shapes', () => {
  const fixtures = [
    [
      'Bearer token fixture Bearer abcdefghijklmnop0123456789',
      'Bearer token fixture',
      'Bearer abcdefghijklmnop0123456789',
    ],
    [
      'GitHub token fixture ghp_abcdefghijklmnopqrstuvwxyz012345',
      'GitHub token fixture',
      'ghp_abcdefghijklmnopqrstuvwxyz012345',
    ],
    [
      'Slack token fixture xoxb-12345678-abcdefgh-ijklmnop',
      'Slack token fixture',
      'xoxb-12345678-abcdefgh-ijklmnop',
    ],
    [
      'FreeLLMAPI key fixture fla_1234567890abcdefghijklmnopqrst',
      'FreeLLMAPI key fixture',
      'fla_1234567890abcdefghijklmnopqrst',
    ],
    [
      'JWT fixture eyJabcdefghijk.eyJabcdefghijk.eyJabcdefghijk',
      'JWT fixture',
      'eyJabcdefghijk.eyJabcdefghijk.eyJabcdefghijk',
    ],
    [
      'password: noema-test-secret-value',
      'password',
      'noema-test-secret-value',
    ],
  ];

  for (const [content, query, secret] of fixtures) {
    const [match] = searchTranscriptHistory(
      [
        {
          ...messages[0],
          id: `credential-${secret.slice(0, 8)}`,
          turnId: 'credential-turn',
          status: 'complete',
          turnStatus: 'completed',
          content,
        },
      ],
      query,
      { currentTurnId: 'current-turn' },
    );

    assert.ok(match, `expected a match for ${content}`);
    assert.equal(match.redacted, true, `expected redaction for ${content}`);
    assert.equal(match.snippet.includes(secret), false);
  }
});

test('history redaction leaves ordinary conversation unchanged', () => {
  const transcript = [
    {
      ...messages[0],
      id: 'ordinary-source',
      turnId: 'ordinary-turn',
      status: 'complete',
      turnStatus: 'completed',
      content: '我们之前讨论过咖啡豆要怎么保存。',
    },
  ];

  const [match] = searchTranscriptHistory(transcript, '之前讨论咖啡豆保存', {
    currentTurnId: 'current-turn',
  });

  assert.ok(match);
  assert.equal(match.redacted, false);
  assert.doesNotMatch(match.snippet, /已隐藏疑似凭据/);
});
