import assert from 'node:assert/strict';
import test from 'node:test';
import { linkWebSourceCitations } from '../src/web-source-citations.mjs';

test('maps model citation markers only to successfully read source URLs', () => {
  const rendered = linkWebSourceCitations(
    '价格为 12 元 [[S1]]；另一个结论 [[S2]]；未知来源 [[S3]]。',
    [
      { citationId: 'S1', url: 'https://example.com/price?q=1' },
      { citationId: 'S2', url: 'https://example.org/policy' },
    ],
  );

  assert.equal(
    rendered,
    '价格为 12 元 [S1](<https://example.com/price?q=1>)；另一个结论 [S2](<https://example.org/policy>)；未知来源 [[S3]]。',
  );
});

test('leaves invalid and non-web source URLs as plain markers', () => {
  const rendered = linkWebSourceCitations('来源 [[S1]] [[S2]]', [
    { citationId: 'S1', url: 'file:///private/source' },
    { citationId: 'S2', url: 'not a URL' },
  ]);

  assert.equal(rendered, '来源 [[S1]] [[S2]]');
});
