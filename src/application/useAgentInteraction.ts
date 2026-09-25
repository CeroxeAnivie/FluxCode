import { useEffect, useRef, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import { parseElicitation, type Elicitation } from '../domain/elicitation';
import { parseAgentRequest, type AgentRequest } from '../domain/interaction';
import type { Conversation } from '../domain/types';

export function useAgentInteraction(
  report: (message: string) => void,
  ready: boolean,
  conversations: Record<string, Conversation>,
) {
  const connectionGeneration = useRef(0);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const [elicitations, setElicitations] = useState<Elicitation[]>([]);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  // Keep unsubmitted answers across task switches, but never persist potentially secret inputs.
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, Record<string, string>>>({});
  const [elicitationDrafts, setElicitationDrafts] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const requestKey = (id: string | number) => `${typeof id}:${id}`;
  useEffect(() => {
    const finished = (threadId: string | null | undefined, turnId: string | null | undefined) =>
      !!threadId && !!turnId && conversations[threadId]?.recoveredTurn?.id === turnId;
    setRequests((rows) => {
      const next = rows.filter((row) => !finished(row.threadId, row.turnId));
      return next.length === rows.length ? rows : next;
    });
    setElicitations((rows) => {
      const next = rows.filter((row) => !finished(row.threadId, row.turnId));
      return next.length === rows.length ? rows : next;
    });
  }, [conversations]);
  useEffect(() => {
    if (ready) return;
    connectionGeneration.current++;
    setRequests([]);
    setElicitations([]);
    setAnswerDrafts({});
    setElicitationDrafts({});
  }, [ready]);
  useEffect(() => {
    const active = new Set(requests.map((request) => requestKey(request.id)));
    setAnswerDrafts((current) => {
      const entries = Object.entries(current).filter(([key]) => active.has(key));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [requests]);
  useEffect(() => {
    const active = new Set(elicitations.map((request) => requestKey(request.id)));
    setElicitationDrafts((current) => {
      const entries = Object.entries(current).filter(([key]) => active.has(key));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [elicitations]);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void bridge
      .subscribe((event) => {
        if (event.method === 'engine/disconnected') {
          setRequests([]);
          setElicitations([]);
        }
        if (event.method === 'engine/elicitation') {
          if (!readyRef.current) return;
          try {
            const request = parseElicitation(event.params);
            setElicitations((rows) =>
              [...rows.filter((r) => r.id !== request.id), request].slice(-32),
            );
          } catch (e) {
            report(String(e));
          }
        }
        if (event.method === 'serverRequest/resolved')
          setElicitations((rows) => rows.filter((r) => r.id !== event.params?.requestId));
        if (event.method === 'serverRequest/resolved')
          setRequests((items) => items.filter((r) => r.id !== event.params?.requestId));
        if (event.method === 'turn/completed') {
          const turn = event.params?.turn as { id?: string } | undefined;
          if (turn?.id)
            setElicitations((rows) =>
              rows.filter((r) => r.threadId !== event.params?.threadId || r.turnId !== turn.id),
            );
          setRequests((items) => {
            return items.filter(
              (r) => !turn?.id || r.threadId !== event.params?.threadId || r.turnId !== turn.id,
            );
          });
        }
        if (event.method === 'engine/userInput') {
          if (!readyRef.current) return;
          try {
            const request = parseAgentRequest(event.params);
            setRequests((items) =>
              [...items.filter((r) => r.id !== request.id), request].slice(-32),
            );
          } catch (e) {
            report(String(e));
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch((e) => report(String(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  async function answer(request: AgentRequest, answers: Record<string, string>) {
    const generation = connectionGeneration.current;
    await bridge.answerAgent(
      request.id,
      Object.fromEntries(request.questions.map((q) => [q.id, { answers: [answers[q.id] ?? ''] }])),
    );
    if (generation === connectionGeneration.current)
      setRequests((items) => items.filter((r) => r.id !== request.id));
  }
  async function answerElicitation(
    id: string | number,
    action: string,
    content: Record<string, unknown> | null,
  ) {
    const generation = connectionGeneration.current;
    await bridge.answerElicitation(id, { action, content, _meta: null });
    if (generation === connectionGeneration.current)
      setElicitations((rows) => rows.filter((r) => r.id !== id));
  }
  return {
    requests,
    answer,
    elicitations,
    answerElicitation,
    answersFor: (id: string | number) => answerDrafts[requestKey(id)] ?? {},
    updateAnswers: (id: string | number, answers: Record<string, string>) =>
      setAnswerDrafts((current) => ({ ...current, [requestKey(id)]: answers })),
    elicitationAnswersFor: (id: string | number) => elicitationDrafts[requestKey(id)] ?? {},
    updateElicitationAnswers: (id: string | number, answers: Record<string, unknown>) =>
      setElicitationDrafts((current) => ({ ...current, [requestKey(id)]: answers })),
  };
}
