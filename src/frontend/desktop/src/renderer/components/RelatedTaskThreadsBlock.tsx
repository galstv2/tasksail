import type { RelatedTaskThread } from '../selectors/taskObservationModel';
import { formatStreamMessage } from '../activityStream';
import { classNames } from '../utils/classNames';

function RelatedTaskThreadsBlock({ relatedThreads }: { relatedThreads: RelatedTaskThread[] }): JSX.Element {
  return (
    <div className="notes-block">
      <div className="panel__title-row">
        <h3>Related task threads</h3>
        <span className="panel__meta">stacked child-task and completed-task context</span>
      </div>

      {relatedThreads.length === 0 ? (
        <p className="panel__lede">No related task threads are currently competing with the active task.</p>
      ) : (
        <div className="related-thread-list" aria-label="Related task threads">
          {relatedThreads.map((thread) => (
            <article key={thread.key} className="related-thread-card">
              <div className="panel__title-row">
                <div>
                  <h4>{thread.heading}</h4>
                  <p className="stream-event__metadata">{thread.summary}</p>
                </div>
                <div className="status-chip-row related-thread-card__chips">
                  {thread.chips.map((chip) => (
                    <span key={chip.label} className={classNames('status-chip', `status-chip--${chip.tone}`)}>
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>

              {thread.sessions.length > 0 ? (
                <ul className="todo-list todo-list--dense related-thread-card__session-list" aria-label={`${thread.heading} sessions`}>
                  {thread.sessions.map((session) => (
                    <li key={session.sessionId}>
                      <strong>{session.agentLabel}</strong>
                      <span className="related-thread-card__session-copy">
                        {session.latestOutputLines[0] ?? 'No terminal excerpt observed yet.'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {thread.events.length > 0 ? (
                <ul className="todo-list todo-list--dense related-thread-card__event-list" aria-label={`${thread.heading} activity`}>
                  {thread.events.slice(0, 2).map((event) => (
                    <li key={event.id}>{formatStreamMessage(event)}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default RelatedTaskThreadsBlock;
