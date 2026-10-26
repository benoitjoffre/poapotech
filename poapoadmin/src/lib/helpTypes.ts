import type { IconName } from "../components/Icon";

export interface HelpLink { to: string; label: string }
export interface HelpStep { title: string; body: string; link?: HelpLink }
export interface HelpSection { title: string; paragraphs?: string[]; items?: string[] }

export interface HelpArticle {
  slug: string;
  number: number;
  title: string;
  summary: string;
  minutes: number;
  category: string;
  icon: IconName;
  intro: string;
  steps: HelpStep[];
  sections?: HelpSection[];
  tips: string[];
}

export interface HelpFaq { question: string; answer: string; slug?: string }
