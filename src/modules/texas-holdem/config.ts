import { z } from 'zod';

// HoldemConfig (spec 04 §1). `denominations` (D21) carries the confirmed chip values so the
// chip-clutter rule can see the next chip up; its first entry is `smallestDenomination`.

const positiveInt = z.number().int().positive();

export const HoldemConfigSchema = z
  .object({
    players: z.number().int().min(2).max(10),
    targetDurationMin: positiveInt.max(24 * 60),
    startingStack: positiveInt,
    structure: z.enum(['gentle', 'standard', 'turbo', 'custom']),
    levelDurationMin: positiveInt,
    startingBlinds: z.object({ sb: positiveInt, bb: positiveInt }),
    growth: z.number().min(0.05).max(2),
    ante: z.object({
      mode: z.enum(['none', 'bigBlind', 'traditional']),
      startLevel: positiveInt,
      ratio: z.number().positive().max(1).optional(),
    }),
    breaks: z.object({ everyMin: positiveInt, durationMin: positiveInt }).nullable(),
    breakEndBehaviour: z.enum(['auto', 'waitForHost']),
    /** When a level's time runs out (spec 11); absent on older configs, which ran automatically. */
    levelEndBehaviour: z.enum(['auto', 'waitForHost']).optional(),
    smallestDenomination: positiveInt,
    denominations: z.array(positiveInt).min(1),
    presetVersion: z.string().min(1),
  })
  .refine((c) => c.denominations.every((d, i, all) => i === 0 || d > (all[i - 1] ?? 0)), {
    message: 'Denominations must be strictly increasing',
    path: ['denominations'],
  })
  .refine((c) => c.denominations[0] === c.smallestDenomination, {
    message: 'The first denomination must be the smallest denomination',
    path: ['smallestDenomination'],
  });

export type HoldemConfig = z.infer<typeof HoldemConfigSchema>;

/** Segment `data` for levels (spec 04 §1). Loose numbers so the validator can report them. */
export const LevelDataSchema = z.object({
  sb: z.number().finite(),
  bb: z.number().finite(),
  ante: z.number().finite(),
});
export type LevelData = z.infer<typeof LevelDataSchema>;
