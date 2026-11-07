/**
 * Shared Zod schemas — validation used identically by the mobile app, the web
 * app, and the Edge Functions. Enums are kept in lock-step with @taskdrop/rules.
 */
import { z } from 'zod';
import {
  TASK_STATUS,
  ROLES,
  TASK_FLAG,
  PAYOUT_MODE,
  CANCELLED_BY,
  CANCEL_REASON,
  MEDIA,
} from '@taskdrop/rules';

export const taskStatusEnum = z.enum(TASK_STATUS);
export const roleEnum = z.enum(ROLES);
export const taskFlagEnum = z.enum(TASK_FLAG);
export const payoutModeEnum = z.enum(PAYOUT_MODE);
export const cancelledByEnum = z.enum(CANCELLED_BY);
export const cancelReasonEnum = z.enum(CANCEL_REASON);

export const pillarEnum = z.enum(['services', 'procurement', 'local_intel']);
export type Pillar = z.infer<typeof pillarEnum>;

/*
 * Ids are Postgres uuids. z.guid() keeps the plain 8-4-4-4-12 shape check zod 3
 * used for .uuid(); zod 4's z.uuid() also checks the version and variant bits.
 */

/** Money is always an integer in the smallest unit (paise/cents). */
export const minorAmount = z.number().int().nonnegative();

/** Profile setup (onboarding). */
export const profileSetupSchema = z.object({
  displayName: z.string().min(2).max(60),
  skills: z.array(z.string().min(1).max(40)).max(20).default([]),
  location: z
    .object({ lat: z.number(), lng: z.number(), label: z.string().max(120).optional() })
    .optional(),
});
export type ProfileSetup = z.infer<typeof profileSetupSchema>;

/** Optional media attached to a posted task (none / one image / <=60s video). */
export const taskMediaSchema = z
  .object({
    kind: z.enum(['image', 'video']),
    storagePath: z.string().min(1),
    durationSeconds: z.number().int().positive().max(MEDIA.MAX_VIDEO_SECONDS).optional(),
  })
  .refine((m) => m.kind !== 'video' || m.durationSeconds !== undefined, {
    error: 'video media requires durationSeconds (<= 60s)',
  });

/** Create a task (Poster). Benchmark price + REQUIRED time limit. */
export const createTaskSchema = z.object({
  pillar: pillarEnum,
  title: z.string().min(4).max(120),
  description: z.string().max(4000).default(''),
  benchmarkMinor: minorAmount,
  /** Required task time limit, in minutes — drives the OVERDUE flag. */
  timeLimitMinutes: z.number().int().positive().max(60 * 24 * 30),
  flag: taskFlagEnum.default('none'),
  media: taskMediaSchema.optional(),
  location: z
    .object({ lat: z.number(), lng: z.number(), label: z.string().max(120).optional() })
    .optional(),
});
export type CreateTask = z.infer<typeof createTaskSchema>;

/** A worker's quote — accept the posted price or counter on price and/or time. */
export const createBidSchema = z.object({
  taskId: z.guid(),
  priceMinor: minorAmount,
  timeLimitMinutes: z.number().int().positive().max(60 * 24 * 30),
  message: z.string().max(1000).optional(),
});
export type CreateBid = z.infer<typeof createBidSchema>;

/** Poster locks a bid → escrow. Poster also chooses payout mode. */
export const lockBidSchema = z.object({
  bidId: z.guid(),
  payoutMode: payoutModeEnum.default('one_time'),
});
export type LockBid = z.infer<typeof lockBidSchema>;

/** A cancellation event, as recorded in cancellations_log. */
export const cancellationSchema = z.object({
  taskId: z.guid(),
  cancelledBy: cancelledByEnum,
  reason: cancelReasonEnum,
  phase: z.enum(['before_start', 'after_start']),
});
export type Cancellation = z.infer<typeof cancellationSchema>;

/** A role-scoped review (poster-role and worker-role are never merged). */
export const reviewSchema = z.object({
  taskId: z.guid(),
  aboutRole: z.enum(['poster', 'worker']),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});
export type Review = z.infer<typeof reviewSchema>;

/*
 * City Hunt (migration 158). The same lists the database and the api use: how long a Hunt runs,
 * what a find must show, and why a poster says "Not it".
 */
export const huntWindowEnum = z.enum(['2h', 'today', '3d']);
export type HuntWindow = z.infer<typeof huntWindowEnum>;
export const huntNeedEnum = z.enum(['photo', 'place', 'pin', 'price']);
export type HuntNeed = z.infer<typeof huntNeedEnum>;
export const huntDeclineReasonEnum = z.enum(['not_it', 'gone', 'too_far', 'other']);
export type HuntDeclineReason = z.infer<typeof huntDeclineReasonEnum>;

/** The Hunt switches on a new post. */
export const huntOptionsSchema = z.object({
  huntWindow: huntWindowEnum,
  huntNeeds: z.array(huntNeedEnum).min(1).max(4),
});
export type HuntOptions = z.infer<typeof huntOptionsSchema>;

/** A find a finder sends. A pin is both coordinates or neither. */
export const huntFindSchema = z
  .object({
    taskId: z.guid(),
    photoPath: z.string().min(3).max(300).nullable().optional(),
    placeName: z.string().trim().min(1).max(120).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    priceNote: z.string().trim().min(1).max(60).nullable().optional(),
    note: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .refine((f) => (f.lat == null) === (f.lng == null), { message: 'A pin needs both coordinates' })
  .refine((f) => f.photoPath != null || f.placeName != null || f.lat != null || f.priceNote != null, {
    message: 'Add at least a photo, the place name, a pin or the price',
  });
export type HuntFind = z.infer<typeof huntFindSchema>;
