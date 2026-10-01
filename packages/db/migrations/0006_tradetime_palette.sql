-- TradeTime palette: move built-in type colours to warm neutrals and the two accents.
-- Only colours still at their original defaults are changed, so customised colours are kept.
UPDATE `session_type` SET `color` = '#202020' WHERE `id` = 'st_trading' AND `color` = '#2563eb';
--> statement-breakpoint
UPDATE `session_type` SET `color` = '#816729' WHERE `id` = 'st_daily_review' AND `color` = '#7c3aed';
--> statement-breakpoint
UPDATE `session_type` SET `color` = '#b39a5b' WHERE `id` = 'st_weekly_review' AND `color` = '#9333ea';
--> statement-breakpoint
UPDATE `session_type` SET `color` = '#4d4d4d' WHERE `id` = 'st_backtesting' AND `color` = '#0891b2';
--> statement-breakpoint
UPDATE `session_type` SET `color` = '#ff682c' WHERE `id` = 'st_education' AND `color` = '#ca8a04';
--> statement-breakpoint
UPDATE `session_type` SET `color` = '#9a958c' WHERE `id` = 'st_other' AND `color` = '#64748b';
--> statement-breakpoint
UPDATE `calendar_event_type` SET `color` = '#202020' WHERE `id` = 'cet_trading' AND `color` = '#2563eb';
--> statement-breakpoint
UPDATE `calendar_event_type` SET `color` = '#816729' WHERE `id` = 'cet_backtest' AND `color` = '#0891b2';
--> statement-breakpoint
UPDATE `calendar_event_type` SET `color` = '#c9c3b8' WHERE `id` = 'cet_no_trade' AND `color` = '#9ca3af';
--> statement-breakpoint
UPDATE `calendar_event_type` SET `color` = '#ff682c' WHERE `id` = 'cet_education' AND `color` = '#ca8a04';
--> statement-breakpoint
UPDATE `calendar_event_type` SET `color` = '#4d4d4d' WHERE `id` = 'cet_admin' AND `color` = '#db2777';
--> statement-breakpoint
UPDATE `calendar_event_type` SET `color` = '#9a958c' WHERE `id` = 'cet_general' AND `color` = '#64748b';
