import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGroupRecipient } from '../../../src/shared/chat/group-mentions.ts';

const members = [
  { id: 'noema', name: 'Noema' },
  { id: 'researcher', name: '新闻观察者' },
  { id: 'engineer', name: '工程搭档' },
];

test('an unmentioned group message uses the coordinator default', () => {
  assert.deepEqual(
    resolveGroupRecipient('大家看看这个进度', members, 'noema'),
    {
      agent: members[0],
      error: null,
    },
  );
});

test('one explicit @mention routes the public message to that member', () => {
  assert.deepEqual(
    resolveGroupRecipient('@工程搭档 帮我检查这个改动', members, 'noema'),
    {
      agent: members[2],
      error: null,
    },
  );
});

test('mentions work after punctuation while email addresses do not route', () => {
  assert.deepEqual(
    resolveGroupRecipient('请看一下（@工程搭档），谢谢', members, 'noema'),
    {
      agent: members[2],
      error: null,
    },
  );
});

test('names are matched exactly so a longer member name is not captured by a prefix', () => {
  const overlapping = [
    { id: 'one', name: '研究员' },
    { id: 'two', name: '研究员助理' },
  ];
  assert.deepEqual(
    resolveGroupRecipient('@研究员助理 看一下', overlapping, 'one'),
    {
      agent: overlapping[1],
      error: null,
    },
  );
});

test('ambiguous messages cannot silently route to just one of several mentioned members', () => {
  assert.deepEqual(
    resolveGroupRecipient(
      '@新闻观察者 查一下，@工程搭档 做个小工具',
      members,
      'noema',
    ),
    {
      agent: null,
      error: '一条群消息只能指定一位回应成员；请拆成多条消息。',
    },
  );
});

test('an email address does not accidentally route to a member', () => {
  assert.deepEqual(
    resolveGroupRecipient('邮箱：me@工程搭档.example', members, 'noema'),
    {
      agent: members[0],
      error: null,
    },
  );
});
