import React, { useRef, useState } from 'react';
import type { Components } from 'react-markdown';

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = preRef.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="code-block-wrap">
      <button
        type="button"
        className="code-block-copy"
        aria-label={copied ? '已复制代码' : '复制代码'}
        title={copied ? '已复制' : '复制代码'}
        onClick={() => void copy()}
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={preRef} className="social-code-block">
        {children}
      </pre>
    </div>
  );
}

export const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    src ? (
      <a href={src} target="_blank" rel="noreferrer noopener">
        查看图片{alt ? `：${alt}` : '链接'}
      </a>
    ) : null,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label="表格，可横向滚动"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};
