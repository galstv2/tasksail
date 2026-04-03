import { useCallback, useEffect, useState } from 'react';

import type { PlannerBrokerStatus, PlannerStreamEvent } from '../../shared/desktopContract';

const MAX_MESSAGES = 200;

export type ConversationMessage = {
  id: string;
  role: 'planner' | 'operator';
  text: string;
  isStreaming: boolean;
  timestamp: string;
};

export function usePlannerStream(): {
  messages: ConversationMessage[];
  isStreaming: boolean;
  brokerStatus: PlannerBrokerStatus;
  lastError: string;
  sendMessage: (text: string) => void;
  clearConversation: () => void;
} {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [brokerStatus, setBrokerStatus] = useState<PlannerBrokerStatus>('idle');
  const [lastError, setLastError] = useState('');

  const applyPlannerEvent = useCallback((plannerEvent: PlannerStreamEvent) => {
    setBrokerStatus(plannerEvent.brokerStatus);
    setIsStreaming(plannerEvent.brokerStatus === 'running');

    if (plannerEvent.eventType === 'planner.turn.failed') {
      setLastError(plannerEvent.error ?? 'Planner turn failed.');
    } else if (
      plannerEvent.eventType === 'planner.turn.started' ||
      plannerEvent.eventType === 'planner.turn.completed' ||
      plannerEvent.eventType === 'planner.session.updated'
    ) {
      setLastError('');
    }

    if (plannerEvent.eventType !== 'planner.turn.message' || !plannerEvent.content) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (plannerEvent.done && last?.role === 'planner' && last.isStreaming) {
          const next = prev.slice(0, -1);
          next.push({ ...last, isStreaming: false });
          return next;
        }
        return prev;
      });
      return;
    }

    const messageContent = plannerEvent.content;

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (plannerEvent.messageKind === 'delta' && last?.role === 'planner' && last.isStreaming) {
        const updated = { ...last, text: last.text + messageContent, isStreaming: true };
        const next = prev.slice(0, -1);
        next.push(updated);
        return next;
      }

      if (plannerEvent.messageKind === 'final' && last?.role === 'planner' && last.isStreaming) {
        const updated = { ...last, text: messageContent, isStreaming: plannerEvent.brokerStatus === 'running' };
        const next = prev.slice(0, -1);
        next.push(updated);
        return next;
      }

      const newMsg: ConversationMessage = {
        id: `planner-${Date.now()}`,
        role: 'planner',
        text: messageContent,
        isStreaming: plannerEvent.brokerStatus === 'running',
        timestamp: new Date().toLocaleTimeString(),
      };
      if (prev.length < MAX_MESSAGES) {
        return [...prev, newMsg];
      }
      const next = prev.slice(1);
      next.push(newMsg);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!window.desktopShell?.onPlannerEvent) return;
    const unsubscribe = window.desktopShell.onPlannerEvent(applyPlannerEvent);
    return unsubscribe;
  }, [applyPlannerEvent]);

  const sendMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const next = [
        ...prev,
        {
          id: `operator-${Date.now()}`,
          role: 'operator' as const,
          text,
          isStreaming: false,
          timestamp: new Date().toLocaleTimeString(),
        },
      ];
      return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    });
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setIsStreaming(false);
    setBrokerStatus('idle');
    setLastError('');
  }, []);

  return { messages, isStreaming, brokerStatus, lastError, sendMessage, clearConversation };
}
