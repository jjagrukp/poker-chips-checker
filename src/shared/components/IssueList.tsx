import { useIssueText } from '@/shared/messages/tone';
import type { Issue } from '@/core/validation/report';

const numberFormat = new Intl.NumberFormat('en-AU');

function formatParams(params: Issue['params']): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, typeof v === 'number' ? numberFormat.format(v) : v]),
  );
}

interface Props {
  issues: readonly Issue[];
  kind: 'error' | 'warning';
  title?: string;
}

/** Renders module/domain issues through the message catalogue. Errors are announced. */
export function IssueList({ issues, kind, title }: Props) {
  const text = useIssueText();
  if (issues.length === 0) return null;
  const marker = kind === 'error' ? 'border-accent' : 'border-state-warning';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`border-l-4 ${marker} pl-3`}>
      {title && <p className="font-semibold">{title}</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${issue.path ?? ''}-${i}`}>
            {text(issue.messageKey, formatParams(issue.params))}
          </li>
        ))}
      </ul>
    </div>
  );
}
