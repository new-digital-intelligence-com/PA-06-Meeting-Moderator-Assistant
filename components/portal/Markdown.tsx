import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * What Ava writes — what she knows about a client, her brief for a meeting — shown like a
 * README: headings, lists, bold, tables. Raw HTML in the text is never rendered.
 */
const components: Components = {
  h1: ({ children }) => <h3 className="mb-3 mt-6 border-b border-slate-200 pb-2 text-lg font-semibold text-slate-900 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-2 mt-6 border-b border-slate-100 pb-1.5 text-base font-semibold text-slate-900 first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1.5 mt-4 text-sm font-semibold text-slate-900 first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mb-1 mt-3 text-sm font-semibold text-slate-800 first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-2 leading-7 text-slate-700">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-slate-400">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-slate-400">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-7 text-slate-700">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-slate-200 pl-4 text-slate-600">{children}</blockquote>,
  hr: () => <hr className="my-5 border-slate-200" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-slate-100 px-3 py-2 text-slate-700">{children}</td>,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
