-- hand-written: drizzle snapshot is incomplete (hand-written 0001_auth.sql et al. were never tracked), so `drizzle-kit generate` re-emits CREATE TABLE for existing tables. Adds the rate_limit table required by better-auth's `rateLimit: { storage: 'database' }`.
CREATE TABLE "identity"."rate_limit" (
    "id" text PRIMARY KEY NOT NULL,
    "key" text NOT NULL,
    "count" integer NOT NULL,
    "lastRequest" bigint NOT NULL,
    CONSTRAINT "rate_limit_key_unique" UNIQUE ("key")
);
