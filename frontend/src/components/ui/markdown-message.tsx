import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import { isSupportedCodeLanguage, oneDark, SyntaxHighlighter } from '../../lib/code-highlighter';
import { cn } from '../../lib/utils';

function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-[var(--code-fg)] opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const markdownComponents: Components = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeText = String(children).replace(/\n$/, '');

    if (match && isSupportedCodeLanguage(match[1])) {
      return (
        <div className="group relative my-2 overflow-hidden rounded-xl border border-[var(--border)]/40" style={{ background: 'var(--code-bg)' }}>
          <CopyCodeButton text={codeText} />
          <SyntaxHighlighter
            language={match[1]}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              fontSize: '13px',
              lineHeight: '1.75',
              borderRadius: 0,
            }}
            PreTag="div"
            useInlineStyles
          >
            {codeText}
          </SyntaxHighlighter>
        </div>
      );
    }

    if (match) {
      return (
        <div className="group relative my-2 overflow-hidden rounded-xl border border-[var(--border)]/40" style={{ background: 'var(--code-bg)' }}>
          <CopyCodeButton text={codeText} />
          <pre className="overflow-auto px-4 py-4 text-[13px] leading-7 text-[var(--code-fg)]">{codeText}</pre>
        </div>
      );
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('markdown text-[15px] leading-7 text-[var(--text-primary)]', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
