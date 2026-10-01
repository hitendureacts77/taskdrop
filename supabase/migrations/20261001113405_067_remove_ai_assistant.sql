-- 067 — no AI talks to customers. The owner removed the AI post writer: posts
-- are written by the built-in writer on the phone (apps/mobile/src/lib/
-- taskBrief.ts). This drops what only the ai-assistant Edge Function used.
-- ai_usage was empty when this ran; nothing else referenced these.

drop function if exists public.spend_ai_credit(uuid);
drop table if exists public.ai_usage;
delete from public.settings where key = 'ai_daily_credits';
