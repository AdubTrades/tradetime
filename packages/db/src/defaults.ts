/**
 * Default lists every new account starts with. Ids are fixed per user (the code refers to some of them, e.g.
 * st_trading, cet_admin, li_pm_credit_card), which works because keys are (user_id, id). Colours are the
 * TradeTime palette.
 */
export const defaultSessionTypes = [
  { id: 'st_trading', name: 'Trading', isTrading: true, color: '#202020', sortOrder: 0 },
  { id: 'st_daily_review', name: 'Daily review', isTrading: false, color: '#816729', sortOrder: 1 },
  { id: 'st_weekly_review', name: 'Weekly review', isTrading: false, color: '#b39a5b', sortOrder: 2 },
  { id: 'st_backtesting', name: 'Backtesting', isTrading: false, color: '#4d4d4d', sortOrder: 3 },
  { id: 'st_education', name: 'Education', isTrading: false, color: '#ff682c', sortOrder: 4 },
  { id: 'st_other', name: 'Other', isTrading: false, color: '#9a958c', sortOrder: 5 },
];

export const defaultListItems = [
  { id: 'li_pm_credit_card', kind: 'payment_method', name: 'Credit Card', sortOrder: 0 },
  { id: 'li_pm_debit_card', kind: 'payment_method', name: 'Debit Card', sortOrder: 1 },
  { id: 'li_pm_bank_transfer', kind: 'payment_method', name: 'Bank Transfer', sortOrder: 2 },
  { id: 'li_type_digital', kind: 'expense_type', name: 'Digital', sortOrder: 0 },
  { id: 'li_type_physical', kind: 'expense_type', name: 'Physical', sortOrder: 1 },
  { id: 'li_type_service', kind: 'expense_type', name: 'Service', sortOrder: 2 },
  { id: 'li_mood_neutral', kind: 'mood', name: 'Neutral', sortOrder: 0 },
  { id: 'li_mood_focused', kind: 'mood', name: 'Focused', sortOrder: 1 },
  { id: 'li_mood_content', kind: 'mood', name: 'Content', sortOrder: 2 },
  { id: 'li_mood_stressed', kind: 'mood', name: 'Stressed', sortOrder: 3 },
  { id: 'li_mood_frustrated', kind: 'mood', name: 'Frustrated', sortOrder: 4 },
  { id: 'li_mistake_fomo', kind: 'mistake', name: 'FOMO entry', sortOrder: 0 },
  { id: 'li_mistake_chased', kind: 'mistake', name: 'Chased entry', sortOrder: 1 },
  { id: 'li_mistake_moved_stop', kind: 'mistake', name: 'Moved stop', sortOrder: 2 },
  { id: 'li_mistake_early_exit', kind: 'mistake', name: 'Early exit', sortOrder: 3 },
  { id: 'li_mistake_oversized', kind: 'mistake', name: 'Oversized', sortOrder: 4 },
  { id: 'li_mistake_revenge', kind: 'mistake', name: 'Revenge trade', sortOrder: 5 },
  { id: 'li_mistake_overtraded', kind: 'mistake', name: 'Overtraded', sortOrder: 6 },
];

export const defaultContracts = [
  { id: 'ct_es', symbol: 'ES', name: 'E-mini S&P 500', tickSize: 0.25, pointValueCents: 5000, feePerSideCents: 0, sortOrder: 0 },
  { id: 'ct_nq', symbol: 'NQ', name: 'E-mini Nasdaq-100', tickSize: 0.25, pointValueCents: 2000, feePerSideCents: 0, sortOrder: 1 },
  { id: 'ct_mes', symbol: 'MES', name: 'Micro E-mini S&P 500', tickSize: 0.25, pointValueCents: 500, feePerSideCents: 0, sortOrder: 2 },
  { id: 'ct_mnq', symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', tickSize: 0.25, pointValueCents: 200, feePerSideCents: 0, sortOrder: 3 },
];

export const defaultQuestions = [
  { id: 'q_mood', prompt: 'How are you feeling?', kind: 'mood', appliesTo: 'both', sortOrder: 0 },
  { id: 'q_focus', prompt: 'Focus', kind: 'scale', appliesTo: 'both', sortOrder: 1 },
  { id: 'q_energy', prompt: 'Energy', kind: 'scale', appliesTo: 'both', sortOrder: 2 },
  { id: 'q_plan', prompt: 'Following my plan?', kind: 'yesPartlyNo', appliesTo: 'both', sortOrder: 3 },
  { id: 'q_day_plan', prompt: 'Plan for the session', kind: 'text', appliesTo: 'start', sortOrder: 4 },
  { id: 'q_levels', prompt: 'Key levels and events', kind: 'text', appliesTo: 'start', sortOrder: 5 },
  { id: 'q_changed', prompt: 'What changed?', kind: 'text', appliesTo: 'checkin', sortOrder: 6 },
] as const;

export const defaultCalendarEventTypes = [
  { id: 'cet_trading', name: 'Trading schedule', color: '#202020', sessionTypeId: 'st_trading', isNoTrade: false, sortOrder: 0 },
  { id: 'cet_backtest', name: 'Backtesting / review', color: '#816729', sessionTypeId: 'st_backtesting', isNoTrade: false, sortOrder: 1 },
  { id: 'cet_no_trade', name: 'No-trade day', color: '#c9c3b8', sessionTypeId: null, isNoTrade: true, sortOrder: 2 },
  { id: 'cet_education', name: 'Education / live stream', color: '#ff682c', sessionTypeId: 'st_education', isNoTrade: false, sortOrder: 3 },
  { id: 'cet_admin', name: 'Admin and deadlines', color: '#4d4d4d', sessionTypeId: null, isNoTrade: false, sortOrder: 4 },
  { id: 'cet_general', name: 'General', color: '#9a958c', sessionTypeId: null, isNoTrade: false, sortOrder: 5 },
];
