import assert from 'node:assert/strict';
import test from 'node:test';
import {
  socialWorkCardTitle,
  socialWorkExecutionStepPresentation,
  socialWorkRecoveryPresentation,
} from '../src/social-work-presentation.mjs';

test('project work cards name the recoverable failure instead of hiding it in generic status', () => {
  const cases = [
    ['app_restarted', 'interrupted', '应用重启后已停止'],
    ['dsh_rate_limited', 'failed', '模型请求被限流'],
    ['dsh_task_timeout', 'failed', '执行超时'],
    ['dsh_tool_loop', 'failed', '重复操作过多，已停止'],
    ['tool_round_limit', 'failed', '工具步骤达到上限'],
    ['tool_output_budget', 'failed', '工具输出达到上限'],
    ['tool_context_budget', 'failed', '工具上下文达到上限'],
    ['command_sandbox_unavailable', 'failed', '项目命令沙箱不可用'],
    ['model_unavailable', 'failed', '所选免费模型当前不可用'],
    ['provider_unavailable', 'failed', '模型没有返回结果'],
    ['verification_failed', 'failed', '文件验收未通过'],
    ['dsh_process_failed', 'failed', '执行进程异常退出'],
    ['dsh_node_unavailable', 'failed', '本机执行环境不可用'],
    ['worker_interrupted', 'interrupted', '项目工作已停止'],
    ['new_error_code', 'failed', '项目工作未完成'],
  ];

  for (const [errorCode, status, expected] of cases) {
    assert.equal(
      socialWorkCardTitle({
        status,
        errorCode,
        verificationStatus: 'unavailable',
      }),
      expected,
      errorCode,
    );
  }
});

test('failed task recovery distinguishes safe replay from possible workspace changes', () => {
  const result = (task) => socialWorkRecoveryPresentation(task);
  assert.equal(result({ toolCallCount: 0, executionSteps: [] }).kind, 'clear');
  assert.match(
    result({
      toolCallCount: 1,
      toolActionCategories: ['read'],
      executionSteps: [
        { category: 'read', hasSideEffect: false, effectStatus: 'none' },
      ],
    }).message,
    /没有显示已生效的写入或命令/u,
  );
  assert.equal(
    result({
      toolCallCount: 1,
      executionSteps: [
        { category: 'write', hasSideEffect: true, effectStatus: 'applied' },
      ],
    }).kind,
    'changed',
  );
  assert.equal(
    result({
      toolCallCount: 1,
      executionSteps: [
        { category: 'command', hasSideEffect: true, effectStatus: 'unknown' },
      ],
    }).kind,
    'unknown',
  );
  assert.equal(
    result({
      toolCallCount: 1,
      executionSteps: [{ category: 'future_tool', effectStatus: 'none' }],
    }).kind,
    'unknown',
  );
});

test('legacy or incomplete execution records do not imply that replay is safe', () => {
  assert.equal(
    socialWorkRecoveryPresentation({
      toolCallCount: 1,
      toolActionCategories: ['write'],
      executionSteps: [],
    }).kind,
    'unknown',
  );
  assert.equal(
    socialWorkRecoveryPresentation({
      toolCallCount: 2,
      executionSteps: [
        { category: 'read', hasSideEffect: false, effectStatus: 'none' },
      ],
    }).kind,
    'unknown',
  );
  assert.equal(
    socialWorkRecoveryPresentation({
      executionSteps: [
        { category: 'read', hasSideEffect: false, effectStatus: 'none' },
      ],
    }).kind,
    'unknown',
  );
});

test('completed project work keeps the independent verification distinction', () => {
  assert.equal(
    socialWorkCardTitle({
      status: 'completed',
      errorCode: null,
      verificationStatus: 'verified',
    }),
    '项目工作已完成并核验',
  );
  assert.equal(
    socialWorkCardTitle({
      status: 'completed',
      errorCode: null,
      verificationStatus: 'unavailable',
    }),
    '项目工作已结束 · 未独立核验',
  );
});

test('execution history explains uncertain side effects without exposing tool inputs', () => {
  assert.deepEqual(
    socialWorkExecutionStepPresentation({
      category: 'write',
      status: 'outcome_unknown',
      effectStatus: 'unknown',
    }),
    {
      categoryLabel: '写入',
      statusLabel: '执行结果不确定',
      effectLabel: '操作结果不确定；继续前先检查已有文件改动',
    },
  );
  assert.deepEqual(
    socialWorkExecutionStepPresentation({
      category: 'command',
      status: 'succeeded',
      effectStatus: 'unknown',
    }),
    {
      categoryLabel: '命令',
      statusLabel: '已返回结果',
      effectLabel: '命令可能已改动项目；继续前先检查工作区',
    },
  );
});
