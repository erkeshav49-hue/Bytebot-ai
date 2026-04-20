import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  botGetSnapshot,
  botGetConfig,
  botSetConfig,
  botStart,
  botStop,
  botPause,
  botClearLog,
  botResetAll,
  botTestTelegram,
  botApplyStrategy,
} from "./bot-engine";

const botConfigSchema = z.object({
  groq: z.string(),
  paper: z.boolean(),
  key: z.string(),
  secret: z.string(),
  testnet: z.boolean(),
  tgt: z.string(),
  tgc: z.string(),
  sz: z.number(),
  mx: z.number(),
  tp: z.number(),
  sl: z.number(),
  lv: z.number(),
  mc: z.number(),
  p: z.record(z.string(), z.object({ s: z.boolean().optional(), f: z.boolean().optional() })),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Bot API ────────────────────────────────────────────────────────────────
  bot: router({
    // Get full bot state snapshot (polled by client every few seconds)
    snapshot: publicProcedure.query(() => {
      return botGetSnapshot();
    }),

    // Get full config (including sensitive keys, for settings screen)
    getConfig: publicProcedure.query(() => {
      return botGetConfig();
    }),

    // Save config
    setConfig: publicProcedure
      .input(botConfigSchema)
      .mutation(({ input }) => {
        botSetConfig(input);
        return { success: true };
      }),

    // Start the bot
    start: publicProcedure.mutation(() => {
      return botStart();
    }),

    // Stop the bot
    stop: publicProcedure.mutation(() => {
      botStop();
      return { success: true };
    }),

    // Pause/resume
    pause: publicProcedure
      .input(z.object({ paused: z.boolean() }))
      .mutation(({ input }) => {
        botPause(input.paused);
        return { success: true };
      }),

    // Clear trade log and stats
    clearLog: publicProcedure.mutation(() => {
      botClearLog();
      return { success: true };
    }),

    // Full reset
    reset: publicProcedure.mutation(() => {
      botResetAll();
      return { success: true };
    }),

    // Apply natural-language strategy instruction (changes settings + adds notes via AI)
    applyStrategy: publicProcedure
      .input(z.object({ instruction: z.string().min(1) }))
      .mutation(async ({ input }) => {
        return await botApplyStrategy(input.instruction);
      }),

    // Test Telegram connection
    testTelegram: publicProcedure
      .input(z.object({ token: z.string(), chatId: z.string() }))
      .mutation(async ({ input }) => {
        const ok = await botTestTelegram(input.token, input.chatId);
        return { ok };
      }),
  }),
});

export type AppRouter = typeof appRouter;
