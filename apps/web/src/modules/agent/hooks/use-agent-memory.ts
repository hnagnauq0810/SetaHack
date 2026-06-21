import { useQuery } from '@tanstack/react-query';
import { agentApi } from '../api/client';

export function useAgentMemory(threadId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agent', 'memory', threadId],
    queryFn: () => agentApi.getMemory(threadId ?? ''),
    enabled: enabled && Boolean(threadId),
    refetchInterval: enabled ? 5000 : false,
  });
}
