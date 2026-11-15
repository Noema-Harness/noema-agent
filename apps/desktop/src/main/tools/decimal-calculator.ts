import Decimal from 'decimal.js';

export const CALCULATE_EXPRESSION_TOOL = {
  type: 'function',
  function: {
    name: 'calculate_expression',
    description:
      '核算会影响答复的算术。只接受含普通十进制数字、括号和 + - * / 的表达式；先把百分比写成显式乘法或除法。输入数字及其来源由模型提供，此工具不核实这些输入或假设。',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: '仅数学表达式，不含货币符号、百分号或自然语言。',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
};

const ARITHMETIC_REQUEST_PATTERN =
  /(?:\d|[%×÷=+*/]|核算|计算|算一算|求和|合计|总额|差额|利润|成本|预算|折扣|税额|税率|利率|收益率|增长率|比例|人均|平均|相差|增加了多少|减少了多少)/u;

export function needsCalculationTool(text: unknown) {
  return typeof text === 'string' && ARITHMETIC_REQUEST_PATTERN.test(text);
}

const CalculationDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  minE: -10_000,
  maxE: 10_000,
  toExpNeg: -12,
  toExpPos: 24,
});
const MAX_EXPRESSION_LENGTH = 512;
const MAX_TOKENS = 160;
const MAX_LITERAL_DIGITS = 128;
const MAX_PARSE_DEPTH = 32;

type CalculationValue = InstanceType<typeof CalculationDecimal>;
type Token = { type: 'number' | 'operator'; value: string };

export function calculateExpression(source: unknown) {
  if (typeof source !== 'string' || !source.trim())
    throw new TypeError('请输入算术表达式。');
  if (source.length > MAX_EXPRESSION_LENGTH)
    throw new RangeError('表达式过长；最多 512 个字符。');

  const tokens = tokenize(source.trim());
  let cursor = 0;
  let operations = 0;

  const expression = (minimumPrecedence = 0, depth = 0): CalculationValue => {
    if (depth > MAX_PARSE_DEPTH)
      throw new RangeError('括号嵌套过深；最多 32 层。');

    let left: CalculationValue;
    const token = tokens[cursor++];
    if (token?.type === 'number') {
      left = new CalculationDecimal(token.value);
    } else if (token?.value === '+' || token?.value === '-') {
      operations += 1;
      const operand = expression(3, depth + 1);
      left = token.value === '-' ? operand.negated() : operand;
    } else if (token?.value === '(') {
      left = expression(0, depth + 1);
      if (tokens[cursor++]?.value !== ')')
        throw new SyntaxError('括号没有闭合。');
    } else {
      throw new SyntaxError('表达式开头需要数字、正负号或左括号。');
    }

    while (cursor < tokens.length) {
      const operator = tokens[cursor];
      const precedence =
        operator.value === '+' || operator.value === '-'
          ? 1
          : operator.value === '*' || operator.value === '/'
            ? 2
            : -1;
      if (precedence < minimumPrecedence) break;
      cursor += 1;
      operations += 1;
      if (operations > MAX_TOKENS) throw new RangeError('计算步骤过多。');
      const right = expression(precedence + 1, depth + 1);
      if (operator.value === '+') left = left.plus(right);
      else if (operator.value === '-') left = left.minus(right);
      else if (operator.value === '*') left = left.times(right);
      else {
        if (right.isZero()) throw new RangeError('除数不能为零。');
        left = left.dividedBy(right);
      }
      if (!left.isFinite()) throw new RangeError('计算结果超出可表示范围。');
    }
    return left;
  };

  const result = expression();
  if (cursor !== tokens.length) throw new SyntaxError('表达式中有多余内容。');
  const value = result.isZero() ? '0' : result.toString();
  return {
    expression: source.trim(),
    value,
    precision: CalculationDecimal.precision,
  };
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let digits = 0;
  let cursor = 0;
  const pattern =
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?|([()+\-*/]))/y;

  while (cursor < source.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match)
      throw new SyntaxError(`表达式含有不支持的内容（位置 ${cursor + 1}）。`);
    cursor = pattern.lastIndex;
    if (match[1] !== undefined) {
      digits += match[1].replace('.', '').length;
      if (digits > MAX_LITERAL_DIGITS) throw new RangeError('数字位数过多。');
      const exponent = Number(match[2] ?? 0);
      if (Math.abs(exponent) > 100)
        throw new RangeError('科学计数法指数必须在 -100 到 100 之间。');
      tokens.push({
        type: 'number',
        value: match[2] ? `${match[1]}e${exponent}` : match[1],
      });
    } else {
      tokens.push({ type: 'operator', value: match[3] });
    }
    if (tokens.length > MAX_TOKENS) throw new RangeError('表达式步骤过多。');
  }
  return tokens;
}
