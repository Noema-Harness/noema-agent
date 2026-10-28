import React from 'react';
import { Button, IconButton } from './button';
import { TextField } from './text-field';

const variants = ['primary', 'secondary', 'quiet', 'danger'] as const;

export function ComponentWorkbench() {
  return (
    <main className="component-workbench">
      <header className="workbench-heading">
        <div>
          <p>NOEMA · UI WORKBENCH</p>
          <h1>组件与状态</h1>
        </div>
        <span>本地预览 · 临时色板</span>
      </header>
      <section className="workbench-note" aria-label="当前设计范围">
        这里展示实际复用的基础控件。颜色仍待视觉评审；先检查文字是否清楚、边界是否可见、操作状态是否容易辨认。
      </section>
      <section className="workbench-section">
        <div className="workbench-section-heading">
          <h2>长回复 · 消息正文</h2>
          <code>实际消息类名 / Markdown 结构</code>
        </div>
        <div className="workbench-conversation">
          <div className="social-shell app">
            <div className="chat-scroll">
              <div className="chat-body">
                <article className="message assistant">
                  <div className="message-bubble">
                    <p>
                      先把最影响后续决策的两项放在一起看。这里的层级来自内容自身，不额外包成卡片。
                    </p>
                    <h2>目前可以确认的差异</h2>
                    <ul>
                      <li>
                        <strong>固定成本：</strong>场地费不随人数变化。
                      </li>
                      <li>
                        <strong>变量成本：</strong>材料费按参加人数增加。
                      </li>
                    </ul>
                    <div className="social-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>人数</th>
                            <th>收入</th>
                            <th>扣除成本后</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>4 人</td>
                            <td>¥800</td>
                            <td>¥80</td>
                          </tr>
                          <tr>
                            <td>6 人</td>
                            <td>¥1,200</td>
                            <td>¥400</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <hr />
                    <p>验证步骤可以直接复制执行：</p>
                    <pre className="social-code-block">
                      <code>npm run typecheck --workspace noema-desktop</code>
                    </pre>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>
      {variants.map((variant) => (
        <section className="workbench-section" key={variant}>
          <div className="workbench-section-heading">
            <h2>{variant}</h2>
            <code>Button variant="{variant}"</code>
          </div>
          <div className="workbench-surface workbench-surface--light">
            <Button variant={variant}>普通操作</Button>
            <Button variant={variant} disabled>
              不可用
            </Button>
            <Button variant={variant} size="small">
              紧凑尺寸
            </Button>
            <IconButton label="关闭示例">×</IconButton>
          </div>
          <div className="workbench-surface workbench-surface--dark">
            <Button variant={variant}>深色表面</Button>
            <Button variant={variant} disabled>
              不可用
            </Button>
            <IconButton label="关闭示例" variant={variant}>
              ×
            </IconButton>
          </div>
        </section>
      ))}
      <section className="workbench-section">
        <div className="workbench-section-heading">
          <h2>输入控件</h2>
          <code>亮色表面 / focus / disabled</code>
        </div>
        <div className="workbench-surface workbench-surface--light">
          <TextField label="默认" placeholder="输入内容" />
          <TextField label="禁用" placeholder="不可编辑" disabled />
          <TextField
            label="错误"
            defaultValue="无效内容"
            error="请检查填写内容。"
          />
        </div>
      </section>
    </main>
  );
}
