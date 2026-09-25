-- 052: performance hygiene from the database advisor.
--
-- Covering indexes for foreign keys that had none (joins and cascading
-- deletes on these columns were sequential scans), and one policy that
-- evaluated auth.uid() once per row instead of once per query.

create index if not exists ad_events_viewer_id_idx on public.ad_events (viewer_id);
create index if not exists assignments_bid_id_idx on public.assignments (bid_id);
create index if not exists feedback_user_id_idx on public.feedback (user_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists notifications_task_id_idx on public.notifications (task_id);
create index if not exists payments_task_id_idx on public.payments (task_id);
create index if not exists reviews_author_id_idx on public.reviews (author_id);
create index if not exists saved_tasks_task_id_idx on public.saved_tasks (task_id);
create index if not exists support_messages_sender_id_idx on public.support_messages (sender_id);
create index if not exists task_promotions_payment_id_idx on public.task_promotions (payment_id);
create index if not exists tasks_funding_payment_id_idx on public.tasks (funding_payment_id);

drop policy if exists ad_events_own_read on public.ad_events;
create policy ad_events_own_read on public.ad_events
  for select
  using (
    private.is_admin()
    or exists (
      select 1 from public.task_promotions p
       where p.id = ad_events.promotion_id
         and p.user_id = (select auth.uid())
    )
  );
