import assert from 'node:assert/strict';
import test from 'node:test';
import {
  socialWorkCardTitle,
  socialWorkExecutionStepPresentation,
  socialWorkResultPresentation,
  socialWorkRecoveryPresentation,
} from '../../../src/shared/execution/social-work-presentation.mjs';

test('project work cards name the recoverable failure instead of hiding it in generic status', () => {
  const cases = [
    ['app_restarted', 'interrupted', '应用重启后已停止'],
    ['application_exit', 'interrupted', 'Noema 退出时已停止'],
    ['application_exit_incomplete', 'interrupted', 'Noema 退出时任务未能收束'],
    ['system_shutdown', 'interrupted', '系统关机或注销时已停止'],
    [
      'system_shutdown_incomplete',
      'interrupted',
      '系统关机或注销时任务未能收束',
    ],
    ['process_crash', 'interrupted', 'Noema 异常退出后已停止'],
    ['dsh_rate_limited', 'failed', '模型请求被限流'],
    ['rate_limited', 'failed', '模型请求被限流'],
    ['dsh_task_timeout', 'failed', '执行超时'],
    ['dsh_tool_loop', 'failed', '重复操作过多，已停止'],
    ['tool_round_limit', 'failed', '本段工具预算已用完，进度已保存'],
    ['tool_output_budget', 'failed', '工具输出达到上限'],
    ['tool_context_budget', 'failed', '工具上下文达到上限'],
    ['command_sandbox_unavailable', 'failed', '项目命令沙箱不可用'],
    ['model_unavailable', 'failed', '所选免费模型当前不可用'],
    ['provider_unavailable', 'failed', '模型没有返回结果'],
    ['response_too_large', 'failed', '模型回复过长，进度已保存'],
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

test('active task cards project persisted model, tool, authorization, and wait phases', () => {
  const title = (phase, executionSteps = []) =>
    socialWorkCardTitle({
      status: 'running',
      phase,
      errorCode: null,
      verificationStatus: 'pending',
      executionSteps,
    });
  assert.equal(title('model_request'), '正在等待模型回复');
  assert.equal(title('model_response'), '正在接收模型回复');
  assert.equal(title('tool_requested'), '模型已请求工具，准备执行');
  assert.equal(title('awaiting_authorization'), '正在等待你确认本次访问授权');
  assert.equal(title('retry_waiting_rate_limit'), '模型请求受限，等待后重试');
  assert.equal(
    title('tool_call', [{ status: 'running', category: 'write' }]),
    '正在写入文件',
  );
  assert.equal(title('legacy-phase'), '项目任务正在处理（具体阶段未知）');
});

test('saved task output is not presented as final delivery before completion', () => {
  assert.deepEqual(
    socialWorkResultPresentation({
      status: 'completed',
      resultText: '完整交付',
    }),
    {
      visible: true,
      title: '执行结果',
      caveat: null,
    },
  );
  assert.equal(
    socialWorkResultPresentation({
      status: 'interrupted',
      resultText: '部分内容',
    }).title,
    '停止前保存的部分内容',
  );
  assert.match(
    socialWorkResultPresentation({
      status: 'interrupted',
      resultText: '部分内容',
    }).caveat,
    /不代表任务完成/u,
  );
  assert.deepEqual(
    socialWorkResultPresentation({
      status: 'interrupted',
      resultText: '部分内容',
    }),
    {
      visible: true,
      title: '停止前保存的部分内容',
      caveat: '任务已停止；下面的文字不代表任务完成或最终交付。',
    },
  );
  assert.equal(
    socialWorkResultPresentation({ status: 'failed' }).title,
    '未完成任务的已保存内容',
  );
  assert.equal(
    socialWorkResultPresentation({ status: 'running' }).title,
    '已保存的阶段内容',
  );
  assert.match(
    socialWorkResultPresentation({ status: 'running' }).caveat,
    /当前任务尚未完成/u,
  );
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
  assert.deepEqual(
    socialWorkRecoveryPresentation({
      resumeBlockReason: '这项旧任务没有工作区身份快照。',
      toolCallCount: 0,
      executionSteps: [],
    }),
    { kind: 'unknown', message: '这项旧任务没有工作区身份快照。' },
  );
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
