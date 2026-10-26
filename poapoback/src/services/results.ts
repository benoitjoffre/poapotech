import { Prisma } from "@prisma/client";
import type { ResultsCounts, ResultsDailyPoint, ResultsSummary } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { QuizError } from "./quizzes";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;
const MAX_QUIZZES = 500;

export interface ResultsFilters { from: Date; to: Date; days: number; quizId?: string; catalogId?: string }

const emptyCounts = (): ResultsCounts => ({ started: 0, completed: 0, recommendations: 0, productClicks: 0 });

function parseDate(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new QuizError(400, `${label} invalide`);
  return date;
}

function optionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 100) throw new QuizError(400, `${label} invalide`);
  return value;
}

/**
 * Convention des périodes : jours UTC entiers, intervalle [from, to[.
 * `from` est arrondi au début de son jour UTC, `to` au début du jour UTC suivant s'il n'est pas déjà à minuit.
 * Ainsi 30 jours = exactement 30 jours UTC (aujourd'hui inclus, partiel), et totaux, série quotidienne
 * et période précédente couvrent les mêmes jours. Défaut : 30 jours se terminant à la fin du jour UTC courant.
 */
export const startOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export const endOfUtcDay = (date: Date) => {
  const start = startOfUtcDay(date);
  return start.getTime() === date.getTime() ? start : new Date(start.getTime() + DAY_MS);
};

export function parseResultsFilters(query: Record<string, unknown>, now = new Date()): ResultsFilters {
  const rawTo = parseDate(query.to, "Date de fin");
  const to = endOfUtcDay(rawTo ?? now);
  const rawFrom = parseDate(query.from, "Date de début");
  const from = rawFrom ? startOfUtcDay(rawFrom) : new Date(to.getTime() - 30 * DAY_MS);
  if (from >= to) throw new QuizError(400, "La date de début doit précéder la date de fin");
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (days > MAX_DAYS) throw new QuizError(400, "Période limitée à 366 jours");
  return { from, to, days, quizId: optionalId(query.quizId, "Expérience"), catalogId: optionalId(query.catalogId, "Catalogue") };
}

/** Fenêtre précédente de même durée, pour comparer les périodes. */
export function previousWindow(f: { from: Date; to: Date }): { from: Date; to: Date } {
  const length = f.to.getTime() - f.from.getTime();
  return { from: new Date(f.from.getTime() - length), to: f.from };
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Jours UTC consécutifs couvrant la fenêtre : les jours sans événement valent 0. */
export function fillDaily(from: Date, to: Date, rows: Map<string, ResultsCounts>): ResultsDailyPoint[] {
  const points: ResultsDailyPoint[] = [];
  const cursor = new Date(`${dayKey(from)}T00:00:00.000Z`);
  while (cursor < to && points.length <= MAX_DAYS + 1) {
    const key = dayKey(cursor);
    points.push({ date: key, ...(rows.get(key) ?? emptyCounts()) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

type MetricRow = { quizId: string; started: number; completed: number; productClicks: number };
type DayRow = { day: string; started: number; completed: number; productClicks: number };

/** Compteurs d'événements par quiz : une seule agrégation SQL, bornée aux quiz du tenant. */
export async function countsByQuiz(tenantId: string, quizIds: string[], from: Date, to: Date): Promise<Map<string, ResultsCounts>> {
  const result = new Map<string, ResultsCounts>();
  if (quizIds.length === 0) return result;
  const [metrics, sessions] = await Promise.all([
    prisma.$queryRaw<MetricRow[]>`
      SELECT "quizId",
             COUNT(*) FILTER (WHERE "type" = 'quiz_start')::int AS started,
             COUNT(*) FILTER (WHERE "type" = 'quiz_complete')::int AS completed,
             COUNT(*) FILTER (WHERE "type" = 'buy_click')::int AS "productClicks"
      FROM "Metric"
      WHERE "tenantId" = ${tenantId} AND "quizId" IN (${Prisma.join(quizIds)})
        AND "createdAt" >= ${from} AND "createdAt" < ${to}
        AND "type" IN ('quiz_start', 'quiz_complete', 'buy_click')
      GROUP BY "quizId"`,
    prisma.quizSession.groupBy({
      by: ["quizId"],
      where: { tenantId, quizId: { in: quizIds }, completedAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
  ]);
  for (const row of metrics) result.set(row.quizId, { started: row.started, completed: row.completed, recommendations: 0, productClicks: row.productClicks });
  for (const row of sessions) {
    const entry = result.get(row.quizId) ?? emptyCounts();
    entry.recommendations = row._count._all;
    result.set(row.quizId, entry);
  }
  return result;
}

/** Série quotidienne (jours UTC) sur un ensemble de quiz du tenant. */
export async function dailyCounts(tenantId: string, quizIds: string[], from: Date, to: Date): Promise<ResultsDailyPoint[]> {
  if (quizIds.length === 0) return fillDaily(from, to, new Map());
  const [metrics, sessions] = await Promise.all([
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE "type" = 'quiz_start')::int AS started,
             COUNT(*) FILTER (WHERE "type" = 'quiz_complete')::int AS completed,
             COUNT(*) FILTER (WHERE "type" = 'buy_click')::int AS "productClicks"
      FROM "Metric"
      WHERE "tenantId" = ${tenantId} AND "quizId" IN (${Prisma.join(quizIds)})
        AND "createdAt" >= ${from} AND "createdAt" < ${to}
        AND "type" IN ('quiz_start', 'quiz_complete', 'buy_click')
      GROUP BY 1
      LIMIT 400`,
    prisma.$queryRaw<{ day: string; recommendations: number }[]>`
      SELECT to_char(("completedAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS recommendations
      FROM "QuizSession"
      WHERE "tenantId" = ${tenantId} AND "quizId" IN (${Prisma.join(quizIds)})
        AND "completedAt" >= ${from} AND "completedAt" < ${to}
      GROUP BY 1
      LIMIT 400`,
  ]);
  const byDay = new Map<string, ResultsCounts>();
  for (const row of metrics) byDay.set(row.day, { started: row.started, completed: row.completed, recommendations: 0, productClicks: row.productClicks });
  for (const row of sessions) {
    const entry = byDay.get(row.day) ?? emptyCounts();
    entry.recommendations = row.recommendations;
    byDay.set(row.day, entry);
  }
  return fillDaily(from, to, byDay);
}

export function sumCounts(counts: Iterable<ResultsCounts>): ResultsCounts {
  const total = emptyCounts();
  for (const c of counts) {
    total.started += c.started; total.completed += c.completed;
    total.recommendations += c.recommendations; total.productClicks += c.productClicks;
  }
  return total;
}

/** Synthèse tenant-scopée. Chaque quiz n'est compté qu'une fois, quel que soit le nombre de campagnes qui le partagent. */
export async function resultsSummary(tenantId: string, filters: ResultsFilters): Promise<ResultsSummary> {
  const [catalogs, allQuizzes] = await Promise.all([
    prisma.catalog.findMany({ where: { tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true }, take: 100 }),
    prisma.quiz.findMany({
      where: { tenantId, ...(filters.catalogId ? { catalogId: filters.catalogId } : {}), ...(filters.quizId ? { id: filters.quizId } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, active: true, catalogId: true, catalog: { select: { name: true } } },
      take: MAX_QUIZZES + 1,
    }),
  ]);
  const truncated = allQuizzes.length > MAX_QUIZZES;
  const quizzes = allQuizzes.slice(0, MAX_QUIZZES);
  const ids = quizzes.map((quiz) => quiz.id);
  const previous = previousWindow(filters);
  const [current, before, daily] = await Promise.all([
    countsByQuiz(tenantId, ids, filters.from, filters.to),
    countsByQuiz(tenantId, ids, previous.from, previous.to),
    dailyCounts(tenantId, ids, filters.from, filters.to),
  ]);
  const experiences = quizzes.map((quiz) => ({
    id: quiz.id, name: quiz.name, active: quiz.active, catalogId: quiz.catalogId, catalogName: quiz.catalog.name,
    ...(current.get(quiz.id) ?? emptyCounts()),
  }));
  return {
    period: { from: filters.from.toISOString(), to: filters.to.toISOString(), days: filters.days },
    totals: sumCounts(current.values()),
    previous: sumCounts(before.values()),
    daily,
    experiences,
    catalogs,
    truncated,
    quizLimit: MAX_QUIZZES,
  };
}
