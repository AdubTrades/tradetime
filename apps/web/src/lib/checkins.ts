import { useQuery } from '@tanstack/react-query';
import { api, type DueCheckIn, type Question, type StateReading } from './api';

export const useQuestions = () => useQuery({ queryKey: ['questions'], queryFn: () => api.get<Question[]>('/questions') });
export const useDayReadings = (day: string) => useQuery({ queryKey: ['readings', day], queryFn: () => api.get<StateReading[]>(`/readings?day=${day}`) });
export const useDueCheckIn = () => useQuery({ queryKey: ['check-in-due'], queryFn: () => api.get<DueCheckIn | null>('/check-ins/due'), refetchInterval: 30_000 });

export const decisionLabels = { keep_trading: 'Keep trading', take_break: 'Take a break', stop: 'Stop for the day' } as const;

/** Questions shown for a start checklist or a check-in, in order. */
export const questionsFor = (questions: Question[], kind: 'start' | 'checkin') =>
  questions.filter((q) => !q.archived && (q.appliesTo === 'both' || q.appliesTo === kind));
